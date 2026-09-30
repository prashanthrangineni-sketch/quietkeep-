// tests/spoken-names.test.mjs
//
// The list handed to the recogniser decides whether "Surya Kiran" is heard as
// a person. It must be short, clean and in the right order - and it must never
// carry a fragment of a note, which would bias recognition toward nonsense.

import assert from 'node:assert/strict'
import test from 'node:test'
import { mergeNames, namesAsWhisperPrompt, recentSpokenNames, MAX_NAMES } from '../src/lib/spoken-names.js'

test('most recent first, duplicates collapsed case-insensitively', () => {
  const out = mergeNames(['Surya Kiran', 'Gautham', 'surya kiran', 'Naveen', 'GAUTHAM'])
  assert.deepEqual(out, ['Surya Kiran', 'Gautham', 'Naveen'])
})

test('whitespace is normalised and blanks dropped', () => {
  assert.deepEqual(mergeNames(['  Surya   Kiran ', '', '   ', null, 42]), ['Surya Kiran'])
})

test('a note fragment with digits or symbols is not a name', () => {
  const out = mergeNames(['Surya Kiran', 'pay 2000 to Ravi', 'ravi@example.com', 'Ravi (office)', 'Ravi'])
  assert.deepEqual(out, ['Surya Kiran', 'Ravi'])
})

test('names in any script survive', () => {
  const out = mergeNames(['సూర్య కిరణ్', 'सूर्य किरण', "O'Brien", 'Jean-Luc'])
  assert.deepEqual(out, ['సూర్య కిరణ్', 'सूर्य किरण', "O'Brien", 'Jean-Luc'])
})

test('the list is capped so the shared terms still fit in the fifty', () => {
  const many = Array.from({ length: 200 }, (_, i) => `Person ${String.fromCharCode(65 + (i % 26))}${'x'.repeat(i % 5)}`)
  const out = mergeNames(many)
  assert.ok(out.length <= MAX_NAMES)
  assert.ok(MAX_NAMES <= 50)
})

test('the Whisper prompt is the same list, comma-separated, or empty', () => {
  assert.equal(namesAsWhisperPrompt(['Surya Kiran', 'surya kiran', 'Ravi']), 'Surya Kiran, Ravi')
  assert.equal(namesAsWhisperPrompt([]), '')
  assert.equal(namesAsWhisperPrompt(undefined), '')
})

test('recentSpokenNames reads keeps.contact_name for that user only, newest first', async () => {
  const calls = {}
  const fake = {
    from(table) {
      calls.table = table
      const q = {
        select(cols) { calls.select = cols; return q },
        eq(col, val) { calls.eq = [col, val]; return q },
        not(col, op, val) { calls.not = [col, op, val]; return q },
        order(col, opts) { calls.order = [col, opts]; return q },
        limit(n) { calls.limit = n; return Promise.resolve({ data: [
          { contact_name: 'Surya Kiran' }, { contact_name: 'Ravi' }, { contact_name: 'surya kiran' },
        ], error: null }) },
      }
      return q
    },
  }
  const out = await recentSpokenNames(fake, 'user-1')
  assert.deepEqual(out, ['Surya Kiran', 'Ravi'])
  assert.equal(calls.table, 'keeps')
  assert.deepEqual(calls.eq, ['user_id', 'user-1'])
  assert.deepEqual(calls.order, ['created_at', { ascending: false }])
})

test('recentSpokenNames is empty on any failure, never throws', async () => {
  const broken = { from() { throw new Error('db down') } }
  assert.deepEqual(await recentSpokenNames(broken, 'user-1'), [])
  assert.deepEqual(await recentSpokenNames(null, 'user-1'), [])
  assert.deepEqual(await recentSpokenNames({}, null), [])
})
