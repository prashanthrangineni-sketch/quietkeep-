#!/usr/bin/env node
// scripts/eval-understanding.mjs
//
// Runs every sentence in tests/fixtures/understanding-cases.json through the
// understanding brain - the production prompt, request body and parser from
// src/lib/aaria-llm.js - against one or more models, and reports, per case,
// whether it found the intent, the person, the time, the amount and the
// direction it was expected to find, and how long it took.
//
// WHY
// "The model understands Telugu" has been a belief. The regex parser's word
// lists were patched one sentence at a time because nobody had a number for
// what the model already did. This produces that number, on the same
// sentences every time, so a prompt change or a model change is a
// measurement and not an opinion.
//
// SAME PROMPT, SAME PARSER, EVERY MODEL
// buildPrompt, buildRequestBody, readUntilJsonComplete and parseBrainResponse
// are imported from aaria-llm.js, so a model here is asked exactly what
// production asks Sarvam and is read exactly the way production reads Sarvam.
// Only the URL, the key and the model name differ. New models live ONLY in
// this script; nothing in production calls them.
//
// Not part of CI: it makes real calls. Run it by hand, or through
// .github/workflows/eval-understanding.yml (workflow_dispatch only):
//
//     SARVAM_API_KEY=... node scripts/eval-understanding.mjs
//     node scripts/eval-understanding.mjs \
//         --model sarvam:sarvam-105b-conversations \
//         --model groq:llama-3.3-70b-versatile \
//         --out measurements/understanding-latest
//
// --model provider:model   repeatable; default is the production model
// --out <path>             writes <path>.json and <path>.md (extension optional)
// --limit <n>              only the first n cases (a smoke test)
// --json                   print the JSON report to stdout
// EVAL_GAP_MS=<ms>         override the pause between calls (0 for a mocked run)
//
// A provider whose key is not in the environment is reported as
// "not measured - no key"; it is never a failure. Keys are read from the
// environment and never printed: any error text a provider returns is
// stripped of every key before it is stored.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  INTENTS, buildPrompt, buildRequestBody, readUntilJsonComplete, parseBrainResponse,
} from '../src/lib/aaria-llm.js'

const here = dirname(fileURLToPath(import.meta.url))
const allCases = JSON.parse(readFileSync(join(here, '..', 'tests', 'fixtures', 'understanding-cases.json'), 'utf8'))

// ── arguments ───────────────────────────────────────────────────────────────
const argv = process.argv.slice(2)
const modelArgs = []
let outPath = null
let limit = null
const asJson = argv.includes('--json')
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--model') modelArgs.push(argv[++i])
  else if (argv[i] === '--out') outPath = argv[++i]
  else if (argv[i] === '--limit') limit = Number(argv[++i])
}
const PROD_MODEL = process.env.SARVAM_CHAT_MODEL || 'sarvam-105b-conversations'
if (!modelArgs.length) modelArgs.push(`sarvam:${PROD_MODEL}`)
const cases = Number.isFinite(limit) && limit > 0 ? allCases.slice(0, limit) : allCases

// Same as production's default (SARVAM_CHAT_TIMEOUT_MS unset).
const TIMEOUT_MS = Number(process.env.SARVAM_CHAT_TIMEOUT_MS || 12000)
const NOW = new Date()
const TZ = 'Asia/Kolkata'
const BASELINE = 'sarvam:sarvam-105b-conversations'

// ── providers ───────────────────────────────────────────────────────────────
// gapMs keeps each run under the provider's published free-tier request rate
// (Groq 30/min, Gemini 15/min, OpenRouter free 20/min). It is waited BETWEEN
// calls and is not part of any measured latency.
// Yotta Shakti Studio (India): OpenAI-style chat completions at one address;
// the model is picked by the "id" header (its Shakti model UUID) plus the
// model name. Short names below map to both. Read from the Shakti Studio
// console on 27 Oct 2026. Billed per token from Pranix's Shakti credit.
const SHAKTI_MODELS = {
  'qwen2.5-vl-72b': { model: 'Qwen/Qwen2.5-VL-72B-Instruct', id: '6dd41d60-1a64-4fa4-9871-17dbe1c73833' },
  'gemma-3-27b': { model: 'gemma-it', id: '23a8dfd7-f6d4-426c-b637-517c205282c7' },
  'llama-4-maverick': { model: 'llama-4', id: '5a5bddc0-4ea9-40c6-b946-2efc2113fa76' },
  'gpt-oss-120b': { model: 'openai/gpt-oss-120b', id: 'cde45577-aa83-442d-bbb4-fb3c54980bf5' },
}

