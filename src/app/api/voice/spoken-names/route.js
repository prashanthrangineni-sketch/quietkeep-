// src/app/api/voice/spoken-names/route.js
// GET → { names: [...] } - the names this signed-in user says, for the
// recogniser's boost list.
//
// WHY
// The phone now hears the person through the engine's listening socket
// (src/lib/listen-stream.js). The socket goes straight from the phone to the
// engine, so the server-side step that adds names in /api/voice/stt never runs
// for it. The phone asks here once, keeps the list for a few minutes, and
// sends it in its "start" message.
//
// Same identity rule as /api/voice/stt: who you are comes from your own sign-in
// token; the read is scoped to that user id. No token, or any error, returns
// an empty list - and an empty list means the recogniser is asked exactly as it
// was before names existed. Names only; nothing else about the contacts.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { recentSpokenNames } from '@/lib/spoken-names';

export const dynamic = 'force-dynamic';

export async function GET(req) {
  const empty = NextResponse.json({ names: [] }, { headers: { 'Cache-Control': 'no-store' } });
  try {
    const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
    if (!token) return empty;
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !anonKey || !serviceKey) return empty;

    const anon = createClient(url, anonKey, { global: { headers: { Authorization: `Bearer ${token}` } } });
    const { data: { user } = {}, error } = await anon.auth.getUser();
    if (error || !user?.id) return empty;

    const service = createClient(url, serviceKey);
    const names = await recentSpokenNames(service, user.id);
    return NextResponse.json({ names: Array.isArray(names) ? names : [] },
      { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return empty;
  }
}
