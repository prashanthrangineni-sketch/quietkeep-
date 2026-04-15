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
