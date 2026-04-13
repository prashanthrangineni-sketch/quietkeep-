// src/app/api/voice/clone/route.js
// FIXED: cookies() → Bearer token auth. Preserves all ElevenLabs voice cloning logic.
import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

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
  const consent   = formData.get('consent');
  const voiceName = formData.get('voice_name') || `qk-${user.id.slice(0, 8)}`;

  if (consent !== 'true') {
    return NextResponse.json({ error: 'Explicit consent required. Send consent=true to acknowledge that you are uploading your own voice.' }, { status: 400 });
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
  await supabase.from('user_settings').upsert({
    user_id: user.id, elevenlabs_voice_id: voiceId,
    voice_clone_consent: true, voice_clone_at: now, updated_at: now,
  }, { onConflict: 'user_id' });

  await supabase.from('audit_log').insert({
    user_id: user.id, action: 'voice_clone_created', service: 'voice_clone',
    details: { voice_id: voiceId, voice_name: voiceName, audio_files_count: audioFiles.length, consent: true, consent_at: now },
  });

  return NextResponse.json({ success: true, voice_id: voiceId, message: 'Voice profile created. Use this voice_id for TTS output.' });
}

export async function GET(request) {
  const supabase = createBearerClient(request);
  if (!supabase) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: settings } = await supabase
    .from('user_settings')
    .select('elevenlabs_voice_id, voice_clone_consent, voice_clone_at')
    .eq('user_id', user.id).single();

  return NextResponse.json({
    voice_id: settings?.elevenlabs_voice_id || null,
    consent:  settings?.voice_clone_consent || false,
    cloned_at: settings?.voice_clone_at || null,
  });
}
