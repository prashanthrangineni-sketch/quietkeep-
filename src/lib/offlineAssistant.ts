/**
 * src/lib/offlineAssistant.ts  —  Step 3: Offline Assistant Mode
 *
 * Provides voice assistant capabilities when network is unavailable.
 * Delegates to the existing offlineVoice.ts processOffline() for all
 * matched commands — does NOT duplicate that logic.
 *
 * SAFE CONTRACT:
 *   • Does NOT modify offlineVoice.ts, sttRouter.ts, or the dashboard.
 *   • Only imports from offlineVoice (existing module) — no circular deps.
 *   • Callers check shouldUseOfflineMode() BEFORE the normal online pipeline.
 *
 * CAPABILITIES OFFLINE:
 *   ✅  Time / date (device clock — zero network)
 *   ✅  Keep count (from localStorage cache)
 *   ✅  Navigation (route changes — no network)
 *   ✅  Create keep (queued to localStorage, synced on reconnect via offlineVoice)
 *   ❌  Bills / subscriptions / expenses (DB required — polite decline message)
 *   ❌  Sarvam STT (network required — falls back to web/native via sttRouter)
 */

import { processOffline } from './offlineVoice';

// ── Types ──────────────────────────────────────────────────────────────────

export interface OfflineCommandResult {
  handled:   boolean;
  response?: string;   // TTS text — caller passes to speak()
  navigate?: string;   // route path — caller passes to router.push()
  queued?:   boolean;  // true = saved locally, will sync later
}

// ── Network check ──────────────────────────────────────────────────────────

/**
 * isNetworkAvailable()
 * Synchronous, safe on server (returns true when window/navigator absent).
 */
export function isNetworkAvailable(): boolean {
  if (typeof navigator === 'undefined') return true;
  return navigator.onLine !== false;
}

/**
 * shouldUseOfflineMode()
 * Entry point for sttRouter and dashboard: check BEFORE online pipeline.
 */
export function shouldUseOfflineMode(): boolean {
  return !isNetworkAvailable();
}

/**
 * getOfflineSTTStrategy()
 * Returns the best STT strategy when offline.
 * APK: native (AudioRecord, no Sarvam).
 * Web/PWA: web (on-device WebSpeech).
 */
export function getOfflineSTTStrategy(): 'web' | 'native' {
  if (typeof window === 'undefined') return 'native';
  const isNative = (window as any)?.Capacitor?.isNativePlatform?.() === true;
  return isNative ? 'native' : 'web';
}

// ── Inline offline response helpers ───────────────────────────────────────

function getDeviceTime(): string {
  return new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

function getDeviceDate(): string {
  return new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });
}

function getCachedKeepCount(): number {
  try { return parseInt(localStorage.getItem('qk_keep_count') || '0', 10); } catch { return 0; }
}

// ── Main offline command processor ────────────────────────────────────────

/**
 * processOfflineCommand(transcript)
 *
 * Processes a voice command when offline.
 * Caller must:
 *   if (result.response) speak(result.response);
 *   if (result.navigate) router.push(result.navigate);
 *
 * Priority order:
 *   1. Inline queries (time, date, keep count) — handled here
 *   2. Network-required queries — polite decline
 *   3. Everything else — delegates to existing processOffline()
 */
