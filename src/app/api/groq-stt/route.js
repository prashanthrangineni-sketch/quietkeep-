// src/app/api/groq-stt/route.js
//
// Replaces /api/sarvam-stt as the primary cloud STT endpoint.
// Sarvam AI was discontinued — Groq Whisper Large v3 Turbo replaces it.
//
// CONTRACT:
//   Accepts EITHER content-type:
//
//   1. application/json
//        body: { audio: <base64 string>, language: <BCP-47, optional> }
//      Returns: { transcript, language, confidence }
//
//   2. multipart/form-data  (drop-in compat for old Sarvam callers —
//      VoiceService.java, browser STT fallback, etc.)
//        fields: file=<audio Blob>, language_code=<BCP-47, optional>
//      Returns: { transcript, language, confidence }
//
// Groq Whisper accepts multipart/form-data with `file` and `model`.
// We forward audio bytes to Groq with no transcoding — Whisper auto-detects
// the input format (wav, webm, mp3, m4a, mp4, mpeg, mpga, ogg, flac).

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/audio/transcriptions';
const GROQ_MODEL    = 'whisper-large-v3-turbo';

// Indian + common Whisper-supported languages. Whisper takes ISO 639-1 codes
// (two-letter, e.g. "en", "hi", "te"), so we normalize "en-IN" → "en" before
// sending. If the language is unknown to us, we omit the field and let
// Whisper auto-detect.
const ISO_639_1_FROM_BCP47 = {
  'en-IN': 'en', 'en-US': 'en', 'en-GB': 'en',
  'hi-IN': 'hi',
  'te-IN': 'te',
  'ta-IN': 'ta',
  'kn-IN': 'kn',
  'ml-IN': 'ml',
  'gu-IN': 'gu',
  'bn-IN': 'bn',
  'mr-IN': 'mr',
};

function toIso639(lang) {
  if (!lang) return null;
  if (ISO_639_1_FROM_BCP47[lang]) return ISO_639_1_FROM_BCP47[lang];
  // Already a 2-letter ISO code?
  if (/^[a-z]{2}$/i.test(lang)) return lang.toLowerCase();
  // Strip region suffix (e.g. "en-IN" → "en") and retry
  const base = String(lang).split('-')[0].toLowerCase();
  return /^[a-z]{2}$/.test(base) ? base : null;
}

function base64ToBlob(b64, mimeType = 'audio/wav') {
  // Strip data URL prefix if present
  const clean = String(b64).replace(/^data:[^;]+;base64,/, '');
  const bin   = Buffer.from(clean, 'base64');
  return new Blob([bin], { type: mimeType });
}

export async function POST(req) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { fallback: true, error: 'GROQ_API_KEY not configured' },
      { status: 503 },
    );
  }

  try {
    const contentType = (req.headers.get('content-type') || '').toLowerCase();
    let audioBlob    = null;
    let audioName    = 'audio.wav';
    let rawLang      = null;

    if (contentType.includes('application/json')) {
      // Spec shape: { audio: base64, language }
      const body = await req.json().catch(() => ({}));
      if (!body?.audio) {
        return NextResponse.json(
          { fallback: true, error: 'No audio provided (expected { audio: base64string })' },
          { status: 400 },
        );
      }
      audioBlob = base64ToBlob(body.audio);
      rawLang   = body.language || null;
    } else {
      // Drop-in compat shape: multipart/form-data with field 'file' (matches
      // existing VoiceService.java and browser callers).
      const form    = await req.formData();
      const audio   = form.get('file') || form.get('audio');
      if (!audio) {
        return NextResponse.json(
          { fallback: true, error: 'No audio file provided' },
          { status: 400 },
        );
      }
      audioBlob = audio;
      audioName = audio.name || 'audio.wav';
      rawLang   = form.get('language_code') || form.get('language') || null;
    }

    const iso = toIso639(rawLang);

    // Forward to Groq Whisper as multipart/form-data
    const groqForm = new FormData();
    groqForm.append('file', audioBlob, audioName);
    groqForm.append('model', GROQ_MODEL);
    if (iso) groqForm.append('language', iso);
    // response_format=verbose_json would give us per-segment timestamps;
    // 'json' is enough for our transcript-only use case and is cheaper.
    groqForm.append('response_format', 'json');

    const res = await fetch(GROQ_ENDPOINT, {
      method:  'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body:    groqForm,
    });

    if (!res.ok) {
      const errText  = await res.text().catch(() => '');
      const hardFail = res.status === 401 || res.status === 403;
      console.error('[groq-stt] Groq HTTP', res.status, errText.slice(0, 300));
      return NextResponse.json(
        { fallback: true, hard_fail: hardFail, error: `Groq ${res.status}: ${errText.slice(0, 200)}` },
        { status: 500 },
      );
    }

    const data       = await res.json();
    const transcript = data?.text || data?.transcript || '';

    // Per spec: confidence is fixed at 0.9 (Whisper does not expose a
    // per-utterance confidence in the json response_format).
    return NextResponse.json(
      {
        transcript,
        language:   rawLang || iso || 'en',
        confidence: 0.9,
      },
      { status: 200 },
    );

  } catch (err) {
    console.error('[groq-stt]', err?.message ?? err);
    return NextResponse.json(
      { fallback: true, error: err?.message || 'groq-stt internal error' },
      { status: 500 },
    );
  }
}

// Lightweight health probe so sttRouter.checkGroqAvailability() can validate
// without burning a real transcription call.
export async function GET() {
  const ok = !!process.env.GROQ_API_KEY;
  return NextResponse.json(
    { ok, provider: 'groq', model: GROQ_MODEL },
    { status: ok ? 200 : 503 },
  );
}
