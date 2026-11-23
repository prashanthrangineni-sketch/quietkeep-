// src/app/api/business/payments/create-qr/route.js
// ─────────────────────────────────────────────────────────────────────────────
// SUBSCRIPTION-ONLY (LEGACY / PLATFORM SUBSCRIPTIONS):
//
// DECISION: Shop payments go straight to the shop's own UPI ID.
// Pranix never holds shop money. The Razorpay QR stays ONLY for
// QuietKeep's own subscription fees (e.g. Plus, Family, Business tiers).
//
// This route must NOT be displayed or used on shop counter screens for customer
// retail billing. Shop counter payments and public shop sales (/s/[shop])
// use direct UPI links (upi://pay?pa=shop_upi_id&...) directly to the shop.
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

    // Create the Razorpay single-use, fixed-amount UPI QR (QuietKeep subscription fees only)
    const rzRes = await fetch('https://api.razorpay.com/v1/payments/qr_codes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Basic ' + Buffer.from(`${keyId}:${keySecret}`).toString('base64'),
      },
      body: JSON.stringify({
        type: 'upi_qr',
        usage: 'single_use',
        fixed_amount: true,
        payment_amount: Math.round(amount * 100), // paise
        description: body.note || `QuietKeep subscription ${pay.id.slice(0, 8)}`,
        notes: {
          payment_id: pay.id,
          workspace_id: workspaceId,
          type: 'subscription',
        },
      }),
    });

    const rz = await rzRes.json();
    if (!rzRes.ok) {
      await db.from('business_payments').update({ status: 'failed', note: rz.error?.description || 'Razorpay error' }).eq('id', pay.id);
      return NextResponse.json({ error: rz.error?.description || 'Razorpay call failed' }, { status: 502 });
    }

    await db.from('business_payments').update({
      provider_payment_id: rz.id,
      provider_qr_id: rz.id,
      qr_image_url: rz.image_url,
    }).eq('id', pay.id);

    return NextResponse.json({
      payment_id: pay.id,
      qr_image_url: rz.image_url,
      amount,
      currency: 'INR',
      status: 'pending',
      notice: 'Subscription payments only. Shop sales use direct shop UPI ID.',
    });
  } catch (e) {
    console.error('[create-qr]', e.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
