// src/app/api/business/geo/route.js
// Server-side field geo check-in writes (was client-direct). RBAC via 'team'.
// Forces workspace_id and verifies the member belongs to this workspace.
export const dynamic = 'force-dynamic';
import { requireBizPermission } from '@/lib/biz-rbac';
import { createWriteClient } from '@/lib/supabase-bearer';

export async function GET(req) {
  try {
    const ctx = await requireBizPermission(req, 'team', 'view');
    if (ctx.error) return ctx.error;
    const db = createWriteClient();
    const { data } = await db
      .from('geo_checkins').select('*,business_members(name)')
      .eq('workspace_id', ctx.workspace.id)
      .order('checkin_at', { ascending: false }).limit(50);
    return Response.json({ data: data || [] });
  } catch (e) {
    console.error('[GEO GET]', e.message);
    return Response.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const ctx = await requireBizPermission(req, 'team', 'edit');
    if (ctx.error) return ctx.error;
    const db = createWriteClient();
    const body = await req.json();

    // Never trust client id/workspace_id on a check-in.
    const { workspace_id: _w, id: _id, ...safe } = body;

    // The member being checked in must belong to this workspace.
    if (safe.member_id) {
      const { data: m } = await db
        .from('business_members').select('workspace_id').eq('id', safe.member_id).maybeSingle();
      if (!m || m.workspace_id !== ctx.workspace.id) {
        return Response.json({ error: 'Invalid member' }, { status: 400 });
      }
    }

    const payload = { ...safe, workspace_id: ctx.workspace.id };
    const { data, error } = await db.from('geo_checkins').insert(payload).select().single();
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ data });
  } catch (e) {
    console.error('[GEO POST]', e.message);
    return Response.json({ error: 'Internal error' }, { status: 500 });
  }
}
