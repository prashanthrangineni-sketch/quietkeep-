// src/app/api/business/counter/undo/route.js
// ─────────────────────────────────────────────────────────────────────────────
// 10-second Undo API for Quick Counter sales. Reverts stock movements.
// ─────────────────────────────────────────────────────────────────────────────
export const dynamic = 'force-dynamic';
import { requireBizPermission } from '@/lib/biz-rbac';
import { createWriteClient } from '@/lib/supabase-bearer';
import { undoCounterSale } from '@/lib/inventory-stock';

export async function POST(req) {
  try {
    const ctx = await requireBizPermission(req, 'billing', 'edit');
    if (ctx.error) return ctx.error;

    const db = createWriteClient();
    const body = await req.json();
    const saleId = body.sale_id || body.id;

    if (!saleId) {
      return Response.json({ error: 'sale_id is required' }, { status: 400 });
    }

    const result = await undoCounterSale(db, ctx.workspace.id, saleId);
    if (!result.ok) {
      return Response.json({ error: result.error || 'Failed to undo sale' }, { status: 400 });
    }

    return Response.json(result);
  } catch (e) {
    console.error('[COUNTER UNDO POST]', e.message);
    return Response.json({ error: 'Internal error' }, { status: 500 });
  }
}
