// src/app/api/business/team/route.js
// Server-side team-member writes (was client-direct). RBAC via 'team'.
// Strips privileged/identity fields (user_id, invite_token, access_role,
// permissions) so member records can't be used for privilege escalation — those
// are set ONLY by the invite → accept flow. Cross-tenant id guard; forced
// workspace_id.
export const dynamic = 'force-dynamic';
import { requireBizPermission } from '@/lib/biz-rbac';
import { createWriteClient } from '@/lib/supabase-bearer';

export async function POST(req) {
  try {
    const ctx = await requireBizPermission(req, 'team', 'edit');
    if (ctx.error) return ctx.error;
    const db = createWriteClient();
    const body = await req.json();

    if (body.id) {
      const { data: existing } = await db
        .from('business_members').select('workspace_id').eq('id', body.id).maybeSingle();
      if (existing && existing.workspace_id !== ctx.workspace.id) {
        return Response.json({ error: 'Forbidden' }, { status: 403 });
      }
    }

    // Privileged/identity fields are never client-settable via this route.
    const {
      workspace_id: _w, user_id: _u, invite_token: _t, invited_at: _i,
      access_role: _a, permissions: _p, ...safe
    } = body;
    const payload = { ...safe, workspace_id: ctx.workspace.id };

    const { data, error } = await db.from('business_members').upsert(payload).select().single();
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ data });
  } catch (e) {
    console.error('[TEAM POST]', e.message);
    return Response.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function DELETE(req) {
  try {
    const ctx = await requireBizPermission(req, 'team', 'delete');
    if (ctx.error) return ctx.error;
    const id = new URL(req.url).searchParams.get('id');
    if (!id) return Response.json({ error: 'id required' }, { status: 400 });

    const db = createWriteClient();
    const { data: existing } = await db
      .from('business_members').select('workspace_id').eq('id', id).maybeSingle();
    if (!existing) return Response.json({ ok: true });
    if (existing.workspace_id !== ctx.workspace.id) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { error } = await db.from('business_members').delete().eq('id', id);
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ ok: true });
  } catch (e) {
    console.error('[TEAM DELETE]', e.message);
    return Response.json({ error: 'Internal error' }, { status: 500 });
  }
}