const PROVIDERS = {
  shakti: {
    url: 'https://http.prod-llm.shaktistudio.shakticloud.ai/chat/completions',
    keyName: 'SHAKTI_API_KEY',
    headers: (k, model) => ({ 'Content-Type': 'application/json', 'Authorization': `Bearer ${k}`, ...(SHAKTI_MODELS[model] ? { id: SHAKTI_MODELS[model].id } : {}) }),
    bodyModel: (model) => SHAKTI_MODELS[model]?.model || model,
    gapMs: 1000,
  },

  sarvam: {
    url: 'https://api.sarvam.ai/v1/chat/completions',
    keyName: 'SARVAM_API_KEY',
    // Exactly the headers aaria-llm.js sends.
    headers: (k) => ({ 'Content-Type': 'application/json', 'api-subscription-key': k, 'Authorization': `Bearer ${k}` }),
    gapMs: 0,
  },
  groq: {
    url: 'https://api.groq.com/openai/v1/chat/completions',
    keyName: 'GROQ_API_KEY',
    headers: (k) => ({ 'Content-Type': 'application/json', 'Authorization': `Bearer ${k}` }),
    gapMs: 2100,
  },
  gemini: {
    // Google's OpenAI-compatible endpoint: same body, same SSE shape.
    url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    keyName: 'GEMINI_API_KEY',
    headers: (k) => ({ 'Content-Type': 'application/json', 'Authorization': `Bearer ${k}` }),
    gapMs: 4100,
  },
  openrouter: {
    url: 'https://openrouter.ai/api/v1/chat/completions',
    keyName: 'OPENROUTER_API_KEY',
    // Same identification headers src/lib/llm.js sends.
    headers: (k) => ({ 'Content-Type': 'application/json', 'Authorization': `Bearer ${k}`, 'HTTP-Referer': 'https://quietkeep.com', 'X-Title': 'QuietKeep' }),
    gapMs: 3100,
  },
}

// Published prices, quoted with where they came from. Looked up 15 Oct 2026.
// The providers' own pricing pages could not be opened from the machine that
// wrote this (its network blocks them), so each figure says what it rests on.
// Nothing here is measured.
const PRICES = {
  'sarvam:sarvam-105b-conversations': {
    text: "Sarvam's own docs disagree: one table lists ₹29.28 in / ₹73.2 out per 1M tokens for sarvam-105b-conversations, another lists sarvam-105b at ₹4 in / ₹16 out, and sarvam.ai/api-pricing says \"Free per token\". Unresolved - check the link.",
    url: 'https://docs.sarvam.ai/api-reference-docs/pricing',
  },
  'sarvam:sarvam-30b': {
    text: "Sarvam docs list sarvam-30b at ₹2.5 in / ₹10 out per 1M tokens; sarvam.ai/api-pricing says \"Free per token\". Unresolved - check the link.",
    url: 'https://docs.sarvam.ai/api-reference-docs/pricing',
  },
  'groq:llama-3.3-70b-versatile': {
    text: '$0.59 in / $0.79 out per 1M tokens (as reported by third-party price trackers; Groq page not opened)',
    url: 'https://groq.com/pricing',
  },
  'gemini:gemini-2.5-flash-lite': {
    text: '$0.10 in / $0.40 out per 1M tokens, paid tier (as reported by third-party price trackers citing Google; Google page not opened)',
    url: 'https://ai.google.dev/gemini-api/docs/pricing',
  },
}
function priceFor(id) {
  if (PRICES[id]) return PRICES[id]
  const [provider, ...rest] = id.split(':')
  const model = rest.join(':')
  if (provider === 'openrouter' && model.endsWith(':free')) {
    return { text: '$0 (OpenRouter ":free" variant; rate-limited)', url: `https://openrouter.ai/${model}` }
  }
  return { text: 'not looked up', url: null }
}

