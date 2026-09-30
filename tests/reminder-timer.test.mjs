// tests/reminder-timer.test.mjs
//
// Moving a keep to another state never touched its reminder. The cause was
// that the dashboard read `result?.keep?.reminder_at` off keepsStore
// .transition(), which is declared Promise<void> and returns nothing — so the
// condition was undefined on every call and the block was dead from the day it
// was written.
//
// The worst consequence was not the missing schedule. It was the missing
// CANCEL: a keep marked done kept a live alarm, and it would still fire.

import assert from 'node:assert/strict'
import test from 'node:test'
import { reminderTimerMessage, TERMINAL_STATES } from '../src/lib/reminder-timer.js'

const NOW = Date.parse('2026-09-30T12:00:00+05:30')
const inAnHour = new Date(NOW + 60 * 60 * 1000).toISOString()
const anHourAgo = new Date(NOW - 60 * 60 * 1000).toISOString()

const keep = (over = {}) => ({
  id: 'keep-1',
  content: 'call Surya Kiran',
  reminder_at: inAnHour,
  status: 'open',
  ...over,
})

// ── the alarm that must not survive ──────────────────────────────────────────

test('marking a keep done cancels its alarm', () => {
  const msg = reminderTimerMessage(keep(), 'done', NOW)
  assert.deepEqual(msg, { type: 'CANCEL_REMINDER', id: 'keep-1' })
})

test('closing a keep cancels its alarm', () => {
  assert.equal(reminderTimerMessage(keep(), 'closed', NOW).type, 'CANCEL_REMINDER')
})

test('finishing cancels even when the client copy shows no reminder', () => {
  // A stale or partial record on the client must never be the reason an alarm
  // outlives the task. Cancelling a timer that does not exist costs nothing.
  const msg = reminderTimerMessage(keep({ reminder_at: null }), 'done', NOW)
  assert.equal(msg.type, 'CANCEL_REMINDER')
})

// ── still live: keep it armed ────────────────────────────────────────────────

test('deferring a keep re-arms its alarm', () => {
  const msg = reminderTimerMessage(keep(), 'deferred', NOW)
  assert.equal(msg.type, 'SCHEDULE_REMINDER')
  assert.equal(msg.id, 'keep-1')
  assert.equal(msg.fireAt, Date.parse(inAnHour))
  assert.equal(msg.text, 'call Surya Kiran')
})

test('blocking and activating also keep the alarm', () => {
  assert.equal(reminderTimerMessage(keep(), 'blocked', NOW).type, 'SCHEDULE_REMINDER')
  assert.equal(reminderTimerMessage(keep(), 'active', NOW).type, 'SCHEDULE_REMINDER')
})

// ── nothing to do ────────────────────────────────────────────────────────────

test('a keep with no reminder is left alone while it is still live', () => {
  assert.equal(reminderTimerMessage(keep({ reminder_at: null }), 'deferred', NOW), null)
})

test('a reminder already in the past is not re-armed', () => {
  // The service worker would fire it at once, which reads to the user as a
  // random alarm with no cause — worse than the silence it replaced.
  assert.equal(reminderTimerMessage(keep({ reminder_at: anHourAgo }), 'deferred', NOW), null)
})

test('a malformed reminder time is ignored rather than thrown on', () => {
  assert.equal(reminderTimerMessage(keep({ reminder_at: 'tomorrow-ish' }), 'active', NOW), null)
})

test('a missing keep is not an error', () => {
  assert.equal(reminderTimerMessage(null, 'done', NOW), null)
  assert.equal(reminderTimerMessage(undefined, 'deferred', NOW), null)
  assert.equal(reminderTimerMessage({}, 'done', NOW), null)
})

// ── the states themselves ────────────────────────────────────────────────────

test('terminal states are exactly done and closed', () => {
  // keeps.status allows open, active, blocked, deferred, reminded, done,
  // closed. Only two of those mean finished, and treating any other as
  // terminal would silently cancel live reminders.
  assert.deepEqual([...TERMINAL_STATES].sort(), ['closed', 'done'])
  for (const live of ['open', 'active', 'blocked', 'deferred', 'reminded']) {
    assert.equal(
      reminderTimerMessage(keep(), live, NOW).type,
      'SCHEDULE_REMINDER',
      `${live} is not a finished state and must keep its alarm`
    )
  }
})
