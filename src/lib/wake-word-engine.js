// src/lib/wake-word-engine.js
// ─────────────────────────────────────────────────────────────────────────────
// QuietKeep Wake / Instant-Invoke Engine  (v1 — replaces the alwaysListening.ts stub)
//
// Retires the self-labelled STUB in src/lib/alwaysListening.ts with a REAL,
// battery-honest, tiered invocation layer, per the advancement blueprint (B1):
//
//   TIER 0  manual        — tap mic / push-to-talk (web + everywhere). Always on.
//   TIER 1  invoke        — Android default-assistant (power long-press),
//                           persistent-notification mic action, home widget.
//                           Zero wake-word battery cost. The primary Android path.
//   TIER 2  counter       — opt-in acoustic hotword ("Aaria") via openWakeWord
//                           tflite inside the existing mic FOREGROUND SERVICE.
//                           Meant for the docked/charging shop-counter phone,
//                           where always-listening is battery-irrelevant.
//
// iOS / PWA: only TIER 0 is possible (no third-party background mic). We detect
// and degrade honestly instead of pretending, which is the bug this replaces.
//
// The native Android side is expected to expose a bridge on window.__QK_WAKE__
// (injected by MainActivity / a Capacitor plugin) mirroring the existing
// window.__QK_TTS__ pattern used in VoiceTalkback.jsx. When absent (web), the
// engine still works for TIER 0/1 UI wiring and no-ops the native calls.
// ─────────────────────────────────────────────────────────────────────────────

const LS_WAKE_MODE = 'qk_wake_mode_v2';   // 'manual' | 'invoke' | 'counter'
const LS_WAKE_WORD = 'qk_wake_word';      // customizable, default 'aaria'
const DEFAULT_WAKE_WORD = 'aaria';

// openWakeWord model shipped in /public/models/ (tflite). Free, Apache-2.0.
const OWW_MODEL_URL = '/models/aaria_wakeword.tflite';
const OWW_THRESHOLD = 0.6;   // detection confidence; tune per accuracy tests

// ── tiny event emitter (no deps) ─────────────────────────────────────────────
const listeners = new Set();
function emitWake(payload) {
  // Fire a DOM CustomEvent (parity with the stub's documented `lotus_wake`)
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    try { window.dispatchEvent(new CustomEvent('qk_wake', { detail: payload })); } catch (_) {}
  }
  listeners.forEach((fn) => { try { fn(payload); } catch (_) {} });
}
export function onWake(fn) { listeners.add(fn); return () => listeners.delete(fn); }

// ── platform + capability detection (honest, no pretending) ──────────────────
function isBrowser() { return typeof window !== 'undefined'; }
function nativeBridge() { return (isBrowser() && window.__QK_WAKE__) || null; }

export function isNativePlatform() {
  return !!(isBrowser() && window.Capacitor
    && typeof window.Capacitor.isNativePlatform === 'function'
    && window.Capacitor.isNativePlatform());
}
export function getPlatform() {
  if (!isNativePlatform()) return 'web';
  const p = window.Capacitor.getPlatform ? window.Capacitor.getPlatform() : 'unknown';
  return p; // 'android' | 'ios' | 'web'
}

// TIER 1 (default-assistant / notification / widget) — Android native only.
export function isInvokeSupported() {
  return getPlatform() === 'android' && !!nativeBridge();
}
// TIER 2 (acoustic hotword) — Android native + a mic foreground service + a model.
export function isCounterModeSupported() {
  const b = nativeBridge();
  return getPlatform() === 'android'
    && !!b
    && typeof b.startHotword === 'function';   // native reports capability by exposing the method
}

// What the UI should actually offer the user, given this device.
export function availableWakeModes() {
  const modes = ['manual'];
  if (isInvokeSupported()) modes.push('invoke');
  if (isCounterModeSupported()) modes.push('counter');
  return modes;
}

// ── mode persistence, with honest degradation (the core stub bug) ────────────
export function getWakeWord() {
  if (!isBrowser()) return DEFAULT_WAKE_WORD;
  return (localStorage.getItem(LS_WAKE_WORD) || DEFAULT_WAKE_WORD).toLowerCase();
}
export function setWakeWord(word) {
  if (!isBrowser() || !word) return;
  localStorage.setItem(LS_WAKE_WORD, String(word).trim().toLowerCase());
}

