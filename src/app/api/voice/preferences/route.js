// src/app/api/voice/preferences/route.js
// User voice + language preferences. Complements /api/voice/clone and /api/voice/tts-token.
// CARD AG-AARIA-24: Enforces 3-part consent before switching to custom voice,
// and ensures deletion purges profile, consent records, and contacts Aaria engine forget.
import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { hasAllClonedVoiceConsents } from '@/lib/cloned-voice-safeguards';
import { executeVoicePreferencesDelete } from '@/lib/cloned-voice-delete.server';

export const dynamic = 'force-dynamic';

function getServiceClient() {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return null;
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, serviceKey);
}


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

  const db = getServiceClient() || sb;

  let body; try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const { data: cur } = await sb.from('user_settings')
    .select('settings, elevenlabs_voice_id, voice_clone_consent, consent_own_or_permitted, consent_no_deception, consent_in_app_labeled')
    .eq('user_id', user.id).maybeSingle();

  const settings = { ...(cur?.settings || {}) };

  const consentsInput = body.consents || (
    ('consent_own_or_permitted' in body || 'consent_no_deception' in body || 'consent_in_app_labeled' in body)
      ? {
          consent_own_or_permitted: body.consent_own_or_permitted,
          consent_no_deception: body.consent_no_deception,
          consent_in_app_labeled: body.consent_in_app_labeled,
        }
      : null
  );

  // If user wants to enable 'own' voice, verify 3-part consent
  if (body.provider === 'own') {
    const hasConsentsNow = consentsInput ? hasAllClonedVoiceConsents(consentsInput) : false;
    if (consentsInput && !hasConsentsNow) {
      return NextResponse.json({
        error: 'Cannot switch on custom voice without all three explicit consent permissions.',
      }, { status: 400 });
    }
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

  if (consentsInput) {
    const now = new Date().toISOString();
    const isTrue = (val) => val === true || val === 'true' || val === 1 || val === '1';
    const c1 = isTrue(consentsInput.consent_own_or_permitted);
    const c2 = isTrue(consentsInput.consent_no_deception);
    const c3 = isTrue(consentsInput.consent_in_app_labeled);

    if (c1 && c2 && c3) {
      patch.voice_clone_consent = true;
      patch.consent_own_or_permitted = true;
      patch.consent_no_deception = true;
      patch.consent_in_app_labeled = true;
      patch.voice_clone_consent_at = now;

      const { error: consentUpsertErr } = await db.from('voice_profile_consents').upsert({
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
    } else {
      // Item 3: unticking any consent must withdraw it (save false, disable cloned voice)
      patch.voice_clone_consent = false;
      patch.consent_own_or_permitted = c1;
      patch.consent_no_deception = c2;
      patch.consent_in_app_labeled = c3;
      patch.voice_clone_consent_at = null;

      if (settings.voice_provider === 'own') {
        settings.voice_provider = 'system';
      }

      const { error: consentWithdrawErr } = await db.from('voice_profile_consents').upsert({
        user_id: user.id,
        voice_id: cur?.elevenlabs_voice_id || null,
        consent_own_or_permitted: c1,
        consent_no_deception: c2,
        consent_in_app_labeled: c3,
        updated_at: now,
      }, { onConflict: 'user_id' });
      if (consentWithdrawErr) {
        return NextResponse.json({ error: consentWithdrawErr.message }, { status: 500 });
      }
    }
  }

  const { error } = await db.from('user_settings').upsert(patch, { onConflict: 'user_id' });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req) {
  const sb = bearer(req); if (!sb) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const user = await getUser(sb); if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const db = getServiceClient() || sb;
  const result = await executeVoicePreferencesDelete({
    supabase: db,
    userId: user.id,
    elevenlabsApiKey: process.env.ELEVENLABS_API_KEY,
    aariaCallerKey: process.env.AARIA_CALLER_KEY,
    fetchImpl: fetch,
  });

  return NextResponse.json(result, { status: result.status });
}
