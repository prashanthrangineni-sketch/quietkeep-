// src/app/api/business/counter/route.js
// ─────────────────────────────────────────────────────────────────────────────
// Quick Counter API: record sales, offline batch sync with idempotency,
// and load top items for the counter screen.
// ─────────────────────────────────────────────────────────────────────────────
export const dynamic = 'force-dynamic';
import { requireBizPermission } from '@/lib/biz-rbac';
import { createWriteClient } from '@/lib/supabase-bearer';
import { recordCounterSale } from '@/lib/inventory-stock';

export async function GET(req) {
  try {
    const ctx = await requireBizPermission(req, 'inventory', 'view');
    if (ctx.error) return ctx.error;

    const db = createWriteClient();

    // 1. Fetch items for counter tiles
    const { data: allItems } = await db
      .from('inventory_items')
      .select('id, name, current_stock, selling_price, unit, is_made_on_spot, recipe, is_top_item, image_url, last_sale_at')
      .eq('workspace_id', ctx.workspace.id)
      .order('is_top_item', { ascending: false })
      .order('last_sale_at', { ascending: false, nullsFirst: false })
      .order('name');

    // 2. Fetch today's sales for counter stats
    const today = new Date().toISOString().split('T')[0];
    const { data: todaySales } = await db
      .from('business_sales')
      .select('id, client_sale_id, total_amount, payment_mode, status, created_at, items')
      .eq('workspace_id', ctx.workspace.id)
      .gte('created_at', today + 'T00:00:00.000Z')
      .order('created_at', { ascending: false })
      .limit(50);

    return Response.json({
      ok: true,
      items: allItems || [],
      recent_sales: todaySales || [],
    });
  } catch (e) {
    console.error('[COUNTER GET]', e.message);
    return Response.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const ctx = await requireBizPermission(req, 'billing', 'create');
    if (ctx.error) return ctx.error;

    const db = createWriteClient();
    const body = await req.json();

    // Support single sale or batch offline sync
    const isBatch = Array.isArray(body.batch);
    const saleList = isBatch ? body.batch : [body];

    const results = [];
    for (const item of saleList) {
      const res = await recordCounterSale(db, ctx.workspace.id, {
        clientSaleId: item.client_sale_id || item.idempotency_key || null,
        items: item.items || (item.item ? [item.item] : []),
        paymentMode: item.payment_mode || 'cash',
        totalAmount: item.total_amount || item.amount || 0,
        source: item.source || 'counter',
        createdBy: ctx.user.id,
        metadata: item.metadata || {},
      });
      results.push(res);
    }

    if (isBatch) {
      return Response.json({
        ok: true,
        batch_count: results.length,
        results,
      });
    }

    return Response.json({
      ok: true,
      ...results[0],
    });
  } catch (e) {
    console.error('[COUNTER POST]', e.message);
    return Response.json({ error: 'Internal error' }, { status: 500 });
  }
}
