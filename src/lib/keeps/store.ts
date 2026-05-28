/**
 * src/lib/keeps/store.ts
 *
 * The ONLY write surface for keep operations in QuietKeep.
 *
 * Architecture:
 *   1. Every write commits to IndexedDB immediately (synchronous guarantee).
 *   2. Network write is attempted in the background.
 *   3. On success: IndexedDB outbox row is marked 'flushed'.
 *   4. On failure: row stays 'pending' and retries on next flush() call.
 *   5. flush() is called: on app open, on online event, on auth refresh.
 *
 * Queues:
 *   pending   — waiting for network
 *   flushing  — in-flight (prevents double-send)
 *   flushed   — successfully synced (retained 24h then pruned)
 *   failed    — exceeded MAX_RETRIES, needs human intervention
 *   conflict  — server rejected with 409 (duplicate / stale)
 *
 * Idempotency:
 *   Every write gets an idempotency_key = uuid. The server deduplicates
 *   on this key, so replaying a pending outbox row is always safe.
 *   Updates: last-write-wins (replaying an update is harmless — same fields applied twice).
 *
 * P0.2 FIX (2026-05-28):
 *   update operation was previously client-direct via anon key supabase.update().
 *   PostgREST auth.uid()=NULL in RLS context → updates silently failed with 403.
 *   Fixed: update now calls PATCH /api/keeps/[id] (service role, same as transition).
 *
 * Usage:
 *   import { keepsStore } from '@/lib/keeps/store';
 *
 *   const keep = await keepsStore.create({ content: 'Buy groceries', source: 'text' });
 *   await keepsStore.update(keepId, { content: 'Buy groceries tomorrow' });
 *   await keepsStore.transition(keepId, 'closed');
 *   keepsStore.onOutboxChange(count => setPendingCount(count));
 *   await keepsStore.flush();
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type KeepStatus = 'open' | 'active' | 'blocked' | 'deferred' | 'done' | 'closed';
export type OutboxStatus = 'pending' | 'flushing' | 'flushed' | 'failed' | 'conflict';

export interface KeepPayload {
  content: string;
  source?: 'text' | 'voice' | 'android_service';
  intent_type?: string;
  reminder_at?: string | null;
  workspace_id?: string | null;
  language?: string;
  location_name?: string | null;
  geo_trigger_enabled?: boolean;
  tags?: string[];
}

export interface OutboxRow {
  id: string;              // uuid — also the idempotency_key sent to server
  operation: 'create' | 'update' | 'transition';
  keepId: string | null;   // null on create (unknown until server responds)
  payload: Record<string, unknown>;
  status: OutboxStatus;
  retries: number;
  createdAt: number;       // Date.now()
  lastAttempt: number | null;
  error: string | null;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const DB_NAME    = 'qk-keeps-store';
const DB_VERSION = 1;
const STORE_NAME = 'outbox';
const MAX_RETRIES = 4;
const BACKOFF_MS  = [1000, 2000, 5000, 15000]; // per retry index
const FLUSH_DEBOUNCE_MS = 300;
const FLUSHED_TTL_MS = 24 * 60 * 60 * 1000; // prune flushed rows after 24h

// ── IndexedDB helpers ─────────────────────────────────────────────────────────

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('status', 'status', { unique: false });
        store.createIndex('createdAt', 'createdAt', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

function idbGet(db: IDBDatabase, id: string): Promise<OutboxRow | undefined> {
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(id);
    req.onsuccess = () => resolve(req.result as OutboxRow | undefined);
    req.onerror   = () => reject(req.error);
  });
}

function idbPut(db: IDBDatabase, row: OutboxRow): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE_NAME, 'readwrite');
    const req = tx.objectStore(STORE_NAME).put(row);
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(req.error);
  });
}

function idbGetByStatus(db: IDBDatabase, status: OutboxStatus): Promise<OutboxRow[]> {
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE_NAME, 'readonly');
    const index = tx.objectStore(STORE_NAME).index('status');
    const req   = index.getAll(status);
    req.onsuccess = () => resolve(req.result as OutboxRow[]);
    req.onerror   = () => reject(req.error);
  });
}

function idbDelete(db: IDBDatabase, id: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE_NAME, 'readwrite');
    const req = tx.objectStore(STORE_NAME).delete(id);
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(req.error);
  });
}

function idbGetAll(db: IDBDatabase): Promise<OutboxRow[]> {
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = () => resolve(req.result as OutboxRow[]);
    req.onerror   = () => reject(req.error);
  });
}

// ── UUID (no crypto dependency for older Capacitor WebViews) ──────────────────

function uuid(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

// ── Token provider ────────────────────────────────────────────────────────────

type TokenProvider = () => Promise<string | null>;
let _tokenProvider: TokenProvider | null = null;

// ── Outbox change listeners ───────────────────────────────────────────────────

type OutboxListener = (pendingCount: number) => void;
const _listeners: Set<OutboxListener> = new Set();

async function _notifyListeners(): Promise<void> {
  try {
    const db = await openDB();
    const pending = await idbGetByStatus(db, 'pending');
    const count   = pending.length;
    _listeners.forEach(fn => { try { fn(count); } catch {} });
  } catch {}
}

// ── Flush debounce ────────────────────────────────────────────────────────────

let _flushTimer: ReturnType<typeof setTimeout> | null = null;

function _scheduleFlush(): void {
  if (_flushTimer) return;
  _flushTimer = setTimeout(() => {
    _flushTimer = null;
    keepsStore.flush().catch(() => {});
  }, FLUSH_DEBOUNCE_MS);
}

// ── Network write helpers ─────────────────────────────────────────────────────

async function _getToken(): Promise<string | null> {
  if (!_tokenProvider) return null;
  try { return await _tokenProvider(); } catch { return null; }
}

async function _apiWrite(
  method: 'POST' | 'PATCH',
  path: string,
  body: Record<string, unknown>,
  idempotencyKey: string,
): Promise<{ ok: boolean; data: unknown; status: number }> {
  const token = await _getToken();
  const headers: Record<string, string> = {
    'Content-Type':    'application/json',
    'Idempotency-Key': idempotencyKey,
  };
  if (token) headers['Authorization'] = 'Bearer ' + token;

  const res = await fetch(path, {
    method,
    headers,
    body: JSON.stringify(body),
  });

  let data: unknown = null;
  try { data = await res.json(); } catch {}

  return { ok: res.ok, data, status: res.status };
}

// ── Core flush logic ──────────────────────────────────────────────────────────

async function _flushRow(db: IDBDatabase, row: OutboxRow): Promise<void> {
  // Mark as in-flight so concurrent flush() calls skip it.
  await idbPut(db, { ...row, status: 'flushing', lastAttempt: Date.now() });

  const backoffMs = BACKOFF_MS[Math.min(row.retries, BACKOFF_MS.length - 1)];

  // Respect backoff — skip if not enough time has passed since last attempt.
  if (row.lastAttempt && Date.now() - row.lastAttempt < backoffMs) {
    await idbPut(db, { ...row, status: 'pending' });
    return;
  }

  try {
    let result: { ok: boolean; data: unknown; status: number };

    if (row.operation === 'create') {
      // Create routes through voice/capture for AI classification.
      result = await _apiWrite('POST', '/api/voice/capture', row.payload as Record<string, unknown>, row.id);
    } else if (row.operation === 'update') {
      // P0.2 FIX: Previously used client-direct anon key supabase.update() which bypassed
      // service-role requirement and caused 403 failures due to auth.uid()=NULL in RLS context.
      // Now correctly routes to PATCH /api/keeps/[id] which uses createWriteClient().
      if (!row.keepId) {
        await idbPut(db, { ...row, status: 'failed', error: 'update has no keepId' });
        return;
      }
      result = await _apiWrite(
        'PATCH',
        `/api/keeps/${row.keepId}`,
        row.payload as Record<string, unknown>,
        row.id
      );
    } else if (row.operation === 'transition') {
      result = await _apiWrite('POST', `/api/keeps/${row.keepId}/transition`, row.payload as Record<string, unknown>, row.id);
    } else {
      // Unknown operation — move to failed so it doesn't block the queue.
      await idbPut(db, { ...row, status: 'failed', error: 'Unknown operation: ' + row.operation });
      return;
    }

    if (result.ok) {
      await idbPut(db, { ...row, status: 'flushed', error: null });
    } else if (result.status === 409) {
      // Conflict — idempotency dedup hit or stale write. Treat as success.
      await idbPut(db, { ...row, status: 'flushed', error: null });
    } else if (result.status === 401) {
      // Auth error — token expired. Put back as pending; flush() after next refresh will retry.
      await idbPut(db, { ...row, status: 'pending', retries: row.retries, error: 'Auth 401 — will retry after token refresh' });
    } else {
      const retries = row.retries + 1;
      const newStatus: OutboxStatus = retries >= MAX_RETRIES ? 'failed' : 'pending';
      await idbPut(db, {
        ...row,
        status:      newStatus,
        retries,
        lastAttempt: Date.now(),
        error:       `HTTP ${result.status}`,
      });
    }
  } catch (err: unknown) {
    const retries = row.retries + 1;
    const newStatus: OutboxStatus = retries >= MAX_RETRIES ? 'failed' : 'pending';
    await idbPut(db, {
      ...row,
      status:      newStatus,
      retries,
      lastAttempt: Date.now(),
      error:       err instanceof Error ? err.message : String(err),
    });
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export const keepsStore = {
  setTokenProvider(fn: TokenProvider): void {
    _tokenProvider = fn;
  },

  onOutboxChange(fn: OutboxListener): () => void {
    _listeners.add(fn);
    _notifyListeners().catch(() => {});
    return () => _listeners.delete(fn);
  },

  async create(payload: KeepPayload): Promise<{ localId: string }> {
    const localId = uuid();
    const row: OutboxRow = {
      id:          localId,
      operation:   'create',
      keepId:      null,
      payload: {
        transcript:          payload.content,
        source:              payload.source || 'text',
        workspace_id:        payload.workspace_id || null,
        language:            payload.language || 'en-IN',
        reminder_at:         payload.reminder_at || null,
        location_name:       payload.location_name || null,
        geo_trigger_enabled: payload.geo_trigger_enabled || false,
        idempotency_key:     localId,
      },
      status:      'pending',
      retries:     0,
      createdAt:   Date.now(),
      lastAttempt: null,
      error:       null,
    };

    const db = await openDB();
    await idbPut(db, row);
    await _notifyListeners();
    _scheduleFlush();

    return { localId };
  },

  async update(keepId: string, updates: Partial<KeepPayload>): Promise<void> {
    const localId = uuid();
    const row: OutboxRow = {
      id:          localId,
      operation:   'update',
      keepId,
      payload:     updates as Record<string, unknown>,
      status:      'pending',
      retries:     0,
      createdAt:   Date.now(),
      lastAttempt: null,
      error:       null,
    };

    const db = await openDB();
    await idbPut(db, row);
    await _notifyListeners();
    _scheduleFlush();
  },

  async transition(keepId: string, newState: KeepStatus, reason?: string): Promise<void> {
    const localId = uuid();
    const row: OutboxRow = {
      id:          localId,
      operation:   'transition',
      keepId,
      payload:     { new_state: newState, reason: reason || null },
      status:      'pending',
      retries:     0,
      createdAt:   Date.now(),
      lastAttempt: null,
      error:       null,
    };

    const db = await openDB();
    await idbPut(db, row);
    await _notifyListeners();
    _scheduleFlush();
  },

  async flush(): Promise<{ flushed: number; failed: number; pending: number }> {
    let flushedCount = 0;
    let failedCount  = 0;

    try {
      const db      = await openDB();
      const pending = await idbGetByStatus(db, 'pending');

      // Process in order (oldest first) — guarantees create-before-update sequencing.
      const sorted = [...pending].sort((a, b) => a.createdAt - b.createdAt);

      for (const row of sorted) {
        await _flushRow(db, row);
        const updated = await idbGet(db, row.id);
        if (updated?.status === 'flushed') flushedCount++;
        if (updated?.status === 'failed')  failedCount++;
      }

      await _notifyListeners();
      await keepsStore.pruneOld();

      const remaining = await idbGetByStatus(db, 'pending');
      return { flushed: flushedCount, failed: failedCount, pending: remaining.length };
    } catch (err) {
      console.error('[keeps/store] flush error:', err);
      return { flushed: flushedCount, failed: failedCount, pending: 0 };
    }
  },

  async getOutboxSummary(): Promise<{ pending: number; failed: number; total: number }> {
    try {
      const db      = await openDB();
      const all     = await idbGetAll(db);
      const pending = all.filter(r => r.status === 'pending' || r.status === 'flushing').length;
      const failed  = all.filter(r => r.status === 'failed').length;
      return { pending, failed, total: all.length };
    } catch {
      return { pending: 0, failed: 0, total: 0 };
    }
  },

  async getFailed(): Promise<OutboxRow[]> {
    try {
      const db = await openDB();
      return await idbGetByStatus(db, 'failed');
    } catch {
      return [];
    }
  },

  async retryFailed(rowId: string): Promise<void> {
    try {
      const db  = await openDB();
      const row = await idbGet(db, rowId);
      if (!row) return;
      await idbPut(db, { ...row, status: 'pending', retries: 0, error: null });
      await _notifyListeners();
      _scheduleFlush();
    } catch {}
  },

  async discard(rowId: string): Promise<void> {
    try {
      const db = await openDB();
      await idbDelete(db, rowId);
      await _notifyListeners();
    } catch {}
  },

  async pruneOld(): Promise<void> {
    try {
      const db       = await openDB();
      const flushed  = await idbGetByStatus(db, 'flushed');
      const cutoff   = Date.now() - FLUSHED_TTL_MS;
      for (const row of flushed) {
        if (row.createdAt < cutoff) await idbDelete(db, row.id);
      }
    } catch {}
  },

  async clear(): Promise<void> {
    try {
      const db  = await openDB();
      const all = await idbGetAll(db);
      for (const row of all) await idbDelete(db, row.id);
      await _notifyListeners();
    } catch {}
  },
};

// ── Auto-register online listener ─────────────────────────────────────────────

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    console.log('[keeps/store] online — flushing outbox');
    keepsStore.flush().catch(() => {});
  });
}
