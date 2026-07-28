// src/app/api/business/compliance/route.js
// Server-side compliance writes (was client-direct). RBAC via 'reports' resource.
// Handles single upsert (+ cross-tenant id guard) and the owner default-calendar
// bulk seed. workspace_id always forced from context.
export const dynamic = 'force-dynamic';
import { requireBizPermission } from '@/lib/biz-rbac';
import { createWriteClient } from '@/lib/supabase-bearer';

export async function GET(req) {
  try {
    const ctx = await requireBizPermission(req, 'reports', 'view');
    if (ctx.error) return ctx.error;
    const db = createWriteClient();
    const { data } = await db
      .from('compliance_reminders').select('*')
      .eq('workspace_id', ctx.workspace.id)
      .order('due_date', { ascending: true });
    return Response.json({ data: data || [] });
  } catch (e) {
    console.error('[COMPLIANCE GET]', e.message);
    return Response.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const ctx = await requireBizPermission(req, 'reports', 'edit');
    if (ctx.error) return ctx.error;
    const db = createWriteClient();
    const body = await req.json();

    // Bulk seed of the default compliance calendar.
    if (body.seed && Array.isArray(body.items)) {
      const rows = body.items.map(({ workspace_id, ...r }) => ({ ...r, workspace_id: ctx.workspace.id }));
      const { error } = await db.from('compliance_reminders')
        .upsert(rows, { onConflict: 'workspace_id,type,due_date', ignoreDuplicates: true });
      if (error) return Response.json({ error: error.message }, { status: 500 });
      return Response.json({ ok: true, seeded: rows.length });
    }

    // Single upsert.
    if (body.id) {
      const { data: existing } = await db
        .from('compliance_reminders').select('workspace_id').eq('id', body.id).maybeSingle();
      if (existing && existing.workspace_id !== ctx.workspace.id) {
        return Response.json({ error: 'Forbidden' }, { status: 403 });
      }
    }
    const { workspace_id: _ignore, ...safe } = body;
    const payload = { ...safe, workspace_id: ctx.workspace.id };
    const { data, error } = await db.from('compliance_reminders').upsert(payload).select().single();
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ data });
  } catch (e) {
    console.error('[COMPLIANCE POST]', e.message);
    return Response.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function DELETE(req) {
  try {
    const ctx = await requireBizPermission(req, 'reports', 'delete');
    if (ctx.error) return ctx.error;
    const id = new URL(req.url).searchParams.get('id');
    if (!id) return Response.json({ error: 'id required' }, { status: 400 });
    const db = createWriteClient();
    const { data: existing } = await db
      .from('compliance_reminders').select('workspace_id').eq('id', id).maybeSingle();
    if (!existing) return Response.json({ ok: true });
    if (existing.workspace_id !== ctx.workspace.id) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }
    const { error } = await db.from('compliance_reminders').delete().eq('id', id);
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ ok: true });
  } catch (e) {
    console.error('[COMPLIANCE DELETE]', e.message);
    return Response.json({ error: 'Internal error' }, { status: 500 });
  }
}
