// tests/aaria-llm-place.test.mjs
// "Remind me to pick up beer when I reach Chintal Kunta" (1 Oct 2026) was saved
// as an alarm at the moment he spoke. The brain must hand back a PLACE, no
// invented time, and the sentence in English letters - with Sarvam mocked.

import assert from 'node:assert/strict'
import test from 'node:test'

process.env.SARVAM_STREAM = '0'
process.env.SARVAM_API_KEY = 'test-key'
const { aariaUnderstandLLM } = await import('../src/lib/aaria-llm.js')

const NOW = '2026-10-01T12:04:00.000Z' // 5:34 pm IST

function mockSarvam(answer) {
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content: JSON.stringify(answer) } }] }),
  })
}

test('a place comes back, and "now" is not a reminder time', async () => {
  mockSarvam({
    intent: 'reminder', confidence: 0.9, language_detected: 'en-IN',
    clean_text: 'Remind me to pick up beer when I reach Chintal Kunta',
    entities: { place: 'Chintal Kunta', datetime_iso: NOW },
    reply: 'I will remind you when you reach Chintal Kunta.',
  })
  const r = await aariaUnderstandLLM('రిమాండ్ మీ టు పిక్ అప్ బియర్ వెన్ ఐ రీచ్ చింతల్ కుంట', { nowISO: NOW })
  assert.equal(r.entities.place, 'Chintal Kunta')
  assert.equal(r.entities.datetimeISO, null)
  assert.equal(r.modelCleanText, 'Remind me to pick up beer when I reach Chintal Kunta')
})

test('a place WITH a time the user named keeps the time', async () => {
  mockSarvam({
    intent: 'reminder', confidence: 0.9,
    entities: { place: 'office', datetime_iso: '2026-10-02T03:30:00.000Z' },
    reply: 'Tomorrow at nine at the office.',
  })
  const r = await aariaUnderstandLLM('remind me tomorrow at 9 at office', { nowISO: NOW })
  assert.equal(r.entities.place, 'office')
  assert.equal(r.entities.datetimeISO, '2026-10-02T03:30:00.000Z')
})

test('no clean_text from the model means none is claimed', async () => {
  mockSarvam({ intent: 'note', confidence: 0.8, entities: {}, reply: 'Saved.' })
  const r = await aariaUnderstandLLM('buy milk', { nowISO: NOW })
  assert.equal(r.modelCleanText, null)
  assert.equal(r.entities.place, null)
})

test('relative minutes still win, place or not', async () => {
  mockSarvam({ intent: 'reminder', confidence: 0.9, entities: { relative_minutes: 5 }, reply: 'In five minutes.' })
  const r = await aariaUnderstandLLM('in five minutes', { nowISO: NOW })
  assert.equal(r.entities.datetimeISO, '2026-10-01T12:09:00.000Z')
})
