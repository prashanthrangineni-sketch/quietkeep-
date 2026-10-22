// src/lib/blackbox-sync.js
// Uploads sealed black box records (.qkedr) from the phone to Supabase when
// online, and retries on reconnect (DRV-01 step 7).
//
// Kept separate from blackbox.js so the pure maths there stays importable in
// plain node tests. The Supabase client is passed in, never imported here.
//
// Flow per record not yet synced:
//   1. QkBlackbox.readRecord({ id })  -> base64 packet + signature + public key
//   2. storage 'blackbox-records' / <user id>/<record id>.qkedr   (private bucket)
//   3. insert one row into public.blackbox_events
//   4. remember the id locally so it is not uploaded twice
// A storage "already exists" or a duplicate-row error counts as done, so a
// retry after a half-finished attempt converges instead of failing forever.

export const BUCKET = 'blackbox-records';
const SYNCED_KEY = 'qk_blackbox_synced_ids';

function plugin() {
  if (typeof window === 'undefined') return null;
  return window.Capacitor?.Plugins?.QkBlackbox ?? null;
}

function readSynced(storage) {
  try {
    const raw = storage?.getItem(SYNCED_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

function writeSynced(storage, set) {
  try { storage?.setItem(SYNCED_KEY, JSON.stringify([...set].slice(-500))); } catch {}
}

export function base64ToBytes(b64) {
  if (typeof atob === 'function') {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

export function storagePathFor(userId, recordId) {
  return `${userId}/${recordId}.qkedr`;
}

function isAlreadyExists(err) {
  const m = String(err?.message || err?.error || '').toLowerCase();
  return err?.statusCode === '409' || err?.statusCode === 409 || m.includes('already exists') || m.includes('duplicate');
}

/**
 * Upload every local record that has not been synced yet.
 * @param {object} supabase  the app's Supabase client
 * @param {object} [opts]    { plugin, storage } — injectable for tests
 * @returns {Promise<{ uploaded: string[], failed: {id:string, reason:string}[], skipped: string }>}
 */
export async function syncPendingRecords(supabase, opts = {}) {
  const p = opts.plugin ?? plugin();
  const storage = opts.storage ?? (typeof window !== 'undefined' ? window.localStorage : null);
  const result = { uploaded: [], failed: [], skipped: '' };

  if (!p) { result.skipped = 'not_native'; return result; }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) { result.skipped = 'offline'; return result; }

  const { data: authData } = await supabase.auth.getUser();
  const userId = authData?.user?.id;
  if (!userId) { result.skipped = 'signed_out'; return result; }

  let records = [];
  try { records = (await p.list())?.records || []; } catch { records = []; }

  const synced = readSynced(storage);
  for (const r of records) {
    if (!r?.id || synced.has(r.id)) continue;
    // DRV-01c: an unconfirmed jolt stays on the phone and is never uploaded.
    if (r.confirmed === false) continue;
    try {
      const rec = await p.readRecord({ id: r.id });
      const path = storagePathFor(userId, rec.id);
      const bytes = base64ToBytes(rec.data);
      const body = typeof Blob !== 'undefined' ? new Blob([bytes], { type: 'application/octet-stream' }) : bytes;

      const { error: upErr } = await supabase.storage.from(BUCKET)
        .upload(path, body, { upsert: false, contentType: 'application/octet-stream' });
      if (upErr && !isAlreadyExists(upErr)) throw new Error(`upload: ${upErr.message || upErr}`);

      const { error: rowErr } = await supabase.from('blackbox_events').insert({
        owner: userId,
        trigger: rec.trigger,
        started_at: rec.started_at,
        ended_at: rec.ended_at,
        hash: rec.hash,
        signature: rec.signature || '',
        public_key: rec.public_key || '',
        sealed: !!rec.signature,
        storage_path: path,
      });
      if (rowErr && rowErr.code !== '23505') throw new Error(`row: ${rowErr.message || rowErr.code}`);

      synced.add(r.id);
      writeSynced(storage, synced);
      result.uploaded.push(r.id);
    } catch (e) {
      result.failed.push({ id: r.id, reason: String(e?.message || e) });
    }
  }
  return result;
}

/**
 * Sync now, and again whenever the phone comes back online.
 * Returns an unsubscribe function.
 */
export function startBlackboxSync(supabase) {
  if (typeof window === 'undefined') return () => {};
  let busy = false;
  const run = async () => {
    if (busy) return;
    busy = true;
    try {
      const r = await syncPendingRecords(supabase);
      if (r.failed.length) console.warn('[blackbox-sync] failed:', r.failed);
    } catch (e) {
      console.warn('[blackbox-sync] error:', e);
    } finally {
      busy = false;
    }
  };
  run();
  window.addEventListener('online', run);
  return () => window.removeEventListener('online', run);
}