// ── one call ────────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function redact(s) {
  let out = String(s || '')
  for (const p of Object.values(PROVIDERS)) {
    const k = process.env[p.keyName]
    if (k && k.length >= 4) out = out.split(k).join('[key]')
  }
  return out.replace(/\s+/g, ' ').slice(0, 300)
}

// The four kinds the report counts. no_intent (JSON came back without an
// intent) is counted as no_json: in both, there was no usable answer.
function kindOf(failure) {
  if (!failure) return null
  if (failure.startsWith('http_')) return 'http'
  if (failure === 'no_intent') return 'no_json'
  return failure
}

async function callOnce(provider, model, c, key) {
  const p = PROVIDERS[provider]
  const clean = c.text.trim()
  // Exactly the arguments aariaUnderstandLLM passes to buildPrompt.
  const prompt = buildPrompt({
    text: clean.slice(0, 1000),
    language: c.language || 'en-IN',
    nowISO: NOW.toISOString(),
    timezone: TZ,
    workspaceMode: c.mode || 'personal',
    pageLabel: null,
  })
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  const t0 = Date.now()
  try {
    const res = await fetch(p.url, {
      method: 'POST',
      headers: p.headers(key, model),
      body: JSON.stringify(buildRequestBody({ model: p.bodyModel ? p.bodyModel(model) : model, prompt, stream: true })),
      signal: ctrl.signal,
    })
    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      return { ms: Date.now() - t0, failure: `http_${res.status}`, status: res.status, error: redact(errText), retryAfter: Number(res.headers.get('retry-after')) || null }
    }
    const raw = res.body ? await readUntilJsonComplete(res.body, ctrl) : ''
    const ms = Date.now() - t0
    const { result, failure } = parseBrainResponse(raw, { clean, nowISO: NOW.toISOString(), language: c.language, model })
    return { ms, failure: failure || null, result: result || null, rawIntent: rawIntentOf(raw) }
  } catch (err) {
    const ms = Date.now() - t0
    if (err?.name === 'AbortError') return { ms, failure: 'timeout' }
    return { ms, failure: 'threw', error: redact(err?.message || String(err)) }
  } finally {
    clearTimeout(timer)
  }
}

// The intent word the model actually wrote, before the parser maps anything
// outside INTENTS to "note". This is what the gap list reports.
function rawIntentOf(raw) {
  const m = String(raw || '').match(/"intent"\s*:\s*"([^"]{1,40})"/)
  return m ? m[1] : null
}

async function call(provider, model, c, key) {
  let r
  let retries = 0
  for (;;) {
    r = await callOnce(provider, model, c, key)
    if (r.status !== 429 || retries >= 2) break
    retries++
    await sleep(Math.min(60, r.retryAfter || 15) * 1000)
  }
  return { ...r, retries }
}

// A first answer that says the model is gone ends that model's run.
const GONE = /(deprecat|decommission|retired|no longer|not found|does not exist|doesn't exist|no endpoints|invalid model|unknown model|model.{0,40}not (?:available|supported)|not a valid model)/i

// ── scoring ─────────────────────────────────────────────────────────────────
const isGap = (c) => typeof c.expect?.intent === 'string' && c.expect.intent.startsWith('unsupported:')
// Brain answers the capture route turns into a reply and NO keep
// (src/lib/brain-turn.js NO_KEEP_INTENTS). Kept as a literal here so this
// script stays free of the route's imports.
const NO_KEEP = new Set(['none', 'confirm', 'pay', 'delete'])
// Drive Mode intents (17 Oct 2026, src/lib/drive-voice.js) also save no keep:
// the capture route answers them and the phone acts. Counted as "saved
// nothing" in the no_keep check, and still action intents for intent_any.
const DRIVE = ['save_last_60s', 'share_record', 'read_health', 'read_faults', 'hazard_ahead', 'stay_awake']
const SAVES_NOTHING = new Set([...NO_KEEP, ...DRIVE])
const ACTION_INTENTS = new Set(INTENTS.filter((i) => i !== 'note' && i !== 'query' && !NO_KEEP.has(i)))
const normName = (s) => String(s || '').toLowerCase().replace(/[^a-z]/g, '')

function localParts(iso) {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return null
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false }).formatToParts(d)
  const get = (t) => f.find((x) => x.type === t)?.value
  return { date: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')) % 24 }
}
function dayOffset(iso) {
  const a = localParts(NOW.toISOString()), b = localParts(iso)
  if (!a || !b) return null
  return Math.round((Date.parse(b.date) - Date.parse(a.date)) / 86400000)
}

