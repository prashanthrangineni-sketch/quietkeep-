// src/app/api/voice/tts/route.js
// Indic reply voice — via Pranix Aaria (the shared voice engine for ALL projects).
//
// CARD AG-AARIA-24:
// - Sends `purpose` on every call to Aaria's /api/voice/speak endpoint.
// - Enforces standard Aaria voice on SOS, alarm, money, payment, and confirmation replies.
import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { extractAudio } from '@/lib/aaria-audio';
import { engineHeaders } from '@/lib/aaria-pass';
import { hasAllClonedVoiceConsents, isRestrictedPurpose } from '@/lib/cloned-voice-safeguards';

export const dynamic = 'force-dynamic';

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

function normalizeLang(lang) {
  if (!lang) return 'en';
  return String(lang).trim();
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
  const rawPurpose = String(body.purpose || 'general').trim().toLowerCase();
  const purpose = rawPurpose || 'general';

  // Server allow-list: only in-app playback purposes may use the cloned voice.
  // Every other purpose (sos, calls, whatsapp, messages to others, export, action_confirmation)
  // falls back to the standard voice.
  const IN_APP_ALLOWED_PURPOSES = new Set(['conversational', 'general', 'brief', 'greeting']);
  const isAllowedPurpose = IN_APP_ALLOWED_PURPOSES.has(purpose);

  // Ignore client body.voice_id. Securely load session user's elevenlabs_voice_id and consent flags.
  const { data: userSettings } = await sb.from('user_settings')
    .select('elevenlabs_voice_id, consent_own_or_permitted, consent_no_deception, consent_in_app_labeled, voice_clone_consent, settings')
    .eq('user_id', user.id)
    .maybeSingle();

  const hasFullConsent = hasAllClonedVoiceConsents({
    consent_own_or_permitted: userSettings?.consent_own_or_permitted,
    consent_no_deception: userSettings?.consent_no_deception,
    consent_in_app_labeled: userSettings?.consent_in_app_labeled,
  });

  const isRestricted = isRestrictedPurpose(purpose) || !isAllowedPurpose || body.is_outbound || body.is_call || body.is_export;
  const isOwnProvider = userSettings?.settings?.voice_provider === 'own' || (!userSettings?.settings?.voice_provider && userSettings?.elevenlabs_voice_id);

  const canUseClonedVoice = hasFullConsent && !isRestricted && isOwnProvider && Boolean(userSettings?.elevenlabs_voice_id);
  const voiceId = canUseClonedVoice ? userSettings.elevenlabs_voice_id : null;

  try {
    const payload = {
      text,
      lang,
      product: 'QuietKeep',
      quality_tier: body.quality_tier || 'standard',
      purpose,
      user_id: user.id,
    };
    if (voiceId) {
      payload.voice_id = voiceId;
    }

    const res = await fetch(`${AARIA_BASE_URL}/api/voice/speak`, {
      method: 'POST',
      headers: engineHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload),
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
