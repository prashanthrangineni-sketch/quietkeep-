// src/app/api/voice/stt/route.js
// Speech-to-text through Pranix Aaria — the shared voice engine for all projects.
//
// WHY
// #41 made QuietKeep SPEAK through Aaria. This makes it LISTEN through Aaria too,
// closing the loop. Aaria's /api/health reports `sarvam:saaras:v3` healthy, which
// is newer than the `saarika:v2` pinned in the orphaned direct /api/sarvam-stt
// route — and it means QuietKeep holds no STT vendor key either.
//
// ARCHITECTURE RULE (see src/lib/sttRouter.ts): Aaria owns provider choice, keys,
// cost and fallback. Do NOT wire a STT/TTS vendor directly into QuietKeep.
//
// DROP-IN CONTRACT — identical to /api/groq-stt, so a call site switches by URL:
//   1. application/json      { audio: <base64>, language?: <BCP-47> }
//   2. multipart/form-data   file=<Blob>, language_code?=<BCP-47>
//   → { transcript, language, confidence, engine_used }
//
// ROUTING
//   Indic audio  → Aaria (saaras:v3 leads Indic recognition)
//   English      → Groq Whisper directly (strong at English; skips a hop)
//   Aaria fails  → Groq fallback, ALWAYS
// So this endpoint is never worse than the one it supersedes.
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const AARIA_BASE_URL = process.env.AARIA_BASE_URL || 'https://pranix-aaria.onrender.com';
const GROQ_ENDPOINT  = 'https://api.groq.com/openai/v1/audio/transcriptions';
const GROQ_MODEL     = 'whisper-large-v3-turbo';

const ISO_639_1_FROM_BCP47 = {
  'en-IN': 'en', 'en-US': 'en', 'en-GB': 'en',
  'hi-IN': 'hi', 'te-IN': 'te', 'ta-IN': 'ta', 'kn-IN': 'kn',
  'ml-IN': 'ml', 'gu-IN': 'gu', 'bn-IN': 'bn', 'mr-IN': 'mr',
  'pa-IN': 'pa', 'od-IN': 'or',
};

function toIso639(lang) {
  if (!lang) return null;
  if (ISO_639_1_FROM_BCP47[lang]) return ISO_639_1_FROM_BCP47[lang];
  if (/^[a-z]{2}$/i.test(lang)) return lang.toLowerCase();
  const base = String(lang).split('-')[0].toLowerCase();
  return /^[a-z]{2}$/.test(base) ? base : null;
}

function isIndic(lang) {
  const iso = toIso639(lang);
  if (!iso) return false;
  return iso !== 'en';
}

// ── read the request in either accepted shape ───────────────────────────────
async function readAudio(req) {
  const contentType = (req.headers.get('content-type') || '').toLowerCase();

  if (contentType.includes('application/json')) {
    const body = await req.json().catch(() => ({}));
    if (!body?.audio) return { error: 'No audio provided (expected { audio: base64string })' };
    const clean = String(body.audio).replace(/^data:[^;]+;base64,/, '');
    return { base64: clean, buffer: Buffer.from(clean, 'base64'), name: 'audio.wav', lang: body.language || null };
  }

  const form = await req.formData();
  const audio = form.get('file') || form.get('audio');
  if (!audio) return { error: 'No audio file provided' };
  const buffer = Buffer.from(await audio.arrayBuffer());
  return {
    base64: buffer.toString('base64'),
    buffer,
    name: audio.name || 'audio.wav',
    lang: form.get('language_code') || form.get('language') || null,
    blob: audio,
  };
}

// ── Groq Whisper (fallback + English primary) ───────────────────────────────
async function transcribeGroq({ buffer, name, lang }) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return { ok: false, error: 'GROQ_API_KEY not configured' };

  const iso = toIso639(lang);
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: 'audio/wav' }), name);
  form.append('model', GROQ_MODEL);
  if (iso) form.append('language', iso);
  form.append('response_format', 'json');

  const res = await fetch(GROQ_ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    return { ok: false, error: `Groq ${res.status}: ${t.slice(0, 200)}`, hard_fail: res.status === 401 || res.status === 403 };
  }
  const data = await res.json();
  return {
    ok: true,
    transcript: data?.text || data?.transcript || '',
    language: lang || iso || 'en',
    confidence: 0.9,
    engine_used: `groq:${GROQ_MODEL}`,
  };
}

// ── Aaria (Indic primary) ───────────────────────────────────────────────────
async function transcribeAaria({ base64, lang }) {
  const res = await fetch(`${AARIA_BASE_URL}/api/voice/listen`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      audio_base64: base64,
      lang_hint: toIso639(lang) || 'en',
      product: 'QuietKeep',
      quality_tier: 'standard',
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    return { ok: false, error: `Aaria ${res.status}: ${t.slice(0, 200)}` };
  }
  const data = await res.json().catch(() => null);
  const transcript = data?.text ?? '';
  // An empty transcript is not a success — fall back rather than return silence.
  if (!transcript) return { ok: false, error: 'aaria_empty_transcript' };
  return {
    ok: true,
    transcript,
    language: data?.language || lang || 'en',
    confidence: typeof data?.confidence === 'number' ? data.confidence : 0.9,
    engine_used: data?.engine_used || 'aaria',
  };
}

export async function POST(req) {
  try {
    const audio = await readAudio(req);
    if (audio.error) return NextResponse.json({ fallback: true, error: audio.error }, { status: 400 });

    const preferAaria = isIndic(audio.lang);

    if (preferAaria) {
      const viaAaria = await transcribeAaria(audio);
      if (viaAaria.ok) return NextResponse.json(viaAaria, { status: 200 });
      console.warn('[voice-stt] Aaria unavailable, falling back to Groq:', viaAaria.error);
    }

    const viaGroq = await transcribeGroq(audio);
    if (viaGroq.ok) return NextResponse.json(viaGroq, { status: 200 });

    // Groq failed too. If we haven't tried Aaria yet (English path), try it now
    // rather than giving up — any transcript beats none.
    if (!preferAaria) {
      const lastResort = await transcribeAaria(audio);
      if (lastResort.ok) return NextResponse.json(lastResort, { status: 200 });
    }

    return NextResponse.json(
      { fallback: true, hard_fail: viaGroq.hard_fail || false, error: viaGroq.error || 'stt_unavailable' },
      { status: 500 },
    );
  } catch (err) {
    console.error('[voice-stt]', err?.message ?? err);
    return NextResponse.json({ fallback: true, error: err?.message || 'voice-stt internal error' }, { status: 500 });
  }
}

// Health probe so sttRouter can validate availability without a real call.
export async function GET() {
  let aariaOk = false;
  try {
    const res = await fetch(`${AARIA_BASE_URL}/api/health`);
    const data = await res.json().catch(() => ({}));
    aariaOk = res.ok && data?.status === 'healthy';
  } catch { /* offline */ }

  return NextResponse.json({
    ok: aariaOk || !!process.env.GROQ_API_KEY,
    provider: 'aaria',
    aaria_healthy: aariaOk,
    groq_fallback: !!process.env.GROQ_API_KEY,
    method: 'POST',
  });
}
