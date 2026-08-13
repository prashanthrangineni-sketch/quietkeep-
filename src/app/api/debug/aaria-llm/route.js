// TEMPORARY DIAGNOSTIC — delete once the Sarvam understanding path is proven.
// Never echoes the API key.

import { NextResponse } from 'next/server';
import { aariaUnderstandLLM } from '@/lib/aaria-llm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const PROBE = 'qk-brain-probe-2026';

const PROMPT = (text) => `You are Aaria, the voice assistant inside QuietKeep. Decide what the app should DO with what the user said.

CURRENT TIME: ${new Date().toISOString()} (timezone Asia/Kolkata)

The user said: """${text}"""

Reply with ONLY a JSON object, no explanation, no markdown fence:
{"intent":"reminder|expense|income|note|query","confidence":0-1,"language_detected":"BCP-47","datetime_iso":"ISO or null","reply":"one short sentence spoken in the user's own language"}`;

async function callSarvam(key, { model, max_tokens, reasoning_effort, text }) {
  const body = {
    model,
    temperature: 0.2,
    max_tokens,
    messages: [{ role: 'user', content: PROMPT(text) }],
  };
  if (reasoning_effort) body.reasoning_effort = reasoning_effort;

  const t0 = Date.now();
  try {
    const res = await fetch('https://api.sarvam.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-subscription-key': key,
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(body),
    });
    const txt = await res.text().catch(() => '');
    let content = null;
    let finish = null;
    let reasoningLen = 0;
    try {
      const j = JSON.parse(txt);
      const m = j?.choices?.[0]?.message;
      content = m?.content ?? null;
      reasoningLen = (m?.reasoning_content || '').length;
      finish = j?.choices?.[0]?.finish_reason ?? null;
    } catch { /* leave raw */ }
    return {
      model, max_tokens, reasoning_effort: reasoning_effort || null,
      status: res.status, ms: Date.now() - t0, finish,
      reasoning_chars: reasoningLen,
      content: content ? String(content).slice(0, 500) : null,
      raw: content ? null : txt.slice(0, 300),
    };
  } catch (e) {
    return { model, ms: Date.now() - t0, error: String(e && e.message ? e.message : e) };
  }
}

export async function GET(req) {
  const url = new URL(req.url);
  if (url.searchParams.get('probe') !== PROBE) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  const text = url.searchParams.get('text') || 'remind me to call Gautam tomorrow morning';
  const language = url.searchParams.get('language') || 'en-IN';
  const key = process.env.SARVAM_API_KEY;
  if (!key) return NextResponse.json({ sarvam_key_present: false });

  const variants = [
    { model: 'sarvam-105b-conversations', max_tokens: 500 },
    { model: 'sarvam-105b', max_tokens: 500, reasoning_effort: 'low' },
    { model: 'sarvam-105b', max_tokens: 2000 },
  ];

  const results = [];
  for (const v of variants) results.push(await callSarvam(key, { ...v, text }));

  let understand = null;
  try {
    const t0 = Date.now();
    const parsed = await aariaUnderstandLLM(text, {
      language, nowISO: new Date().toISOString(),
      timezone: 'Asia/Kolkata', workspaceMode: 'personal',
    });
    understand = { ms: Date.now() - t0, result: parsed };
  } catch (e) {
    understand = { error: String(e && e.message ? e.message : e) };
  }

  return NextResponse.json({ text, language, variants: results, understand });
}
