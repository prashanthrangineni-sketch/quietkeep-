// src/app/api/business/team/invite/route.js
// ─────────────────────────────────────────────────────────────────────────────
// Staff invite (owner / team-edit permission). Creates a business_members row in
// `invited` state with a single-use invite_token and returns a join URL. The new
// user redeems it at /b/join → /api/business/team/accept-invite, which binds the
// row to their auth user. This is what turns "HR records" into real app users so
// attendance / chat / tasks / field check-in stop being owner-proxy.
//
// Env: SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_APP_URL (optional).
// ─────────────────────────────────────────────────────────────────────────────
export const dynamic = 'force-dynamic';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { requireBizPermission } from '@/lib/biz-rbac';

function svc() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export async function POST(req) {
  try {
    // Fail-closed RBAC: caller must have team.edit in their workspace.
    const ctx = await requireBizPermission(req, 'team', 'edit');
    if (ctx.error) return ctx.error;
    const { workspace } = ctx;

    let body;
    try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
    if (!body.name && !body.phone && !body.email) {
      return NextResponse.json({ error: 'name, phone or email required' }, { status: 400 });
    }

    const db = svc();
    const inviteToken = crypto.randomBytes(24).toString('hex');

    const { data, error } = await db.from('business_members').insert({
      workspace_id: workspace.id,
      name: body.name || null,
      phone: body.phone || null,
      email: body.email ? String(body.email).trim().toLowerCase() : null,
      access_role: body.access_role || 'staff',
      permissions: body.permissions || null,
      status: 'invited',
      invite_token: inviteToken,
      invited_at: new Date().toISOString(),
    }).select().single();

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    const base = process.env.NEXT_PUBLIC_APP_URL || 'https://quietkeep.com';
    return NextResponse.json({
      member_id: data.id,
      invite_token: inviteToken,
      invite_url: `${base}/b/join?token=${inviteToken}`,
    });
  } catch (e) {
    console.error('[team-invite]', e.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