/** Returns { checks: {intent?, person?, time?, amount?, direction?, missing?, item?}, fails: [] } */
function score(expect, got) {
  const checks = {}
  const fails = []
  const e = got?.entities || {}
  const mark = (k, ok, why) => { checks[k] = ok; if (!ok) fails.push(why) }

  if (expect.intent_any) {
    const ok = !!got && expect.intent_any.includes(got.intent) && !(expect.no_action && ACTION_INTENTS.has(got.intent))
    mark('intent', ok, `intent ${got?.intent ?? 'none'} not in ${expect.intent_any.join('/')}`)
  } else if (expect.intent) {
    mark('intent', got?.intent === expect.intent, `intent ${got?.intent ?? 'none'} != ${expect.intent}`)
  }

  if (expect.person !== undefined) {
    const p = e.person
    let ok = !!p && !/[^\x00-\x7F]/.test(p)   // contacts are stored in English letters
    if (ok && Array.isArray(expect.person)) {
      const g = normName(p)
      ok = expect.person.some((n) => { const w = normName(n); return w && (g.includes(w) || w.includes(g)) })
    }
    mark('person', ok, p ? `person "${p}"` : 'no person')
  }

  const wantsTime = expect.time !== undefined || expect.minutes_from_now !== undefined || expect.local_hour !== undefined || expect.day_offset !== undefined
  if (wantsTime) {
    const t = e.datetimeISO
    let ok = true, why = ''
    if (expect.time === false) { if (t) { ok = false; why = 'invented a time' } }
    else if (!t) { ok = false; why = 'no time' }
    else {
      if (typeof expect.minutes_from_now === 'number') {
        const mins = (new Date(t) - NOW) / 60000
        if (!(Math.abs(mins - expect.minutes_from_now) <= 2)) { ok = false; why = `time ${Number.isFinite(mins) ? mins.toFixed(1) : '?'} min out, expected ${expect.minutes_from_now}` }
      }
      if (typeof expect.day_offset === 'number' && dayOffset(t) !== expect.day_offset) { ok = false; why = `day offset ${dayOffset(t)} != ${expect.day_offset}` }
      if (typeof expect.local_hour === 'number' && localParts(t)?.hour !== expect.local_hour) { ok = false; why = `local hour ${localParts(t)?.hour} != ${expect.local_hour}` }
    }
    mark('time', ok, why)
  }

  if (typeof expect.amount === 'number') mark('amount', e.amount === expect.amount, `amount ${e.amount ?? 'none'} != ${expect.amount}`)
  if (expect.direction) mark('direction', e.direction === expect.direction, `direction ${e.direction ?? 'none'} != ${expect.direction}`)
  if (expect.missing) mark('missing', (got?.missing || []).includes(expect.missing), `did not ask for ${expect.missing}`)
  if (expect.item === true) mark('item', !!e.item, 'no item')
  // Business details read back before a write (15 Oct 2026).
  if (expect.status) mark('status', e.status === expect.status, `status ${e.status ?? 'none'} != ${expect.status}`)
  if (expect.stock_op) mark('stock_op', e.stockOp === expect.stock_op, `stock_op ${e.stockOp ?? 'none'} != ${expect.stock_op}`)
  if (typeof expect.quantity === 'number') mark('quantity', e.quantity === expect.quantity, `quantity ${e.quantity ?? 'none'} != ${expect.quantity}`)
  // A sentence that must not save anything ("thank you", a stray "yes"):
  // did the brain give an answer the route turns into a keep? A failed call
  // counts as a keep - production then falls back to the regex parser.
  if (expect.no_keep) mark('no_keep', !!got && SAVES_NOTHING.has(got.intent), `would save a ${got?.intent ?? 'regex'} keep`)
  return { checks, fails }
}

