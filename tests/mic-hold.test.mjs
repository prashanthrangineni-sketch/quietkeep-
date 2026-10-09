// tests/mic-hold.test.mjs
//
// "Hey Aaria" worked once per app start: the phone-side listener stepped aside
// when Aaria opened the microphone and was never told she had finished
// (fault A22, 3 October 2026). These cases pin down when "taken" and "free"
// are said - once each per turn, and "free" only when the turn is really over.
//
// Run: node tests/mic-hold.test.mjs

import assert from 'node:assert/strict'
import test from 'node:test'
import { createMicHold } from '../src/lib/mic-hold.js'

function rig(over = {}) {
  const log = []
  const state = { t: 0, busy: true, timers: 0 }
  const hold = createMicHold({
    claim: () => log.push('taken'),
    release: () => log.push('free'),
    isBusy: () => state.busy,
    now: () => state.t,
    setTimer: () => { state.timers += 1; return 1 },
    clearTimer: () => { state.timers -= 1 },
    ...over,
  })
  const run = (ms) => { for (let i = 0; i < ms / 250; i++) { state.t += 250; hold.tick() } }
  return { hold, log, state, run }
}

test('says "taken" once when the microphone opens', () => {
  const { hold, log } = rig()
  assert.equal(hold.hold(), true)
  assert.deepEqual(log, ['taken'])
  assert.equal(hold.held(), true)
})

test('stays taken while she listens, thinks and speaks', () => {
  const { hold, log, run } = rig()
  hold.hold()
  run(20000)
  assert.deepEqual(log, ['taken'])
})

test('says "free" once, a full second after everything has stopped', () => {
  const { hold, log, state, run } = rig()
  hold.hold()
  run(3000)
  state.busy = false
  run(750)
  assert.deepEqual(log, ['taken'])          // not yet: under a second of quiet
  run(750)
  assert.deepEqual(log, ['taken', 'free'])
  run(5000)
  assert.deepEqual(log, ['taken', 'free'])  // and only once
  assert.equal(hold.held(), false)
  assert.equal(state.timers, 0)             // the watcher is gone
})

test('a gap between her question and the answer does not free the microphone', () => {
  const { hold, log, state, run } = rig()
  hold.hold()
  run(2000)
  state.busy = false; run(500)     // half a second of nothing
  state.busy = true;  run(4000)    // she starts speaking her question
  state.busy = false; run(500)
  assert.deepEqual(log, ['taken'])
})

test('the answer turn re-opens the microphone without saying "taken" again', () => {
  const { hold, log, run } = rig()
  hold.hold()
  run(5000)
  assert.equal(hold.hold(), false)
  assert.deepEqual(log, ['taken'])
})

test('a stuck state cannot silence the other listener for good', () => {
  const { hold, log, run } = rig()
  hold.hold()
  run(89000)
  assert.deepEqual(log, ['taken'])
  run(1500)
  assert.deepEqual(log, ['taken', 'free'])
})

test('re-opening the microphone renews the ceiling', () => {
  const { hold, log, run } = rig()
  hold.hold()
  run(80000)
  hold.hold()
  run(80000)
  assert.deepEqual(log, ['taken'])
})

test('a new turn after "free" says "taken" again', () => {
  const { hold, log, state, run } = rig()
  hold.hold(); state.busy = false; run(1500)
  state.busy = true
  assert.equal(hold.hold(), true)
  assert.deepEqual(log, ['taken', 'free', 'taken'])
})

test('leaving the screen frees the microphone at once, and only if it was taken', () => {
  const a = rig(); a.hold.hold(); a.hold.dispose()
  assert.deepEqual(a.log, ['taken', 'free'])
  const b = rig(); b.hold.dispose()
  assert.deepEqual(b.log, [])
})

test('a fault in the signals or the busy check never throws', () => {
  const { hold, state, run } = rig({
    claim: () => { throw new Error('x') },
    release: () => { throw new Error('y') },
    isBusy: () => { throw new Error('z') },
  })
  assert.doesNotThrow(() => hold.hold())
  assert.doesNotThrow(() => run(2000))     // a busy check that fails counts as "not busy"
  assert.equal(hold.held(), false)
  assert.equal(state.timers, 0)
})
