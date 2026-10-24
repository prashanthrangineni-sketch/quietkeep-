// src/app/api/voice/clone/route.js
// FIXED: cookies() → Bearer token auth. Preserves all ElevenLabs voice cloning logic.
// CARD AG-AARIA-24: Enforces 3 explicit consent permissions before creating voice.
import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { hasAllClonedVoiceConsents } from '@/lib/cloned-voice-safeguards';

const ELEVENLABS_API = 'https://api.elevenlabs.io/v1';
const ALLOWED_TIERS  = ['pro', 'business', 'growth', 'enterprise'];

function createBearerClient(req) {
  const auth  = (req.headers.get('Authorization') || '').trim();
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : auth;
  if (!token) return null;
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );
}

export async function POST(request) {
  const supabase = createBearerClient(request);
  if (!supabase) return NextResponse.json({ error: 'Unauthorized — session expired, please refresh.' }, { status: 401 });

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized — session expired, please refresh.' }, { status: 401 });

  const elevenlabsKey = process.env.ELEVENLABS_API_KEY;
  if (!elevenlabsKey) return NextResponse.json({ error: 'Voice cloning not configured on this instance' }, { status: 503 });

  const { data: profile } = await supabase
    .from('profiles').select('subscription_tier').eq('user_id', user.id).single();

  if (!profile || !ALLOWED_TIERS.includes(profile.subscription_tier)) {
    return NextResponse.json({ error: 'Voice cloning requires a Pro or Business subscription' }, { status: 403 });
  }

  const formData = await request.formData();
  const voiceName = formData.get('voice_name') || `qk-${user.id.slice(0, 8)}`;

  // CARD AG-AARIA-24: Validate all 3 explicit consent permissions
  const consentA = formData.get('consent_own_or_permitted') === 'true' || formData.get('consent_a') === 'true';
  const consentB = formData.get('consent_no_deception') === 'true' || formData.get('consent_b') === 'true';
  const consentC = formData.get('consent_in_app_labeled') === 'true' || formData.get('consent_c') === 'true';

  if (!hasAllClonedVoiceConsents({
    consent_own_or_permitted: consentA,
    consent_no_deception: consentB,
    consent_in_app_labeled: consentC,
  })) {
    return NextResponse.json({
      error: 'All three explicit consent permissions are required to create a custom voice: (a) own voice or permission, (b) no deception, (c) in-app labelled only.',
    }, { status: 400 });
  }

  const audioFiles = [];
  for (let i = 0; i < 5; i++) {
    const file = formData.get(`audio_${i}`);
    if (file) audioFiles.push(file);
  }
  if (audioFiles.length === 0) return NextResponse.json({ error: 'At least one audio file required (audio_0)' }, { status: 400 });

  const elForm = new FormData();
  elForm.append('name', voiceName);
  elForm.append('description', `QuietKeep user voice — uid:${user.id.slice(0, 8)}`);
  for (const file of audioFiles) { elForm.append('files', file); }

  let voiceId;
  try {
    const elRes = await fetch(`${ELEVENLABS_API}/voices/add`, {
      method: 'POST', headers: { 'xi-api-key': elevenlabsKey }, body: elForm,
    });
    if (!elRes.ok) { const errText = await elRes.text(); return NextResponse.json({ error: `ElevenLabs error: ${errText}` }, { status: 502 }); }
    const elData = await elRes.json();
    voiceId = elData.voice_id;
  } catch (err) {
    return NextResponse.json({ error: 'Failed to reach ElevenLabs: ' + err.message }, { status: 502 });
  }

  if (!voiceId) return NextResponse.json({ error: 'ElevenLabs did not return a voice_id' }, { status: 502 });

  const now = new Date().toISOString();
  const { error: settingsErr } = await supabase.from('user_settings').upsert({
    user_id: user.id,
    elevenlabs_voice_id: voiceId,
    voice_clone_consent: true,
    consent_own_or_permitted: true,
    consent_no_deception: true,
    consent_in_app_labeled: true,
    voice_clone_at: now,
    voice_clone_consent_at: now,
    updated_at: now,
  }, { onConflict: 'user_id' });

  if (settingsErr) {
    return NextResponse.json({ error: 'Failed to save consent settings: ' + settingsErr.message }, { status: 500 });
  }

  const { error: consentErr } = await supabase.from('voice_profile_consents').upsert({
    user_id: user.id,
    voice_id: voiceId,
    voice_name: voiceName,
    consent_own_or_permitted: true,
    consent_no_deception: true,
    consent_in_app_labeled: true,
    consented_at: now,
    updated_at: now,
  }, { onConflict: 'user_id' });

  if (consentErr) {
    return NextResponse.json({ error: 'Failed to save consent record: ' + consentErr.message }, { status: 500 });
  }

  await supabase.from('audit_log').insert({
    user_id: user.id,
    action: 'voice_clone_created',
    service: 'voice_clone',
    details: {
      voice_id: voiceId,
      voice_name: voiceName,
      audio_files_count: audioFiles.length,
      consent: true,
      consent_own_or_permitted: true,
      consent_no_deception: true,
      consent_in_app_labeled: true,
      consent_at: now,
    },
  });

  return NextResponse.json({ success: true, voice_id: voiceId, message: 'Voice profile created with verified 3-part consent.' });
}

export async function GET(request) {
  const supabase = createBearerClient(request);
  if (!supabase) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: settings } = await supabase
    .from('user_settings')
    .select('elevenlabs_voice_id, voice_clone_consent, voice_clone_at, consent_own_or_permitted, consent_no_deception, consent_in_app_labeled, voice_clone_consent_at')
    .eq('user_id', user.id).single();

  const hasFullConsent = Boolean(
    settings?.voice_clone_consent &&
    settings?.consent_own_or_permitted &&
    settings?.consent_no_deception &&
    settings?.consent_in_app_labeled
  );

  return NextResponse.json({
    voice_id: settings?.elevenlabs_voice_id || null,
    consent: hasFullConsent,
    consent_own_or_permitted: settings?.consent_own_or_permitted || false,
    consent_no_deception: settings?.consent_no_deception || false,
    consent_in_app_labeled: settings?.consent_in_app_labeled || false,
    cloned_at: settings?.voice_clone_at || null,
    consented_at: settings?.voice_clone_consent_at || null,
  });
}
