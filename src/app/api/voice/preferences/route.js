// src/app/api/voice/preferences/route.js
// User voice + language preferences. Complements the existing /api/voice/clone
// (own-voice creation) and /api/voice/tts-token. Uses the same Bearer-client
// pattern those routes use for user_settings.
//   GET    → current preferences + own-voice status
//   POST   → save language / tone / provider / input toggle / preset
//   DELETE → remove the user's cloned voice + consent (privacy control)
import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

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
    .select('voice_language,voice_tone,voice_input_enabled,preferred_language,elevenlabs_voice_id,voice_clone_consent,settings')
    .eq('user_id', user.id).maybeSingle();

  const settings = data?.settings || {};
  return NextResponse.json({
    voice_language: data?.voice_language || data?.preferred_language || 'en-IN',
    voice_tone: data?.voice_tone || 'warm',
    voice_input_enabled: data?.voice_input_enabled ?? true,
    provider: settings.voice_provider || (data?.elevenlabs_voice_id ? 'own' : 'system'),
    preset_voice: settings.preset_voice || null,
    has_own_voice: !!data?.elevenlabs_voice_id,
    consent: !!data?.voice_clone_consent,
  });
}

export async function POST(req) {
  const sb = bearer(req); if (!sb) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const user = await getUser(sb); if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body; try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const { data: cur } = await sb.from('user_settings').select('settings').eq('user_id', user.id).maybeSingle();
  const settings = { ...(cur?.settings || {}) };
  if (body.provider) settings.voice_provider = body.provider;
  if (body.preset_voice !== undefined) settings.preset_voice = body.preset_voice;

  const patch = { user_id: user.id, settings, updated_at: new Date().toISOString() };
  if (body.voice_language) { patch.voice_language = body.voice_language; patch.preferred_language = body.voice_language; }
  if (body.voice_tone) patch.voice_tone = body.voice_tone;
  if (typeof body.voice_input_enabled === 'boolean') patch.voice_input_enabled = body.voice_input_enabled;

  const { error } = await sb.from('user_settings').upsert(patch, { onConflict: 'user_id' });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req) {
  const sb = bearer(req); if (!sb) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const user = await getUser(sb); if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Best-effort delete from ElevenLabs, then clear locally (user privacy control).
  try {
    const { data } = await sb.from('user_settings').select('elevenlabs_voice_id').eq('user_id', user.id).maybeSingle();
    const vid = data?.elevenlabs_voice_id;
    const key = process.env.ELEVENLABS_API_KEY;
    if (vid && key) {
      await fetch(`https://api.elevenlabs.io/v1/voices/${vid}`, { method: 'DELETE', headers: { 'xi-api-key': key } }).catch(() => {});
    }
  } catch (_) {}

  const { error } = await sb.from('user_settings').upsert({
    user_id: user.id, elevenlabs_voice_id: null, voice_clone_consent: false, updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  try { await sb.from('audit_log').insert({ user_id: user.id, action: 'voice_clone_deleted', service: 'voice_clone', details: {} }); } catch (_) {}
  return NextResponse.json({ ok: true });
}
