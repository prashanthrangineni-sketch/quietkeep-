// src/app/api/business/counter/unmatched-payments/route.js
// ─────────────────────────────────────────────────────────────────────────────
// UPI payments received with no items: list pending cards and resolve by
// picking items (which lowers stock) or skipping.
// ─────────────────────────────────────────────────────────────────────────────
export const dynamic = 'force-dynamic';
import { requireBizPermission } from '@/lib/biz-rbac';
import { createWriteClient } from '@/lib/supabase-bearer';
import { decrementStockForSale } from '@/lib/inventory-stock';

export async function GET(req) {
  try {
    const ctx = await requireBizPermission(req, 'billing', 'view');
    if (ctx.error) return ctx.error;

    const db = createWriteClient();
    const { data: cards } = await db
      .from('business_approvals')
      .select('*')
      .eq('workspace_id', ctx.workspace.id)
      .eq('action_type', 'upi_unmatched_payment')
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    return Response.json({
      ok: true,
      cards: cards || [],
    });
  } catch (e) {
    console.error('[UNMATCHED PAYMENTS GET]', e.message);
    return Response.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const ctx = await requireBizPermission(req, 'billing', 'edit');
    if (ctx.error) return ctx.error;

    const db = createWriteClient();
    const body = await req.json();
    const { approval_id, action = 'pick_items', items = [] } = body;

    if (!approval_id) {
      return Response.json({ error: 'approval_id required' }, { status: 400 });
    }

    const { data: card } = await db
      .from('business_approvals')
      .select('*')
      .eq('id', approval_id)
      .eq('workspace_id', ctx.workspace.id)
      .maybeSingle();

    if (!card) {
      return Response.json({ error: 'Card not found' }, { status: 404 });
    }

    const nowIso = new Date().toISOString();

    if (action === 'skip' || action === 'dismiss') {
      await db.from('business_approvals')
        .update({ status: 'rejected', approved_at: nowIso })
        .eq('id', approval_id);
      return Response.json({ ok: true, status: 'skipped' });
    }

    // Owner picked items: lower stock and complete
    if (Array.isArray(items) && items.length > 0) {
      await decrementStockForSale(db, ctx.workspace.id, items, {
        referenceId: approval_id,
        reason: 'upi_unmatched_sale',
        paymentMode: 'upi',
      });
    }

    await db.from('business_approvals')
      .update({
        status: 'approved',
        approved_at: nowIso,
        payload: { ...card.payload, selected_items: items, resolved: true },
      })
      .eq('id', approval_id);

    return Response.json({ ok: true, status: 'resolved', items });
  } catch (e) {
    console.error('[UNMATCHED PAYMENTS POST]', e.message);
    return Response.json({ error: 'Internal error' }, { status: 500 });
  }
}
