// src/lib/follow-up-answer.js
//
// WHY THIS EXISTS
// ---------------
// Aaria asks questions and then forgets it asked them.
//
// On 30 September 2026 the founder said "5 నిమిషాల్లో సూర్య కిరణ్‌కి కాల్
// చెయ్యి". The recogniser lost the time, so Aaria correctly asked "When should
// I remind you to call Surya Kiran? It is eleven oh four now." He tapped
// speak, said "five minutes" — and that became a BRAND NEW instruction,
// parsed from nothing, with no idea a question was outstanding. His words:
//
//   "i need to click tap where it would be new instruction not the
//    continuation of its context... like if its a wake word then it would be
//    continuos and meaning ful"
//
// He is right, and this is the smaller half of that. Continuous listening is a
// separate piece of work. Remembering the question you asked thirty seconds
// ago is not — it is a lookup and a guard, and without it every clarifying
// question Aaria asks is a dead end.
//
// WHAT THIS FILE IS AND IS NOT
// -----------------------------
// It is a pure decision: given the keep that carries an unanswered question
// and the words just spoken, is this an ANSWER or a new instruction? No
// database, no network, no side effects, so it can be tested exhaustively.
//
// It is deliberately narrow. The guards below exist because the failure mode
// of getting this wrong is far worse than the failure it fixes: a new
// instruction swallowed as an answer to an old question is a note the user
// never gets, and they will not know why.

// Relative, not '@/lib/...', on purpose. The node test suite loads these files
// directly and the bundler alias does not exist there - which is why
// contacts-flatten.js was written dependency-free for the same reason.
import { relativeMinutesFromText, computeReminderAt } from './intent-executor.js'

// ONE CLOCK.
//
// isUsableInstant() in intent-executor.js is the right check in the right
// place, and it reads the real wall clock. Every decision in THIS file is made
// against an injected `nowMs` so it can be tested at a fixed moment.
//
// Mixing the two is not a testing inconvenience, it is a defect: a keep that
// already carried a time was judged against a different instant than the
// question's age was, so the "do not re-open an answered question" guard
// silently stopped firing once real time moved past the keep's reminder. CI
// caught it on the first run.
//
// Same one-minute slack as isUsableInstant, for the same reason: the write and
// the check are never simultaneous.
const SLACK_MS = 60_000

function isFutureInstant(value, nowMs) {
  if (!value) return false
  const t = value instanceof Date ? value.getTime() : Date.parse(String(value))
  return Number.isFinite(t) && t > nowMs - SLACK_MS
}

// How long a question stays open.
//
// Long enough to fumble with the phone, short enough that "five minutes" said
// ten minutes later is obviously a new thought. The founder's own sequence on
// 30 September ran 11:03, 11:04, 11:04 — three attempts inside ninety seconds.
export const FOLLOW_UP_WINDOW_MS = 5 * 60 * 1000

// An answer is SHORT. This is the main guard and it is worth stating plainly:
// "five minutes" is an answer, "remind me to call Ramesh about the invoice
// tomorrow" is not, even if a question happens to be open.
//
// Eight words, because "in about five minutes from now please" is seven and is
// still plainly an answer.
export const MAX_ANSWER_WORDS = 8

// Hints we know how to answer. Anything else falls through untouched, which is
// the correct behaviour for a question this file has never heard of.
const TIME_HINTS = new Set(['time_needed', 'call_or_remind', 'when_is_meeting'])

// "Now" in the three languages QuietKeep actually gets spoken to in, plus the
// romanised forms the recogniser returns rather than the native script - which
// is the whole lesson of 30 September.
const NOW_WORDS = /^(now|right now|call now|call him now|call her now|immediately|ippudu|ipudu|abhi|abhee|ఇప్పుడు|अभी)\b/i

// An explicit refusal. Without this, "no" and "later" would fall through to the
// time parser, find nothing, and be saved as a note reading "no".
const NOT_NOW_WORDS = /^(no|not now|later|cancel|skip|vaddu|వద్దు|nahi|नहीं)\b/i

/**
 * Is this keep carrying a question we are still waiting on an answer to?
 *
 * Three conditions, all of them necessary:
 *   - it has a follow_up with an action_hint we understand
 *   - it does not already have a usable time (a question answered by the
 *     keep's own later correction must not be re-opened)
 *   - it is recent
 */
export function isPendingQuestion(keep, nowMs = Date.now()) {
  if (!keep || !keep.follow_up) return false

  const hint = keep.follow_up.action_hint
  if (!TIME_HINTS.has(hint)) return false

  if (isUsableInstant(keep.reminder_at)) return false

  const createdMs = Date.parse(keep.created_at || '')
  if (!Number.isFinite(createdMs)) return false

  const age = nowMs - createdMs
  return age >= 0 && age <= FOLLOW_UP_WINDOW_MS
}

/**
 * Does what was just said answer that question?
 *
 * Returns one of:
 *   { kind: 'time',    reminderAt: Date }  - a moment was given
 *   { kind: 'now' }                        - do it now, do not schedule
 *   { kind: 'declined' }                   - explicitly not now
 *   null                                   - not an answer; treat as new
 *
 * `null` is the safe answer and is returned for anything at all doubtful.
 */
export function readAnswer(keep, rawText, nowMs = Date.now()) {
  if (!isPendingQuestion(keep, nowMs)) return null

  const text = String(rawText || '').trim()
  if (!text) return null

  // THE GUARD THAT MATTERS.
  //
  // A long sentence is a new instruction, full stop, even when a question is
  // open. Swallowing one as an answer loses a note the user believed they
  // saved, and nothing in the product would show them why.
  const words = text.split(/\s+/).filter(Boolean)
  if (words.length > MAX_ANSWER_WORDS) return null

  if (NOT_NOW_WORDS.test(text)) return { kind: 'declined' }

  // "Now" only means anything for a question that offered it.
  if (keep.follow_up.action_hint === 'call_or_remind' && NOW_WORDS.test(text)) {
    return { kind: 'now' }
  }

  // A relative offset - "five minutes", "ఐదు నిమిషాల్లో", "paanch minute".
  // Checked before the full parse because it is the commonest answer by far
  // and resolves without touching entities.
  const mins = relativeMinutesFromText(text)
  if (mins !== null) {
    return { kind: 'time', reminderAt: new Date(nowMs + mins * 60000) }
  }

  // A clock time - "at six", "6:30 pm", "tomorrow at ten".
  const at = computeReminderAt({ dates: [], times: [text] }, undefined, text)
  if (isUsableInstant(at)) return { kind: 'time', reminderAt: new Date(at) }

  return null
}

/**
 * What Aaria says back once the answer has been applied.
 *
 * Kept here beside the decision so the wording and the behaviour cannot drift
 * apart - which is how a confirmation came to announce a time three lines
 * above the code that had not set one.
 */
export function answerConfirmation(answer, keep, timeZone = 'Asia/Kolkata') {
  const who = keep?.contact_name || keep?.follow_up?.contact?.name || null

  if (!answer) return null

  if (answer.kind === 'declined') {
    return who ? `Fine — no reminder for ${who}.` : 'Fine — no reminder set.'
  }

  if (answer.kind === 'now') {
    return who ? `Calling ${who} now.` : 'Calling now.'
  }

  const dt = answer.reminderAt
  const timeStr = dt.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone })
  const dateStr = dt.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone })

  return who
    ? `Right — ${dateStr} at ${timeStr} I'll call ${who}.`
    : `Right — ${dateStr} at ${timeStr}.`
}
