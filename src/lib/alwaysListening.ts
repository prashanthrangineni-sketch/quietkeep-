/**
 * src/lib/capacitor/alwaysListening.ts
 *
 * Phase 5 — Always-Listening Architecture (STUB — NOT YET ACTIVE)
 *
 * ══════════════════════════════════════════════════════════════════════════
 * DO NOT IMPORT THIS FILE IN PRODUCTION YET.
 * This file is architecture documentation + stub APIs only.
 * All exported functions return early with safe no-ops.
 * Phase 5 implementation happens in a future session.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * ── DESIGN ────────────────────────────────────────────────────────────────
 *
 * GOAL: Detect "Lotus" wake word even when:
 *   - Screen is locked
 *   - App is in background
 *   - User is hands-free
 *
 * CONSTRAINT: Android only. Web/PWA cannot background-listen (OS restriction).
 *
 * ── FLOW ──────────────────────────────────────────────────────────────────
 *
 *   [Mic] → VoiceService.captureThread
 *          → sendChunk() — currently sends every chunk to Sarvam STT
 *          ↓  Phase 5 addition:
 *          → detectWakeWord(chunk) — lightweight energy + keyword scan
 *             → if wake word detected:
 *                dispatchLotusWake() → MainActivity.evaluateJavascript(
 *                  "window.dispatchEvent(new CustomEvent('lotus_wake',
 *                   {detail:{source:'background'}}))"
 *                )
 *                → JS: lotus_wake event listener in dashboard → activate STT
 *
 * ── JAVA CHANGES NEEDED (Phase 5) ────────────────────────────────────────
 *
 * 1. VoiceService.java:
 *    Add static callback interface:
 *      public interface WakeWordListener {
 *        void onWakeWordDetected(String source);
 *      }
 *    Register from MainActivity:
 *      VoiceService.setWakeWordListener((source) ->
 *        dispatchLotusWakeEvent(source));
 *
 * 2. MainActivity.java:
 *    Add dispatchLotusWakeEvent():
 *      getBridge().getWebView().post(() ->
 *        getBridge().getWebView().evaluateJavascript(
 *          "window.dispatchEvent(new CustomEvent('lotus_wake'," +
 *          "{detail:{source:'" + source + "'}}))", null));
 *
 * 3. VoiceService.sendChunk():
 *    Before sending to Sarvam STT, run lightweight energy check:
 *      if (containsWakeWord(rawBytes)) {
 *        notifyWakeWordListeners("background");
 *        // Then send full chunk for command recognition
 *      }
 *
 * ── LOCK SCREEN (Phase 5) ────────────────────────────────────────────────
 *
 * AndroidManifest.xml additions needed:
 *   android:showOnLockScreen="true" on MainActivity
 *   android:turnScreenOn="true"
 *
 * MainActivity.java additions:
 *   // In onCreate():
 *   if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
 *     setShowWhenLocked(true);
 *     setTurnScreenOn(true);
 *   } else {
 *     getWindow().addFlags(
 *       WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED |
 *       WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
 *   }
 *
 *   // Dismiss keyguard when wake word detected:
 *   KeyguardManager km = getSystemService(KeyguardManager.class);
 *   km.requestDismissKeyguard(this, null);
 *
 * ── BATTERY IMPACT ───────────────────────────────────────────────────────
 *
 * Current (Phase 1): VoiceService streams 3s chunks to Sarvam STT.
 *   Battery draw: ~5-8% per hour (AudioRecord + network)
 *
 * Phase 5 addition: lightweight energy pre-filter before each STT call.
 *   - Energy check: ~0.1ms per chunk, negligible
 *   - No change to overall battery draw (already running AudioRecord)
 *   - WakeLock already acquired (30-min timeout, see VoiceService.java)
 *
 * Recommendation: keep always-on listening as opt-in (user toggle).
 *   Default: always-on OFF. User enables via voice settings.
 *
 * ── DEVICE COMPATIBILITY ─────────────────────────────────────────────────
 *
 * Minimum: Android 8.0 (API 26) — FOREGROUND_SERVICE_TYPE_MICROPHONE
 * Required: Android 9.0+ (API 28) — reliable background mic access
 * Tested on: Realme, OnePlus (ColorOS/OxygenOS), Pixel (stock)
 *
 * ColorOS / Realme MIUI note:
 *   These OSes aggressively kill background services even with WakeLock.
 *   Mitigation already in place: KeepAliveService (Hans-freeze prevention).
 *   Phase 5 will also need: Settings → Battery → QuietKeep → "No restrictions"
 *   Guide shown in PermissionOnboarding step (existing component).
 *
 * ── REQUIRED PERMISSIONS (already in AndroidManifest.xml) ────────────────
 *   RECORD_AUDIO            ✅ declared
 *   FOREGROUND_SERVICE      ✅ declared
 *   FOREGROUND_SERVICE_MICROPHONE ✅ declared
 *   WAKE_LOCK               ✅ declared
 *   REQUEST_IGNORE_BATTERY_OPTIMIZATIONS ✅ declared
 *
 * No new permissions needed for Phase 5 beyond what's already declared.
 *
 * ── JS BRIDGE EVENT ──────────────────────────────────────────────────────
 *
 * The 'lotus_wake' CustomEvent is dispatched by VoiceService via
 * MainActivity.dispatchLotusWakeEvent(). Dashboard listens:
 *
 *   window.addEventListener('lotus_wake', (e) => {
 *     // Activate STT, show visual indicator
 *     startVoice();
 *     speak('Listening.');
 *   });
 *
 * This is safe to add NOW in dashboard — it fires only when Phase 5
 * Java code is deployed. No-op otherwise.
 */

