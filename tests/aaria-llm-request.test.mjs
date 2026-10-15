// tests/aaria-llm-request.test.mjs
// The brain's prompt builder, request body and response parser were exported
// (Oct 2026) so scripts/eval-understanding.mjs can send other models exactly
// what production sends Sarvam. Exporting must not change production.
//
// The two golden files were captured from aaria-llm.js BEFORE that refactor,
// with fetch mocked:
//   aaria-llm-request-golden.json  url, headers and the exact body string
//   aaria-llm-output-golden.json   what came back for fixed model answers
// Both are compared byte-for-byte. If this fails, production behaviour moved.
//
// 15 Oct 2026: the request bodies were re-captured once, on purpose, when the
// prompt gained the confirm / delete / pay / none / trip / compliance intents
// and the romanised-Telugu examples. URL, headers, model, temperature,
// max_tokens and stream were checked unchanged before re-capturing.

import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

process.env.SARVAM_API_KEY = 'test-key'
delete process.env.SARVAM_CHAT_MODEL
delete process.env.SARVAM_STREAM
const brain = await import('../src/lib/aaria-llm.js')
const { aariaUnderstandLLM, buildPrompt, buildRequestBody, parseBrainResponse } = brain

const reqGolden = JSON.parse(readFileSync(new URL('./fixtures/aaria-llm-request-golden.json', import.meta.url), 'utf8'))
const outGolden = JSON.parse(readFileSync(new URL('./fixtures/aaria-llm-output-golden.json', import.meta.url), 'utf8'))

async function capture(text, opts) {
  let cap
  globalThis.fetch = async (url, init) => {
    cap = { url, method: init.method, headers: init.headers, body: init.body }
    return { ok: false, status: 418, text: async () => '' }
  }
  const err = console.error
  console.error = () => {}
  try { await aariaUnderstandLLM(text, opts) } finally { console.error = err }
  return cap
}

test('default request is byte-identical to the one sent before the refactor', async () => {
  for (const g of reqGolden) {
    const got = await capture(g.input.text, g.input.opts)
    assert.equal(got.url, g.request.url)
    assert.equal(got.method, g.request.method)
    assert.deepEqual(got.headers, g.request.headers)
    assert.equal(got.body, g.request.body, `body changed for: ${g.input.text}`)
  }
})

test('default model, temperature, max_tokens and stream are unchanged', () => {
  const body = JSON.parse(reqGolden[0].request.body)
  assert.equal(body.model, 'sarvam-105b-conversations')
  assert.equal(body.temperature, 0.2)
  assert.equal(body.max_tokens, 450)
  assert.equal(body.stream, true)
})

test('the exported builders produce the same body the brain sends', () => {
  const g = reqGolden[1]
  const o = g.input.opts
  const prompt = buildPrompt({
    text: g.input.text.trim(), language: o.language, nowISO: o.nowISO,
    timezone: o.timezone, workspaceMode: o.workspaceMode, pageLabel: o.pageLabel,
  })
  const body = JSON.stringify(buildRequestBody({ model: 'sarvam-105b-conversations', prompt, stream: true }))
  assert.equal(body, g.request.body)
})

function sse(text) {
  const enc = new TextEncoder()
  const chunks = [...text.matchAll(/[\s\S]{1,7}/g)].map((m) => `data: ${JSON.stringify({ choices: [{ delta: { content: m[0] } }] })}\n\n`)
  chunks.push('data: [DONE]\n\n')
  return new ReadableStream({ start(c) { for (const ch of chunks) c.enqueue(enc.encode(ch)); c.close() } })
}

test('parsed output for fixed answers is identical to before the refactor', async () => {
  for (const g of outGolden) {
    let failure = null
    globalThis.fetch = async () => ({ ok: true, body: sse(g.answer), json: async () => ({ choices: [{ message: { content: g.answer } }] }) })
    const r = await aariaUnderstandLLM('some words', { nowISO: '2026-10-01T12:04:00.000Z', onFailure: (f) => { failure = f } })
    assert.deepEqual(r, g.result, `output changed for: ${g.answer}`)
    assert.equal(failure, g.failure)
  }
})

test('parseBrainResponse alone agrees with the brain on a clean answer', () => {
  const g = outGolden[0]
  const { result } = parseBrainResponse(g.answer, { clean: 'some words', nowISO: '2026-10-01T12:04:00.000Z', model: 'sarvam-105b-conversations' })
  assert.deepEqual(result, g.result)
})
