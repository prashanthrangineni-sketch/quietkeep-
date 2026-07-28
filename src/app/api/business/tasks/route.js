// src/app/api/business/tasks/route.js
// Server-side task writes (was client-direct). RBAC via 'team'. Cross-tenant id
// guard; assignee must belong to this workspace; workspace_id forced.
export const dynamic = 'force-dynamic';
import { requireBizPermission } from '@/lib/biz-rbac';
import { createWriteClient } from '@/lib/supabase-bearer';

export async function GET(req) {
  try {
    const ctx = await requireBizPermission(req, 'team', 'view');
    if (ctx.error) return ctx.error;
    const db = createWriteClient();
    const { data } = await db
      .from('business_tasks').select('*, business_members(name)')
      .eq('workspace_id', ctx.workspace.id)
      .order('created_at', { ascending: false }).limit(50);
    return Response.json({ data: data || [] });
  } catch (e) {
    console.error('[TASKS GET]', e.message);
    return Response.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const ctx = await requireBizPermission(req, 'team', 'edit');
    if (ctx.error) return ctx.error;
    const db = createWriteClient();
    const body = await req.json();

    if (body.id) {
      const { data: existing } = await db
        .from('business_tasks').select('workspace_id').eq('id', body.id).maybeSingle();
      if (existing && existing.workspace_id !== ctx.workspace.id) {
        return Response.json({ error: 'Forbidden' }, { status: 403 });
      }
    }
    if (body.assignee_id) {
      const { data: m } = await db
        .from('business_members').select('workspace_id').eq('id', body.assignee_id).maybeSingle();
      if (m && m.workspace_id !== ctx.workspace.id) {
        return Response.json({ error: 'Invalid assignee' }, { status: 400 });
      }
    }

    const { workspace_id: _ignore, ...safe } = body;
    const payload = { ...safe, workspace_id: ctx.workspace.id };
    const { data, error } = await db.from('business_tasks').upsert(payload).select().single();
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ data });
  } catch (e) {
    console.error('[TASKS POST]', e.message);
    return Response.json({ error: 'Internal error' }, { status: 500 });
  }
}
