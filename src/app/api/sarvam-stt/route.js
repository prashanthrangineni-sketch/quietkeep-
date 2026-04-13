// src/app/api/sarvam-stt/route.js  v2
// FIX B6: Do not forcibly rename uploaded audio to 'audio.webm'.
//         VoiceService.java sends audio as 'chunk.wav' with Content-Type audio/wav.
//         Renaming to .webm caused Sarvam AI to reject the file due to MIME mismatch.
//         We now preserve the original filename and let Sarvam detect the format.
//
// All v1 logic is otherwise unchanged.

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const SUPPORTED_LANGS = ['en-IN','hi-IN','te-IN','ta-IN','kn-IN','ml-IN','gu-IN','bn-IN','mr-IN'];

export async function POST(req) {
  const apiKey = process.env.SARVAM_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { fallback: true, error: 'SARVAM_API_KEY not configured' },
      { status: 503 }
    );
  }

  try {
    const formData     = await req.formData();
    const audioFile    = formData.get('audio');
    const rawLang      = formData.get('language_code') || 'en-IN';
    const languageCode = SUPPORTED_LANGS.includes(rawLang) ? rawLang : 'en-IN';

    if (!audioFile) {
      return NextResponse.json({ fallback: true, error: 'No audio file provided' }, { status: 400 });
    }

    const sarvamForm = new FormData();
    // FIX B6: Use the original filename from the upload.
    // VoiceService sends 'chunk.wav'; browser clients send 'audio.webm'.
    // Sarvam AI uses the filename extension to determine format.
    const originalName = audioFile.name || 'audio.wav';
    sarvamForm.append('file', audioFile, originalName);
    sarvamForm.append('model', 'saarika:v2');
    sarvamForm.append('language_code', languageCode);

    const res = await fetch('https://api.sarvam.ai/speech-to-text', {
      method: 'POST',
      headers: { 'api-subscription-key': apiKey },
      body: sarvamForm,
    });

    if (!res.ok) {
      const errText = await res.text();
      const hard_fail = res.status === 401 || res.status === 403;
      return NextResponse.json(
        { fallback: true, hard_fail, error: `Sarvam ${res.status}: ${errText}` },
        { status: 500 }
      );
    }

    const data = await res.json();
    const transcript = data?.transcript || data?.text || '';

    return NextResponse.json({ transcript, language: languageCode }, { status: 200 });

  } catch (err) {
    console.error('[sarvam-stt]', err?.message ?? err);
    return NextResponse.json({ fallback: true, error: err?.message }, { status: 500 });
  }
}
