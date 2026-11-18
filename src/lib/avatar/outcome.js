// src/lib/avatar/outcome.js
// What really happened to the thing the person asked for. (AARIA 4.3 / 4.4)
//
// THE RULE THIS FILE EXISTS TO ENFORCE
// Aaria's face shows "done" only when an action is CONFIRMED completed - never
// on "understood", never on "I will", never on a question back. 13 October
// 2026 is why: "Calling Surya now." was spoken and nothing was dialled.
//
// So the face does not read the reply text at all. It reads this:
//   completed  the server recorded success, or the phone carried the action out
//   pending    Aaria asked something, or is waiting for a yes / unlock / fingerprint
//   failed     refused, errored, or the phone could not carry it out
//   none       nothing to report (a chat answer, a page change)
//
// No dependencies, so it runs under plain node in tests/avatar-outcome.test.mjs.

const _listeners = new Set();

/** Subscribe to { status, reason, at }. Returns unsubscribe. */
export function onOutcome(fn) {
  if (typeof fn !== 'function') return () => { };
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

export function reportOutcome(outcome) {
  if (!outcome || !outcome.status || outcome.status === 'none') return;
  const event = { status: outcome.status, reason: outcome.reason || null, at: Date.now() };
  for (const fn of _listeners) { try { fn(event); } catch { } }
}

/**
 * Read the outcome from /api/voice/capture's answer.
 * Conservative on purpose: anything not provably finished is NOT "completed".
 *
 * @param {object|null} json  the parsed response body
 * @param {boolean} ok        the HTTP status was 2xx
 */
export function outcomeFromCapture(json, ok = true) {
  if (!ok || !json || typeof json !== 'object') return { status: 'failed', reason: 'request_failed' };
  if (json.error) return { status: 'failed', reason: 'server_error' };

  // Background talk Aaria chose to ignore in keep-listening mode: nothing was
  // done, and nothing is said. Never a "done".
  if (json.ignored) return { status: 'none', reason: 'ignored_background_talk' };

  // Waiting on the person: none of these is an action that has happened.
  if (json.needs_unlock) return { status: 'pending', reason: 'needs_unlock' };
  if (json.needs_biometric) return { status: 'pending', reason: 'needs_fingerprint' };
  if (json.follow_up || json.needs_followup || json.clarification) return { status: 'pending', reason: 'asked_a_question' };
  if (Array.isArray(json.choices) && json.choices.length) return { status: 'pending', reason: 'asked_which_one' };

  const recorded = json.step_record && typeof json.step_record.result === 'string' ? json.step_record.result : null;
  if (recorded === 'refused') return { status: 'failed', reason: 'refused' };
  if (recorded === 'pending_confirmation') return { status: 'pending', reason: 'awaiting_yes' };

  // The phone still has to carry this out (a call, navigation). The server
  // saying "do" is a decision, not a result - the result is reported later,
  // by outcomeFromClientAction(), once the phone has actually done it.
  if (json.auto_exec) return { status: 'pending', reason: 'phone_action_not_run_yet' };

  if (recorded === 'success') return { status: 'completed', reason: 'server_recorded_success' };
  // A saved row with an id is a write the database confirmed.
  if (json.keep && json.keep.id) return { status: 'completed', reason: 'saved' };

  return { status: 'none', reason: 'nothing_to_confirm' };
}

/** Read the outcome of an action the phone itself carried out (intent-executor). */
export function outcomeFromClientAction(done) {
  if (done && done.executed === true) return { status: 'completed', reason: 'phone_action_ran' };
  return { status: 'failed', reason: 'phone_action_did_not_run' };
}

/** Test-only. */
export function _resetForTests() { _listeners.clear(); }
