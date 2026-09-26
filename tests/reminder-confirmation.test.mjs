// tests/reminder-confirmation.test.mjs
//
// What Aaria is allowed to say about a reminder. Every case below is a bug that
// reached the founder's phone on 26 September 2026.

import assert from 'node:assert/strict'
import test from 'node:test'
import { buildExecutionTTS, isUsableInstant } from '../src/lib/intent-executor.js'

const inFiveMinutes = () => new Date(Date.now() + 5 * 60 * 1000)

// "remind me to call Surya in five minutes" — a relative offset. It resolves to
// a real instant and puts NOTHING in entities.times, which is what broke this.
const relativeReminder = {
  type: 'reminder',
  subject: 'remind me to call Surya in five minutes',
  entities: { names: ['Surya'], dates: [], times: [] },
}

// "remind me tomorrow to call Surya" — a day, no hour. Asking which hour is
// correct here and must survive.
const dayOnlyReminder = {
  type: 'reminder',
  subject: 'remind me to call Surya',
  entities: { names: ['Surya'], dates: ['2026-09-27'], times: [] },
}

test('never claims a reminder is set when there is no time', () => {
  const said = buildExecutionTTS(relativeReminder, null, null, null)
  assert.match(said, /when|ఎప్పుడు|कब/i)
  assert.doesNotMatch(said, /I'll remind you to .* at /i)
})

test('does not ask for a time it already has', () => {
  // The bug, verbatim from the screenshot:
  //   "...Sat, 26 Sept. What time should I set it for?"
  // with reminder_at already stored.
  const said = buildExecutionTTS(relativeReminder, null, inFiveMinutes(), null)
  assert.doesNotMatch(said, /what time should i set it for/i)
  assert.match(said, /I'll remind you/i)
  assert.match(said, /\d{1,2}:\d{2}/)      // the time it knows is spoken back
})

test('still asks which hour when the user named a day and no time', () => {
  const tomorrowish = new Date(Date.now() + 20 * 60 * 60 * 1000)
  const said = buildExecutionTTS(dayOnlyReminder, null, tomorrowish, null)
  assert.match(said, /what time should i set it for/i)
})

test('a follow-up question always wins', () => {
  const said = buildExecutionTTS(
    relativeReminder, null, inFiveMinutes(),
    { follow_up: 'Who do you want to contact?' }
  )
  assert.equal(said, 'Who do you want to contact?')
})

test('isUsableInstant rejects nothing, rubbish and the past', () => {
  assert.equal(isUsableInstant(null), false)
  assert.equal(isUsableInstant('not a date'), false)
  assert.equal(isUsableInstant(new Date(Date.now() - 3600_000)), false)
  assert.equal(isUsableInstant(inFiveMinutes()), true)
})
