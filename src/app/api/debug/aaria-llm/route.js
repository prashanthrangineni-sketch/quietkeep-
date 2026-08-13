// Health probe for Aaria's understanding brain (Sarvam).
// GET /api/debug/aaria-llm?probe=...&text=...&language=te-IN
// Returns what the brain understood, plus how long it took. Never echoes the key.
//
// Findings this probe produced on 13 Aug 2026, kept here so nobody re-derives them:
//   - SARVAM_API_KEY is present and valid in production.
//   - Model 'sarvam-m' is DEPRECATED — Sarvam replies 400 with
//     "Please use one of the available models instead: sarvam-105b,
//      sarvam-105b-conversations". This was the single reason every multilingual
//      utterance fell back to the English regex parser.
//   - 'sarvam-105b' is a reasoning model: it spends the whole token budget on
//     reasoning_content and returns content:null (finish_reason "length").
//   - 'sarvam-105b-conversations' returns clean JSON in ~4s. That is the brain.

import { NextResponse } from 'next/server';
import { aariaUnderstandLLM } from '@/lib/aaria-llm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const PROBE = 'qk-brain-probe-2026';

export async function GET(req) {
  const url = new URL(req.url);
  if (url.searchParams.get('probe') !== PROBE) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  const text = url.searchParams.get('text') || 'remind me to call Gautam tomorrow morning';
  const language = url.searchParams.get('language') || 'en-IN';

  const t0 = Date.now();
  let result = null;
  let error = null;
  try {
    result = await aariaUnderstandLLM(text, {
      language,
      nowISO: new Date().toISOString(),
      timezone: 'Asia/Kolkata',
      workspaceMode: url.searchParams.get('mode') === 'business' ? 'business' : 'personal',
    });
  } catch (e) {
    error = String(e && e.message ? e.message : e);
  }

  return NextResponse.json({
    text,
    language,
    sarvam_key_present: !!process.env.SARVAM_API_KEY,
    model: process.env.SARVAM_CHAT_MODEL || 'sarvam-105b-conversations',
    ms: Date.now() - t0,
    healthy: !!result,
    error,
    result,
  });
}