// ── one model, every case ───────────────────────────────────────────────────
async function runModel(id) {
  const i = id.indexOf(':')
  const provider = i > 0 ? id.slice(0, i).toLowerCase() : ''
  const model = i > 0 ? id.slice(i + 1) : ''
  if (!PROVIDERS[provider] || !model) return { id, status: 'not measured - unknown provider', rows: [] }
  const key = process.env[PROVIDERS[provider].keyName]
  if (!key) return { id, provider, model, status: 'not measured - no key', note: `${PROVIDERS[provider].keyName} is not set`, rows: [] }

  const rows = []
  for (const [n, c] of cases.entries()) {
    const gap = process.env.EVAL_GAP_MS !== undefined ? Number(process.env.EVAL_GAP_MS) : PROVIDERS[provider].gapMs
    if (n > 0 && gap > 0) await sleep(gap)
    const r = await call(provider, model, c, key)
    if (n === 0 && r.status && r.status >= 400 && r.status < 500 && r.status !== 429 && GONE.test(r.error || '')) {
      return { id, provider, model, status: provider === 'openrouter' ? 'retired' : 'not offered', note: `HTTP ${r.status}: ${r.error}`, rows: [] }
    }
    const got = r.result
    const { checks, fails } = isGap(c) ? { checks: {}, fails: [] } : score(c.expect, got)
    rows.push({
      id: c.id, group: c.group, gap: isGap(c) ? c.expect.intent.slice('unsupported:'.length) : null,
      ms: r.ms, retries: r.retries, failure: r.failure || null, failure_kind: kindOf(r.failure), error: r.error || null,
      intent: got?.intent ?? null, raw_intent: r.rawIntent ?? null, confidence: got?.confidence ?? null,
      person: got?.entities?.person ?? null, time: got?.entities?.datetimeISO ?? null,
      amount: got?.entities?.amount ?? null, direction: got?.entities?.direction ?? null,
      expected_intent: c.expect?.intent ?? null,
      status: got?.entities?.status ?? null, stock_op: got?.entities?.stockOp ?? null, quantity: got?.entities?.quantity ?? null,
      missing: got?.missing ?? [], checks, pass: !isGap(c) && fails.length === 0, fails,
    })
    if (!asJson && !outPath) process.stderr.write(`${id} ${n + 1}/${cases.length}\r`)
  }
  return { id, provider, model, status: 'measured', rows }
}

// ── summary ─────────────────────────────────────────────────────────────────
const GROUPS = [
  ['te-script', 'Telugu script'], ['te-roman', 'Telugu roman'], ['hi-script', 'Hindi script'],
  ['hi-roman', 'Hindi roman'], ['en', 'English'], ['mixed', 'Mixed'],
]
// The business intents added on 15 Oct 2026, each scored on its own.
const BUSINESS = ['attendance', 'stock', 'payroll']
function pct(rows, k) {
  const r = rows.filter((x) => x.checks[k] !== undefined)
  if (!r.length) return null
  const ok = r.filter((x) => x.checks[k]).length
  return { ok, n: r.length, pct: Math.round((1000 * ok) / r.length) / 10 }
}
function percentile(sorted, p) {
  if (!sorted.length) return null
  return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)]
}
function summarise(m) {
  if (m.status !== 'measured') return null
  const scored = m.rows.filter((r) => !r.gap)
  const answered = m.rows.filter((r) => !r.failure).map((r) => r.ms).sort((a, b) => a - b)
  const failures = { timeout: 0, http: 0, no_json: 0, threw: 0 }
  for (const r of m.rows) if (r.failure_kind) failures[r.failure_kind] = (failures[r.failure_kind] || 0) + 1
  const httpCodes = {}
  for (const r of m.rows) if (r.failure_kind === 'http') httpCodes[r.failure] = (httpCodes[r.failure] || 0) + 1
  return {
    calls: m.rows.length,
    scored_cases: scored.length,
    intent: pct(scored, 'intent'),
    intent_by_group: Object.fromEntries(GROUPS.map(([g]) => [g, pct(scored.filter((r) => r.group === g), 'intent')])),
    person: pct(scored, 'person'), time: pct(scored, 'time'), amount: pct(scored, 'amount'), direction: pct(scored, 'direction'),
    intent_by_business: Object.fromEntries(BUSINESS.map((b) => [b, pct(scored.filter((r) => r.expected_intent === b), 'intent')])),
    business_details: { status: pct(scored, 'status'), stock_op: pct(scored, 'stock_op'), quantity: pct(scored, 'quantity') },
    intent_by_drive: Object.fromEntries(DRIVE.map((d) => [d, pct(scored.filter((r) => r.expected_intent === d), 'intent')])),
    drive_intent: pct(scored.filter((r) => DRIVE.includes(r.expected_intent)), 'intent'),
    no_keep: pct(scored, 'no_keep'),
    keeps_from_no_keep_cases: scored.filter((r) => r.checks.no_keep === false).map((r) => ({ id: r.id, intent: r.intent })),
    full_pass: { ok: scored.filter((r) => r.pass).length, n: scored.length, pct: scored.length ? Math.round((1000 * scored.filter((r) => r.pass).length) / scored.length) / 10 : null },
    latency_ms: { answered: answered.length, p50: percentile(answered, 0.5), p95: percentile(answered, 0.95) },
    failures, http_codes: httpCodes,
    retries_429: m.rows.reduce((s, r) => s + (r.retries || 0), 0),
  }
}

