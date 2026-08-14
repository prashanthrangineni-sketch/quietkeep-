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

    // BUG FOUND 13 Aug 2026 — the orphan factory.
    //   Stripping user_id and invite_token is right: neither may be settable by
    //   a client. But the result was a row with no identity AND no way to ever
    //   gain one, saved as status:'active'. Every membership query filters on
    //   user_id, so the person the row describes could never match it.
    //   Production held 9 such rows; 8 were unclaimable.
    //
    //   The row still must not carry a user_id from the client. What it can
    //   carry is a token only the server minted, which the invitee redeems at
    //   /b/join. Creates only — an edit must never rotate a live token.
    const isCreate = !body.id;
    if (isCreate) {
      payload.invite_token = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
      payload.invited_at = new Date().toISOString();
      // 'active' with no user behind it is a lie the rest of the app believes.
      payload.status = 'invited';
    }

    const { data, error } = await db.from('business_members').upsert(payload).select().single();
    if (error) return Response.json({ error: error.message }, { status: 500 });

    // The owner needs something to send. Without this the token exists but is
    // invisible, which is how the invite page ended up unreachable in practice.
    const origin = new URL(req.url).origin;
    return Response.json({
      data,
      ...(isCreate && data?.invite_token
        ? { invite_url: `${origin}/b/join?token=${data.invite_token}` }
        : {}),
    });
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
