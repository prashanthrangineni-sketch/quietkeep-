// tests/scheduled-call.test.mjs
//
// "Call Surya Kiran in 5 minutes" came back as a question on the founder's
// phone at 21:34 IST on 26 September 2026, while the reminder row for 21:39
// was already on disk. These cases pin that down, and pin down the four
// behaviours that must survive the fix.
//
// Run: node --test tests/scheduled-call.test.mjs

import assert from 'node:assert/strict'
import test from 'node:test'
import { computeFollowUp, buildExecutionTTS } from '../src/lib/intent-executor.js'

const inFiveMinutes = () => new Date(Date.now() + 5 * 60 * 1000)
const tomorrowish   = () => new Date(Date.now() + 20 * 60 * 60 * 1000)

// Surya Kiran, as he arrived from the 1,920-contact phonebook sync.
const surya = { single: { id: 'c1', name: 'Surya Kiran', phone: '+910000000000' } }

// The exact utterance, classified exactly as the live parser classified it.
const callInFive = {
  type: 'meeting',
  subject: 'call Surya Kiran in 5 minutes',
  entities: { names: ['Surya Kiran'], dates: [], times: [] },
}

test('a call that already has a time asks nothing', () => {
  assert.equal(computeFollowUp(callInFive, surya, inFiveMinutes()), null)
})

test('and states the plan, with the time in it', () => {
  const said = buildExecutionTTS(callInFive, surya, inFiveMinutes(), null)
  assert.doesNotMatch(said, /now or set a reminder/i)
  assert.match(said, /I'll call Surya Kiran/)
  assert.match(said, /\d{1,2}:\d{2}/)
})

test('it never claims the call has already happened', () => {
  const said = buildExecutionTTS(callInFive, surya, inFiveMinutes(), null)
  assert.doesNotMatch(said, /\b(called|done|saved and called|dialled|dialed)\b/i)
})

test('MUST NOT BREAK: a bare "call Surya Kiran" still offers now or later', () => {
  const bare = {
    type: 'contact',
    subject: 'call Surya Kiran',
    entities: { names: ['Surya Kiran'], dates: [], times: [] },
  }
  assert.match(computeFollowUp(bare, surya, null).follow_up, /now or set a reminder/i)
})

test('MUST NOT BREAK: a day with no hour asks which hour', () => {
  const dayOnly = {
    type: 'contact',
    subject: 'call Surya Kiran tomorrow',
    entities: { names: ['Surya Kiran'], dates: ['2026-09-27'], times: [] },
  }
  const f = computeFollowUp(dayOnly, surya, tomorrowish())
  assert.equal(f.action_hint, 'time_needed')
  assert.match(f.follow_up, /what time/i)
})

test('and is not asked "when is this meeting?" either', () => {
  // The second question, one branch below the first. Freeing the call from
  // "now or later?" dropped it in here until the branch learned to read the
  // time as well. A relative offset writes nothing into entities.dates or
  // entities.times, so only reminderAt can see it.
  const f = computeFollowUp(callInFive, surya, inFiveMinutes())
  assert.equal(f, null)

  const alsoWithoutAContact = computeFollowUp(callInFive, null, inFiveMinutes())
  assert.doesNotMatch(alsoWithoutAContact?.follow_up || '', /when is this meeting/i)
})

test('MUST NOT BREAK: a meeting with genuinely no time is still asked about', () => {
  const vague = {
    type: 'meeting',
    subject: 'meeting with Surya Kiran',
    entities: { names: ['Surya Kiran'], dates: [], times: [] },
  }
  assert.match(computeFollowUp(vague, null, null).follow_up, /isn't in your contacts|when is this meeting/i)
  assert.match(
    computeFollowUp({ ...vague, entities: { names: [], dates: [], times: [] } }, null, null).follow_up,
    /who do you want to contact/i
  )
})

test('MUST NOT BREAK: a real meeting is not turned into a phone call', () => {
  const meeting = {
    type: 'meeting',
    subject: 'meeting with Surya Kiran at 3pm',
    entities: { names: ['Surya Kiran'], dates: [], times: ['3:00 pm'] },
  }
  assert.doesNotMatch(buildExecutionTTS(meeting, surya, inFiveMinutes(), null), /I'll call/)
})

test('MUST NOT BREAK: the reminder wording the founder confirmed is untouched', () => {
  const rem = {
    type: 'reminder',
    subject: 'remind me to call Surya Kiran in 5 minutes',
    entities: { names: ['Surya Kiran'], dates: [], times: [] },
  }
  const said = buildExecutionTTS(rem, surya, inFiveMinutes(), null)
  assert.match(said, /I'll remind you/i)
  assert.doesNotMatch(said, /^Right —/)
})

test('MUST NOT BREAK: two Suryas are still disambiguated before anything else', () => {
  const ambiguous = {
    ambiguous: true,
    multiple: [{ name: 'Surya Kiran' }, { name: 'Surya Reddy' }],
  }
  assert.match(computeFollowUp(callInFive, ambiguous, inFiveMinutes()).follow_up, /which one/i)
})

test('MUST NOT BREAK: someone not in the phonebook is still handled', () => {
  assert.match(
    computeFollowUp(callInFive, null, inFiveMinutes()).follow_up,
    /isn't in your contacts/i
  )
})

test('an explicit clock time needs no question either', () => {
  const at3 = {
    type: 'contact',
    subject: 'call Surya Kiran at 3pm',
    entities: { names: ['Surya Kiran'], dates: ['2026-09-27'], times: ['3:00 pm'] },
  }
  assert.equal(computeFollowUp(at3, surya, tomorrowish()), null)
  assert.match(buildExecutionTTS(at3, surya, tomorrowish(), null), /I'll call Surya Kiran/)
})

test('a Telugu call instruction is recognised as a call', () => {
  const te = {
    type: 'meeting',
    subject: 'సూర్య కిరణ్ కి 5 నిమిషాల్లో కాల్ చెయ్యి',
    entities: { names: ['Surya Kiran'], dates: [], times: [] },
  }
  assert.match(buildExecutionTTS(te, surya, inFiveMinutes(), null), /I'll call/)
})

test('a Hindi call instruction is recognised as a call', () => {
  const hi = {
    type: 'meeting',
    subject: 'सूर्या किरण को 5 मिनट में कॉल करो',
    entities: { names: ['Surya Kiran'], dates: [], times: [] },
  }
  assert.match(buildExecutionTTS(hi, surya, inFiveMinutes(), null), /I'll call/)
})

test('a time already past never produces a confident plan', () => {
  const said = buildExecutionTTS(callInFive, surya, new Date(Date.now() - 3600_000), null)
  assert.doesNotMatch(said, /I'll call Surya Kiran/)
})

test('a follow-up question still wins over everything', () => {
  const said = buildExecutionTTS(
    callInFive, surya, inFiveMinutes(),
    { follow_up: 'Who do you want to contact?' }
  )
  assert.equal(said, 'Who do you want to contact?')
})
