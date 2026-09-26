// tests/transcript-clean.test.mjs
//
// The two "IN" strings below are copied byte for byte out of the database:
// keeps 60d0e354-ebe5-4846-ac9f-b2ef52cf3555 and
// 2d5e263b-1d13-49f8-9721-d7a9c18c04f3, saved 26 September 2026 at 18:44.
// They are what the Android voice service actually sent, not a reconstruction.
//
// The safety cases matter as much as the repairs. A transcript repair that
// deletes words a person genuinely said is worse than the stutter it removes,
// so the last four assert that ordinary speech comes back untouched.

import assert from 'node:assert/strict'
import test from 'node:test'
import { collapseRepeats } from '../src/lib/transcript-clean.js'

test('repairs the real "please remind" transcript', () => {
  const stored =
    'please remind please remind me please remind me to call ' +
    'please remind me to call Surya please remind me to call Surya after ' +
    'please remind me to call Surya after 5 ' +
    'please remind me to call Surya after 5 minutes'
  assert.equal(
    collapseRepeats(stored),
    'please remind me to call Surya after 5 minutes'
  )
})

test('repairs the real "remind me" transcript, including its repeated tail', () => {
  const stored =
    'remind me remind me to call remind me to call Surya ' +
    'remind me to call Surya after remind me to call Surya after 5 ' +
    'remind me to call Surya after 5 minutes ' +
    'remind me to call Surya after 5 minutes'
  assert.equal(
    collapseRepeats(stored),
    'remind me to call Surya after 5 minutes'
  )
})

test('repairs Telugu, where the number word was buried four deep', () => {
  assert.equal(
    collapseRepeats('ఐదు ఐదు ఐదు ఐదు ఐదు నిమిషాల్లో ఐదు నిమిషాల్లో ఐదు నిమిషాల్లో'),
    'ఐదు నిమిషాల్లో'
  )
})

test('repairs a romanised Telugu transcript', () => {
  assert.equal(
    collapseRepeats('రిమాండ్ రిమాండ్ రిమాండ్ మీ రిమాండ్ మీ టు రిమాండ్ మీ టు కాల్ సూర్య'),
    'రిమాండ్ మీ టు కాల్ సూర్య'
  )
})

// ── the sentences that must survive untouched ────────────────────────────────

test('leaves a clean sentence exactly as it was', () => {
  const clean = 'remind me to call Ravi tomorrow at 5pm'
  assert.equal(collapseRepeats(clean), clean)
})

test('does NOT delete words when the first word simply recurs', () => {
  // "call" opens the sentence and appears again in the middle. The segments are
  // not drafts of one another, so nothing may be removed.
  const spoken = 'call me when you call Surya'
  assert.equal(collapseRepeats(spoken), spoken)
})

test('leaves a short utterance alone', () => {
  assert.equal(collapseRepeats('call Surya'), 'call Surya')
})

test('survives empty and rubbish input', () => {
  assert.equal(collapseRepeats(''), '')
  assert.equal(collapseRepeats(null), '')
  assert.equal(collapseRepeats('   '), '   ')
})