const fmtPct = (x) => (x ? `${x.pct}% (${x.ok}/${x.n})` : 'n/a')
const fmtMs = (x) => (x == null ? 'n/a' : `${(x / 1000).toFixed(2)} s`)

function verdicts(models) {
  const base = models.find((m) => m.id === BASELINE && m.summary)
  return models.map((m) => {
    if (m.id === BASELINE) return { id: m.id, line: m.summary ? 'baseline (production model)' : `baseline ${m.status} - no comparison possible` }
    if (!m.summary) return { id: m.id, line: `${m.status} - no comparison` }
    if (!base) return { id: m.id, line: 'baseline not measured - no comparison' }
    const a = m.summary, b = base.summary
    const faster = a.latency_ms.p50 != null && b.latency_ms.p50 != null
      ? (a.latency_ms.p50 < b.latency_ms.p50 ? `faster (median ${fmtMs(a.latency_ms.p50)} vs ${fmtMs(b.latency_ms.p50)})` : `not faster (median ${fmtMs(a.latency_ms.p50)} vs ${fmtMs(b.latency_ms.p50)})`)
      : 'speed not comparable (no answered calls)'
    const acc = a.intent && b.intent
      ? (a.intent.pct >= b.intent.pct - 2 ? `as accurate (intent ${a.intent.pct}% vs ${b.intent.pct}%)` : `less accurate (intent ${a.intent.pct}% vs ${b.intent.pct}%)`)
      : 'accuracy not comparable'
    return { id: m.id, line: `${faster}; ${acc}` }
  })
}

function gapList(models) {
  const names = [...new Set(cases.filter(isGap).map((c) => c.expect.intent.slice('unsupported:'.length)))]
  return names.map((name) => {
    const byModel = {}
    for (const m of models) {
      if (m.status !== 'measured') continue
      const counts = {}
      for (const r of m.rows.filter((x) => x.gap === name)) {
        const k = r.failure ? `(${r.failure_kind})` : (r.raw_intent && r.raw_intent !== r.intent ? `${r.raw_intent}→${r.intent}` : r.intent)
        counts[k] = (counts[k] || 0) + 1
      }
      byModel[m.id] = counts
    }
    return { name, cases: cases.filter((c) => c.expect?.intent === `unsupported:${name}`).length, brain_answered: byModel }
  })
}

