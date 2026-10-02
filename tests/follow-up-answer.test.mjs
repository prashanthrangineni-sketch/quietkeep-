// tests/follow-up-answer.test.mjs
//
// Aaria asks a question and forgets it asked. This holds the fix, and - more
// carefully - holds the line on what must NOT be treated as an answer.
//
// The dangerous direction is not missing an answer. A missed answer is one
// more tap. An ordinary instruction swallowed as an answer to a stale question
// is a note the user believed they saved and will never find, with nothing on
// screen to explain it. Every "returns null" test below is guarding that.

import assert from 'node:assert/strict'
import test from 'node:test'
import {
  readAnswer,
  isPendingQuestion,
  answerConfirmation,
  FOLLOW_UP_WINDOW_MS,
  MAX_ANSWER_WORDS,
} from '../src/lib/follow-up-answer.js'

const NOW = Date.parse('2026-09-30T11:04:00+05:30')

function pending(overrides = {}) {
  return {
    id: 'keep-1',
    content: 'Surya Kiran ki call chahie',
    voice_text: 'Surya Kiran ki call chahie',
    contact_name: 'Surya Kiran',
    contact_phone: '+919790851815',
    reminder_at: null,
    created_at: new Date(NOW - 30_000).toISOString(),
    follow_up: {
      action_hint: 'call_or_remind',
      follow_up: 'Call Surya Kiran now or set a reminder?',
      contact: { name: 'Surya Kiran', phone: '+919790851815' },
    },
    ...overrides,
  }
}

// ── the actual sequence from 30 September ────────────────────────────────────

test('"five minutes" answers the question instead of starting over', () => {
  const answer = readAnswer(pending(), 'five minutes', NOW)
  assert.equal(answer.kind, 'time')
  assert.equal(answer.reminderAt.getTime(), NOW + 5 * 60_000)
})

test('the same answer in Telugu script', () => {
  const answer = readAnswer(pending(), 'ఐదు నిమిషాల్లో', NOW)
  assert.equal(answer.kind, 'time')
  assert.equal(answer.reminderAt.getTime(), NOW + 5 * 60_000)
})

test('the same answer in Telugu written in English letters', () => {
  // What the recogniser ACTUALLY returns - the lesson of 30 September. This
  // works because "minut" matches the "min" prefix, not because anyone listed
  // the word.
  const answer = readAnswer(pending(), '5 minut', NOW)
  assert.equal(answer.kind, 'time')
})

test('"now" is an answer when the question offered it', () => {
  assert.equal(readAnswer(pending(), 'now', NOW).kind, 'now')
  assert.equal(readAnswer(pending(), 'call now', NOW).kind, 'now')
  assert.equal(readAnswer(pending(), 'ippudu', NOW).kind, 'now')
})

test('"no" is an answer, and is not parsed as a note reading "no"', () => {
  assert.equal(readAnswer(pending(), 'no', NOW).kind, 'declined')
  assert.equal(readAnswer(pending(), 'later', NOW).kind, 'declined')
})

test('a clock time answers it', () => {
  const answer = readAnswer(pending(), '6:30 pm', NOW)
  assert.equal(answer.kind, 'time')
})

// ── what must NOT be swallowed ───────────────────────────────────────────────

test('a long sentence is a new instruction even with a question open', () => {
  const fresh = 'remind me to call Ramesh about the pending invoice tomorrow morning'
  assert.equal(fresh.split(/\s+/).length > MAX_ANSWER_WORDS, true)
  assert.equal(readAnswer(pending(), fresh, NOW), null)
})

test('a question older than the window is closed', () => {
  const stale = pending({
    created_at: new Date(NOW - FOLLOW_UP_WINDOW_MS - 1000).toISOString(),
  })
  assert.equal(readAnswer(stale, 'five minutes', NOW), null)
})

test('a keep that already has a time is not re-opened', () => {
  const answered = pending({ reminder_at: new Date(NOW + 600_000).toISOString() })
  assert.equal(readAnswer(answered, 'five minutes', NOW), null)
})

test('a keep carrying no question is never touched', () => {
  assert.equal(readAnswer(pending({ follow_up: null }), 'five minutes', NOW), null)
})

test('a question shape we do not understand falls through', () => {
  // (was 'disambiguate_contact', which this file now understands - see
  // tests/contact-match.test.mjs. 'add_contact' has no spoken answer.)
  const unknown = pending({ follow_up: { action_hint: 'add_contact' } })
  assert.equal(readAnswer(unknown, 'five minutes', NOW), null)
})

