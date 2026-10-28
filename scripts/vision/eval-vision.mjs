#!/usr/bin/env node
// scripts/vision/eval-vision.mjs
//
// Evaluates image-reading AI models on Indian bills, receipts, and product labels
// against the synthetic ground-truth test suite in tests/fixtures/vision/.
//
// Models are specified via --model provider:model (e.g. openrouter:nvidia/nemotron-3.5-super-vl:free,
// gemini:gemini-3.5-flash-lite). Keys are read only from environment variables
// (OPENROUTER_API_KEY, GEMINI_API_KEY) and are never printed.
//
// Writes:
//   measurements/vision-latest.md    readable table report
//   measurements/vision-latest.json  full per-call dataset

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { scoreVisionRecord } from './vision-score.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const rootDir = join(here, '..', '..')
const fixturesDir = join(rootDir, 'tests', 'fixtures', 'vision')

// ── load fixtures ───────────────────────────────────────────────────────────
function loadFixtures() {
  if (!existsSync(fixturesDir)) return []
  const files = readdirSync(fixturesDir).filter((f) => f.endsWith('.json'))
  const items = []
  for (const f of files) {
    try {
      const data = JSON.parse(readFileSync(join(fixturesDir, f), 'utf8'))
      const pngPath = join(fixturesDir, f.replace(/\.json$/, '.png'))
      if (existsSync(pngPath)) {
        items.push({ ...data, pngPath })
      }
    } catch {
      // Ignore unparseable files
    }
  }
  // Sort deterministically by id
  return items.sort((a, b) => a.id.localeCompare(b.id))
}

const allFixtures = loadFixtures()

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

const DEFAULT_MODELS = [
  'openrouter:nvidia/nemotron-3.5-super-vl:free',
  'gemini:gemini-3.5-flash-lite',
]

if (!modelArgs.length) {
  modelArgs.push(...DEFAULT_MODELS)
}

const fixtures = Number.isFinite(limit) && limit > 0 ? allFixtures.slice(0, limit) : allFixtures
const TIMEOUT_MS = Number(process.env.VISION_TIMEOUT_MS || 45000)
const NOW = new Date()

// ── providers ───────────────────────────────────────────────────────────────
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

  openrouter: {
    url: 'https://openrouter.ai/api/v1/chat/completions',
    keyName: 'OPENROUTER_API_KEY',
    headers: (k) => ({
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${k}`,
      'HTTP-Referer': 'https://quietkeep.com',
      'X-Title': 'QuietKeep Vision Bench',
    }),
    gapMs: 3100,
  },
  gemini: {
    // Google's OpenAI-compatible chat completions endpoint supports multimodal image_url
    url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    keyName: 'GEMINI_API_KEY',
    headers: (k) => ({
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${k}`,
    }),
    gapMs: 4100,
  },
}

const PRICES = {
  'openrouter:nvidia/nemotron-3.5-super-vl:free': {
    text: '$0 (OpenRouter ":free" variant; rate-limited)',
    url: 'https://openrouter.ai/nvidia/nemotron-3.5-super-vl:free',
  },
  'gemini:gemini-3.5-flash-lite': {
    text: 'not re-checked for 3.5 - see the pricing page',
    url: 'https://ai.google.dev/gemini-api/docs/pricing',
  },
}

function priceFor(id) {
  if (PRICES[id]) return PRICES[id]
  const [provider, ...rest] = id.split(':')
  const model = rest.join(':')
  if (provider === 'openrouter' && model.endsWith(':free')) {
    return { text: '$0 (OpenRouter free variant)', url: `https://openrouter.ai/${model}` }
  }
  return { text: 'not looked up', url: null }
}

