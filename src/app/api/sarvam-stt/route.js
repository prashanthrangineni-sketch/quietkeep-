import { NextResponse } from 'next/server';

export async function POST(req) {
  try {
    const formData = await req.formData();
    const audioFile = formData.get('audio');
    const languageCode = formData.get('language_code') || 'en-IN';

    if (!audioFile) return NextResponse.json({ error: 'No audio file' }, { status: 400 });

    const sarvamForm = new FormData();
    sarvamForm.append('file', audioFile, 'audio.webm');
    sarvamForm.append('model', 'saarika:v2');
    sarvamForm.append('language_code', languageCode);

    const res = await fetch('https://api.sarvam.ai/speech-to-text', {
      method: 'POST',
      headers: {
        'api-subscription-key': process.env.SARVAM_API_KEY || '',
      },
      body: sarvamForm,
    });

    if (!res.ok) {
      const err = await res.text();
      return NextResponse.json({ error: `Sarvam API error: ${err}` }, { status: 500 });
    }

    const data = await res.json();
    return NextResponse.json({ transcript: data.transcript || '' });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
