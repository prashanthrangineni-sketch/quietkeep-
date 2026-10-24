// src/app/api/voice/preferences/route.js
// User voice + language preferences. Complements /api/voice/clone and /api/voice/tts-token.
// CARD AG-AARIA-24: Enforces 3-part consent before switching to custom voice,
// and ensures deletion purges profile, consent records, and contacts Aaria engine forget.
import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { hasAllClonedVoiceConsents } from '@/lib/cloned-voice-safeguards';
import { askEngineToForget } from '@/lib/aaria-forget';

export const dynamic = 'force-dynamic';

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
async function getUser(sb) { const { data: { user } } = await sb.auth.getUser(); return user; }

export async function GET(req) {
  const sb = bearer(req); if (!sb) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const user = await getUser(sb); if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data } = await sb.from('user_settings')
    .select('voice_language,voice_tone,voice_input_enabled,preferred_language,elevenlabs_voice_id,voice_clone_consent,consent_own_or_permitted,consent_no_deception,consent_in_app_labeled,voice_clone_consent_at,settings')
    .eq('user_id', user.id).maybeSingle();

  const settings = data?.settings || {};
  const hasFullConsent = hasAllClonedVoiceConsents({
    consent_own_or_permitted: data?.consent_own_or_permitted,
    consent_no_deception: data?.consent_no_deception,
    consent_in_app_labeled: data?.consent_in_app_labeled,
  });

  return NextResponse.json({
    voice_language: data?.voice_language || data?.preferred_language || 'en-IN',
    voice_tone: data?.voice_tone || 'warm',
    voice_input_enabled: data?.voice_input_enabled ?? true,
    provider: settings.voice_provider || (data?.elevenlabs_voice_id && hasFullConsent ? 'own' : 'system'),
    preset_voice: settings.preset_voice || null,
    has_own_voice: !!data?.elevenlabs_voice_id,
    consent: hasFullConsent,
    consents: {
      consent_own_or_permitted: !!data?.consent_own_or_permitted,
      consent_no_deception: !!data?.consent_no_deception,
      consent_in_app_labeled: !!data?.consent_in_app_labeled,
      consented_at: data?.voice_clone_consent_at || null,
    },
  });
}

