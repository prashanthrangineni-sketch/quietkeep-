// tests/wake-payload.test.mjs
//
// "Hey Aaria, remind me to call Ravi" - one breath. The phone-side listener
// keeps the rest of the sentence and hands it over as { text }. These cases
// pin down what the wake event carries, and that a bare wake is unchanged.
//
// Run: node tests/wake-payload.test.mjs

import assert from 'node:assert/strict'
import test from 'node:test'
import { wakeCommandText, wakePayload, registerNativeWake, onWake } from '../src/lib/wake-word-engine.js'

test('the rest of the sentence travels with the wake', () => {
  const p = wakePayload('aaria_edge', { text: 'remind me to call Ravi at six' }, 'Aaria', 1000)
  assert.deepEqual(p, { source: 'aaria_edge', at: 1000, word: 'Aaria', text: 'remind me to call Ravi at six' })
})

test('MUST NOT BREAK: a bare wake carries no text', () => {
  assert.equal(wakePayload('native', undefined, 'Aaria', 1).text, '')
  assert.equal(wakePayload('native', null, 'Aaria', 1).text, '')
  assert.equal(wakePayload('aaria_edge', {}, 'Aaria', 1).text, '')
  assert.equal(wakePayload(undefined, undefined, 'Aaria', 1).source, 'native')
})

test('an older app that passes something else as the second argument is a bare wake', () => {
  assert.equal(wakeCommandText('remind me'), '')        // a string, not { text }
  assert.equal(wakeCommandText(42), '')
  assert.equal(wakeCommandText({ text: 42 }), '')
  assert.equal(wakeCommandText({ text: null }), '')
})

test('noise is not a command', () => {
  assert.equal(wakeCommandText({ text: '   ' }), '')
  assert.equal(wakeCommandText({ text: ' . , ' }), '')
  assert.equal(wakeCommandText({ text: '...' }), '')
})

test('spacing is tidied and a runaway text is cut', () => {
  assert.equal(wakeCommandText({ text: '  remind   me \n to call  Ravi ' }), 'remind me to call Ravi')
  assert.equal(wakeCommandText({ text: 'a'.repeat(900) }).length, 300)
})

test('Telugu and Hindi words count as a command', () => {
  assert.equal(wakeCommandText({ text: 'రవికి కాల్ చెయ్యి' }), 'రవికి కాల్ చెయ్యి')
  assert.equal(wakeCommandText({ text: 'रवि को कॉल करो' }), 'रवि को कॉल करो')
})

test('the page says it accepts words, and a wake with words reaches the listener', () => {
  const had = globalThis.window
  globalThis.window = { addEventListener() {}, dispatchEvent() {} }
  try {
    registerNativeWake()
    assert.equal(globalThis.window.__qkOnWakeAcceptsText, true)
    const seen = []
    const off = onWake((p) => seen.push(p))
    globalThis.window.__qkOnWake('aaria_edge', { text: ' remind me to call Ravi ' })
    globalThis.window.__qkOnWake('aaria_edge')
    off()
    assert.equal(seen.length, 2)
    assert.equal(seen[0].source, 'aaria_edge')
    assert.equal(seen[0].text, 'remind me to call Ravi')
    assert.equal(seen[1].text, '')
  } finally {
    if (had === undefined) delete globalThis.window; else globalThis.window = had
  }
})