const FIXED_PROMPT = `You are a strict data extractor for Indian bills, receipts, and product labels.
Extract information from the provided image and return ONLY a valid JSON object matching this schema:
{
  "doc_type": "kirana" | "pharmacy" | "restaurant" | "utility" | "product_label",
  "merchant": "merchant, store, or brand name",
  "date": "YYYY-MM-DD or billing/mfg date as printed",
  "total": number (total amount in rupees, or null),
  "currency": "INR",
  "items": [
    {
      "name": "item name or description",
      "qty": "quantity string, e.g. 1, 2 kg, 500 ml",
      "price": number (item price/amount in rupees)
    }
  ],
  "mrp": number (maximum retail price in rupees, or null),
  "expiry": "YYYY-MM-DD or MM/YY or expiry string, or null"
}
Output valid JSON ONLY. Do not include markdown formatting, code fences, or any other text.`

// ── helpers ─────────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function redact(s) {
  let out = String(s || '')
  for (const p of Object.values(PROVIDERS)) {
    const k = process.env[p.keyName]
    if (k && k.length >= 4) out = out.split(k).join('[key]')
  }
  return out.replace(/\s+/g, ' ').slice(0, 300)
}

function kindOf(failure) {
  if (!failure) return null
  if (failure.startsWith('http_')) return 'http'
  if (failure === 'no_json') return 'no_json'
  return failure
}

const GONE = /(deprecat|decommission|retired|no longer|not found|does not exist|doesn't exist|no endpoints|invalid model|unknown model|not supported)/i

async function callOnce(provider, model, fixture, key) {
  const p = PROVIDERS[provider]
  const base64Data = readFileSync(fixture.pngPath).toString('base64')

  const requestBody = {
    model: p.bodyModel ? p.bodyModel(model) : model,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: FIXED_PROMPT },
          {
            type: 'image_url',
            image_url: {
              url: `data:image/png;base64,${base64Data}`,
            },
          },
        ],
      },
    ],
    temperature: 0.1,
    max_tokens: 1500,
  }

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  const t0 = Date.now()

  try {
    const res = await fetch(p.url, {
      method: 'POST',
      headers: p.headers(key, model),
      body: JSON.stringify(requestBody),
      signal: ctrl.signal,
    })

    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      return {
        ms: Date.now() - t0,
        failure: `http_${res.status}`,
        status: res.status,
        error: redact(errText),
        retryAfter: Number(res.headers.get('retry-after')) || null,
      }
    }

    const json = await res.json()
    const ms = Date.now() - t0
    const content = json.choices?.[0]?.message?.content || ''

    if (!content) {
      return { ms, failure: 'no_json', raw: '' }
    }

    return { ms, failure: null, raw: content }
  } catch (err) {
    const ms = Date.now() - t0
    if (err?.name === 'AbortError') return { ms, failure: 'timeout' }
    return { ms, failure: 'threw', error: redact(err?.message || String(err)) }
  } finally {
    clearTimeout(timer)
  }
}

const DAILY_LIMIT = /(per[- ]day|per day|daily)/i

async function call(provider, model, fixture, key) {
  let r
  let retries = 0
  for (;;) {
    r = await callOnce(provider, model, fixture, key)
    if (r.status !== 429 || retries >= 2) break
    // A daily quota will not come back in 15 s: retrying only burns the run's
    // time budget (26 Oct: 283 x 2 retries ran a whole run out of time).
    if (DAILY_LIMIT.test(r.error || '')) { r.dailyLimit = true; break }
    retries++
    await sleep(Math.min(60, r.retryAfter || 15) * 1000)
  }
  return { ...r, retries }
}

