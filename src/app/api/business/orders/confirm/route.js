// src/app/api/business/orders/confirm/route.js
// ─────────────────────────────────────────────────────────────────────────────
// Shop order confirmation route.
//
// When a customer pays via UPI at /s/[shop] and taps "I have paid", the order
// is stored as 'paid - awaiting shop confirmation'.
//
// Stock is decremented ONLY when this confirmation route is called:
// - One tap in the shopkeeper dashboard/counter, OR
// - Automatically when matching UPI payment is received.
// ─────────────────────────────────────────────────────────────────────────────

export const dynamic = 'force-dynamic';
import { requireBizPermission } from '@/lib/biz-rbac';
import { createWriteClient } from '@/lib/supabase-bearer';
import { decrementStockForSale } from '@/lib/inventory-stock';

export async function POST(req) {
  try {
    const ctx = await requireBizPermission(req, 'billing', 'edit');
    if (ctx.error) return ctx.error;

    const body = await req.json().catch(() => ({}));
    const { sale_id, client_sale_id } = body;

    if (!sale_id && !client_sale_id) {
      return Response.json({ error: 'Missing sale_id or client_sale_id' }, { status: 400 });
    }

    const db = createWriteClient();

    // Query the sale record
    let query = db
      .from('business_sales')
      .select('*')
      .eq('workspace_id', ctx.workspace.id);

    if (sale_id) {
      query = query.eq('id', sale_id);
    } else {
      query = query.eq('client_sale_id', client_sale_id);
    }

    const { data: sale, error: findErr } = await query.maybeSingle();

    if (findErr) {
      console.error('[ORDERS CONFIRM] Query error:', findErr.message);
      return Response.json({ error: 'Failed to find order' }, { status: 500 });
    }

    if (!sale) {
      return Response.json({ error: 'Order not found in this workspace' }, { status: 404 });
    }

    // Idempotency: If already confirmed, do not lower stock a second time
    if (sale.status === 'completed' || sale.status === 'confirmed') {
      return Response.json({
        ok: true,
        already_confirmed: true,
        status: sale.status,
        sale_id: sale.id,
      });
    }

    // 1. Lower inventory stock for each sold line item
    const lineItems = Array.isArray(sale.items) ? sale.items : [];
    const stockResult = await decrementStockForSale(db, ctx.workspace.id, lineItems, {
      referenceId: sale.id,
      reason: 'shop_upi_sale',
      paymentMode: 'upi',
    });

    // 2. Update sale record status to completed
    const updatedMetadata = {
      ...(typeof sale.metadata === 'object' && sale.metadata !== null ? sale.metadata : {}),
      confirmed_at: new Date().toISOString(),
      confirmed_by: ctx.user.id,
      stock_lowered: true,
      stock_updated_count: stockResult.updated,
    };

    const { data: updatedSale, error: updateErr } = await db
      .from('business_sales')
      .update({
        status: 'completed',
        metadata: updatedMetadata,
      })
      .eq('id', sale.id)
      .select()
      .single();

    if (updateErr) {
      console.error('[ORDERS CONFIRM] Update error:', updateErr.message);
      return Response.json({ error: 'Failed to update order status' }, { status: 500 });
    }

    return Response.json({
      ok: true,
      status: 'completed',
      stock_lowered: true,
      updated_items: stockResult.updated,
      missed_items: stockResult.missed,
      sale: updatedSale,
    });
  } catch (err) {
    console.error('[ORDERS CONFIRM] Error:', err.message);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
