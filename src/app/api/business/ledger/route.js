// src/app/api/business/ledger/route.js
// SPRINT 1 FIX: Service role for all writes (upsert + delete).
// RBAC via requireBizPermission preserved exactly — it validates identity and role.
// authSB inline factory removed; writes now use createWriteClient.
//
// BEFORE: authSB(token) anon Bearer for ledger.upsert and ledger.delete.
//         auth.uid()=NULL in RLS -> all ledger entries silently failed to persist.
//         RBAC check passed (requireBizPermission uses its own resolution),
//         but the actual write after the check always failed.
//
// AFTER: Identity + RBAC from requireBizPermission (unchanged).
//        Writes via createWriteClient (service role). workspace_id always explicit.

export const dynamic = 'force-dynamic';
import { requireBizPermission } from '@/lib/biz-rbac';
import { createWriteClient } from '@/lib/supabase-bearer';

export async function GET(req) {
  try {
    const ctx = await requireBizPermission(req, 'ledger', 'view');
    if (ctx.error) return ctx.error;

    const { supabase, workspace } = ctx;
    // READ via the context's own supabase client (already anon Bearer — SELECT is safe).
    const { data } = await supabase
      .from('business_ledger').select('*')
      .eq('workspace_id', workspace.id)
      .order('created_at', { ascending: false }).limit(200);

    return Response.json({ data: data || [] });
  } catch (e) {
    console.error('[LEDGER GET]', e.message);
    return Response.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const ctx = await requireBizPermission(req, 'ledger', 'create');
    if (ctx.error) return ctx.error;

    const { workspace } = ctx;
    const body = await req.json();
    const payload = { ...body, workspace_id: workspace.id };

    const db = createWriteClient();
    const { data, error } = await db.from('business_ledger').upsert(payload).select().single();
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ data });
  } catch (e) {
    console.error('[LEDGER POST]', e.message);
    return Response.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function DELETE(req) {
  try {
    const ctx = await requireBizPermission(req, 'ledger', 'delete');
    if (ctx.error) return ctx.error;

    const { workspace } = ctx;
    const { id } = await req.json();

    const db = createWriteClient();
    const { error } = await db.from('business_ledger')
      .delete()
      .eq('id', id)
      .eq('workspace_id', workspace.id); // always scope to workspace

    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ success: true });
  } catch (e) {
    console.error('[LEDGER DELETE]', e.message);
    return Response.json({ error: 'Internal error' }, { status: 500 });
  }
}
