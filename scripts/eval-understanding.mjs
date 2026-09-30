#!/usr/bin/env node
// scripts/eval-understanding.mjs
//
// Runs every sentence in tests/fixtures/understanding-cases.json through the
// live understanding brain (src/lib/aaria-llm.js) and reports, per case,
// whether it found the intent, the person, the time, the amount and the
// direction it was expected to find - and how long it took.
//
// WHY
// "The model understands Telugu" has been a belief. The regex parser's word
// lists were patched one sentence at a time because nobody had a number for
// what the model already did. This produces that number, on the same
// sentences every time, so a prompt change or a model change is a
// measurement and not an opinion.
//
// Not part of CI: it makes real calls and needs SARVAM_API_KEY. Run it by
// hand before and after any change to aaria-llm.js:
//
//     SARVAM_API_KEY=... node scripts/eval-understanding.mjs
//     SARVAM_API_KEY=... node scripts/eval-understanding.mjs --json > out.json
//
// The key is read from the environment and never printed.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { aariaUnderstandLLM } from '../src/lib/aaria-llm.js'

const here = dirname(fileURLToPath(import.meta.url))
const cases = JSON.parse(readFileSync(join(here, '..', 'tests', 'fixtures', 'understanding-cases.json'), 'utf8'))
const asJson = process.argv.includes('--json')

if (!process.env.SARVAM_API_KEY) {
  console.error('SARVAM_API_KEY is not set in this shell. Nothing was called.')
  process.exit(2)
}

const NOW = new Date()
const TZ = 'Asia/Kolkata'

function check(expect, got) {
  const fails = []
  if (!got) return ['brain returned nothing']
  if (expect.intent && got.intent !== expect.intent) fails.push(`intent ${got.intent} != ${expect.intent}`)
  if (expect.person === true && !got.entities?.person) fails.push('no person')
  if (expect.time === true && !got.entities?.datetimeISO) fails.push('no time')
  if (expect.time === false && got.entities?.datetimeISO) fails.push('invented a time')
  if (expect.missing && !(got.missing || []).includes(expect.missing)) fails.push(`did not ask for ${expect.missing}`)
  if (expect.item === true && !got.entities?.item) fails.push('no item')
  if (expect.direction && got.entities?.direction !== expect.direction) fails.push(`direction ${got.entities?.direction} != ${expect.direction}`)
  if (typeof expect.amount === 'number' && got.entities?.amount !== expect.amount) fails.push(`amount ${got.entities?.amount} != ${expect.amount}`)
  if (typeof expect.minutes_from_now === 'number' && got.entities?.datetimeISO) {
    const mins = (new Date(got.entities.datetimeISO) - NOW) / 60000
    if (Math.abs(mins - expect.minutes_from_now) > 2) fails.push(`time is ${mins.toFixed(1)} min out, expected ${expect.minutes_from_now}`)
  }
  return fails
}

const rows = []
for (const c of cases) {
  const t0 = Date.now()
  let failure = null
  const got = await aariaUnderstandLLM(c.text, {
    language: c.language, nowISO: NOW.toISOString(), timezone: TZ, workspaceMode: 'personal',
    onFailure: (r) => { failure = r },
  })
  const ms = Date.now() - t0
  const fails = check(c.expect, got)
  rows.push({
    id: c.id, language: c.language, ms, pass: fails.length === 0, fails, failure,
    intent: got?.intent ?? null, confidence: got?.confidence ?? null,
    person: got?.entities?.person ?? null, time: got?.entities?.datetimeISO ?? null,
    missing: got?.missing ?? [],
  })
}

const passed = rows.filter((r) => r.pass).length
const p50 = [...rows].sort((a, b) => a.ms - b.ms)[Math.floor(rows.length / 2)]?.ms
const p95 = [...rows].sort((a, b) => a.ms - b.ms)[Math.floor(rows.length * 0.95)]?.ms

if (asJson) {
  console.log(JSON.stringify({ measured_at: NOW.toISOString(), model: process.env.SARVAM_CHAT_MODEL || 'sarvam-105b-conversations', passed, total: rows.length, latency_ms: { p50, p95 }, rows }, null, 2))
} else {
  for (const r of rows) {
    const mark = r.pass ? 'PASS' : 'FAIL'
    console.log(`${mark}  ${r.id.padEnd(36)} ${String(r.ms).padStart(6)} ms  intent=${r.intent} conf=${r.confidence} person=${r.person ? 'yes' : 'no'} time=${r.time ? 'yes' : 'no'} missing=[${r.missing}]${r.fails.length ? '  <- ' + r.fails.join('; ') : ''}${r.failure ? '  (' + r.failure + ')' : ''}`)
  }
  console.log('')
  console.log(`${passed} of ${rows.length} passed · latency p50 ${p50} ms · p95 ${p95} ms · model ${process.env.SARVAM_CHAT_MODEL || 'sarvam-105b-conversations'}`)
}
process.exit(passed === rows.length ? 0 : 1)
