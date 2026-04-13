// src/app/api/voice/tts-token/route.js
// FIXED: cookies() → Bearer token auth. Returns ELEVENLABS_API_KEY only with consent.
import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

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
    .select('voice_clone_consent, elevenlabs_voice_id')
    .eq('user_id', user.id)
    .maybeSingle();

  if (!data?.voice_clone_consent) return NextResponse.json({ key: null });

  return NextResponse.json({ key: apiKey, voice_id: data.elevenlabs_voice_id || null });
}
