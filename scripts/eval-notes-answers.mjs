#!/usr/bin/env node
// scripts/eval-notes-answers.mjs
//
// MEASUREMENT ONLY. Does a model answer a student's question from the class
// notes it is given, in the student's language, and say "not in the notes"
// when the notes do not contain the answer? This is the EdGridAI doubt-solver
// pattern, measured on the Yotta Shakti credit before it expires. Nothing in
// any app calls these models.
//
//   node scripts/eval-notes-answers.mjs --model shakti:gpt-oss-120b --out measurements/notes-answers-latest
//
// Cases: tests/fixtures/notes-answer-cases.json (24 hand-written, synthetic:
// 18 answerable - 6 each en/hi/te - and 6 whose answer is NOT in the notes).
// Scoring is deterministic: an answerable case is right when every "must"
// group has at least one of its words in the answer and the model did not
// refuse; a not-in-notes case is right when the model replied NOT_IN_NOTES.
// "Same language" = the answer is mostly in the question's script.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const cases = JSON.parse(readFileSync(join(here, '..', 'tests', 'fixtures', 'notes-answer-cases.json'), 'utf8'))

const argv = process.argv.slice(2)
const models = []; let outPath = null
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--model') models.push(argv[++i])
  else if (argv[i] === '--out') outPath = argv[++i].replace(/\.(md|json)$/, '')
}
if (!models.length) models.push('shakti:gpt-oss-120b')

const SHAKTI_MODELS = {
  'qwen2.5-vl-72b': { model: 'Qwen/Qwen2.5-VL-72B-Instruct', id: '6dd41d60-1a64-4fa4-9871-17dbe1c73833' },
  'gemma-3-27b': { model: 'gemma-it', id: '23a8dfd7-f6d4-426c-b637-517c205282c7' },
  'llama-4-maverick': { model: 'llama-4', id: '5a5bddc0-4ea9-40c6-b946-2efc2113fa76' },
  'gpt-oss-120b': { model: 'openai/gpt-oss-120b', id: 'cde45577-aa83-442d-bbb4-fb3c54980bf5' },
}
const PROVIDERS = {
  shakti: {
    url: 'https://http.prod-llm.shaktistudio.shakticloud.ai/chat/completions', keyName: 'SHAKTI_API_KEY',
    headers: (k, m) => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${k}`, ...(SHAKTI_MODELS[m] ? { id: SHAKTI_MODELS[m].id } : {}) }),
    bodyModel: (m) => SHAKTI_MODELS[m]?.model || m, gapMs: 1000,
  },
  gemini: {
    url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', keyName: 'GEMINI_API_KEY',
    headers: (k) => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${k}` }), bodyModel: (m) => m, gapMs: 1000,
  },
  sarvam: {
    url: 'https://api.sarvam.ai/v1/chat/completions', keyName: 'SARVAM_API_KEY',
    headers: (k) => ({ 'Content-Type': 'application/json', 'api-subscription-key': k, Authorization: `Bearer ${k}` }), bodyModel: (m) => m, gapMs: 0,
  },
}
const LANG_NAME = { en: 'English', hi: 'Hindi', te: 'Telugu' }
const REASONING = /(gpt-oss|nemotron|r1|qwq)/i
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function prompt(c) {
  return [
    { role: 'system', content: `You are a patient school tutor. Answer ONLY from the class notes given. Reply in ${LANG_NAME[c.lang]}, in at most two short sentences. If the notes do not contain the answer, reply exactly: NOT_IN_NOTES` },
    { role: 'user', content: `Class notes:\n${c.notes}\n\nStudent's question: ${c.q}` },
  ]
}

function clean(text) {
  let t = String(text || '')
  t = t.replace(/<think>[\s\S]*?<\/think>/gi, ' ')
  const fin = t.lastIndexOf('<|channel|>final<|message|>')
  if (fin !== -1) t = t.slice(fin + 27)
  return t.trim()
}

function scriptShare(text, lang) {
  const letters = [...text].filter((ch) => /\p{L}/u.test(ch))
  if (!letters.length) return 0
  const re = lang === 'te' ? /[ఀ-౿]/ : lang === 'hi' ? /[ऀ-ॿ]/ : /[A-Za-z]/
  return letters.filter((ch) => re.test(ch)).length / letters.length
}

function score(c, answer) {
  const refused = /NOT_IN_NOTES/i.test(answer)
  if (c.none) return { ok: refused, refused }
  // Normalise unusual spaces (models write "Bahadur\u202fShah", "3\u202fA").
  const low = answer.replace(/[\u00a0\u2000-\u200b\u202f\u205f]/g, ' ').toLowerCase()
  const has = (w) => w === 'amp' ? /amp|\d\s*a\b/.test(low) : low.includes(w.toLowerCase())
  const factsOk = c.must.every((g) => g.some(has))
  return { ok: factsOk && !refused, refused, sameLang: scriptShare(answer, c.lang) >= 0.6 }
}

