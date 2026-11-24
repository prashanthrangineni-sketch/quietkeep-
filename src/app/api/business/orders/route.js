// src/app/api/business/orders/route.js
// ─────────────────────────────────────────────────────────────────────────────
// List orders for the merchant workspace (e.g. pending UPI orders awaiting confirmation).
// ─────────────────────────────────────────────────────────────────────────────

export const dynamic = 'force-dynamic';
import { requireBizPermission } from '@/lib/biz-rbac';
import { createWriteClient } from '@/lib/supabase-bearer';

export async function GET(req) {
  try {
    const ctx = await requireBizPermission(req, 'billing', 'view');
    if (ctx.error) return ctx.error;

    const { searchParams } = new URL(req.url);
    const status = searchParams.get('status'); // e.g. 'paid - awaiting shop confirmation' or 'pending'

    const db = createWriteClient();
    let query = db
      .from('business_sales')
      .select('*')
      .eq('workspace_id', ctx.workspace.id)
      .order('created_at', { ascending: false })
      .limit(50);

    if (status === 'pending') {
      query = query.eq('status', 'paid - awaiting shop confirmation');
    } else if (status) {
      query = query.eq('status', status);
    }

    const { data: orders, error } = await query;
    if (error) {
      console.error('[ORDERS GET] Query error:', error.message);
      return Response.json({ error: 'Failed to fetch orders' }, { status: 500 });
    }

    return Response.json({ data: orders || [] });
  } catch (err) {
    console.error('[ORDERS GET] Error:', err.message);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
