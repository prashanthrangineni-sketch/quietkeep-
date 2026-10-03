// tests/contact-match.test.mjs
// Built from the shape of the founder's own address book on 1 Oct 2026:
// nine Venus, fourteen Yadavs, no "Venu Yadav".

import assert from 'node:assert/strict'
import test from 'node:test'
import { rankContactsForName, pickContactFromAnswer, nameTokens } from '../src/lib/contact-match.js'
import { computeFollowUp } from '../src/lib/intent-executor.js'
import { readAnswer } from '../src/lib/follow-up-answer.js'

const BOOK = [
  { id: 1, name: 'Venu Nz', phone: '+911' },
  { id: 2, name: 'Vijay Yadav', phone: '+912' },
  { id: 3, name: 'Arun Venu', phone: '+913' },
  { id: 4, name: 'Venu Reddy', phone: '+914' },
  { id: 5, name: 'Venugopal Chary Oyo Santhosh Oak', phone: '+915' },
  { id: 6, name: 'Prem Yadav', phone: '+916' },
  { id: 7, name: 'Surya Kiran', phone: '+917' },
]

test('tokens: any script, punctuation dropped', () => {
  assert.deepEqual(nameTokens('Venu  Yadav,'), ['venu', 'yadav'])
  assert.deepEqual(nameTokens('వేణు యాదవ్'), ['వేణు', 'యాదవ్'])
})

test('"Venu Yadav" is not guessed - it is a question about the Venus', () => {
  const r = rankContactsForName('Venu Yadav', BOOK)
  assert.equal(r.ambiguous, true)
  assert.equal(r.partial, true)
  const names = r.multiple.map(c => c.name)
  assert.ok(names.includes('Venu Reddy') && names.includes('Venu Nz'))
  assert.ok(!names.includes('Vijay Yadav'), 'a different given name is not a candidate')
})

test('a contact carrying every spoken word is the match', () => {
  assert.equal(rankContactsForName('Surya Kiran', BOOK).single.name, 'Surya Kiran')
  assert.equal(rankContactsForName('kiran surya', BOOK).single.name, 'Surya Kiran')
})

test('nobody plausible is null', () => {
  assert.equal(rankContactsForName('Gautham', BOOK), null)
})

test('the answer picks by name or by position', () => {
  const offered = rankContactsForName('Venu Yadav', BOOK).multiple
  assert.equal(pickContactFromAnswer('Venu Reddy', offered).name, 'Venu Reddy')
  assert.equal(pickContactFromAnswer('Reddy', offered).name, 'Venu Reddy')
  assert.equal(pickContactFromAnswer('the first one', offered).name, offered[0].name)
  assert.equal(pickContactFromAnswer('Venu', offered), null, 'still ambiguous - do not pick')
})

test('a reminder to CALL someone unresolved asks which one', () => {
  const parsed = { type: 'reminder', wants_call: true, entities: { names: ['Venu Yadav'] } }
  const f = computeFollowUp(parsed, rankContactsForName('Venu Yadav', BOOK), new Date(Date.now() + 120000))
  assert.equal(f.action_hint, 'disambiguate_contact')
  assert.match(f.follow_up, /Which one/)
})

test('a reminder that merely names someone does not ask', () => {
  const parsed = { type: 'reminder', wants_call: false, entities: { names: ['Venu'] } }
  assert.equal(computeFollowUp(parsed, null, new Date(Date.now() + 120000)), null)
})

test('a reminder to call someone not in contacts says it cannot dial', () => {
  const parsed = { type: 'reminder', wants_call: true, entities: { names: ['Gautham'] } }
  const f = computeFollowUp(parsed, null, new Date(Date.now() + 120000))
  assert.equal(f.action_hint, 'add_contact')
})

test('answering "which Venu" resolves even though the keep already has a time', () => {
  const now = Date.now()
  const keep = {
    created_at: new Date(now - 20_000).toISOString(),
    reminder_at: new Date(now + 100_000).toISOString(),
    follow_up: { action_hint: 'disambiguate_contact', contacts: rankContactsForName('Venu Yadav', BOOK).multiple },
  }
  const a = readAnswer(keep, 'Venu Reddy', now)
  assert.equal(a.kind, 'contact')
  assert.equal(a.contact.phone, '+914')
})

// ── "Which Venu?" made answerable (3 October 2026) ───────────────────────────
import { contactChoices, spokenContactQuestion, narrowContacts } from '../src/lib/contact-match.js'

const SIX_VENUS = [
  { id: 'a', name: 'Venu Champapet', phone: '+919666522488' },
  { id: 'b', name: 'Venu Nz', phone: '+910220716592' },
  { id: 'c', name: 'Venu Nz', phone: '+919948046899' },
  { id: 'd', name: 'Venu Menukonda', phone: '+919347569066' },
  { id: 'e', name: 'Venugopal Chary Oyo Santhosh Oak', phone: '+919550657530' },
  { id: 'f', name: 'Venukumar Home Theatre', phone: '+919704733047' },
]

test('same-named contacts are told apart by the end of the number; others are not cluttered', () => {
  const labels = contactChoices(SIX_VENUS).map((c) => c.label)
  assert.equal(labels[0], 'Venu Champapet')
  assert.equal(labels[1], 'Venu Nz · …6592')
  assert.equal(labels[2], 'Venu Nz · …6899')
  assert.equal(labels.length, 6)
})

test('the spoken question names three people, not six', () => {
  const q = spokenContactQuestion('Venu', SIX_VENUS)
  assert.match(q, /^Which Venu\?/)
  assert.match(q, /Venu Champapet, Venu Nz or Venu Menukonda/)
  assert.match(q, /3 more on screen/)
  assert.ok(q.length < 110, `too long to say: ${q.length} characters`)
  assert.doesNotMatch(q, /Home Theatre/)
})

test('two people offered → both are said, nothing is "on screen"', () => {
  const q = spokenContactQuestion('Venu', SIX_VENUS.slice(0, 1).concat(SIX_VENUS.slice(3, 4)))
  assert.match(q, /Venu Champapet or Venu Menukonda\?/)
  assert.doesNotMatch(q, /more on screen/)
})

test('"Venu Nz" with two Venu Nz narrows to those two; a unique or useless answer narrows nothing', () => {
  assert.deepEqual(narrowContacts('Venu Nz', SIX_VENUS).map((c) => c.id), ['b', 'c'])
  assert.deepEqual(narrowContacts('Menukonda', SIX_VENUS), [])
  assert.deepEqual(narrowContacts('umbrella', SIX_VENUS), [])
})