function markdown(report) {
  const L = []
  L.push('# Understanding brain - measured model table', '')
  L.push(`Measured ${report.measured_at} (IST clock given to every model). ${report.cases.total} cases: ${report.cases.scored} scored, ${report.cases.gap} on the gap list. Same prompt, request body and parser as production (src/lib/aaria-llm.js) for every model; timeout ${report.timeout_ms} ms; streamed, read until the JSON closes.`, '')
  L.push(`Generated by scripts/eval-understanding.mjs${report.run_url ? ` in ${report.run_url}` : ''}. Every new case is synthetic (written, not spoken).`, '')
  L.push('## Correct intent', '')
  L.push(`| Model | Status | Intent overall | ${GROUPS.map(([, l]) => l).join(' | ')} |`)
  L.push(`|---|---|---|${GROUPS.map(() => '---').join('|')}|`)
  for (const m of report.models) {
    const s = m.summary
    L.push(`| ${m.id} | ${m.status}${m.note ? ` (${m.note})` : ''} | ${s ? fmtPct(s.intent) : 'not measured'} | ${GROUPS.map(([g]) => (s ? fmtPct(s.intent_by_group[g]) : '-')).join(' | ')} |`)
  }
  L.push('', '## Details, speed, failures, price', '')
  L.push('| Model | Person | Time | Amount | Direction | All checks | Median reply | 95th pct reply | Failures (timeout / http / no_json / threw) | Published price |')
  L.push('|---|---|---|---|---|---|---|---|---|---|')
  for (const m of report.models) {
    const s = m.summary
    const price = m.price.url ? `[${m.price.text}](${m.price.url})` : m.price.text
    if (!s) { L.push(`| ${m.id} | not measured | | | | | | | | ${price} |`); continue }
    const f = s.failures
    const codes = Object.entries(s.http_codes).map(([k, v]) => `${k}×${v}`).join(', ')
    L.push(`| ${m.id} | ${fmtPct(s.person)} | ${fmtPct(s.time)} | ${fmtPct(s.amount)} | ${fmtPct(s.direction)} | ${fmtPct(s.full_pass)} | ${fmtMs(s.latency_ms.p50)} | ${fmtMs(s.latency_ms.p95)} | ${f.timeout} / ${f.http}${codes ? ` (${codes})` : ''} / ${f.no_json} / ${f.threw} | ${price} |`)
  }
  L.push('', 'Reply times are over calls that returned an answer (n shown in the JSON). A failed call scores as wrong on every check it had. Percentages are over the cases that check applies to.', '')
  L.push('## Business records (attendance, stock, payroll)', '')
  L.push('Business-workspace sentences. Intent per new intent, and the details Aaria reads back before writing (attendance status, stock add / remove / out / check, quantity).', '')
  L.push(`| Model | ${BUSINESS.map((b) => `${b[0].toUpperCase()}${b.slice(1)} intent`).join(' | ')} | Status | Stock op | Quantity |`)
  L.push(`|---|${BUSINESS.map(() => '---').join('|')}|---|---|---|`)
  for (const m of report.models) {
    const s = m.summary
    if (!s) continue
    L.push(`| ${m.id} | ${BUSINESS.map((b) => fmtPct(s.intent_by_business[b])).join(' | ')} | ${fmtPct(s.business_details.status)} | ${fmtPct(s.business_details.stock_op)} | ${fmtPct(s.business_details.quantity)} |`)
  }
  L.push('')
  L.push('## Drive Mode (save the record, share, car health, faults, hazards, stay awake)', '')
  L.push('Drive sentences added 17 Oct 2026 (hand-off DRV-03). Done when all Drive sentences together score at least 90% and the rest does not drop.', '')
  L.push(`| Model | All Drive | ${DRIVE.join(' | ')} |`)
  L.push(`|---|---|${DRIVE.map(() => '---').join('|')}|`)
  for (const m of report.models) {
    const s = m.summary
    if (!s) continue
    L.push(`| ${m.id} | ${fmtPct(s.drive_intent)} | ${DRIVE.map((d) => fmtPct(s.intent_by_drive[d])).join(' | ')} |`)
  }
  L.push('')
  L.push('## Sentences that must not save anything', '')
  L.push('Thanks, small talk and a bare yes / no with nothing pending ("no_keep" cases). Saved nothing = the brain answered none, confirm, pay, delete or a Drive intent, which the capture route turns into a reply and no keep. (A bare yes / no never reaches the brain in production - the route answers it first - so this is the brain\'s own score.)', '')
  for (const m of report.models) {
    const s = m.summary
    if (!s) continue
    const bad = s.keeps_from_no_keep_cases
    L.push(`- ${m.id}: saved nothing on ${fmtPct(s.no_keep)}${bad.length ? `; would have saved a keep: ${bad.map((b) => `${b.id} (${b.intent ?? 'no answer'})`).join(', ')}` : ''}`)
  }
  L.push('')
  L.push('## Against the baseline (sarvam-105b-conversations)', '')
  for (const v of report.verdicts) L.push(`- ${v.id}: ${v.line}`)
  L.push('', '## Gap list - things people say that the brain has no name for', '')
  L.push(`The brain can only answer one of: ${INTENTS.join(', ')}. Anything else it writes is filed as "note" by the parser. Below: what each model did with these sentences (raw word→what the app received).`, '')
  for (const g of report.gaps) {
    L.push(`- **${g.name}** (${g.cases} cases): ` + (Object.keys(g.brain_answered).length
      ? Object.entries(g.brain_answered).map(([id, c]) => `${id}: ${Object.entries(c).map(([k, v]) => `${k}×${v}`).join(', ')}`).join('; ')
      : 'no model measured'))
  }
  if (!report.gaps.length) L.push('- nothing on the list in this run')
  L.push('- confirm, delete, trip, compliance, pay and none left this list on 15 Oct 2026, and attendance, stock and payroll later the same day: the brain has words for them now and they are scored above.')
  L.push('', '## Not measured', '')
  const nm = report.models.filter((m) => m.status !== 'measured')
  if (!nm.length) L.push('- every requested model was measured')
  for (const m of nm) L.push(`- ${m.id}: ${m.status}${m.note ? ` - ${m.note}` : ''}`)
  L.push('')
  return L.join('\n')
}