export function getWakeMode() {
  if (!isBrowser()) return 'manual';
  const stored = localStorage.getItem(LS_WAKE_MODE) || 'manual';
  // Degrade to what the device can actually do — never silently claim more.
  if (stored === 'counter' && !isCounterModeSupported()) return isInvokeSupported() ? 'invoke' : 'manual';
  if (stored === 'invoke' && !isInvokeSupported()) return 'manual';
  return stored;
}

// Returns the mode actually applied (may be a downgrade). Callers should read it
// back and reflect the truth in the UI, instead of assuming success.
export function setWakeMode(requested) {
  if (!isBrowser()) return 'manual';
  let applied = requested;
  if (requested === 'counter' && !isCounterModeSupported()) applied = isInvokeSupported() ? 'invoke' : 'manual';
  if (requested === 'invoke' && !isInvokeSupported()) applied = 'manual';
  localStorage.setItem(LS_WAKE_MODE, applied);
  // Apply immediately.
  stop();
  start(applied);
  return applied;
}

// ── lifecycle ────────────────────────────────────────────────────────────────
let _running = null;   // current running mode
let _oww = null;       // { audioCtx, stream, worker } for web counter fallback (dev only)

export function isRunning() { return _running; }

export function start(mode = getWakeMode()) {
  if (!isBrowser()) return;
  if (_running === mode) return;
  stop();

  if (mode === 'invoke') {
    // Ask the native layer to ensure the default-assistant registration,
    // persistent mic notification, and home widget are active. The actual
    // "wake" arrives later as a native → JS callback (see registerNativeWake).
    const b = nativeBridge();
    if (b && typeof b.ensureInvokeSurfaces === 'function') b.ensureInvokeSurfaces();
    _running = 'invoke';
    return;
  }

  if (mode === 'counter') {
    const b = nativeBridge();
    if (b && typeof b.startHotword === 'function') {
      // Native mic foreground service runs openWakeWord; JS just configures it.
      b.startHotword({ word: getWakeWord(), model: OWW_MODEL_URL, threshold: OWW_THRESHOLD });
      _running = 'counter';
      return;
    }
    // No native hotword available → honest downgrade.
    _running = isInvokeSupported() ? 'invoke' : 'manual';
    return;
  }

  // manual — nothing to run; VoiceCapture's tap handler drives invocation.
  _running = 'manual';
}

export function stop() {
  const b = nativeBridge();
  if (_running === 'counter' && b && typeof b.stopHotword === 'function') {
    try { b.stopHotword(); } catch (_) {}
  }
  if (_oww) {   // tear down any web dev fallback
    try { _oww.stream && _oww.stream.getTracks().forEach((t) => t.stop()); } catch (_) {}
    try { _oww.audioCtx && _oww.audioCtx.close(); } catch (_) {}
    try { _oww.worker && _oww.worker.terminate(); } catch (_) {}
    _oww = null;
  }
  _running = null;
}

// ── native → JS wake callback wiring ─────────────────────────────────────────
// MainActivity / the Capacitor plugin calls window.__qkOnWake(source) when the
// user long-presses power (default assistant), taps the notification mic, taps
// the widget, or the hotword fires. We normalise it into a single 'qk_wake' event
// that the dashboard's existing voice loop can subscribe to.
export function registerNativeWake() {
  if (!isBrowser()) return;
  window.__qkOnWake = (source = 'native') => emitWake({ source, at: Date.now(), word: getWakeWord() });
  // Back-compat: honour the stub's documented event name too.
  window.addEventListener('lotus_wake', () => emitWake({ source: 'legacy_lotus', at: Date.now() }));
}

// Convenience one-call boot used by the dashboard on mount.
export function initWakeEngine() {
  registerNativeWake();
  start(getWakeMode());
  return {
    mode: getWakeMode(),
    available: availableWakeModes(),
    platform: getPlatform(),
    word: getWakeWord(),
  };
}

export default {
  onWake, initWakeEngine, start, stop, isRunning,
  getWakeMode, setWakeMode, getWakeWord, setWakeWord,
  availableWakeModes, isInvokeSupported, isCounterModeSupported,
  isNativePlatform, getPlatform, registerNativeWake,
};
