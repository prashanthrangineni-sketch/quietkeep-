// src/app/api/business/inventory/route.js
// ─────────────────────────────────────────────────────────────────────────────
// Server-side inventory writes (was client-direct from the page). RBAC-gated via
// requireBizPermission('inventory', …); cross-tenant guard on any supplied id;
// workspace_id always forced from the resolved context, never from the body.
// ─────────────────────────────────────────────────────────────────────────────
export const dynamic = 'force-dynamic';
import { requireBizPermission } from '@/lib/biz-rbac';
import { createWriteClient } from '@/lib/supabase-bearer';

export async function GET(req) {
  try {
    const ctx = await requireBizPermission(req, 'inventory', 'view');
    if (ctx.error) return ctx.error;

    const db = createWriteClient();
    const { data } = await db
      .from('inventory_items').select('*')
      .eq('workspace_id', ctx.workspace.id)
      .order('name');

    return Response.json({ data: data || [] });
  } catch (e) {
    console.error('[INVENTORY GET]', e.message);
    return Response.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const ctx = await requireBizPermission(req, 'inventory', 'edit');
    if (ctx.error) return ctx.error;

    const db = createWriteClient();
    const body = await req.json();

    // Cross-tenant guard: an id, if supplied, must belong to this workspace.
    if (body.id) {
      const { data: existing } = await db
        .from('inventory_items').select('workspace_id').eq('id', body.id).maybeSingle();
      if (existing && existing.workspace_id !== ctx.workspace.id) {
        return Response.json({ error: 'Forbidden' }, { status: 403 });
      }
    }

    const { workspace_id: _ignore, ...safe } = body;
    const payload = { ...safe, workspace_id: ctx.workspace.id };

    const { data, error } = await db.from('inventory_items').upsert(payload).select().single();
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ data });
  } catch (e) {
    console.error('[INVENTORY POST]', e.message);
    return Response.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function DELETE(req) {
  try {
    const ctx = await requireBizPermission(req, 'inventory', 'delete');
    if (ctx.error) return ctx.error;

    const id = new URL(req.url).searchParams.get('id');
    if (!id) return Response.json({ error: 'id required' }, { status: 400 });

    const db = createWriteClient();
    const { data: existing } = await db
      .from('inventory_items').select('workspace_id').eq('id', id).maybeSingle();
    if (!existing) return Response.json({ ok: true }); // already gone
    if (existing.workspace_id !== ctx.workspace.id) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { error } = await db.from('inventory_items').delete().eq('id', id);
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ ok: true });
  } catch (e) {
    console.error('[INVENTORY DELETE]', e.message);
    return Response.json({ error: 'Internal error' }, { status: 500 });
  }
}
