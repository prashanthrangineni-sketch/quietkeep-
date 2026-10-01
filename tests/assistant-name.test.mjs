// tests/assistant-name.test.mjs
// The assistant is Aaria. A phone that stored the retired default "lotus" must
// stop showing it; a word the person chose themselves must be left alone.

import assert from 'node:assert/strict'
import test from 'node:test'
import { readWakeWord, acceptedWakeWords, displayWakeWord, DEFAULT_WAKE_WORD, ASSISTANT_NAME, WAKE_WORD_KEY } from '../src/lib/assistant-name.js'

function memory(initial = {}) {
  const m = new Map(Object.entries(initial))
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), m }
}

test('the name is Aaria and the default wake word is aaria', () => {
  assert.equal(ASSISTANT_NAME, 'Aaria')
  assert.equal(DEFAULT_WAKE_WORD, 'aaria')
  assert.equal(readWakeWord(memory()), 'aaria')
})

test('a stored "lotus" (the old default) becomes aaria, and stays aaria', () => {
  const s = memory({ [WAKE_WORD_KEY]: 'Lotus' })
  assert.equal(readWakeWord(s), 'aaria')
  assert.equal(s.m.get(WAKE_WORD_KEY), 'aaria')
})

test('a word the person chose is never touched', () => {
  const s = memory({ [WAKE_WORD_KEY]: 'Jarvis' })
  assert.equal(readWakeWord(s), 'jarvis')
  assert.equal(s.m.get(WAKE_WORD_KEY), 'Jarvis')
})

test('old habit still works while the default is in use, never for a custom word', () => {
  assert.deepEqual(acceptedWakeWords('aaria'), ['aaria', 'lotus'])
  assert.deepEqual(acceptedWakeWords('jarvis'), ['jarvis'])
})

test('shown as a name', () => {
  assert.equal(displayWakeWord('aaria'), 'Aaria')
  assert.equal(displayWakeWord(), 'Aaria')
})

test('storage that throws (private mode) still answers aaria', () => {
  const broken = { getItem() { throw new Error('denied') }, setItem() { throw new Error('denied') } }
  assert.equal(readWakeWord(broken), 'aaria')
})
