// src/app/api/business/claim-membership/route.js
// ─────────────────────────────────────────────────────────────────────────────
// Attach a signed-in user to staff rows their employer already created for them.
//
// WHY THIS EXISTS
//   /b/team's "Add member" writes a row with name, phone and role but no
//   user_id and no invite_token -- the API that serves it strips both. The row
//   lands as status='active', user_id=NULL, which is a contradiction: every
//   membership lookup filters on user_id, so the person it describes can never
//   match it. On 13 Aug 2026 production held 9 such rows and 8 were unclaimed.
//
//   Those rows cannot be rescued by the invite flow, because they have no
//   token to redeem. The only identifier they carry is the phone or email the
//   owner typed. So we match on that -- once, at sign-in.
//
// WHY THIS IS SAFE
//   We only ever match against identifiers Supabase itself has verified:
//     - user.phone  is set only after an SMS OTP round-trip
//     - user.email  is set only after a magic link or an OAuth provider
//   A caller cannot assert either one; they prove them by signing in. And we
//   only touch rows where user_id IS NULL, so a claimed row can never be taken
//   over by someone else.
//
//   The residual risk is a typo: if the owner mistypes a digit, the person who
//   actually owns that number could claim the row. That is inherent to any
//   phone-addressed invite and is the same exposure the SMS invite link has.
//
// PHONE MATCHING
//   Supabase stores E.164 without '+' ("919876543210"). Owners type whatever
//   they like -- "9876543210", "+91 98765 43210", "098765 43210". Comparing
//   the last 10 digits of each is the only thing that reliably matches, so we
//   compare on a normalised suffix rather than on the stored strings.
//
// Auth: Bearer (the caller's own session). Env: SUPABASE_SERVICE_ROLE_KEY.
//   The service role is required: RLS deliberately hides an unclaimed row from
//   the very person who is about to claim it -- they are not a member yet.
// ─────────────────────────────────────────────────────────────────────────────
export const dynamic = 'force-dynamic';
import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

function authSB(token) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );
}
function svc() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

/** Last 10 digits, or null. "+91 98765 43210" and "919876543210" both -> "9876543210". */
function last10(v) {
  const digits = String(v || '').replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : null;
}

export async function POST(req) {
  try {
    const bearer = req.headers.get('Authorization')?.replace('Bearer ', '').trim();
    if (!bearer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: { user } } = await authSB(bearer).auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const myPhone = last10(user.phone);
    const myEmail = (user.email || '').trim().toLowerCase() || null;

    // Nothing verified to match on -- not an error, just nothing to do.
    if (!myPhone && !myEmail) {
      return NextResponse.json({ ok: true, claimed: 0, reason: 'no verified phone or email' });
    }

    const db = svc();

    // Unclaimed rows only. Phone is compared in JS because the stored format
    // is whatever the owner typed and Postgres cannot index a suffix match
    // here without a generated column; the unclaimed set is tiny by nature.
    const { data: candidates, error: readErr } = await db
      .from('business_members')
      .select('id,workspace_id,phone,email,name,status')
      .is('user_id', null)
      .limit(500);

    if (readErr) return NextResponse.json({ error: readErr.message }, { status: 400 });

    const mine = (candidates || []).filter(m => {
      const byPhone = myPhone && last10(m.phone) === myPhone;
      const byEmail = myEmail && (m.email || '').trim().toLowerCase() === myEmail;
      return byPhone || byEmail;
    });

    if (!mine.length) return NextResponse.json({ ok: true, claimed: 0 });

    // One workspace per person in practice, but claim every match rather than
    // guessing which is "the" one -- a person can legitimately be staff at two
    // businesses run from this app.
    const ids = mine.map(m => m.id);
    const { error: updErr } = await db
      .from('business_members')
      .update({
        user_id: user.id,
        status: 'active',
        invite_token: null,
        updated_at: new Date().toISOString(),
      })
      .in('id', ids)
      .is('user_id', null); // re-checked at write time, so a race cannot double-claim

    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 400 });

    console.log('[claim-membership] claimed', ids.length, 'row(s) for user', user.id);

    return NextResponse.json({
      ok: true,
      claimed: ids.length,
      workspace_ids: [...new Set(mine.map(m => m.workspace_id))],
    });
  } catch (e) {
    console.error('[claim-membership]', e.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