test('words that resolve to no time are not an answer', () => {
  assert.equal(readAnswer(pending(), 'buy milk', NOW), null)
  assert.equal(readAnswer(pending(), 'hello', NOW), null)
})

test('empty input is never an answer', () => {
  assert.equal(readAnswer(pending(), '', NOW), null)
  assert.equal(readAnswer(pending(), '   ', NOW), null)
})

test('"now" is not an answer to a question that did not offer it', () => {
  const timeOnly = pending({ follow_up: { action_hint: 'time_needed' } })
  assert.equal(readAnswer(timeOnly, 'now', NOW), null)
})

test('a keep created in the future is not pending', () => {
  // Clock skew between device and server. Treating a negative age as "recent"
  // would leave a question open indefinitely.
  const skewed = pending({ created_at: new Date(NOW + 60_000).toISOString() })
  assert.equal(isPendingQuestion(skewed, NOW), false)
})

test('a malformed created_at does not throw and does not count as pending', () => {
  assert.equal(isPendingQuestion(pending({ created_at: 'not a date' }), NOW), false)
  assert.equal(isPendingQuestion(null, NOW), false)
  assert.equal(isPendingQuestion(undefined, NOW), false)
})

// ── what Aaria says back ─────────────────────────────────────────────────────

test('the confirmation names the person and the time it actually set', () => {
  const answer = readAnswer(pending(), 'five minutes', NOW)
  const said = answerConfirmation(answer, pending())
  assert.match(said, /Surya Kiran/)
  assert.match(said, /11:09/)
})

test('declining says so rather than claiming a reminder', () => {
  const said = answerConfirmation({ kind: 'declined' }, pending())
  assert.match(said, /no reminder/i)
  assert.doesNotMatch(said, /I'll call/)
})

test('calling now does not announce a time it has not set', () => {
  const said = answerConfirmation({ kind: 'now' }, pending())
  assert.match(said, /Calling Surya Kiran now/)
  assert.doesNotMatch(said, /\d{1,2}:\d{2}/)
})

// ── "When?" answered with a place (2 October 2026) ──────────────────────────
import { isPlaceAnswer, placeConfirmation } from '../src/lib/follow-up-answer.js'

test('a place answers an open "when?"', () => {
  const keep = pending({ follow_up: { action_hint: 'time_needed', follow_up: 'When should I remind you?' } })
  assert.equal(isPlaceAnswer(keep, 'when I reach Mansoorabad', 'Mansoorabad', { nowMs: NOW }), true)
})

test('a place is NOT an answer when a clock time came with it', () => {
  const keep = pending({ follow_up: { action_hint: 'time_needed', follow_up: 'When?' } })
  assert.equal(isPlaceAnswer(keep, 'at 6 near Mansoorabad', 'Mansoorabad', { hasTime: true, nowMs: NOW }), false)
})

test('a long sentence naming a place is a new instruction', () => {
  const keep = pending({ follow_up: { action_hint: 'time_needed', follow_up: 'When?' } })
  assert.equal(isPlaceAnswer(keep, 'remind me to pick up the laundry and the keys when I reach Mansoorabad', 'Mansoorabad', { nowMs: NOW }), false)
})

test('"navigate to …" is never swallowed as an answer', () => {
  const keep = pending({ follow_up: { action_hint: 'time_needed', follow_up: 'When?' } })
  assert.equal(isPlaceAnswer(keep, 'navigate to Mansoorabad', 'Mansoorabad', { nowMs: NOW }), false)
})

test('no open question, a stale one, or a "who?" question → not a place answer', () => {
  assert.equal(isPlaceAnswer(null, 'when I reach Mansoorabad', 'Mansoorabad', { nowMs: NOW }), false)
  const stale = pending({ follow_up: { action_hint: 'time_needed', follow_up: 'When?' } })
  assert.equal(isPlaceAnswer(stale, 'when I reach Mansoorabad', 'Mansoorabad', { nowMs: NOW + 6 * 60 * 1000 }), false)
  const who = pending({ follow_up: { action_hint: 'disambiguate_contact', follow_up: 'Which Venu?' } })
  assert.equal(isPlaceAnswer(who, 'the one in Mansoorabad', 'Mansoorabad', { nowMs: NOW }), false)
})

test('the confirmation says whether she can actually alert there', () => {
  assert.match(placeConfirmation('Mansoorabad', true), /when you reach Mansoorabad/)
  assert.match(placeConfirmation('Mansoorabad', false), /could not find it on the map/)
})
