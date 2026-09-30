// src/lib/reminder-timer.js
//
// WHY THIS EXISTS
// ---------------
// Moving a keep to another state was supposed to keep its reminder in step.
// It never did once, and the reason is three words long.
//
// src/app/dashboard/page.jsx held this:
//
//     const result = await keepsStore.transition(id, state);
//     if (result?.keep?.reminder_at) { ...schedule the reminder... }
//
// keepsStore.transition() is declared `Promise<void>`. It writes the change to
// IndexedDB and schedules a background flush - deliberately, because the store
// is offline-first and the network write may happen minutes later or on
// another day. It has never returned a keep and was never going to.
//
// So `result` was always undefined, the `if` never ran, and the whole block
// was dead from the commit that introduced it. A reminder on a keep that got
// deferred was never re-armed; a reminder on a keep marked done was never
// cancelled and would still fire.
//
// THE FIX IS NOT TO MAKE THE STORE RETURN SOMETHING
// -------------------------------------------------
// That would undo the offline-first design to serve a notification. The client
// already knows everything needed - it is holding the keep on screen. The
// decision belongs here, against local data, and works with no network at all.
//
// This file is pure: it returns the message to post, or null. The caller does
// the posting. Both message shapes are the ones public/sw.js already handles.

// The states that mean "this is finished".
//
// Matches the keeps.status check constraint, which allows exactly:
// open, active, blocked, deferred, reminded, done, closed.
export const TERMINAL_STATES = new Set(['closed', 'done']);

// Do not arm a timer for a moment that has already passed. The service worker
// would fire it immediately, which reads to the user as a random alarm with no
// cause - worse than the silence it replaced.
//
// A minute of slack, because the click and the check are not simultaneous.
const PAST_SLACK_MS = 60_000;

/**
 * What the service worker should be told, now that this keep has changed state.
 *
 * Returns one of:
 *   { type: 'CANCEL_REMINDER', id }                    - finished; stop it firing
 *   { type: 'SCHEDULE_REMINDER', id, text, fireAt }    - still live; keep it armed
 *   null                                               - nothing to do
 *
 * null is the safe answer and covers a keep with no reminder, a reminder in
 * the past, and anything malformed.
 */
export function reminderTimerMessage(keep, newState, nowMs = Date.now()) {
  if (!keep || !keep.id) return null;

  // Finished. Cancel unconditionally - including when there is no reminder_at
  // on the copy we hold, because a stale or partial client record must not be
  // the reason an alarm survives being marked done. Cancelling a timer that
  // does not exist is free; leaving one armed is an alarm at 3am for something
  // the user completed.
  if (TERMINAL_STATES.has(newState)) {
    return { type: 'CANCEL_REMINDER', id: keep.id };
  }

  const at = Date.parse(keep.reminder_at || '');
  if (!Number.isFinite(at)) return null;
  if (at <= nowMs - PAST_SLACK_MS) return null;

  return {
    type:   'SCHEDULE_REMINDER',
    id:     keep.id,
    text:   keep.content || '',
    fireAt: at,
  };
}

/**
 * Post that message, if there is one and a service worker is listening.
 *
 * Separated from the decision so the decision can be tested without a browser,
 * and so a missing service worker is a no-op rather than a thrown error in the
 * middle of a state change the user has already seen succeed on screen.
 */
export function syncReminderTimer(keep, newState, nowMs = Date.now()) {
  const message = reminderTimerMessage(keep, newState, nowMs);
  if (!message) return null;

  try {
    if (typeof navigator !== 'undefined'
        && 'serviceWorker' in navigator
        && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage(message);
      return message;
    }
  } catch {
    // A notification that cannot be scheduled must never break the state
    // change itself, which has already been applied and shown to the user.
  }
  return null;
}