// ── Type definitions ───────────────────────────────────────────────────────

export interface AlwaysListeningConfig {
  /** BCP-47 wake word (default: 'lotus') */
  wakeWord:        string;
  /** Whether to unlock screen when wake word detected */
  unlockScreen:    boolean;
  /** Whether to start STT automatically after wake word */
  autoStartSTT:    boolean;
}

export interface AlwaysListeningStatus {
  available:  boolean;
  active:     boolean;
  reason?:    string;
}

// ── Stub API (safe no-ops until Phase 5 implemented) ──────────────────────

/**
 * isAlwaysListeningSupported()
 *
 * Returns true when the device supports always-on listening.
 * Currently always false — placeholder for Phase 5.
 * Phase 5: return isAndroid() && Build.VERSION.SDK_INT >= 26
 */
export function isAlwaysListeningSupported(): boolean {
  return false; // Phase 5
}

/**
 * getAlwaysListeningStatus()
 *
 * Returns current status of always-on listening.
 */
export function getAlwaysListeningStatus(): AlwaysListeningStatus {
  return {
    available: false,
    active:    false,
    reason:    'Phase 5 not yet implemented',
  };
}

/**
 * registerLotusWakeListener(callback)
 *
 * Registers a callback fired when VoiceService detects the wake word.
 * Safe to call now — fires only when Phase 5 Java code is deployed.
 * Returns a cleanup function (call in useEffect return).
 *
 * Usage in dashboard:
 *   import { registerLotusWakeListener } from '@/lib/capacitor/alwaysListening';
 *   useEffect(() => {
 *     const cleanup = registerLotusWakeListener(() => {
 *       startVoice();
 *       speak('Listening.');
 *     });
 *     return cleanup;
 *   }, []);
 */
export function registerLotusWakeListener(
  callback: (detail: { source: string }) => void
): () => void {
  if (typeof window === 'undefined') return () => {};

  const handler = (e: Event) => {
    const detail = (e as CustomEvent).detail ?? { source: 'unknown' };
    callback(detail);
  };

  window.addEventListener('lotus_wake', handler);

  return () => window.removeEventListener('lotus_wake', handler);
}

/**
 * dispatchLotusWakeForTesting()
 *
 * Development helper — manually fires the lotus_wake event from browser.
 * Never call in production. Useful for testing the JS-side listener.
 */
export function dispatchLotusWakeForTesting(source = 'test'): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('lotus_wake', { detail: { source } }));
  console.log('[QK Phase5] lotus_wake dispatched (test mode)');
}