// ── one model evaluation ────────────────────────────────────────────────────
async function runModel(id) {
  const i = id.indexOf(':')
  const provider = i > 0 ? id.slice(0, i).toLowerCase() : ''
  const model = i > 0 ? id.slice(i + 1) : ''

  if (!PROVIDERS[provider] || !model) {
    return { id, status: 'not measured - unknown provider', rows: [] }
  }

  const key = process.env[PROVIDERS[provider].keyName]
  if (!key) {
    return {
      id,
      provider,
      model,
      status: 'not measured - no key',
      note: `${PROVIDERS[provider].keyName} is not set`,
      rows: [],
    }
  }

  const rows = []
  for (const [n, f] of fixtures.entries()) {
    const gap = process.env.EVAL_GAP_MS !== undefined ? Number(process.env.EVAL_GAP_MS) : PROVIDERS[provider].gapMs
    if (n > 0 && gap > 0) await sleep(gap)

    const r = await call(provider, model, f, key)
    if (r.dailyLimit) {
      return { id, provider, model, status: `not measured - provider daily limit reached (after ${n} answers)`, note: String(r.error || '').slice(0, 200), rows: [] }
    }
    if (n === 0 && r.status && r.status >= 400 && r.status < 500 && r.status !== 429 && GONE.test(r.error || '')) {
      return {
        id,
        provider,
        model,
        status: provider === 'openrouter' ? 'retired' : 'not offered',
        note: `HTTP ${r.status}: ${r.error}`,
        rows: [],
      }
    }

    let scoreResult
    if (r.failure) {
      scoreResult = {
        pass: false,
        json_valid: false,
        checks: { json_valid: false, total: false, date: false, mrp: false, expiry: false, merchant: false },
        fails: [r.failure],
        items_f1: { precision: 0, recall: 0, f1: 0, matched: 0, expected: f.items?.length || 0, got: 0 },
        got: null,
      }
    } else {
      scoreResult = scoreVisionRecord(f, r.raw)
    }

    rows.push({
      id: f.id,
      doc_type: f.doc_type,
      script: f.script,
      variation: f.variation,
      ms: r.ms,
      retries: r.retries || 0,
      failure: r.failure || null,
      failure_kind: kindOf(r.failure),
      error: r.error || null,
      pass: scoreResult.pass,
      json_valid: scoreResult.json_valid,
      checks: scoreResult.checks,
      fails: scoreResult.fails,
      items_f1: scoreResult.items_f1,
      got: scoreResult.got,
      raw_head: typeof r.raw === 'string' ? r.raw.slice(0, 400) : null,
    })

    if (!asJson && !outPath) {
      process.stderr.write(`${id} ${n + 1}/${fixtures.length}\r`)
    }
  }

  // Every call failed (e.g. the provider's daily limit): that is not a 0%
  // score - nothing was read - so say so instead of printing 0% rows.
  if (rows.length && rows.every((r) => r.failure)) {
    const kinds = {}
    for (const r of rows) kinds[r.failure] = (kinds[r.failure] || 0) + 1
    const top = Object.entries(kinds).sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k}x${v}`).join(', ')
    return { id, provider, model, status: `not measured - every call failed (${top})`, note: String(rows[0].error || '').slice(0, 200), rows }
  }
  return { id, provider, model, status: 'measured', rows }
}

// ── summary calculation ─────────────────────────────────────────────────────
const DOC_TYPES = ['kirana', 'pharmacy', 'restaurant', 'utility', 'product_label']
const SCRIPTS = ['telugu', 'hindi', 'english', 'mixed']

function pct(rows, checkFn) {
  if (!rows.length) return null
  const ok = rows.filter(checkFn).length
  return { ok, n: rows.length, pct: Math.round((1000 * ok) / rows.length) / 10 }
}

function percentile(sorted, p) {
  if (!sorted.length) return null
  return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)]
}

function summarise(m) {
  if (m.status !== 'measured') return null
  const rows = m.rows
  const answered = rows.filter((r) => !r.failure).map((r) => r.ms).sort((a, b) => a - b)
  const failures = { timeout: 0, http: 0, no_json: 0, threw: 0 }
  for (const r of rows) {
    if (r.failure_kind) failures[r.failure_kind] = (failures[r.failure_kind] || 0) + 1
  }

  // Exact fields
  const totalAcc = pct(rows.filter((r) => r.checks.total !== undefined), (r) => r.checks.total)
  const dateAcc = pct(rows.filter((r) => r.checks.date !== undefined), (r) => r.checks.date)
  const mrpAcc = pct(rows.filter((r) => r.checks.mrp !== undefined), (r) => r.checks.mrp)
  const expiryAcc = pct(rows.filter((r) => r.checks.expiry !== undefined), (r) => r.checks.expiry)
  const merchantAcc = pct(rows.filter((r) => r.checks.merchant !== undefined), (r) => r.checks.merchant)
  const jsonValidRate = pct(rows, (r) => r.json_valid)
  const fullPass = pct(rows, (r) => r.pass)

  // Average items F1
  const f1Sum = rows.reduce((s, r) => s + (r.items_f1?.f1 || 0), 0)
  const avgItemsF1 = rows.length ? Math.round((1000 * f1Sum) / rows.length) / 1000 : 0

  // Grouped by doc_type
  const byDocType = {}
  for (const dt of DOC_TYPES) {
    const sub = rows.filter((r) => r.doc_type === dt)
    byDocType[dt] = {
      full_pass: pct(sub, (r) => r.pass),
      total: pct(sub.filter((r) => r.checks.total !== undefined), (r) => r.checks.total),
      merchant: pct(sub.filter((r) => r.checks.merchant !== undefined), (r) => r.checks.merchant),
      avg_f1: sub.length ? Math.round((1000 * sub.reduce((s, r) => s + (r.items_f1?.f1 || 0), 0)) / sub.length) / 1000 : null,
    }
  }

  // Grouped by script
  const byScript = {}
  for (const sc of SCRIPTS) {
    const sub = rows.filter((r) => r.script === sc)
    byScript[sc] = {
      full_pass: pct(sub, (r) => r.pass),
      merchant: pct(sub.filter((r) => r.checks.merchant !== undefined), (r) => r.checks.merchant),
      avg_f1: sub.length ? Math.round((1000 * sub.reduce((s, r) => s + (r.items_f1?.f1 || 0), 0)) / sub.length) / 1000 : null,
    }
  }

  return {
    calls: rows.length,
    json_valid: jsonValidRate,
    full_pass: fullPass,
    total: totalAcc,
    date: dateAcc,
    mrp: mrpAcc,
    expiry: expiryAcc,
    merchant: merchantAcc,
    avg_items_f1: avgItemsF1,
    by_doc_type: byDocType,
    by_script: byScript,
    latency_ms: {
      answered: answered.length,
      p50: percentile(answered, 0.5),
      p95: percentile(answered, 0.95),
    },
    failures,
  }
}

const fmtPct = (x) => (x ? `${x.pct}% (${x.ok}/${x.n})` : 'n/a')
const fmtMs = (x) => (x == null ? 'n/a' : `${(x / 1000).toFixed(2)} s`)

// ── markdown report generation ──────────────────────────────────────────────
function generateMarkdown(report) {
  const L = []
  L.push('# Vision extraction benchmark - Indian bills, receipts & product labels')
  L.push('')
  L.push(`Measured ${report.measured_at}. Test suite: ${report.cases.total} synthetic images with Playwright/Chromium rendering across 5 document types and 4 script categories.`)
  L.push(`Models evaluated for QuickScanZ and Cart2Save fact extraction. Timeout: ${report.timeout_ms} ms.`)
  L.push('')

  L.push('## Overall Extraction Accuracy')
  L.push('')
  L.push('| Model | Status | JSON Valid | All Checks Pass | Total Exact | Date Exact | MRP Exact | Expiry Exact | Merchant Fuzzy | Items Avg F1 |')
  L.push('|---|---|---|---|---|---|---|---|---|---|')
  for (const m of report.models) {
    const s = m.summary
    if (!s) {
      L.push(`| ${m.id} | ${m.status}${m.note ? ` (${m.note})` : ''} | - | - | - | - | - | - | - | - |`)
      continue
    }
    L.push(
      `| ${m.id} | ${m.status} | ${fmtPct(s.json_valid)} | ${fmtPct(s.full_pass)} | ${fmtPct(s.total)} | ${fmtPct(s.date)} | ${fmtPct(s.mrp)} | ${fmtPct(s.expiry)} | ${fmtPct(s.merchant)} | ${s.avg_items_f1.toFixed(3)} |`
    )
  }
  L.push('')

  L.push('## Accuracy by Document Type')
  L.push('')
  L.push('| Model | Kirana Bill | Pharmacy Bill | Restaurant Bill | Utility Bill | Product Label |')
  L.push('|---|---|---|---|---|---|')
  for (const m of report.models) {
    const s = m.summary
    if (!s) continue
    L.push(
      `| ${m.id} | ${fmtPct(s.by_doc_type.kirana?.full_pass)} | ${fmtPct(s.by_doc_type.pharmacy?.full_pass)} | ${fmtPct(s.by_doc_type.restaurant?.full_pass)} | ${fmtPct(s.by_doc_type.utility?.full_pass)} | ${fmtPct(s.by_doc_type.product_label?.full_pass)} |`
    )
  }
  L.push('')

  L.push('## Accuracy by Script Category')
  L.push('')
  L.push('| Model | Telugu | Hindi | English | Mixed |')
  L.push('|---|---|---|---|---|')
  for (const m of report.models) {
    const s = m.summary
    if (!s) continue
    L.push(
      `| ${m.id} | ${fmtPct(s.by_script.telugu?.full_pass)} | ${fmtPct(s.by_script.hindi?.full_pass)} | ${fmtPct(s.by_script.english?.full_pass)} | ${fmtPct(s.by_script.mixed?.full_pass)} |`
    )
  }
  L.push('')

  L.push('## Latency, Failures, and Published Price')
  L.push('')
  L.push('| Model | Median Reply | 95th pct Reply | Failures (timeout / http / no_json / threw) | Published Price |')
  L.push('|---|---|---|---|---|')
  for (const m of report.models) {
    const s = m.summary
    const price = m.price.url ? `[${m.price.text}](${m.price.url})` : m.price.text
    if (!s) {
      L.push(`| ${m.id} | not measured | not measured | - | ${price} |`)
      continue
    }
    const f = s.failures
    L.push(
      `| ${m.id} | ${fmtMs(s.latency_ms.p50)} | ${fmtMs(s.latency_ms.p95)} | ${f.timeout} / ${f.http} / ${f.no_json} / ${f.threw} | ${price} |`
    )
  }
  L.push('')

  L.push('## Not Measured / Skipped')
  L.push('')
  const nm = report.models.filter((m) => m.status !== 'measured')
  if (!nm.length) {
    L.push('- Every requested model was measured.')
  } else {
    for (const m of nm) {
      L.push(`- **${m.id}**: ${m.status}${m.note ? ` - ${m.note}` : ''}`)
    }
  }
  L.push('')

  return L.join('\n')
}

// ── main ────────────────────────────────────────────────────────────────────
async function main() {
  const results = await Promise.all(modelArgs.map(runModel))
  for (const m of results) {
    m.summary = summarise(m)
    m.price = priceFor(m.id)
  }

  const report = {
    measured_at: NOW.toISOString(),
    run_url: process.env.GITHUB_RUN_URL || null,
    timeout_ms: TIMEOUT_MS,
    cases: { total: fixtures.length },
    models: results,
  }

  const md = generateMarkdown(report)

  if (outPath) {
    const stem = outPath.replace(/\.(json|md)$/i, '')
    mkdirSync(dirname(stem) || '.', { recursive: true })
    writeFileSync(`${stem}.json`, JSON.stringify(report, null, 2) + '\n')
    writeFileSync(`${stem}.md`, md)
    console.log(md)
  } else if (asJson) {
    console.log(JSON.stringify(report, null, 2))
  } else {
    console.log(md)
  }

  const measured = results.filter((m) => m.status === 'measured')
  if (outPath || asJson) {
    process.exitCode = 0
  } else if (!measured.length) {
    console.error('No model was measured (no API key set).')
    process.exitCode = 2
  } else {
    process.exitCode = 0
  }
}

main().catch((err) => {
  console.error('eval-vision failed:', err)
  process.exit(1)
})
