// src/app/api/business/payments/create-qr/route.js
// ─────────────────────────────────────────────────────────────────────────────
// SOFTWARE SOUNDBOX (1/2): generate a dynamic, fixed-amount UPI QR for a bill.
//
// POST { amount, customer_name?, customer_id?, note? } (Bearer auth)
//   → creates a Razorpay single-use UPI QR for exactly this amount
//   → records a `pending` row in business_payments
//   → returns { payment_id, qr_image_url, amount }
//
// When the customer pays, Razorpay calls /api/business/payments/webhook, which
// marks it paid and QUEUES A SPOKEN CONFIRMATION into nudge_queue — so the
// merchant's phone says "₹500 received from Ramesh" with no hardware soundbox.
//
// Env: RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, SUPABASE_SERVICE_ROLE_KEY.
// ─────────────────────────────────────────────────────────────────────────────
export const dynamic = 'force-dynamic';
import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

function auth(token) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );
}
function svc() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}
async function getUser(token) {
  const { data: { user } } = await auth(token).auth.getUser();
  return user;
}
async function accessibleWorkspaceIds(db, userId) {
  const ids = new Set();
  const owned = await db.from('business_workspaces').select('id').eq('owner_user_id', userId);
  (owned.data || []).forEach(w => ids.add(w.id));
  const member = await db.from('business_members').select('workspace_id,status').eq('user_id', userId);
  (member.data || []).forEach(m => {
    if (!m.status || ['active', 'invited'].includes(String(m.status).toLowerCase())) {
      if (m.workspace_id) ids.add(m.workspace_id);
    }
  });
  return ids;
}

export async function POST(req) {
  try {
    const token = req.headers.get('Authorization')?.replace('Bearer ', '').trim();
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const user = await getUser(token);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    let body;
    try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

    const amount = Number(body.amount);
    if (!amount || amount <= 0) return NextResponse.json({ error: 'amount must be > 0' }, { status: 400 });

    const db = svc();
    const wsIds = await accessibleWorkspaceIds(db, user.id);
    let workspaceId = body.workspace_id;
    if (workspaceId) {
      if (!wsIds.has(workspaceId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    } else {
      if (wsIds.size === 0) return NextResponse.json({ error: 'No workspace' }, { status: 404 });
      workspaceId = Array.from(wsIds)[0];
    }

    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!keyId || !keySecret) {
      return NextResponse.json({ error: 'Payments not configured' }, { status: 503 });
    }

    // Pre-insert the pending record so we have an id to stamp into QR notes.
    const { data: pay, error: insErr } = await db.from('business_payments').insert({
      workspace_id: workspaceId,
      customer_id: body.customer_id || null,
      customer_name: body.customer_name || null,
      amount,
      currency: 'INR',
      status: 'pending',
      provider: 'razorpay',
      note: body.note || null,
      created_by: user.id,
    }).select().single();
    if (insErr) return NextResponse.json({ error: insErr.message }, { status: 400 });

    // Create the Razorpay single-use, fixed-amount UPI QR.
    const basic = Buffer.from(`${keyId}:${keySecret}`).toString('base64');
    const rzRes = await fetch('https://api.razorpay.com/v1/payments/qr_codes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Basic ${basic}` },
      body: JSON.stringify({
        type: 'upi_qr',
        usage: 'single_use',
        fixed_amount: true,
        payment_amount: Math.round(amount * 100),
        description: (body.note || 'QuietKeep payment').slice(0, 40),
        notes: { payment_id: pay.id, workspace_id: workspaceId },
        close_by: Math.floor(Date.now() / 1000) + 30 * 60, // expires in 30 min
      }),
    });
    const rz = await rzRes.json();
    if (!rzRes.ok) {
      await db.from('business_payments').update({ status: 'failed' }).eq('id', pay.id);
      return NextResponse.json({ error: 'QR creation failed', detail: rz?.error?.description || null }, { status: 502 });
    }

    await db.from('business_payments').update({
      provider_qr_id: rz.id,
      qr_image_url: rz.image_url,
    }).eq('id', pay.id);

    return NextResponse.json({
      payment_id: pay.id,
      qr_id: rz.id,
      qr_image_url: rz.image_url,
      amount,
      status: 'pending',
    });
  } catch (e) {
    console.error('[create-qr]', e.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
