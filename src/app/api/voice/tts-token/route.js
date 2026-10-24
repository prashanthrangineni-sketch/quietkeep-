// src/app/api/voice/tts-token/route.js
// FIXED: cookies() → Bearer token auth. Returns ELEVENLABS_API_KEY only with verified 3-part consent.
import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { hasAllClonedVoiceConsents } from '@/lib/cloned-voice-safeguards';

export const dynamic = 'force-dynamic';

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

export async function GET(request) {
  const supabase = createBearerClient(request);
  if (!supabase) return NextResponse.json({ key: null });

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ key: null });

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return NextResponse.json({ key: null });

  const { data } = await supabase
    .from('user_settings')
    .select('voice_clone_consent, elevenlabs_voice_id, consent_own_or_permitted, consent_no_deception, consent_in_app_labeled')
    .eq('user_id', user.id)
    .maybeSingle();

  const hasFullConsent = hasAllClonedVoiceConsents({
    consent_own_or_permitted: data?.consent_own_or_permitted,
    consent_no_deception: data?.consent_no_deception,
    consent_in_app_labeled: data?.consent_in_app_labeled,
  });

  if (!data?.voice_clone_consent || !hasFullConsent) {
    return NextResponse.json({ key: null });
  }

  // Never return raw ElevenLabs API key to the browser. Return { key: null } always.
  return NextResponse.json({ key: null, voice_id: null });
}
