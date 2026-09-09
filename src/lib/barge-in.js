// src/lib/barge-in.js
// Barge-in: letting the user interrupt the assistant mid-sentence. (SOT W12)
//
// WHY THIS IS FOUR THINGS AND NOT ONE
// NVIDIA's streaming-pipeline session breaks barge-in into four parts and is
// blunt that teams ship the first two, believe they are done, and then cannot
// work out why the assistant "answers questions nobody asked":
//
//   1. DETECT   the user has started speaking while we are talking
//   2. STOP     synthesis, immediately
//   3. FLUSH    anything already in flight, so it cannot arrive and play later
//   4. TRUNCATE the conversation history, so the model is not told it said
//               things the user never heard
//
// Part 3 is the one that bites in a browser. `speakAaria()` awaits a network
// round trip and only then plays. If the user interrupts during that fetch,
// nothing has started playing yet - so "stop playback" is a no-op - and the
// audio arrives a second later and starts talking over them. Cancelling the
// request is not enough either, because the promise may already have resolved.
//
// Part 4 is the one that corrupts state. If the assistant "said" three
// sentences and the user cut it off after four words, the history must record
// what was heard, not what was generated - otherwise the next turn is answered
// against a conversation that never happened.
//
// HOW THIS SOLVES 3 AND 4 WITHOUT KNOWING ANYTHING ABOUT THE APP
// A monotonic generation counter. Every attempt to speak takes a token. Any
// barge-in bumps the counter, which invalidates every token issued before it.
// Playback code checks `isCurrent(token)` immediately before it makes a sound,
// so late-arriving audio discards itself. No cancellation, no races, no
// AbortController plumbing through five layers.
//
// Stoppers and history truncators are REGISTERED rather than imported, so this
// module has no dependencies, no DOM, and no framework - which is why it can
// be tested with plain node. The wiring lives at the edges where it belongs.

export const BARGE_IN_REASON = {
  USER_SPEECH: 'user_speech',   // the case this exists for
  USER_ACTION: 'user_action',   // tapped stop, pressed Escape
  NEW_SPEECH: 'new_speech',     // a higher-priority utterance replaced this one
  NAVIGATION: 'navigation',     // route change while speaking
};

let _generation = 0;
let _speaking = false;
let _activeToken = 0;
let _lastEvent = null;

const _stoppers = new Set();
const _truncators = new Set();
const _listeners = new Set();

function _safely(fn, label) {
  // A failing stopper must never prevent the remaining stoppers from running.
  // Half-executed barge-in is worse than none: the audio keeps playing AND the
  // history has been truncated.
  try {
    fn();
  } catch (err) {
    try { console.warn(`[barge-in] ${label} threw:`, err); } catch {}
  }
}

/**
 * Register a function that stops audio output. Called on every barge-in.
 * Returns an unsubscribe function.
 *
 * Register every independent output path - browser speechSynthesis, an
 * HTMLAudioElement, a native bridge. Whichever is not registered is the one
 * that keeps talking.
 */
export function registerStopper(fn) {
  if (typeof fn !== 'function') return () => {};
  _stoppers.add(fn);
  return () => _stoppers.delete(fn);
}

/**
 * Register a function that truncates conversation history to what the user
 * actually heard. Called on every barge-in, after the stoppers.
 */
export function registerHistoryTruncator(fn) {
  if (typeof fn !== 'function') return () => {};
  _truncators.add(fn);
  return () => _truncators.delete(fn);
}

