// src/app/api/business/payments/webhook/route.js
// ─────────────────────────────────────────────────────────────────────────────
// SOFTWARE SOUNDBOX (2/2): receive Razorpay QR payment events and make the
// merchant's phone SPEAK the confirmation.
//
// On `qr_code.credited` (or `payment.captured` carrying our payment_id note):
//   1. verify the X-Razorpay-Signature (MANDATORY, constant-time)
//   2. mark the business_payments row paid (idempotent)
//   3. write a business_ledger credit entry
//   4. QUEUE a spoken confirmation into nudge_queue for the workspace owner:
//        "₹500 received from Ramesh"
//      The existing /api/cron/process-nudges drainer then delivers it as a push
//      + in-app nudge, which the client TTS speaks aloud. No hardware soundbox.
//
// This is the anti-fake-screenshot pitch: the confirmation is webhook-verified,
// not a screenshot the customer shows you.
//
// Env: RAZORPAY_WEBHOOK_SECRET, SUPABASE_SERVICE_ROLE_KEY.
// ─────────────────────────────────────────────────────────────────────────────
export const dynamic = 'force-dynamic';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

function svc() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export async function POST(req) {
  const body = await req.text();
  const signature = req.headers.get('x-razorpay-signature') || '';
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET || '';

  // ── verify signature — fail closed ──
  if (!secret) {
    console.error('[pay-webhook] RAZORPAY_WEBHOOK_SECRET not set — rejecting');
    return Response.json({ error: 'Webhook not configured' }, { status: 503 });
  }
  {
    const expected = crypto.createHmac('sha256', secret).update(body).digest('hex');
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(signature, 'utf8');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return Response.json({ error: 'Invalid signature' }, { status: 400 });
    }
  }

  let event;
  try { event = JSON.parse(body); } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const type = event.event;
  const qr = event.payload?.qr_code?.entity;
  const payment = event.payload?.payment?.entity;
  const notes = payment?.notes || qr?.notes || {};
  const paymentId = notes.payment_id;          // our business_payments.id
  const paidPaise = payment?.amount || qr?.payment_amount || 0;
  const upiRef = payment?.acquirer_data?.upi_transaction_id || payment?.id || null;

  // We only act on credit/capture events that carry our payment_id.
  const isCredit = type === 'qr_code.credited' || type === 'payment.captured';
  if (!isCredit || !paymentId) {
    return Response.json({ ok: true, ignored: true });
  }

  const db = svc();

  // Load the pending payment (and guard idempotency).
  const { data: pay } = await db.from('business_payments')
    .select('id,workspace_id,customer_name,amount,status').eq('id', paymentId).maybeSingle();
  if (!pay) return Response.json({ ok: true, unknown_payment: true });
  if (pay.status === 'paid') return Response.json({ ok: true, already_paid: true });

  const nowIso = new Date().toISOString();
  const amount = pay.amount || (paidPaise / 100);
  const who = pay.customer_name || 'a customer';

  // 2. mark paid
  await db.from('business_payments').update({
    status: 'paid',
    provider_payment_id: payment?.id || null,
    upi_ref: upiRef,
    paid_at: nowIso,
  }).eq('id', pay.id);

  // 3. ledger credit (best-effort)
  try {
    await db.from('business_ledger').insert({
      workspace_id: pay.workspace_id,
      entry_type: 'credit',
      amount,
      party_name: pay.customer_name || null,
      category: 'upi_payment',
      note: `UPI payment received (ref ${upiRef || 'n/a'})`,
      created_at: nowIso,
    });
  } catch (e) { console.warn('[pay-webhook] ledger insert skipped:', e.message); }

  // 4. queue the SPOKEN confirmation for the workspace owner
  const { data: ws } = await db.from('business_workspaces')
    .select('owner_user_id').eq('id', pay.workspace_id).maybeSingle();
  if (ws?.owner_user_id) {
    const rupees = Number(amount).toLocaleString('en-IN');
    await db.from('nudge_queue').insert({
      user_id: ws.owner_user_id,
      workspace_id: pay.workspace_id,
      nudge_type: 'payment_received',
      title: 'Payment received',
      body: `₹${rupees} received from ${who}`,
      channel: 'push',
      domain_type: 'business',
      priority_score: 0.95,
      scheduled_for: nowIso,
      delivered: false,
      payload: { type: 'payment', url: '/b/ledger', speak: true, amount, party: who },
      deduplication_key: `pay:${pay.id}`,
    });
  }

  return Response.json({ ok: true, spoken: `₹${amount} received from ${who}` });
}

export async function GET() {
  return Response.json({ status: 'QuietKeep payments webhook active', version: '1.0' });
}