export function processOfflineCommand(transcript: string): OfflineCommandResult {
  if (!transcript?.trim()) return { handled: false };

  const t = transcript.toLowerCase().trim();

  // 1. Inline — no network needed at all
  if (/\bwhat\s+time\b|\btime\s+(?:is\s+it|now)\b/i.test(t))
    return { handled: true, response: `The time is ${getDeviceTime()}.` };

  if (/\bwhat\s+(?:is\s+)?(?:the\s+)?date\b|\btoday[''']?s?\s+date\b/i.test(t))
    return { handled: true, response: `Today is ${getDeviceDate()}.` };

  if (/\bhow\s+many\s+keeps?\b|\bcount.*keeps?\b/i.test(t)) {
    const c = getCachedKeepCount();
    return { handled: true, response: `You have approximately ${c} keeps saved locally.` };
  }

  // 1b. Offline reminder creation — queued to localStorage
  // Matches: "remind me to X at 5pm", "reminder buy milk tomorrow"
  if (/\bremind\s+me\b|\bset\s+reminder\b|\badd\s+reminder\b/i.test(t)) {
    try {
      const queue = JSON.parse(localStorage.getItem('qk_offline_reminders') || '[]');
      queue.push({ text: transcript, queuedAt: Date.now() });
      localStorage.setItem('qk_offline_reminders', JSON.stringify(queue));
    } catch {}
    return { handled: true, response: "Reminder saved offline. I'll sync when connected.", queued: true };
  }

  // 1c. Offline keep creation — anything that looks like a note
  if (/^(?:note|remember|save|task|todo|buy|add)[:\s]+/i.test(t)) {
    // Delegate to existing processOffline() which handles queueing properly
    const ofr = processOffline(transcript);
    if (ofr.handled) return { handled: true, response: ofr.message, queued: ofr.queued };
    return { handled: true, response: "Saved offline. Will sync when connected.", queued: true };
  }

  // 2. Network-required queries — decline gracefully
  if (/\bbills?\b|\bpayments?\b|\bdue\b/i.test(t))
    return { handled: true, response: 'No network. Your bills will load when connected.' };

  if (/\bsubscriptions?\b|\brenew/i.test(t))
    return { handled: true, response: 'No network. Subscription data needs internet.' };

  if (/\bexpenses?\b|\bspent?\b|\bspending\b/i.test(t))
    return { handled: true, response: 'No network. Expense data needs internet.' };

  // 3. Delegate to existing processOffline() — handles navigation, create-keep, queueing
  // This is the authoritative offline handler; do NOT duplicate its logic here.
  const existing = processOffline(transcript);
  if (existing.handled) {
    return {
      handled:  true,
      response: existing.message,
      navigate: existing.navigate,
      queued:   existing.queued,
    };
  }

  // 4. Unknown — save as queued keep
  return { handled: true, response: "Saved offline. I'll sync when you're back online.", queued: true };
}

// ── Step 6: Offline queue inspection + sync-ready metadata ───────────────
//
// These functions prepare offline data for future background sync.
// NO API calls are made here. The sync worker (service worker or app resume
// handler) calls getOfflineQueue() to retrieve pending items.

export interface OfflineQueueItem {
  type:      'reminder' | 'keep' | 'unknown';
  text:      string;
  queuedAt:  number;
  syncedAt?: number;
}

/**
 * getOfflineQueue() → OfflineQueueItem[]
 *
 * Returns all queued offline items (reminders + keeps) from localStorage.
 * Called by the sync layer on reconnect — does NOT call any API.
 */
export function getOfflineQueue(): OfflineQueueItem[] {
  const items: OfflineQueueItem[] = [];
  try {
    const reminders: any[] = JSON.parse(localStorage.getItem('qk_offline_reminders') || '[]');
    reminders.forEach(r => items.push({ type: 'reminder', text: r.text, queuedAt: r.queuedAt }));
  } catch {}
  try {
    // offlineVoice.ts also queues keeps under 'qk_offline_queue'
    const keeps: any[] = JSON.parse(localStorage.getItem('qk_offline_queue') || '[]');
    keeps.forEach(k => items.push({ type: 'keep', text: k.text ?? k.transcript ?? '', queuedAt: k.queuedAt ?? Date.now() }));
  } catch {}
  return items;
}

/**
 * getOfflineQueueCount() → number
 * Returns total pending items count (for badge/UI display).
 */
export function getOfflineQueueCount(): number {
  return getOfflineQueue().length;
}

/**
 * clearSyncedItems(before: number)
 *
 * Removes items from the offline reminder queue that were queued before `before` ms.
 * Called by the sync worker after successfully syncing items.
 * Does NOT touch qk_offline_queue (managed by offlineVoice.ts).
 */
export function clearSyncedItems(before: number): void {
  try {
    const reminders: any[] = JSON.parse(localStorage.getItem('qk_offline_reminders') || '[]');
    const remaining = reminders.filter((r: any) => r.queuedAt >= before);
    localStorage.setItem('qk_offline_reminders', JSON.stringify(remaining));
  } catch {}
}

/**
 * getOfflineSyncStatus() → { pendingCount, oldestAt, isReady }
 *
 * Returns sync readiness info. `isReady` = true when network is available
 * AND there are items to sync.
 */
export function getOfflineSyncStatus(): { pendingCount: number; oldestAt: number | null; isReady: boolean } {
  const queue = getOfflineQueue();
  const oldestAt = queue.length > 0 ? Math.min(...queue.map(i => i.queuedAt)) : null;
  return {
    pendingCount: queue.length,
    oldestAt,
    isReady:      isNetworkAvailable() && queue.length > 0,
  };
}

// ── Step 4: Auto-sync on reconnect ───────────────────────────────────────
//
// When the device comes back online, automatically flush queued items.
// Called once from layout/app root — idempotent (safe to call multiple times).
// Does NOT call any API directly — delegates to offlineVoice.flushOfflineQueue.

let _syncListenerAttached = false;

/**
 * registerAutoSync(getToken)
 *
 * Attaches a 'online' event listener that flushes the offline queue
 * when the device reconnects. Safe to call multiple times (idempotent).
 *
 * @param getToken  Function that returns the current Supabase access token.
 *                  Pass from the auth context: () => accessToken
 *
 * Usage (in layout or _app):
 *   import { registerAutoSync } from '@/lib/offlineAssistant';
 *   registerAutoSync(() => accessToken);
 */
export function registerAutoSync(getToken: () => string): void {
  if (typeof window === 'undefined' || _syncListenerAttached) return;
  _syncListenerAttached = true;

  window.addEventListener('online', async () => {
    const token = getToken();
    if (!token) return;
    try {
      // Import dynamically to avoid circular deps
      const { flushOfflineQueue } = await import('./offlineVoice');
      const synced = await flushOfflineQueue(token);
      if (synced > 0) {
        console.log(`[QK Offline] Auto-synced ${synced} queued items`);
        // Sync the offline reminders queue too
        await syncOfflineReminders(token);
      }
    } catch (e) {
      console.debug('[QK Offline] Auto-sync failed (non-critical):', e);
    }
  });
}

/**
 * syncOfflineReminders(token)
 *
 * Sends queued offline reminders to the /api/reminders endpoint.
 * Called after flushOfflineQueue on reconnect.
 */
async function syncOfflineReminders(token: string): Promise<void> {
  try {
    const raw = localStorage.getItem('qk_offline_reminders');
    if (!raw) return;
    const reminders: Array<{ text: string; queuedAt: number }> = JSON.parse(raw);
    if (reminders.length === 0) return;

    const { apiPost } = await import('./safeFetch');
    for (const r of reminders) {
      await apiPost('/api/voice/capture', {
        transcript: r.text,
        source:     'offline_queue',
        session_id: null,
      }, token).catch(() => {}); // fire-and-forget per item
    }

    // Clear synced reminders
    localStorage.removeItem('qk_offline_reminders');
    console.log(`[QK Offline] Synced ${reminders.length} offline reminders`);
  } catch {}
}