/** Subscribe to barge-in events, e.g. to reopen the microphone. */
export function onBargeIn(fn) {
  if (typeof fn !== 'function') return () => {};
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

/**
 * Claim the right to speak. Call BEFORE any network request or playback.
 * Returns a token to pass to isCurrent() immediately before making a sound.
 *
 * Taking a new token supersedes the previous one: a second utterance starting
 * while the first is still in flight silently cancels the first, which is what
 * the existing debounce and 'high' priority behaviour already implied but had
 * no way to enforce.
 */
export function beginSpeech() {
  _generation += 1;
  _activeToken = _generation;
  _speaking = true;
  return _generation;
}

/**
 * True only if this token still represents the current utterance. Check this
 * immediately before playing audio - this is part 3, the flush.
 */
export function isCurrent(token) {
  return token === _generation && _speaking;
}

/** Mark an utterance finished normally. Older tokens are ignored. */
export function endSpeech(token) {
  if (token === _activeToken) _speaking = false;
}

/** Is the assistant currently speaking (or about to)? */
export function isSpeaking() {
  return _speaking;
}

/**
 * Interrupt the assistant. Safe to call at any time.
 *
 * Returns true if something was actually interrupted, false if nothing was
 * speaking. The return value matters: callers use it to decide whether to
 * treat the user's speech as an interruption or as an ordinary new command.
 */
export function bargeIn(reason = BARGE_IN_REASON.USER_SPEECH, detail = null) {
  if (!_speaking) return false;

  // Part 3 first, and before anything that can throw. Bumping the generation
  // is what makes in-flight audio discard itself, so it must happen even if a
  // stopper below explodes.
  _generation += 1;
  _speaking = false;

  const event = { reason, detail, at: Date.now() };
  _lastEvent = event;

  // Part 2 - stop what is already making noise.
  for (const stop of _stoppers) _safely(stop, 'stopper');

  // Part 4 - forget what the user never heard.
  for (const truncate of _truncators) _safely(() => truncate(event), 'truncator');

  for (const listen of _listeners) _safely(() => listen(event), 'listener');

  return true;
}

/** The most recent barge-in, for diagnostics and telemetry. */
export function lastBargeIn() {
  return _lastEvent;
}

// ── Part 1: detection, and why it is not "any speech" ───────────────────────
//
// The microphone stays open while the assistant talks. So the first thing the
// recogniser hears when we start speaking is US. Barging in on any detected
// speech would make the assistant interrupt itself on its own audio, every
// time - a worse product than no barge-in at all.
//
// The real fix is acoustic echo cancellation plus server-side VAD, which is
// what NVIDIA's streaming pipeline provides and what our rebuild (W11) will
// inherit. The Web Speech API gives us neither: it exposes no audio
// constraints, so we cannot ask for echo cancellation on the stream it uses.
//
// Until then, detection is deliberately HIGH PRECISION rather than high
// recall. We interrupt on two signals we can trust:
//
//   * the wake word - "Aaria, stop", "Aaria, wait"
//   * an explicit stop command in any of our languages
//
// and we suppress anything that is explainable as the assistant hearing
// itself. Missing an interruption is a small annoyance; interrupting itself
// mid-answer on an echo is a broken product. That asymmetry sets the rule.

let _spokenText = '';

/** Tell the detector what the assistant is currently saying, for echo filtering. */
export function setSpokenText(text) {
  _spokenText = String(text || '');
}

export function currentSpokenText() {
  return _spokenText;
}

function _norm(s) {
  // \p{M} - combining marks - MUST be kept. Indic vowel signs are marks, not
  // letters: strip them and "ఆగు" becomes "ఆగ", which matches nothing. This
  // exact bug was live here until the Telugu stop word failed its test. It is
  // the same class of defect NVIDIA's Indic session warns about, where a
  // normalisation step written against English quietly mangles Indic text and
  // the damage is later read as a recognition failure.
  return String(s || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Is this heard text most likely our own voice coming back through the mic?
 *
 * Conservative on purpose: it only says yes when the heard words actually
 * appear in what we are saying. A user genuinely repeating our words back is
 * rare; the assistant hearing itself is constant.
 */
export function looksLikeSelfEcho(heard) {
  const h = _norm(heard);
  const s = _norm(_spokenText);
  if (!h || !s) return false;
  if (s.includes(h)) return true;
  const words = h.split(' ').filter(Boolean);
  if (words.length < 2) return false;
  const overlap = words.filter((w) => s.includes(w)).length;
  return overlap / words.length >= 0.8;
}

// Stop words across the languages our users actually speak. Short and
// unambiguous only - a long list here would fire on ordinary conversation.
const STOP_COMMANDS = [
  'stop', 'wait', 'quiet', 'shut up', 'cancel', 'enough', 'be quiet',
  'ruko', 'ruk', 'bas', 'chup', 'band karo',
  'aagu', 'apu', 'ఆగు', 'చాలు', 'chaalu',
];

// Normalised once, so the commands and the heard text are compared in the same
// form. Comparing raw entries against normalised input is how the Telugu entry
// silently stopped matching.
const _STOP_NORM = STOP_COMMANDS.map((c) => _norm(c)).filter(Boolean);

/** Does this look like the user explicitly telling the assistant to stop? */
export function isInterruptCommand(heard) {
  const h = _norm(heard);
  if (!h) return false;
  return _STOP_NORM.some((cmd) => h === cmd || h.startsWith(cmd + ' ') || h.endsWith(' ' + cmd));
}

/**
 * The decision function the microphone layer calls on every recognition result
 * while the assistant is speaking.
 *
 * @param {string} heard        what the recogniser produced
 * @param {boolean} wakeWordHit whether the wake word matched
 * @returns {boolean} true if the assistant was interrupted
 */
export function considerUserSpeech(heard, wakeWordHit = false) {
  if (!_speaking) return false;
  if (looksLikeSelfEcho(heard)) return false;
  if (!wakeWordHit && !isInterruptCommand(heard)) return false;
  return bargeIn(BARGE_IN_REASON.USER_SPEECH, heard);
}

/** Test-only: restore module state. Not used by the app. */
export function _resetForTests() {
  _generation = 0;
  _speaking = false;
  _activeToken = 0;
  _lastEvent = null;
  _spokenText = '';
  _stoppers.clear();
  _truncators.clear();
  _listeners.clear();
}
