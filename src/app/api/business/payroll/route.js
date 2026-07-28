// src/app/api/business/payroll/route.js
// RBAC-hardened: requireBizPermission gates access (owner or permitted member,
// fail-closed). Cross-tenant guard: a client-supplied id must belong to the
// caller's workspace; workspace_id is always forced from the resolved context,
// never trusted from the body.

export const dynamic = 'force-dynamic';
import { requireBizPermission } from '@/lib/biz-rbac';
import { createWriteClient } from '@/lib/supabase-bearer';

export async function GET(req) {
  try {
    const ctx = await requireBizPermission(req, 'payroll', 'view');
    if (ctx.error) return ctx.error;

    const db = createWriteClient();
    const { data } = await db
      .from('payroll_records').select('*')
      .eq('workspace_id', ctx.workspace.id)
      .order('created_at', { ascending: false }).limit(200);

    return Response.json({ data: data || [] });
  } catch (e) {
    console.error('[PAYROLL GET]', e.message);
    return Response.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const ctx = await requireBizPermission(req, 'payroll', 'edit');
    if (ctx.error) return ctx.error;

    const db = createWriteClient();
    const body = await req.json();

    // Cross-tenant guard: an id, if supplied, must belong to this workspace.
    if (body.id) {
      const { data: existing } = await db
        .from('payroll_records').select('workspace_id').eq('id', body.id).maybeSingle();
      if (existing && existing.workspace_id !== ctx.workspace.id) {
        return Response.json({ error: 'Forbidden' }, { status: 403 });
      }
    }

    // Never trust a body-supplied workspace_id.
    const { workspace_id: _ignore, ...safe } = body;
    const payload = { ...safe, workspace_id: ctx.workspace.id };

    const { data, error } = await db.from('payroll_records').upsert(payload).select().single();
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ data });
  } catch (e) {
    console.error('[PAYROLL POST]', e.message);
    return Response.json({ error: 'Internal error' }, { status: 500 });
  }
}
