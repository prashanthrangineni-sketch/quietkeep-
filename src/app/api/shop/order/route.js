// src/app/api/shop/order/route.js
// ─────────────────────────────────────────────────────────────────────────────
// Public customer order submission route for /s/[shop].
//
// When the customer taps "I have paid", this route records the order into
// business_sales with status: 'paid - awaiting shop confirmation'.
//
// CRITICAL: Stock is NOT lowered here. Stock is decremented ONLY when
// the shopkeeper confirms the order (or marks UPI received).
// ─────────────────────────────────────────────────────────────────────────────

export const dynamic = 'force-dynamic';
import { createWriteClient } from '@/lib/supabase-bearer';
import { calculateCartTotal } from '@/lib/upi';

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const {
      workspace_id,
      client_sale_id,
      items,
      customer_name = '',
      customer_phone = '',
      upi_ref = '',
    } = body;

    if (!workspace_id) {
      return Response.json({ error: 'Missing workspace_id' }, { status: 400 });
    }

    if (!Array.isArray(items) || items.length === 0) {
      return Response.json({ error: 'Cart cannot be empty' }, { status: 400 });
    }

    const db = createWriteClient();

    // Verify workspace exists
    const { data: ws, error: wsErr } = await db
      .from('business_workspaces')
      .select('id, name, upi_id')
      .eq('id', workspace_id)
      .maybeSingle();

    if (wsErr || !ws) {
      return Response.json({ error: 'Shop not found' }, { status: 404 });
    }

    if (!ws.upi_id) {
      return Response.json({ error: 'Shop has not configured a UPI ID' }, { status: 400 });
    }

    // Sanitize and calculate total on server
    const cleanItems = items.map(it => {
      const price = Number(it.selling_price ?? it.price ?? 0);
      const qty = Math.max(1, Math.round(Number(it.quantity ?? it.qty ?? 1)));
      return {
        item_id: it.item_id || it.id || null,
        name: String(it.name || 'Item').trim(),
        price,
        selling_price: price,
        quantity: qty,
        unit: it.unit || 'pcs',
      };
    });

    const totalAmount = calculateCartTotal(cleanItems);
    if (totalAmount <= 0) {
      return Response.json({ error: 'Invalid order total' }, { status: 400 });
    }

    const orderRef = client_sale_id || `ORD-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

    // Record into business_sales as 'paid - awaiting shop confirmation'
    const nowIso = new Date().toISOString();
    const salePayload = {
      workspace_id: ws.id,
      client_sale_id: orderRef,
      items: cleanItems,
      total_amount: totalAmount,
      payment_mode: 'upi',
      status: 'paid - awaiting shop confirmation',
      source: 'public_shop',
      metadata: {
        order_ref: orderRef,
        shop_upi_id: ws.upi_id,
        customer_name: customer_name.trim() || null,
        customer_phone: customer_phone.trim() || null,
        upi_ref: upi_ref.trim() || null,
        submitted_at: nowIso,
      },
    };

    const { data: sale, error: insertErr } = await db
      .from('business_sales')
      .insert(salePayload)
      .select()
      .single();

    if (insertErr) {
      console.error('[API /api/shop/order] Insert failed:', insertErr.message);
      return Response.json({ error: 'Failed to record order: ' + insertErr.message }, { status: 500 });
    }

    return Response.json({
      ok: true,
      sale_id: sale.id,
      client_sale_id: orderRef,
      status: 'paid - awaiting shop confirmation',
      total_amount: totalAmount,
      shop_name: ws.name,
      shop_upi_id: ws.upi_id,
    });
  } catch (err) {
    console.error('[API /api/shop/order] Error:', err.message);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
