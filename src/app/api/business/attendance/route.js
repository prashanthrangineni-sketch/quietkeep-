// src/app/api/business/attendance/route.js
// RBAC-hardened: requireBizPermission (mapped to the 'team' resource) gates
// access — owner or permitted member, fail-closed. This is what lets staff mark
// their own attendance instead of the owner proxying everyone. Cross-tenant
// guard: a client-supplied id must belong to the caller's workspace; workspace_id
// is always forced from context.

export const dynamic = 'force-dynamic';
import { requireBizPermission } from '@/lib/biz-rbac';
import { createWriteClient } from '@/lib/supabase-bearer';

export async function GET(req) {
  try {
    const ctx = await requireBizPermission(req, 'team', 'view');
    if (ctx.error) return ctx.error;

    const db = createWriteClient();
    const { data } = await db
      .from('attendance_logs').select('*')
      .eq('workspace_id', ctx.workspace.id)
      .order('created_at', { ascending: false }).limit(200);

    return Response.json({ data: data || [] });
  } catch (e) {
    console.error('[ATTENDANCE GET]', e.message);
    return Response.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const ctx = await requireBizPermission(req, 'team', 'edit');
    if (ctx.error) return ctx.error;

    const db = createWriteClient();
    const body = await req.json();

    // Cross-tenant guard: an id, if supplied, must belong to this workspace.
    if (body.id) {
      const { data: existing } = await db
        .from('attendance_logs').select('workspace_id').eq('id', body.id).maybeSingle();
      if (existing && existing.workspace_id !== ctx.workspace.id) {
        return Response.json({ error: 'Forbidden' }, { status: 403 });
      }
    }

    const { workspace_id: _ignore, ...safe } = body;
    const payload = { ...safe, workspace_id: ctx.workspace.id };

    const { data, error } = await db.from('attendance_logs').upsert(payload).select().single();
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ data });
  } catch (e) {
    console.error('[ATTENDANCE POST]', e.message);
    return Response.json({ error: 'Internal error' }, { status: 500 });
  }
}
