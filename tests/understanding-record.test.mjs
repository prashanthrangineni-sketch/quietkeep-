// tests/understanding-record.test.mjs
//
// The decision "should the brain read this" and the record "what the brain
// did" used to be inline in the capture route and invisible afterwards. Both
// are pure now; both are pinned here.

import assert from 'node:assert/strict'
import test from 'node:test'
import { whyBrainRun, describeUnderstanding } from '../src/lib/understanding-record.js'

const NOW = new Date('2026-09-30T14:10:00+05:30')

// ── whyBrainRun ───────────────────────────────────────────────────────────────

test('a confident English reminder with a time stays on the regex', () => {
  const d = whyBrainRun({
    parsed: { type: 'reminder', confidence: 0.9 },
    text: 'remind me to call Surya Kiran in five minutes',
    language: 'en-IN',
    reminderAt: NOW,
  })
  assert.equal(d.run, false)
  assert.deepEqual(d.reasons, [])
})

test('Telugu always goes to the brain, and the reason says so', () => {
  const d = whyBrainRun({
    parsed: { type: 'reminder', confidence: 0.9 },
    text: 'ఐదు నిమిషాల్లో సూర్య కిరణ్‌కి కాల్ చెయ్యి',
    language: 'te-IN',
    reminderAt: NOW,
  })
  assert.equal(d.run, true)
  assert.ok(d.reasons.includes('non_english'))
})

test('a reminder the regex found no time for goes to the brain', () => {
  const d = whyBrainRun({
    parsed: { type: 'reminder', confidence: 0.9 },
    text: 'remind me to call Surya Kiran',
    language: 'en-IN',
    reminderAt: null,
  })
  assert.equal(d.run, true)
  assert.ok(d.reasons.includes('no_time_found'))
})

test('romanised Hindi tagged as English is caught by its function words', () => {
  const d = whyBrainRun({
    parsed: { type: 'note', confidence: 0.95 },
    text: 'Surya Kiran ko paanch minute mein call karna hai',
    language: 'en-IN',
    reminderAt: null,
  })
  assert.ok(d.reasons.includes('romanised_indic'))
})

test('the regex being confidently money-shaped is not trusted', () => {
  const d = whyBrainRun({
    parsed: { type: 'expense', confidence: 0.95 },
    text: 'Ramesh se paanch sau rupaye aaye',
    language: 'en-IN',
    reminderAt: null,
  })
  assert.ok(d.reasons.includes('money_shaped'))
})

test('a weak regex result is a reason on its own', () => {
  const d = whyBrainRun({
    parsed: { type: 'unknown', confidence: 0.1 },
    text: 'the thing with the place',
    language: 'en-IN',
    reminderAt: null,
  })
  assert.deepEqual(d.reasons, ['regex_weak'])
})

// ── describeUnderstanding ─────────────────────────────────────────────────────

test('regex-only captures say so and carry nothing else', () => {
  const r = describeUnderstanding({ decision: { run: false, reasons: [] }, llmAssist: null })
  assert.deepEqual(r, { engine: 'regex', ran: false, reasons: [], outcome: 'regex_only' })
})

test('a brain that returned nothing names the failure', () => {
  const r = describeUnderstanding({
    decision: { run: true, reasons: ['non_english'] },
    llmAssist: null, latencyMs: 12003, failure: 'timeout',
  })
  assert.equal(r.outcome, 'failed_timeout')
  assert.equal(r.latency_ms, 12003)
  assert.deepEqual(r.reasons, ['non_english'])
})

test('a brain that returned nothing with no named failure is still recorded', () => {
  const r = describeUnderstanding({ decision: { run: true, reasons: ['regex_weak'] }, llmAssist: null })
  assert.equal(r.outcome, 'returned_nothing')
})

test('the 30 September case: brain ran, saw a person, saw no time, asked', () => {
  const r = describeUnderstanding({
    decision: { run: true, reasons: ['non_english'] },
    llmAssist: {
      intent: 'reminder', confidence: 0.8, language: 'te-IN', engine: 'sarvam-105b-conversations',
      entities: { person: 'Surya Kiran', datetimeISO: null }, missing: ['datetime'],
    },
    latencyMs: 4200,
  })
  assert.equal(r.outcome, 'accepted')
  assert.equal(r.person_found, true)
  assert.equal(r.time_found, false)
  assert.deepEqual(r.missing, ['datetime'])
})

test('below the gate is recorded as below the gate, not as a failure', () => {
  const r = describeUnderstanding({
    decision: { run: true, reasons: ['regex_weak'] },
    llmAssist: { intent: 'note', confidence: 0.3, entities: {}, missing: [] },
  })
  assert.equal(r.outcome, 'below_threshold')
})

test('the record never carries prompt, key or raw model text', () => {
  const r = describeUnderstanding({
    decision: { run: true, reasons: ['non_english'] },
    llmAssist: {
      intent: 'reminder', confidence: 0.9, entities: { person: 'X', datetimeISO: NOW.toISOString() },
      missing: [], reply: 'ఐదు నిమిషాల్లో గుర్తు చేస్తాను', cleanText: 'raw text here', title: 't',
    },
  })
  const blob = JSON.stringify(r)
  assert.ok(!blob.includes('raw text here'))
  assert.ok(!blob.includes('గుర్తు చేస్తాను'))
  assert.ok(!('reply' in r) && !('cleanText' in r))
})
