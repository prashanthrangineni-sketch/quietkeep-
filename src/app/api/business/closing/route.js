// src/app/api/business/closing/route.js
// ─────────────────────────────────────────────────────────────────────────────
// Daily Closing Check API (/b/closing):
// Enter physical cash in drawer & physical counts for top 10 packaged items.
// Shows gaps, logs 'adjustment' stock movements, and calculates & saves
// the shop accuracy score (0-100) on the workspace.
// ─────────────────────────────────────────────────────────────────────────────
export const dynamic = 'force-dynamic';
import { requireBizPermission } from '@/lib/biz-rbac';
import { createWriteClient } from '@/lib/supabase-bearer';
import { adjustStockForClosing } from '@/lib/inventory-stock';

export async function GET(req) {
  try {
    const ctx = await requireBizPermission(req, 'inventory', 'view');
    if (ctx.error) return ctx.error;

    const db = createWriteClient();

    // 1. Fetch top 10 packaged items (exclude made-on-the-spot items)
    const { data: topItems } = await db
      .from('inventory_items')
      .select('id, name, current_stock, unit, selling_price, is_made_on_spot')
      .eq('workspace_id', ctx.workspace.id)
      .eq('is_made_on_spot', false)
      .order('is_top_item', { ascending: false })
      .order('current_stock', { ascending: false })
      .limit(10);

    // 2. Fetch today's expected cash from counter sales + ledger
    const today = new Date().toISOString().split('T')[0];
    const { data: sales } = await db
      .from('business_sales')
      .select('total_amount')
      .eq('workspace_id', ctx.workspace.id)
      .eq('payment_mode', 'cash')
      .eq('status', 'completed')
      .gte('created_at', today + 'T00:00:00.000Z');

    const expectedCashSales = (sales || []).reduce((acc, s) => acc + Number(s.total_amount || 0), 0);

    // 3. Fetch workspace current accuracy score and last closing check
    const { data: ws } = await db
      .from('business_workspaces')
      .select('accuracy_score, last_closing_at, closing_cash_in_drawer')
      .eq('id', ctx.workspace.id)
      .maybeSingle();

    return Response.json({
      ok: true,
      top_items: topItems || [],
      expected_cash: expectedCashSales,
      current_accuracy_score: ws?.accuracy_score !== undefined && ws?.accuracy_score !== null ? Number(ws.accuracy_score) : 100,
      last_closing_at: ws?.last_closing_at || null,
      last_closing_cash: ws?.closing_cash_in_drawer || null,
    });
  } catch (e) {
    console.error('[CLOSING GET]', e.message);
    return Response.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const ctx = await requireBizPermission(req, 'inventory', 'edit');
    if (ctx.error) return ctx.error;

    const db = createWriteClient();
    const body = await req.json();

    const {
      cash_in_drawer = 0,
      expected_cash = 0,
      item_counts = [],
      notes = '',
    } = body;

    const result = await adjustStockForClosing(db, ctx.workspace.id, {
      cashInDrawer: cash_in_drawer,
      expectedCash: expected_cash,
      itemCounts: item_counts,
      notes,
      checkedBy: ctx.user.id,
    });

    return Response.json(result);
  } catch (e) {
    console.error('[CLOSING POST]', e.message);
    return Response.json({ error: 'Internal error' }, { status: 500 });
  }
}
