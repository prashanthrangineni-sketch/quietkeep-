// src/app/api/voice/forget-me/route.js
// POST -> tell the Aaria voice engine to erase what it keeps about the
// signed-in person (src/lib/aaria-forget.js).
//
// Part of deleting an account: the Delete Account flow calls this before it
// removes the person's QuietKeep data, so nothing about them is left in the
// voice engine either. Who is forgotten comes only from the caller's own
// sign-in token - never from the request body - so nobody can erase someone
// else.
//
// 200 { ok: true, erased, provider_voices_to_remove, partly }
// 401 { ok: false, reason: 'not_signed_in' }
// 502 { ok: false, reason }   the engine could not be reached or refused;
//                             the caller should retry, not report success.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { askEngineToForget } from '@/lib/aaria-forget';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };

export async function POST(req) {
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!token || !url || !anonKey) {
    return NextResponse.json({ ok: false, reason: 'not_signed_in' }, { status: 401, headers: NO_STORE });
  }
  let userId = null;
  try {
    const anon = createClient(url, anonKey, { global: { headers: { Authorization: `Bearer ${token}` } } });
    const { data: { user } = {}, error } = await anon.auth.getUser();
    if (!error && user?.id) userId = user.id;
  } catch {}
  if (!userId) {
    return NextResponse.json({ ok: false, reason: 'not_signed_in' }, { status: 401, headers: NO_STORE });
  }

  const r = await askEngineToForget(userId);
  if (!r.ok) {
    return NextResponse.json({ ok: false, reason: r.reason }, { status: 502, headers: NO_STORE });
  }
  return NextResponse.json({
    ok: true,
    partly: r.partly,
    erased: r.erased,
    provider_voices_to_remove: r.providerVoicesToRemove,
  }, { headers: NO_STORE });
}
