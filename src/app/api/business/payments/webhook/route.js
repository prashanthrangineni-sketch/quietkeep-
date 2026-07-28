// src/app/api/business/payments/webhook/route.js
// ─────────────────────────────────────────────────────────────────────────────
// SOFTWARE SOUNDBOX (2/2): receive Razorpay QR payment events, post them to the
// books, and make the merchant's phone SPEAK the confirmation.
//
// On `qr_code.credited` (or `payment.captured` carrying our payment_id note):
//   1. verify the X-Razorpay-Signature (MANDATORY, constant-time)
//   2. apply_business_payment() — ONE transaction that marks the payment paid,
//      writes the business_ledger credit, and clears the customer's khata
//   3. QUEUE a spoken confirmation into nudge_queue for the workspace owner:
//        "₹500 received from Ramesh"
//      The pg_cron nudge drainer delivers it as a push + in-app nudge, which the
//      client TTS speaks aloud. No hardware soundbox.
//
// This is the anti-fake-screenshot pitch: the confirmation is webhook-verified,
// not a screenshot the customer shows you.
//
// WHY A SQL FUNCTION
// The previous version inserted a `note` column that does not exist on
// business_ledger — PostgREST rejected it and a try/catch swallowed the error,
// so a paid QR silently never reached the books, and the customer's khata was
// never touched. Those three writes must also succeed or fail together, and a
// redelivered webhook must not double-post. apply_business_payment() locks the
// payment row FOR UPDATE and does all three atomically, which also removes the
// read-then-write race this handler used to have.
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
  const upiRef = payment?.acquirer_data?.upi_transaction_id || payment?.id || null;

  // We only act on credit/capture events that carry our payment_id.
  const isCredit = type === 'qr_code.credited' || type === 'payment.captured';
  if (!isCredit || !paymentId) {
    return Response.json({ ok: true, ignored: true });
  }

  const db = svc();

  // ── 2. post the payment: paid + ledger credit + khata, atomically ──
  const { data: applied, error: applyErr } = await db.rpc('apply_business_payment', {
    p_payment_id: paymentId,
    p_provider_payment_id: payment?.id || null,
    p_upi_ref: upiRef,
  });

  // A failure here means the money is NOT in the books. Never swallow it —
  // return 500 so Razorpay retries the delivery.
  if (applyErr) {
    console.error('[pay-webhook] apply_business_payment failed:', applyErr.message, { paymentId });
    return Response.json({ error: 'Ledger posting failed', detail: applyErr.message }, { status: 500 });
  }
  if (!applied?.ok) {
    console.warn('[pay-webhook] payment not applied:', applied?.reason, { paymentId });
    return Response.json({ ok: true, skipped: applied?.reason || 'not_applied' });
  }
  // Redelivered webhook — already posted, so don't announce it twice either.
  if (applied.already_paid) {
    return Response.json({ ok: true, already_paid: true });
  }

  const amount = applied.amount;
  const who = applied.party || 'a customer';

  // ── 3. queue the SPOKEN confirmation for the workspace owner ──
  const { data: ws } = await db.from('business_workspaces')
    .select('owner_user_id').eq('id', applied.workspace_id).maybeSingle();
  if (ws?.owner_user_id) {
    const rupees = Number(amount).toLocaleString('en-IN');
    const { error: nudgeErr } = await db.from('nudge_queue').insert({
      user_id: ws.owner_user_id,
      workspace_id: applied.workspace_id,
      nudge_type: 'payment_received',
      title: 'Payment received',
      body: `₹${rupees} received from ${who}`,
      channel: 'push',
      domain_type: 'business',
      priority_score: 0.95,
      scheduled_for: new Date().toISOString(),
      delivered: false,
      payload: { type: 'payment', url: '/b/ledger', speak: true, amount, party: who },
      deduplication_key: `pay:${paymentId}`,
    });
    // The money IS in the books at this point, so a failed announcement must not
    // fail the webhook (that would make Razorpay retry an already-posted payment).
    if (nudgeErr) console.warn('[pay-webhook] spoken confirmation not queued:', nudgeErr.message);
  }

  return Response.json({
    ok: true,
    ledger_id: applied.ledger_id,
    spoken: `₹${amount} received from ${who}`,
  });
}

export async function GET() {
  return Response.json({ status: 'QuietKeep payments webhook active', version: '2.0' });
}
