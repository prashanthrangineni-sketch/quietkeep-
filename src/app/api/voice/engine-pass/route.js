// src/app/api/voice/engine-pass/route.js
// GET -> { pass, expires_at } for the phone's live listening socket.
//
// The socket goes straight from the phone to the Aaria engine, and a browser
// cannot put a server secret on it. So a SIGNED-IN phone asks here and gets a
// pass that expires in 10 minutes - never the key itself
// (src/lib/aaria-pass.js). Same identity rule as /api/voice/spoken-names:
// who you are comes from your own sign-in token. No token, no key configured,
// or any error -> { pass: null }, and the socket opens exactly as before.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { makeEnginePass } from '@/lib/aaria-pass';

export const dynamic = 'force-dynamic';

const PHONE_PASS_LIFETIME_S = 10 * 60;

export async function GET(req) {
  const none = NextResponse.json({ pass: null }, { headers: { 'Cache-Control': 'no-store' } });
  try {
    const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
    if (!token) return none;
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anonKey) return none;
    const anon = createClient(url, anonKey, { global: { headers: { Authorization: `Bearer ${token}` } } });
    const { data: { user } = {}, error } = await anon.auth.getUser();
    if (error || !user?.id) return none;

    const p = makeEnginePass({ lifetimeS: PHONE_PASS_LIFETIME_S });
    if (!p) return none;
    return NextResponse.json({ pass: p.pass, expires_at: p.expiresAt },
      { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return none;
  }
}
