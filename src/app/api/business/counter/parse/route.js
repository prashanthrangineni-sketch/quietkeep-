// src/app/api/business/counter/parse/route.js
// ─────────────────────────────────────────────────────────────────────────────
// Server-side natural language text command sale parser endpoint.
// ─────────────────────────────────────────────────────────────────────────────
export const dynamic = 'force-dynamic';
import { requireBizPermission } from '@/lib/biz-rbac';
import { createWriteClient } from '@/lib/supabase-bearer';
import { parseSaleCommand } from '@/lib/sale-command-parser';

export async function POST(req) {
  try {
    const ctx = await requireBizPermission(req, 'billing', 'view');
    if (ctx.error) return ctx.error;

    const db = createWriteClient();
    const body = await req.json();
    const command = body.command || body.text || '';

    // Fetch shop inventory items for matching
    const { data: shopItems } = await db
      .from('inventory_items')
      .select('id, name, sku, barcode, selling_price, current_stock, unit, is_made_on_spot, recipe')
      .eq('workspace_id', ctx.workspace.id);

    const parsed = parseSaleCommand(command, shopItems || []);

    return Response.json(parsed);
  } catch (e) {
    console.error('[COUNTER PARSE POST]', e.message);
    return Response.json({ error: 'Internal error' }, { status: 500 });
  }
}
