// src/app/api/business/team/accept-invite/route.js
// ─────────────────────────────────────────────────────────────────────────────
// Redeem a staff invite. The (already signed-in) invitee POSTs the token; we bind
// the invited business_members row to their auth user and flip it to `active`.
// The invite_token is single-use (cleared on redemption).
//
// Auth: Bearer (the invitee's session). Env: SUPABASE_SERVICE_ROLE_KEY.
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

export async function POST(req) {
  try {
    const bearer = req.headers.get('Authorization')?.replace('Bearer ', '').trim();
    if (!bearer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { data: { user } } = await authSB(bearer).auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    let body;
    try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
    const invite = String(body.token || '').trim();
    if (!invite) return NextResponse.json({ error: 'token required' }, { status: 400 });

    const db = svc();
    const { data: member } = await db.from('business_members')
      .select('id,workspace_id,status,user_id,email')
      .eq('invite_token', invite)
      .maybeSingle();

    if (!member) return NextResponse.json({ error: 'Invalid or expired invite' }, { status: 404 });
    if (member.user_id) return NextResponse.json({ error: 'Invite already used' }, { status: 409 });

    // Optional soft check: if the invite named an email, it should match.
    if (member.email && user.email && member.email.toLowerCase() !== user.email.toLowerCase()) {
      return NextResponse.json({ error: 'This invite was issued for a different email.' }, { status: 403 });
    }

    const { error } = await db.from('business_members').update({
      user_id: user.id,
      status: 'active',
      invite_token: null,
      updated_at: new Date().toISOString(),
    }).eq('id', member.id);

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true, workspace_id: member.workspace_id });
  } catch (e) {
    console.error('[accept-invite]', e.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
