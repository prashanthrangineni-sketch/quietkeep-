// tests/hotword-not-in-app.test.mjs
//
// The browser wake word is for a phone propped up on a counter, in a BROWSER.
// Inside the Capacitor Android shell the Web Speech API is present but has no
// speech service behind it, so it starts, dies, and restarts forever — and
// Android plays its listening tone on every start.
//
// Measured from the live code path on 28 September 2026: 40 microphone starts
// in 16 seconds. The founder heard it as continuous beeping whenever the app
// was on screen, and silence when the phone was locked, because a hidden page
// releases the microphone.
//
// Run: node tests/hotword-not-in-app.test.mjs

import assert from 'node:assert/strict'
import test from 'node:test'

// The module reads window at call time, not at import time, so the stub can be
// swapped per test.
const { isHotwordSupported } = await import('../src/lib/aaria-hotword.js')

function withWindow(win, fn) {
  const had = 'window' in globalThis
  const prev = globalThis.window
  globalThis.window = win
  try { return fn() } finally {
    if (had) globalThis.window = prev
    else delete globalThis.window
  }
}

// A plain browser that supports speech recognition.
const browser = { webkitSpeechRecognition: function () {} }

test('a browser with speech recognition is supported', () => {
  assert.equal(withWindow(browser, isHotwordSupported), true)
})

test('a browser without speech recognition is not', () => {
  assert.equal(withWindow({}, isHotwordSupported), false)
})

test('the Android app is NOT supported, even though the API appears present', () => {
  const app = {
    ...browser,
    Capacitor: { isNativePlatform: () => true },
  }
  assert.equal(withWindow(app, isHotwordSupported), false)
})

test('the older isNative flag is honoured too', () => {
  const app = { ...browser, Capacitor: { isNative: true } }
  assert.equal(withWindow(app, isHotwordSupported), false)
})

test('Capacitor running in a browser preview is still a browser', () => {
  const preview = { ...browser, Capacitor: { isNativePlatform: () => false } }
  assert.equal(withWindow(preview, isHotwordSupported), true)
})

test('a Capacitor object that throws does not take the page down', () => {
  const odd = {
    ...browser,
    Capacitor: { isNativePlatform: () => { throw new Error('nope') } },
  }
  assert.doesNotThrow(() => withWindow(odd, isHotwordSupported))
})

test('no window at all is not supported', () => {
  const had = 'window' in globalThis
  const prev = globalThis.window
  delete globalThis.window
  try { assert.equal(isHotwordSupported(), false) } finally {
    if (had) globalThis.window = prev
  }
})
