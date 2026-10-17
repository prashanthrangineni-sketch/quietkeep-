// tests/drive-voice.test.mjs
//
// Drive intents through the Intent Layer (hand-off DRV-03, 17 Oct 2026).
// Pins the levels, what the server plans, and what the phone says - the
// result, never a promise.
//
// Run: node tests/drive-voice.test.mjs

import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DRIVE_INTENTS, DRIVE_TYPE, DEVICE_ACTION, planDriveTurn, runDriveAction,
  nearestHazard, sayableMetres, driveLine,
} from '../src/lib/drive-voice.js'
import { decide, levelFor, LEVEL, DECISION, mayActUnasked } from '../src/lib/action-levels.js'
import { INTENTS } from '../src/lib/aaria-llm.js'
import { DRIVE_WORDS, whyBrainRun } from '../src/lib/understanding-record.js'

test('every Drive intent is a brain intent and has a level', () => {
  for (const i of DRIVE_INTENTS) {
    assert.ok(INTENTS.includes(i), `${i} missing from the brain's INTENTS`)
    assert.ok(DRIVE_TYPE[i], `${i} has no type`)
    assert.notEqual(levelFor({ type: DRIVE_TYPE[i] }), LEVEL.NEVER, `${i} has no level`)
  }
})

test('levels match the hand-off', () => {
  assert.equal(levelFor({ type: DRIVE_TYPE.save_last_60s }), LEVEL.READ_BACK)   // "auto": seals on the phone
  assert.equal(levelFor({ type: DRIVE_TYPE.share_record }), LEVEL.SPOKEN_YES)   // reaches another person
  for (const i of ['read_health', 'read_faults', 'hazard_ahead', 'stay_awake']) {
    assert.equal(levelFor({ type: DRIVE_TYPE[i] }), LEVEL.READ_BACK, i)
  }
})

test('saving the record happens without asking; sharing never does', () => {
  assert.equal(mayActUnasked(DRIVE_TYPE.save_last_60s), true)
  assert.equal(mayActUnasked(DRIVE_TYPE.share_record), false)
  const s = decide({ type: DRIVE_TYPE.share_record }, { spokenYes: false, unlocked: true }, { doneThisHour: 0 })
  assert.equal(s.decision, DECISION.ASK_YES)
})

test('the paused switch stops Drive actions too', () => {
  const s = decide({ type: DRIVE_TYPE.save_last_60s }, {}, { settings: { actions_paused: true } })
  assert.equal(s.decision, DECISION.REFUSE)
})

test('share reads back WHO and sends nothing; no phone action yet', () => {
  const p = planDriveTurn({ intent: 'share_record', entities: { person: 'Suresh' }, language: 'en-IN' })
  assert.equal(p.deviceAction, null)
  assert.match(p.tts, /Suresh/)
  assert.match(p.tts, /nothing has been sent/)
  const te = planDriveTurn({ intent: 'share_record', entities: { person: 'Suresh' }, language: 'te-IN' })
  assert.match(te.tts, /Suresh/)
})

test('car health and faults wait for the car reader', () => {
  for (const i of ['read_health', 'read_faults']) {
    const p = planDriveTurn({ intent: i, language: 'en-IN' })
    assert.equal(p.deviceAction, null)
    assert.equal(p.tts, 'Connect the car reader first, then ask me again.')
  }
  assert.equal(DEVICE_ACTION.read_health, null)
})

test('server never says the record was saved - the phone says that', () => {
  const p = planDriveTurn({ intent: 'save_last_60s', language: 'en-IN' })
  assert.equal(p.deviceAction, 'save_last_60s')
  assert.doesNotMatch(p.tts, /saved/i)
})

test('phone: save seals with the voice trigger and says the result', async () => {
  let trigger = null
  const said = await runDriveAction('save_last_60s', {
    language: 'en-IN',
    deps: { isBlackboxAvailable: () => true, saveLast60s: async (t) => { trigger = t; return { id: 'r1' } } },
  })
  assert.equal(trigger, 'voice_save')
  assert.equal(said, 'Saved the last 60 seconds of the drive.')
})

test('phone: save outside the app or on failure does not claim success', async () => {
  const noBox = await runDriveAction('save_last_60s', { language: 'hi-IN', deps: { isBlackboxAvailable: () => false } })
  assert.equal(noBox, driveLine('save_no_box', 'hi-IN'))
  const failed = await runDriveAction('save_last_60s', {
    language: 'en-IN', deps: { isBlackboxAvailable: () => true, saveLast60s: async () => null },
  })
  assert.equal(failed, 'I could not save the record just now. Try once more.')
})

test('phone: hazard ahead uses the shared map and a sayable distance', async () => {
  const pos = { lat: 17.4, lng: 78.4 }
  const near = { id: 'a', lat: 17.4027, lng: 78.4, kind: 'hard_brake', severity: 'hard', reports: 3 }
  const said = await runDriveAction('hazard_ahead', {
    language: 'en-IN',
    deps: { position: () => pos, fetchSpots: async () => [near], phraseFor: () => 'Riders often slow down suddenly just ahead.' },
  })
  assert.equal(said, 'Riders often slow down suddenly in about 300 metres.')
  const none = await runDriveAction('hazard_ahead', { language: 'en-IN', deps: { position: () => pos, fetchSpots: async () => [] } })
  assert.equal(none, 'Nothing reported on the road ahead.')
  const noFix = await runDriveAction('hazard_ahead', { language: 'te-IN', deps: { position: () => null } })
  assert.equal(noFix, driveLine('hazard_no_fix', 'te-IN'))
})

test('nearestHazard ignores single unconfirmed reports, far spots and spots behind', () => {
  const pos = { lat: 17.4, lng: 78.4, headingDeg: 0 }
  const lone = { id: 'l', lat: 17.401, lng: 78.4, kind: 'hard_brake', severity: 'moderate', reports: 1 }
  const far = { id: 'f', lat: 17.42, lng: 78.4, kind: 'hard_brake', severity: 'hard', reports: 5 }
  const behind = { id: 'b', lat: 17.398, lng: 78.4, kind: 'hard_brake', severity: 'hard', reports: 5 }
  assert.equal(nearestHazard(pos, [lone, far, behind]), null)
  assert.equal(sayableMetres(312), 300)
  assert.equal(sayableMetres(780), 800)
  assert.equal(sayableMetres(10), 50)
})

test('phone: stay awake depends on whether the ride guard is on', async () => {
  const on = await runDriveAction('stay_awake', { language: 'en-IN', deps: { isRideGuardActive: () => true } })
  const off = await runDriveAction('stay_awake', { language: 'en-IN', deps: { isRideGuardActive: () => false } })
  assert.match(on, /watching your ride time/)
  assert.match(off, /Turn on Drive Mode/)
})

test('Drive sentences make the brain run; ordinary reminders do not trip it', () => {
  for (const t of ['keep me awake', 'save the record', 'anything ahead', 'how is my car', 'any engine faults', 'black box save', 'save last 60']) {
    assert.ok(DRIVE_WORDS.test(t), t)
    const d = whyBrainRun({ parsed: { type: 'task', confidence: 0.9 }, text: t, language: 'en-IN', reminderAt: new Date() })
    assert.ok(d.reasons.includes('drive_shaped'), t)
  }
  assert.equal(DRIVE_WORDS.test('remind me to call Ravi at 5'), false)
})