// ── run ─────────────────────────────────────────────────────────────────────
const results = await Promise.all(modelArgs.map(runModel))
for (const m of results) { m.summary = summarise(m); m.price = priceFor(m.id) }
const report = {
  measured_at: NOW.toISOString(),
  run_url: process.env.GITHUB_RUN_URL || null,
  timeout_ms: TIMEOUT_MS,
  cases: { total: cases.length, scored: cases.filter((c) => !isGap(c)).length, gap: cases.filter(isGap).length },
  models: results,
}
report.verdicts = verdicts(results)
report.gaps = gapList(results)

if (outPath) {
  const stem = outPath.replace(/\.(json|md)$/i, '')
  mkdirSync(dirname(stem) || '.', { recursive: true })
  writeFileSync(`${stem}.json`, JSON.stringify(report, null, 2) + '\n')
  writeFileSync(`${stem}.md`, markdown(report))
  console.log(markdown(report))
} else if (asJson) {
  console.log(JSON.stringify(report, null, 2))
} else {
  for (const m of results) {
    if (m.status !== 'measured') { console.log(`${m.id}: ${m.status}${m.note ? ` - ${m.note}` : ''}`); continue }
    for (const r of m.rows) {
      const mark = r.gap ? 'GAP ' : (r.pass ? 'PASS' : 'FAIL')
      console.log(`${mark}  ${r.id.padEnd(36)} ${String(r.ms).padStart(6)} ms  intent=${r.raw_intent ?? r.intent} conf=${r.confidence} person=${r.person ?? '-'} time=${r.time ? 'yes' : 'no'} amount=${r.amount ?? '-'} missing=[${r.missing}]${r.fails.length ? '  <- ' + r.fails.join('; ') : ''}${r.failure ? '  (' + r.failure + ')' : ''}`)
    }
    const s = m.summary
    console.log(`\n${m.id}: ${s.full_pass.ok} of ${s.full_pass.n} passed · intent ${fmtPct(s.intent)} · median ${fmtMs(s.latency_ms.p50)} · p95 ${fmtMs(s.latency_ms.p95)}\n`)
  }
}

// Exit status: in report mode (--out / --json) a finished run is success; the
// numbers are the result. Run by hand, it still fails when a scored case fails.
// process.exitCode, not process.exit(): exiting at once cuts off a large
// report still being written to a pipe.
const measured = results.filter((m) => m.status === 'measured')
if (outPath || asJson) process.exitCode = 0
else if (!measured.length) { console.error('No model was measured (no key in this shell?). Nothing was called.'); process.exitCode = 2 }
else process.exitCode = measured.every((m) => m.summary.full_pass.ok === m.summary.full_pass.n) ? 0 : 1