async function ask(provider, model, c, key) {
  const p = PROVIDERS[provider]
  const body = { model: p.bodyModel(model), messages: prompt(c), temperature: 0.1, max_tokens: REASONING.test(model) ? 2000 : 400 }
  const t0 = Date.now()
  for (let attempt = 0; attempt < 3; attempt++) {
    const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 60000)
    try {
      const res = await fetch(p.url, { method: 'POST', headers: p.headers(key, model), body: JSON.stringify(body), signal: ctrl.signal })
      const txt = await res.text()
      if (res.status === 429 && attempt < 2) { await sleep(15000); continue }
      if (!res.ok) return { ms: Date.now() - t0, error: `http_${res.status}: ${txt.slice(0, 200)}` }
      const j = JSON.parse(txt)
      return { ms: Date.now() - t0, answer: clean(j?.choices?.[0]?.message?.content) }
    } catch (e) {
      return { ms: Date.now() - t0, error: e?.name === 'AbortError' ? 'timeout' : String(e?.message || e).slice(0, 200) }
    } finally { clearTimeout(timer) }
  }
}

const report = { measured_at: new Date().toISOString(), run_url: process.env.GITHUB_RUN_URL || null, cases: cases.length, models: [] }
for (const id of models) {
  const [provider, ...rest] = id.split(':'); const model = rest.join(':')
  const key = process.env[PROVIDERS[provider]?.keyName]
  if (!PROVIDERS[provider] || !key) { report.models.push({ id, status: 'not measured - no key' }); console.log(`${id}: not measured - no key`); continue }
  const rows = []
  for (const [n, c] of cases.entries()) {
    if (n) await sleep(PROVIDERS[provider].gapMs)
    const r = await ask(provider, model, c, key)
    const s = r.answer != null ? score(c, r.answer) : { ok: false }
    rows.push({ id: c.id, lang: c.lang, none: !!c.none, ok: s.ok, refused: s.refused ?? null, same_lang: s.sameLang ?? null, ms: r.ms, error: r.error || null, answer: (r.answer || '').slice(0, 300) })
  }
  const pct = (a, b) => (b ? Math.round((1000 * a) / b) / 10 : null)
  const ans = rows.filter((r) => !r.none), none = rows.filter((r) => r.none)
  const byLang = {}
  for (const l of ['en', 'hi', 'te']) { const x = ans.filter((r) => r.lang === l); byLang[l] = `${pct(x.filter((r) => r.ok).length, x.length)}% (${x.filter((r) => r.ok).length}/${x.length})` }
  const times = rows.filter((r) => !r.error).map((r) => r.ms).sort((a, b) => a - b)
  const summary = {
    answered_right: `${pct(ans.filter((r) => r.ok).length, ans.length)}% (${ans.filter((r) => r.ok).length}/${ans.length})`,
    by_lang: byLang,
    same_language: `${pct(ans.filter((r) => r.same_lang).length, ans.length)}% (${ans.filter((r) => r.same_lang).length}/${ans.length})`,
    said_not_in_notes: `${pct(none.filter((r) => r.ok).length, none.length)}% (${none.filter((r) => r.ok).length}/${none.length})`,
    wrongly_refused: ans.filter((r) => r.refused).length,
    errors: rows.filter((r) => r.error).length,
    median_ms: times.length ? times[Math.floor(times.length / 2)] : null,
  }
  report.models.push({ id, status: 'measured', summary, rows })
  console.log(id, JSON.stringify(summary))
}

if (outPath) {
  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(`${outPath}.json`, JSON.stringify(report, null, 2))
  const L = ['# Notes-grounded answers (EdGridAI doubt-solver pattern) - measured', '',
    `Measured ${report.measured_at}. ${cases.length} synthetic cases (18 answerable: 6 en / 6 hi / 6 te; 6 whose answer is not in the notes). Measurement only - no app calls these models.`, '',
    '| Model | Answered right | English | Hindi | Telugu | Same language | Said "not in notes" when right to | Wrongly refused | Errors | Median reply |', '|---|---|---|---|---|---|---|---|---|---|']
  for (const m of report.models) {
    if (m.status !== 'measured') { L.push(`| ${m.id} | ${m.status} |  |  |  |  |  |  |  |  |`); continue }
    const s = m.summary
    L.push(`| ${m.id} | ${s.answered_right} | ${s.by_lang.en} | ${s.by_lang.hi} | ${s.by_lang.te} | ${s.same_language} | ${s.said_not_in_notes} | ${s.wrongly_refused} | ${s.errors} | ${s.median_ms != null ? (s.median_ms / 1000).toFixed(2) + ' s' : '-'} |`)
  }
  L.push('', `Run: ${report.run_url || 'local'}`)
  writeFileSync(`${outPath}.md`, L.join('\n') + '\n')
}
