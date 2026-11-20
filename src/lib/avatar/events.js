// src/lib/avatar/events.js
// The one list of signals every Aaria face listens to. (AARIA item 4.4)
//
// Any face - the 2D orb, the anime characters, the realistic people, and any
// face added later - is drawn from these events and nothing else. A face never
// reads the reply text, never guesses from timers, and never decides on its
// own that something was "done". That keeps every face honest in the same way.
//
//   state         what Aaria is doing: idle | listening | thinking | speaking
//   speech.start  the reply's first audible moment        { source, estimated, durationMs }
//   speech.end    the reply's last audible moment         { source, reason }
//   speech.skip   speak() was called, nothing was said    { reason }
//   mouth         mouth shapes, 0..1 each                 { open, aa, ih, ou, ee, oh }
//                 (defined for faces drawn outside this page; faces in the page
//                 compute it themselves from the playing audio, 60 times a second)
//   emotion       the face's pose                         { pose: idle|listening|thinking|speaking|done|oops }
//   outcome       what happened to the request            { status: completed|pending|failed }
//   error         something went wrong, in plain words   { message }
//
// "done" (emotion) can only follow a "completed" outcome; that rule lives in
// src/lib/avatar/pose.js and is tested in tests/avatar-face.test.mjs.
//
// No dependencies, no DOM: runs under plain node in tests/avatar-events.test.mjs.

export const STATES = Object.freeze(['idle', 'listening', 'thinking', 'speaking']);
export const POSES = Object.freeze(['idle', 'listening', 'thinking', 'speaking', 'done', 'oops']);
export const SPEECH_SOURCES = Object.freeze(['aaria', 'browser', 'native']);
export const OUTCOMES = Object.freeze(['completed', 'pending', 'failed']);
export const MOUTH_KEYS = Object.freeze(['open', 'aa', 'ih', 'ou', 'ee', 'oh']);

const isNum01 = (x) => typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= 1;
const isText = (x, max = 300) => typeof x === 'string' && x.length > 0 && x.length <= max;

/** Each event type and the check its payload must pass. */
export const EVENT_TYPES = Object.freeze({
  state: (p) => STATES.includes(p.state),
  'speech.start': (p) => SPEECH_SOURCES.includes(p.source)
    && typeof p.estimated === 'boolean'
    && (p.durationMs == null || (Number.isFinite(p.durationMs) && p.durationMs > 0)),
  'speech.end': (p) => SPEECH_SOURCES.includes(p.source) && isText(p.reason, 40),
  'speech.skip': (p) => isText(p.reason, 40),
  mouth: (p) => MOUTH_KEYS.every((k) => isNum01(p[k])),
  emotion: (p) => POSES.includes(p.pose),
  outcome: (p) => OUTCOMES.includes(p.status),
  error: (p) => isText(p.message),
});

/** True when this is a well-formed event of a known type. */
export function isValidEvent(e) {
  if (!e || typeof e !== 'object' || typeof e.type !== 'string') return false;
  const check = EVENT_TYPES[e.type];
  if (!check) return false;
  try { return !!check(e); } catch { return false; }
}

/**
 * A small event bus with the contract enforced at the door: an event that
 * does not match the list above is dropped (and counted), never passed on.
 */
export function createAvatarBus({ now = () => Date.now() } = {}) {
  const listeners = new Set();
  let dropped = 0;
  return {
    emit(event) {
      if (!isValidEvent(event)) { dropped += 1; return false; }
      const e = { ...event, at: event.at ?? now() };
      for (const fn of listeners) { try { fn(e); } catch { } }
      return true;
    },
    on(fn) {
      if (typeof fn !== 'function') return () => { };
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    droppedCount: () => dropped,
    listenerCount: () => listeners.size,
  };
}

/** The bus the app uses. */
export const avatarBus = createAvatarBus();

// ── Adapters: today's signals, translated into the contract ────────────────
// Kept here so every source of truth feeds the bus the same way.

/** speech-signal.js event -> contract event (or null). */
export function fromSpeechSignal(s) {
  if (!s) return null;
  if (s.type === 'start') return { type: 'speech.start', source: s.source, estimated: !!s.estimated, durationMs: s.durationMs ?? null };
  if (s.type === 'end') return { type: 'speech.end', source: s.source, reason: s.reason || 'ended' };
  if (s.type === 'skipped') return { type: 'speech.skip', reason: s.reason || 'skipped' };
  return null;
}

/** outcome.js event -> contract event (or null). "none" carries nothing. */
export function fromOutcome(o) {
  if (!o || !OUTCOMES.includes(o.status)) return null;
  return { type: 'outcome', status: o.status };
}

/** The dock's status string -> contract event (or null). */
export function fromStatus(status) {
  return STATES.includes(status) ? { type: 'state', state: status } : null;
}

/** The dock's error text -> contract event (or null). */
export function fromError(message) {
  const m = typeof message === 'string' ? message.trim() : '';
  return m ? { type: 'error', message: m.slice(0, 300) } : null;
}

/**
 * Connect the existing signal modules to a bus. Returns a function that
 * disconnects. The two subscribe functions are passed in, so this file stays
 * free of imports and testable on its own.
 */
export function connectSources(bus, { onSpeechSignal, onOutcome } = {}) {
  const offs = [];
  if (onSpeechSignal) offs.push(onSpeechSignal((s) => { const e = fromSpeechSignal(s); if (e) bus.emit(e); }));
  if (onOutcome) offs.push(onOutcome((o) => { const e = fromOutcome(o); if (e) bus.emit(e); }));
  return () => offs.forEach((off) => { try { off(); } catch { } });
}
