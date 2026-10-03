// tests/reminder-arm.test.mjs
//
// 3 October 2026: "Call Akhilesh Munugala in one minute", the contact picked by
// a tap, the phone locked - the reminder was spoken and no call was placed.
// The fix to the lock-screen path is native code; these cases pin down the
// decisions made before the alarm is handed to the phone.
//
// Run: node tests/reminder-arm.test.mjs

import assert from 'node:assert/strict'
import test from 'node:test'
import { dedupeTwins, actionFor, alarmReport, reportSignature } from '../src/lib/reminder-arm.js'

const at = Date.parse('2026-10-03T08:46:46.535Z')

test('a reminder row and its keep are one alarm, not two', () => {
  const out = dedupeTwins([
    { id: 'rem-r1', keepId: 'k1', text: 'Call Akhilesh', fireAt: at, contactPhone: '+910000000001', contactName: 'Akhilesh' },
    { id: 'keep-k1', keepId: 'k1', text: 'Call Akhilesh', fireAt: at, contactPhone: '+910000000001', contactName: 'Akhilesh' },
  ])
  assert.deepEqual(out.map((r) => r.id), ['rem-r1'])
})

test('the number is not lost when only the keep has it', () => {
  const out = dedupeTwins([
    { id: 'rem-r1', keepId: 'k1', text: 'Call Akhilesh', fireAt: at, contactPhone: null, contactName: null },
    { id: 'keep-k1', keepId: 'k1', text: 'Call Akhilesh', fireAt: at + 400, contactPhone: '+910000000001', contactName: 'Akhilesh' },
  ])
  assert.equal(out.length, 1)
  assert.equal(out[0].contactPhone, '+910000000001')
  assert.equal(actionFor(out[0]).actionType, 'call')
  assert.equal(actionFor(out[0]).display_name, 'Akhilesh')
})

test('MUST NOT BREAK: a keep with no reminder row is still armed', () => {
  const out = dedupeTwins([{ id: 'keep-k2', keepId: 'k2', text: 'Buy milk', fireAt: at }])
  assert.deepEqual(out.map((r) => r.id), ['keep-k2'])
})

test('MUST NOT BREAK: a keep whose reminder is for a different time is still armed', () => {
  const out = dedupeTwins([
    { id: 'rem-r1', keepId: 'k1', text: 'Call Akhilesh', fireAt: at },
    { id: 'keep-k1', keepId: 'k1', text: 'Call Akhilesh', fireAt: at + 3600e3 },
  ])
  assert.deepEqual(out.map((r) => r.id), ['rem-r1', 'keep-k1'])
})

test('MUST NOT BREAK: two different reminders at the same minute both fire', () => {
  const out = dedupeTwins([
    { id: 'rem-r1', keepId: 'k1', text: 'Call Akhilesh', fireAt: at },
    { id: 'rem-r2', keepId: 'k2', text: 'Call Venu', fireAt: at },
    { id: 'keep-k3', keepId: 'k3', text: 'Buy milk', fireAt: at },
  ])
  assert.equal(out.length, 3)
})

test('a reminder row with no keep behind it never swallows a keep', () => {
  const out = dedupeTwins([
    { id: 'rem-r1', keepId: null, text: 'Call Akhilesh', fireAt: at },
    { id: 'keep-k1', keepId: 'k1', text: 'Call Akhilesh', fireAt: at },
  ])
  assert.equal(out.length, 2)
})

test('a call needs a number and the word', () => {
  assert.equal(actionFor({ text: 'Call Akhilesh', contactPhone: '' }), null)
  assert.equal(actionFor({ text: 'Buy milk', contactPhone: '+910000000001' }), null)
  assert.deepEqual(actionFor({ text: 'Call Akhilesh Munagala in next one minute.', contactPhone: '+910000000001', contactName: 'Akhilesh Munugala' }),
    { actionType: 'call', phone: '+910000000001', display_name: 'Akhilesh Munugala' })
  assert.equal(actionFor({ text: 'Akhilesh ki కాల్ cheyyi', contactPhone: '+910000000001' }).actionType, 'call')
})

test('the report keeps only what it is meant to, and never a number or a name', () => {
  const report = alarmReport({
    reminder_id: 'rem-r1', fired_at: '1791017206535', action_type: 'call', has_phone: 'true',
    fullscreen_allowed: 'true', direct_start: 'asked', countdown_result: 'acted',
    phone: '+910000000001', display_name: 'Akhilesh', reminder_text: 'Call Akhilesh', empty: '',
  })
  assert.equal(report.action_type, 'call')
  assert.equal(report.countdown_result, 'acted')
  assert.equal('phone' in report, false)
  assert.equal('display_name' in report, false)
  assert.equal('reminder_text' in report, false)
  assert.doesNotMatch(JSON.stringify(report), /910000000001|Akhilesh/)
})

test('an empty or missing record reports nothing', () => {
  assert.deepEqual(alarmReport(null), {})
  assert.deepEqual(alarmReport({}), {})
  assert.deepEqual(alarmReport({ fired_at: '' }), {})
})

test('the same state is the same signature; a new step is a new one', () => {
  const a = alarmReport({ fired_at: '1', action_type: 'call' })
  const b = alarmReport({ fired_at: '1', action_type: 'call' })
  const c = alarmReport({ fired_at: '1', action_type: 'call', countdown_result: 'acted' })
  assert.equal(reportSignature(a), reportSignature(b))
  assert.notEqual(reportSignature(a), reportSignature(c))
})
