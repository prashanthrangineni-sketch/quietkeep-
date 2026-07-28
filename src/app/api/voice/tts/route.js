// src/app/api/voice/tts/route.js
// Indic reply voice — via Pranix Aaria (the shared voice engine for ALL projects).
//
// WHY THIS EXISTS
// QuietKeep understood Telugu/Hindi (STT) but REPLIED in a broken OS voice, because
// src/lib/tts.js had no Indic path — only browser SpeechSynthesis and Pro-gated
// ElevenLabs. This route gives the assistant a natural Indian reply voice.
//
// WHY AARIA AND NOT SARVAM DIRECTLY
// Aaria (/api/health) already reports `sarvam:bulbul:v3` and `sarvam:saaras:v3` as
// HEALTHY providers. Calling api.sarvam.ai from QuietKeep would duplicate a provider
// that already lives inside Aaria, and would fragment the voice identity across
// projects. QuietKeep therefore holds NO Sarvam key: Aaria owns provider choice,
// keys, cost and fallback. Swapping Bulbul for something better later is an Aaria
// change with no QuietKeep release.
//
//   POST { text, lang, quality_tier? }
//     → { audio: "<base64>", codec, provider, visual_companion }   (audio available)
//     → { audio: null, audio_url }                                 (URL-style reply)
//     → { audio: null, reason }                                    (client falls back)
//
// Never returns a hard error to the user — an unavailable voice degrades to the
// browser voice in src/lib/tts.js rather than breaking the reply.
import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// Same base URL the existing /api/aaria proxy uses; overridable per environment.
const AARIA_BASE_URL = process.env.AARIA_BASE_URL || 'https://pranix-aaria.onrender.com';

function bearer(req) {
  const a = (req.headers.get('Authorization') || '').trim();
  const t = a.startsWith('Bearer ') ? a.slice(7).trim() : a;
  if (!t) return null;
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: `Bearer ${t}` } } }
  );
}

// Aaria accepts a language hint; keep both bare ("te") and BCP-47 ("te-IN") usable.
function normalizeLang(lang) {
  if (!lang) return 'en';
  return String(lang).trim();
}

// Aaria's speak contract may return audio under a few shapes depending on the
// provider behind it. Accept all of them rather than assuming one.
function extractAudio(d) {
  if (!d || typeof d !== 'object') return { audio: null, audio_url: null };
  const audio =
    d.audio_base64 ||
    d.audioBase64 ||
    d.audio_content ||
    (typeof d.audio === 'string' ? d.audio : null) ||
    (Array.isArray(d.audios) ? d.audios[0] : null) ||
    null;
  const audio_url = d.audio_url || d.audioUrl || d.url || null;
  return { audio, audio_url };
}

export async function POST(req) {
  const sb = bearer(req);
  if (!sb) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const text = (body.text || '').toString().trim().slice(0, 1500);
  if (!text) return NextResponse.json({ error: 'text required' }, { status: 400 });

  const lang = normalizeLang(body.lang);

  try {
    const res = await fetch(`${AARIA_BASE_URL}/api/voice/speak`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        lang,
        product: 'QuietKeep',
        quality_tier: body.quality_tier || 'standard',
      }),
    });

    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).slice(0, 200);
      return NextResponse.json({ audio: null, reason: `aaria_${res.status}`, detail });
    }

    const data = await res.json().catch(() => null);
    const { audio, audio_url } = extractAudio(data);

    // No audio yet (e.g. Aaria returned metadata only) → client uses browser voice.
    if (!audio && !audio_url) {
      return NextResponse.json({
        audio: null,
        reason: 'aaria_no_audio',
        visual_companion: data?.visual_companion ?? null,
      });
    }

    return NextResponse.json({
      audio,
      audio_url,
      codec: data?.codec || data?.output_audio_codec || 'mp3',
      provider: data?.engine_used || data?.provider || 'aaria',
      lang,
      visual_companion: data?.visual_companion ?? null,
    });
  } catch (e) {
    return NextResponse.json({
      audio: null,
      reason: 'aaria_unreachable',
      detail: String(e?.message || e).slice(0, 200),
    });
  }
}
