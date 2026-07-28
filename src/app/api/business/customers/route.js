// src/app/api/business/customers/route.js
// Server-side customer writes (was client-direct). RBAC via the 'ledger' resource
// (customers are khata/ledger parties; a documented resource that grants owners).
// Cross-tenant id guard; workspace_id forced from context.
export const dynamic = 'force-dynamic';
import { requireBizPermission } from '@/lib/biz-rbac';
import { createWriteClient } from '@/lib/supabase-bearer';

export async function GET(req) {
  try {
    const ctx = await requireBizPermission(req, 'ledger', 'view');
    if (ctx.error) return ctx.error;
    const db = createWriteClient();
    const { data } = await db
      .from('business_customers').select('*')
      .eq('workspace_id', ctx.workspace.id)
      .order('name');
    return Response.json({ data: data || [] });
  } catch (e) {
    console.error('[CUSTOMERS GET]', e.message);
    return Response.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const ctx = await requireBizPermission(req, 'ledger', 'edit');
    if (ctx.error) return ctx.error;
    const db = createWriteClient();
    const body = await req.json();

    if (body.id) {
      const { data: existing } = await db
        .from('business_customers').select('workspace_id').eq('id', body.id).maybeSingle();
      if (existing && existing.workspace_id !== ctx.workspace.id) {
        return Response.json({ error: 'Forbidden' }, { status: 403 });
      }
    }

    const { workspace_id: _ignore, ...safe } = body;
    const payload = { ...safe, workspace_id: ctx.workspace.id };

    const { data, error } = await db.from('business_customers').upsert(payload).select().single();
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ data });
  } catch (e) {
    console.error('[CUSTOMERS POST]', e.message);
    return Response.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function DELETE(req) {
  try {
    const ctx = await requireBizPermission(req, 'ledger', 'delete');
    if (ctx.error) return ctx.error;
    const id = new URL(req.url).searchParams.get('id');
    if (!id) return Response.json({ error: 'id required' }, { status: 400 });

    const db = createWriteClient();
    const { data: existing } = await db
      .from('business_customers').select('workspace_id').eq('id', id).maybeSingle();
    if (!existing) return Response.json({ ok: true });
    if (existing.workspace_id !== ctx.workspace.id) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { error } = await db.from('business_customers').delete().eq('id', id);
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ ok: true });
  } catch (e) {
    console.error('[CUSTOMERS DELETE]', e.message);
    return Response.json({ error: 'Internal error' }, { status: 500 });
  }
}