export async function POST(req) {
  const sb = bearer(req); if (!sb) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const user = await getUser(sb); if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body; try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const { data: cur } = await sb.from('user_settings')
    .select('settings, elevenlabs_voice_id, voice_clone_consent, consent_own_or_permitted, consent_no_deception, consent_in_app_labeled')
    .eq('user_id', user.id).maybeSingle();

  const settings = { ...(cur?.settings || {}) };

  // If user wants to enable 'own' voice, verify 3-part consent
  if (body.provider === 'own') {
    const consentFromReq = body.consents || {
      consent_own_or_permitted: body.consent_own_or_permitted,
      consent_no_deception: body.consent_no_deception,
      consent_in_app_labeled: body.consent_in_app_labeled,
    };
    const hasConsentsNow = hasAllClonedVoiceConsents(consentFromReq);
    const hadConsentsPrior = hasAllClonedVoiceConsents({
      consent_own_or_permitted: cur?.consent_own_or_permitted,
      consent_no_deception: cur?.consent_no_deception,
      consent_in_app_labeled: cur?.consent_in_app_labeled,
    });

    if (!hasConsentsNow && !hadConsentsPrior) {
      return NextResponse.json({
        error: 'Cannot switch on custom voice without all three explicit consent permissions.',
      }, { status: 400 });
    }
    settings.voice_provider = 'own';
  } else if (body.provider) {
    settings.voice_provider = body.provider;
  }

  if (body.preset_voice !== undefined) settings.preset_voice = body.preset_voice;

  const patch = { user_id: user.id, settings, updated_at: new Date().toISOString() };
  if (body.voice_language) { patch.voice_language = body.voice_language; patch.preferred_language = body.voice_language; }
  if (body.voice_tone) patch.voice_tone = body.voice_tone;
  if (typeof body.voice_input_enabled === 'boolean') patch.voice_input_enabled = body.voice_input_enabled;

  if (body.consents && hasAllClonedVoiceConsents(body.consents)) {
    const now = new Date().toISOString();
    patch.voice_clone_consent = true;
    patch.consent_own_or_permitted = true;
    patch.consent_no_deception = true;
    patch.consent_in_app_labeled = true;
    patch.voice_clone_consent_at = now;

    const { error: consentUpsertErr } = await sb.from('voice_profile_consents').upsert({
      user_id: user.id,
      voice_id: cur?.elevenlabs_voice_id || null,
      consent_own_or_permitted: true,
      consent_no_deception: true,
      consent_in_app_labeled: true,
      consented_at: now,
      updated_at: now,
    }, { onConflict: 'user_id' });
    if (consentUpsertErr) {
      return NextResponse.json({ error: consentUpsertErr.message }, { status: 500 });
    }
  }

  const { error } = await sb.from('user_settings').upsert(patch, { onConflict: 'user_id' });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req) {
  const sb = bearer(req); if (!sb) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const user = await getUser(sb); if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // 1. Engine forget: fail if key missing or if engine forget fails
  if (!process.env.AARIA_CALLER_KEY) {
    return NextResponse.json({
      ok: false,
      error: 'Engine key not configured (AARIA_CALLER_KEY missing). Cannot perform safe deletion.',
    }, { status: 500 });
  }

  const engineRes = await askEngineToForget(user.id);
  if (!engineRes.ok) {
    return NextResponse.json({
      ok: false,
      error: 'Engine forget refused or failed. Cannot report success.',
      reason: engineRes.reason,
    }, { status: 502 });
  }

  // 2. Delete voice from ElevenLabs: delete user voice + any returned in providerVoicesToRemove
  const { data: userSet, error: userSetErr } = await sb.from('user_settings')
    .select('elevenlabs_voice_id')
    .eq('user_id', user.id)
    .maybeSingle();

  if (userSetErr) {
    return NextResponse.json({ ok: false, error: userSetErr.message }, { status: 500 });
  }

  const voicesToDelete = new Set();
  if (userSet?.elevenlabs_voice_id) {
    voicesToDelete.add(userSet.elevenlabs_voice_id);
  }
  if (Array.isArray(engineRes.providerVoicesToRemove)) {
    engineRes.providerVoicesToRemove.forEach(v => { if (v) voicesToDelete.add(v); });
  }

  const elKey = process.env.ELEVENLABS_API_KEY;
  for (const vid of voicesToDelete) {
    if (vid && elKey) {
      try {
        const elRes = await fetch(`https://api.elevenlabs.io/v1/voices/${vid}`, {
          method: 'DELETE',
          headers: { 'xi-api-key': elKey },
        });
        if (!elRes.ok && elRes.status !== 404) {
          const detail = await elRes.text().catch(() => '');
          return NextResponse.json({
            ok: false,
            error: `ElevenLabs voice deletion failed (${elRes.status}): ${detail.slice(0, 200)}`,
          }, { status: 502 });
        }
      } catch (err) {
        return NextResponse.json({
          ok: false,
          error: `Failed to contact ElevenLabs to delete voice: ${err.message}`,
        }, { status: 502 });
      }
    }
  }

  // 3. Remove consent record from voice_profile_consents
  const { error: consentDelErr } = await sb.from('voice_profile_consents').delete().eq('user_id', user.id);
  if (consentDelErr) {
    return NextResponse.json({ ok: false, error: consentDelErr.message }, { status: 500 });
  }

  // 4. Clear locally in user_settings
  const { error: clearErr } = await sb.from('user_settings').upsert({
    user_id: user.id,
    elevenlabs_voice_id: null,
    voice_clone_consent: false,
    consent_own_or_permitted: false,
    consent_no_deception: false,
    consent_in_app_labeled: false,
    voice_clone_consent_at: null,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' });

  if (clearErr) return NextResponse.json({ ok: false, error: clearErr.message }, { status: 500 });

  try {
    await sb.from('audit_log').insert({
      user_id: user.id,
      action: 'voice_clone_deleted',
      service: 'voice_clone',
      details: { purged_consents: true, erased: engineRes.erased },
    });
  } catch (_) {}

  return NextResponse.json({ ok: true, deleted: true });
}
