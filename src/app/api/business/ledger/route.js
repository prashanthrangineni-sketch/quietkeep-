// src/app/api/business/ledger/route.js  — RBAC-upgraded version
// Change from original: 3 lines added per handler (requireBizPermission call).
// All existing logic preserved exactly.

export const dynamic = 'force-dynamic';
import { requireBizPermission } from '@/lib/biz-rbac';
import { createClient } from '@supabase/supabase-js';

function authSB(token) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );
}

export async function GET(req) {
  try {
    // RBAC: must have ledger.view
    const ctx = await requireBizPermission(req, 'ledger', 'view');
    if (ctx.error) return ctx.error;

    const { user, workspace, token } = ctx;
    const sb = authSB(token);

    let q = sb.from('business_ledger').select('*').eq('workspace_id', workspace.id);
    const { data } = await q.order('created_at', { ascending: false }).limit(200);
    return Response.json({ data: data || [] });
  } catch (e) {
    console.error('[LEDGER GET]', e.message);
    return Response.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    // RBAC: must have ledger.create
    const ctx = await requireBizPermission(req, 'ledger', 'create');
    if (ctx.error) return ctx.error;

    const { workspace, token } = ctx;
    const sb = authSB(token);

    const body = await req.json();
    const payload = { ...body, workspace_id: workspace.id };
    const { data, error } = await sb.from('business_ledger').upsert(payload).select().single();
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ data });
  } catch (e) {
    console.error('[LEDGER POST]', e.message);
    return Response.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function DELETE(req) {
  try {
    // RBAC: must have ledger.delete (only owner + manager — see permission matrix)
    const ctx = await requireBizPermission(req, 'ledger', 'delete');
    if (ctx.error) return ctx.error;

    const { workspace, token } = ctx;
    const sb = authSB(token);

    const { id } = await req.json();
    const { error } = await sb.from('business_ledger')
      .delete()
      .eq('id', id)
      .eq('workspace_id', workspace.id);  // scoped to workspace — safety

    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ success: true });
  } catch (e) {
    console.error('[LEDGER DELETE]', e.message);
    return Response.json({ error: 'Internal error' }, { status: 500 });
  }
}
