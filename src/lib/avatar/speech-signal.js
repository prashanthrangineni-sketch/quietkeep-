// src/lib/avatar/speech-signal.js
// When Aaria's reply is REALLY audible. (AARIA work package, item 4.1)
//
// WHY THIS EXISTS
// The dock showed "Speaking" from a guess: a timer of 1.2 s plus 55 ms per
// character, capped at 9 s (context/aaria.jsx, say()). The guess started
// before the voice had even been fetched, ended early on any reply longer than
// about 140 characters, and showed "Speaking" when nothing was said at all
// (voice replies switched off, or the same sentence repeated within 1.5 s).
//
// The three places that actually make sound know the truth:
//   * src/lib/tts.js playAudioUrl()        - Aaria's own voice (an <audio>)
//   * VoiceTalkback.jsx browser fallback   - speechSynthesis onstart / onend
//   * VoiceTalkback.jsx native fallback    - the phone's system voice. Its
//     bridge has speak / stop / setLanguage and no "finished" callback, so
//     this one path still reports an ESTIMATED end, and says so.
// They announce it here; whoever draws Aaria listens here.
//
// The thinking sounds (src/lib/fillers.js) deliberately do NOT announce: an
// "okay" while the brain works is not Aaria speaking her reply.
//
// No dependencies, no DOM, no framework - so it runs under plain node in
// tests/speech-signal.test.mjs, the same way barge-in.js does.

const _listeners = new Set();
let _seq = 0;
let _active = null;   // { id, source, estimated, durationMs, at } or null

function _emit(event) {
  for (const fn of _listeners) {
    // One broken listener must never stop the others hearing "ended".
    try { fn(event); } catch (err) {
      try { console.warn('[speech-signal] listener threw:', err); } catch { }
    }
  }
}

/** Subscribe to { type: 'start' | 'end' | 'skipped', ... }. Returns unsubscribe. */
export function onSpeechSignal(fn) {
  if (typeof fn !== 'function') return () => { };
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

/**
 * Sound has started coming out. Returns an id to pass to speechEnded().
 * A start while another speech is active ends the older one first
 * ('superseded'), so an "end" can never be missing.
 *
 * @param {'aaria'|'browser'|'native'} source
 * @param {boolean} estimated   true when the END of this speech will be a guess
 * @param {number|null} durationMs  length of the sound, when known
 */
export function speechStarted({ source = 'aaria', estimated = false, durationMs = null } = {}) {
  if (_active) speechEnded(_active.id, 'superseded');
  _seq += 1;
  const dur = Number.isFinite(durationMs) && durationMs > 0 ? Math.round(durationMs) : null;
  _active = { id: _seq, source, estimated: !!estimated, durationMs: dur, at: Date.now() };
  _emit({ type: 'start', ..._active });
  return _active.id;
}

/**
 * The sound with this id has stopped. Idempotent, and an id that is no longer
 * the active one is ignored - an old reply can never end a newer one.
 */
export function speechEnded(id, reason = 'ended') {
  if (!_active || _active.id !== id) return false;
  const was = _active;
  _active = null;
  _emit({
    type: 'end', id: was.id, source: was.source, estimated: was.estimated,
    reason, at: Date.now(), spokeForMs: Date.now() - was.at,
  });
  return true;
}

/** speak() was called and nothing will be said (talkback off, duplicate, no output). */
export function speechSkipped(reason = 'skipped') {
  _emit({ type: 'skipped', reason, at: Date.now() });
}

/** The speech that is audible right now, or null. */
export function activeSpeech() {
  return _active ? { ..._active } : null;
}

// ── The "speaking" state, driven by the signal ──────────────────────────────
//
// say() calls expect() and then speak(). From there:
//   start    -> onSpeaking()            the first sound of the reply
//   end      -> onIdle(reason)          the last sound of the reply
//   skipped  -> onIdle(reason)          nothing was going to be said
// and two safety nets, because a state that can stick is worse than a guess:
//   * no sound within startTimeoutMs of expect()        -> onIdle('no_sound')
//     (a slow voice that arrives up to lateStartMs later is still shown)
//   * no end within the sound's own length + slackMs    -> onIdle('overrun')
//     (only when the length is known; an estimated end arrives by itself)
//
// Kept apart from React so every rule above has a plain-node test.
export function createSpeakingTracker({
  onSpeaking,
  onIdle,
  startTimeoutMs = 6000,
  slackMs = 2000,
  lateStartMs = 30000,
  now = () => Date.now(),
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (t) => clearTimeout(t),
} = {}) {
  let pending = false;      // expect() was called, no sound yet
  let pendingUntil = 0;     // a start after this moment is not this reply's
  let currentId = null;     // the speech this tracker is showing as "speaking"
  let startTimer = null;
  let endTimer = null;

  const clearTimers = () => {
    if (startTimer !== null) { clearTimer(startTimer); startTimer = null; }
    if (endTimer !== null) { clearTimer(endTimer); endTimer = null; }
  };
  const idle = (reason) => {
    pending = false; currentId = null; clearTimers();
    try { onIdle?.(reason); } catch { }
  };

  const off = onSpeechSignal((e) => {
    if (e.type === 'start') {
      if (!pending || now() > pendingUntil) { pending = false; return; }   // not a reply this tracker was asked to show
      pending = false;
      currentId = e.id;
      clearTimers();
      if (!e.estimated && e.durationMs) {
        endTimer = setTimer(() => { endTimer = null; idle('overrun'); }, e.durationMs + slackMs);
      }
      try { onSpeaking?.(e); } catch { }
      return;
    }
    if (e.type === 'end') {
      // While a NEW reply is awaited, the old one ending is not "idle": the
      // new one is about to start (or its own safety net will fire).
      if (pending) { if (e.id === currentId) currentId = null; return; }
      if (e.id !== currentId) return;
      idle(e.reason);
      return;
    }
    if (e.type === 'skipped') {
      if (!pending) return;
      pending = false;
      if (startTimer !== null) { clearTimer(startTimer); startTimer = null; }
      // The same sentence said twice in a row is skipped while the first is
      // still audible: keep showing that one, do not go idle under it.
      const still = activeSpeech();
      if (currentId !== null && still && still.id === currentId) return;
      idle(e.reason);
    }
  });

  return {
    /** A reply is about to be spoken. Call BEFORE speak(). */
    expect() {
      pending = true;
      pendingUntil = now() + startTimeoutMs + lateStartMs;
      if (startTimer !== null) clearTimer(startTimer);
      startTimer = setTimer(() => {
        startTimer = null;
        if (!pending) return;
        const still = activeSpeech();
        if (currentId !== null && still && still.id === currentId) { pending = false; return; }
        // Show idle, but stay ready: a voice fetched from a sleeping server
        // can take longer than this, and must still be shown when it comes.
        currentId = null;
        try { onIdle?.('no_sound'); } catch { }
      }, startTimeoutMs);
    },
    /** Forget everything without calling back (stopped by hand, unmount). */
    cancel() { pending = false; currentId = null; clearTimers(); },
    isPending: () => pending,
    isSpeaking: () => currentId !== null,
    dispose() { pending = false; currentId = null; clearTimers(); off(); },
  };
}

/** Test-only: restore module state. Not used by the app. */
export function _resetForTests() {
  _listeners.clear();
  _seq = 0;
  _active = null;
}
