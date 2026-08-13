// TEMPORARY DIAGNOSTIC — delete once the Sarvam understanding path is proven.
// Returns the literal Sarvam HTTP status/body so we stop guessing why
// aariaUnderstandLLM() returns null. Never echoes the API key.

import { NextResponse } from 'next/server';
import { aariaUnderstandLLM } from '@/lib/aaria-llm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PROBE = 'qk-brain-probe-2026';

export async function GET(req) {
  const url = new URL(req.url);
  if (url.searchParams.get('probe') !== PROBE) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  const text = url.searchParams.get('text') || 'remind me to call Gautam tomorrow morning';
  const language = url.searchParams.get('language') || 'en-IN';
  const key = process.env.SARVAM_API_KEY;

  const report = {
    build_has_module: true,
    sarvam_key_present: !!key,
    sarvam_key_len: key ? key.length : 0,
    text,
    language,
  };

  if (!key) return NextResponse.json(report);

  // 1. Raw call — show exactly what Sarvam says.
  const body = {
    model: process.env.SARVAM_CHAT_MODEL || 'sarvam-105b',
    temperature: 0.2,
    max_tokens: 200,
    messages: [{ role: 'user', content: 'Reply with only the word OK.' }],
  };

  for (const variant of [
    { name: 'both-headers', headers: { 'api-subscription-key': key, Authorization: `Bearer ${key}` } },
    { name: 'bearer-only', headers: { Authorization: `Bearer ${key}` } },
    { name: 'subscription-only', headers: { 'api-subscription-key': key } },
  ]) {
    try {
      const t0 = Date.now();
      const res = await fetch('https://api.sarvam.ai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...variant.headers },
        body: JSON.stringify(body),
      });
      const txt = await res.text().catch(() => '');
      report[variant.name] = { status: res.status, ms: Date.now() - t0, body: txt.slice(0, 400) };
    } catch (e) {
      report[variant.name] = { error: String(e && e.message ? e.message : e) };
    }
  }

  // 2. The real function, end to end.
  try {
    const t0 = Date.now();
    const parsed = await aariaUnderstandLLM(text, {
      language,
      nowISO: new Date().toISOString(),
      timezone: 'Asia/Kolkata',
      workspaceMode: 'personal',
    });
    report.understand = { ms: Date.now() - t0, result: parsed };
  } catch (e) {
    report.understand = { error: String(e && e.message ? e.message : e) };
  }

  return NextResponse.json(report);
}
