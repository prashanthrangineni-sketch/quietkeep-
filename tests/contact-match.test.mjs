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

// ── Card AG-V6 — Telugu contact names that actually match ───────────────────

test('"అశోక్కి", "అశోక్ కి", "అశోక్ గారికి" → contact "Ashok" (single) when only one Ashok exists; → ask when "Ashok Kumar" and "Ashok Reddy" both exist', () => {
  const singleBook = [{ id: 101, name: 'Ashok', phone: '+919876543210' }]
  assert.equal(rankContactsForName('అశోక్కి', singleBook)?.single?.name, 'Ashok')
  assert.equal(rankContactsForName('అశోక్ కి', singleBook)?.single?.name, 'Ashok')
  assert.equal(rankContactsForName('అశోక్ గారికి', singleBook)?.single?.name, 'Ashok')

  const multiBook = [
    { id: 102, name: 'Ashok Kumar', phone: '+919876543211' },
    { id: 103, name: 'Ashok Reddy', phone: '+919876543212' },
  ]
  const r1 = rankContactsForName('అశోక్కి', multiBook)
  assert.equal(r1.ambiguous, true)
  assert.equal(r1.multiple.length, 2)

  const r2 = rankContactsForName('అశోక్ కి', multiBook)
  assert.equal(r2.ambiguous, true)
  assert.equal(r2.multiple.length, 2)

  const r3 = rankContactsForName('అశోక్ గారికి', multiBook)
  assert.equal(r3.ambiguous, true)
  assert.equal(r3.multiple.length, 2)
})

test('"రమేష్ అన్నకి" → "Ramesh Anna" or "Ramesh" (single if unique)', () => {
  const withAnna = [{ id: 201, name: 'Ramesh Anna', phone: '+919876543220' }]
  assert.equal(rankContactsForName('రమేష్ అన్నకి', withAnna)?.single?.name, 'Ramesh Anna')

  const withoutAnna = [{ id: 202, name: 'Ramesh', phone: '+919876543221' }]
  assert.equal(rankContactsForName('రమేష్ అన్నకి', withoutAnna)?.single?.name, 'Ramesh')

  const both = [
    { id: 201, name: 'Ramesh Anna', phone: '+919876543220' },
    { id: 202, name: 'Ramesh', phone: '+919876543221' },
  ]
  const rBoth = rankContactsForName('రమేష్ అన్నకి', both)
  assert.equal(rBoth.ambiguous, true)
  assert.equal(rBoth.multiple.length, 2)
})

test('Latin spoken "ashok ki" → "Ashok"', () => {
  const book = [{ id: 301, name: 'Ashok', phone: '+919876543230' }]
  assert.equal(rankContactsForName('ashok ki', book)?.single?.name, 'Ashok')
})

test('One-letter slip finds the contact only when unique; never auto-picks between two near names', () => {
  // Unique one-letter slip in Latin
  const singleLatin = [{ id: 401, name: 'Ashok', phone: '+919876543240' }]
  const rSlip = rankContactsForName('Ashol', singleLatin)
  assert.equal(rSlip?.single, undefined)          // never dialled on a guess
  assert.equal(rSlip?.ambiguous, true)
  assert.equal(rSlip?.fuzzy, true)
  assert.equal(rSlip?.multiple?.[0]?.name, 'Ashok') // offered as the one choice

  // Two near names in Latin: never auto-picks
  const twoLatin = [
    { id: 401, name: 'Ashok', phone: '+919876543240' },
    { id: 402, name: 'Ashor', phone: '+919876543241' },
  ]
  const rTwo = rankContactsForName('Ashol', twoLatin)
  assert.equal(rTwo.ambiguous, true)
  assert.equal(rTwo.multiple.length, 2)

  // Unique one-letter slip in Telugu (క్యాన్సల్ for క్యాన్సిల్)
  const singleTelugu = [{ id: 403, name: 'క్యాన్సిల్', phone: '+919876543242' }]
  const rSlipTe = rankContactsForName('క్యాన్సల్', singleTelugu)
  assert.equal(rSlipTe?.single, undefined)
  assert.equal(rSlipTe?.ambiguous, true)
  assert.equal(rSlipTe?.multiple?.[0]?.name, 'క్యాన్సిల్')

  // Two near names in Telugu: never auto-picks
  const twoTelugu = [
    { id: 403, name: 'క్యాన్సిల్', phone: '+919876543242' },
    { id: 404, name: 'క్యాన్సుల్', phone: '+919876543243' },
  ]
  const rTwoTe = rankContactsForName('క్యాన్సల్', twoTelugu)
  assert.equal(rTwoTe.ambiguous, true)
  assert.equal(rTwoTe.multiple.length, 2)

  // Tokens with fewer than 4 letters must NOT match via one-letter tolerance
  const threeLetter = [{ id: 405, name: 'Ram', phone: '+919876543244' }]
  assert.equal(rankContactsForName('Raj', threeLetter), null)
})

test('Telugu contact saved in Telugu script matched from Latin spoken query', () => {
  const teluguSaved = [{ id: 501, name: 'అశోక్', phone: '+919876543250' }]
  assert.equal(rankContactsForName('Ashok', teluguSaved)?.single?.name, 'అశోక్')
  assert.equal(rankContactsForName('ashok ki', teluguSaved)?.single?.name, 'అశోక్')
})

