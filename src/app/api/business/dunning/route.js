// src/app/api/business/dunning/route.js
// ─────────────────────────────────────────────────────────────────────────────
// AUTOMATED WHATSAPP DUNNING (SOT P3) — the collections half of the wedge.
//
// Completes the cycle opened by the payment fix:
//   overdue party → WhatsApp reminder + UPI pay link → customer pays
//   → /api/business/payments/webhook → apply_business_payment()
//   → ledger credit + khata cleared, automatically.
//
//   GET  → PREVIEW who would be reminded. Read-only, sends nothing.
//   POST → actually send. Explicit call only.
//
// WHY NOT AUTOMATIC (yet)
// This messages REAL CUSTOMERS. A bad run is a reputational failure, not a bad
// row. So there is no cron here: the merchant triggers it, having seen the
// preview. Wiring it to pg_cron is a deliberate opt-in, not a default.
//
// CONSENT: a customer is only messaged when whatsapp_opted_in is true AND a
// phone number exists. Everyone else is reported as skipped, with the reason,
// so the merchant can see who is unreachable instead of them vanishing.
//
// THE AMOUNT BUG THIS AVOIDS
// business_ledger.amount_pending is NOT reliably populated — live data has rows
// with payment_status='pending', amount=3200 and amount_pending=0.00. Dunning on
// amount_pending alone would have found ZERO overdue customers and silently done
// nothing. So the due amount falls back to `amount` when amount_pending is 0.
// Likewise due_date is often null, so the clock falls back to
// transaction_date + 15 days.
export const dynamic = 'force-dynamic';
import { requireBizPermission } from '@/lib/biz-rbac';
import { createWriteClient } from '@/lib/supabase-bearer';
import { NextResponse } from 'next/server';

const STAGES = [15, 7, 3];          // checked high→low; first match wins
const GRACE_DAYS = 15;              // used when a ledger row has no due_date

function stageFor(daysOverdue) {
  for (const s of STAGES) if (daysOverdue >= s) return s;
  return null;
}

function money(n) {
  return Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

// Load every overdue receivable for the workspace, joined to its customer.
async function loadCandidates(db, workspaceId) {
  const [{ data: ledger }, { data: customers }, { data: sent }] = await Promise.all([
    db.from('business_ledger')
      .select('id,party_name,amount,amount_pending,due_date,transaction_date,payment_status')
      .eq('workspace_id', workspaceId)
      .eq('payment_status', 'pending'),
    db.from('business_customers')
      .select('id,name,phone,whatsapp_opted_in,outstanding_balance')
      .eq('workspace_id', workspaceId),
    db.from('business_dunning_log')
      .select('ledger_id,customer_id,stage')
      .eq('workspace_id', workspaceId)
      .eq('status', 'sent'),
  ]);

  const byName = new Map(
    (customers || []).map((c) => [String(c.name || '').trim().toLowerCase(), c])
  );
  const alreadySent = new Set(
    (sent || []).map((r) => `${r.ledger_id || r.customer_id}:${r.stage}`)
  );

  const today = new Date();
  const out = [];

  for (const l of ledger || []) {
    const pending = Number(l.amount_pending || 0);
    const due = pending > 0 ? pending : Number(l.amount || 0);
    if (due <= 0) continue;

    const base = l.due_date
      ? new Date(l.due_date)
      : new Date(new Date(l.transaction_date).getTime() + GRACE_DAYS * 86400000);
    const daysOverdue = Math.floor((today - base) / 86400000);
    const stage = stageFor(daysOverdue);
    if (!stage) continue;

    const cust = byName.get(String(l.party_name || '').trim().toLowerCase()) || null;

    let skip = null;
    if (alreadySent.has(`${l.id}:${stage}`)) skip = 'already_reminded_at_this_stage';
    else if (!cust) skip = 'no_customer_record';
    else if (!cust.phone) skip = 'no_phone_number';
    else if (!cust.whatsapp_opted_in) skip = 'not_opted_in_to_whatsapp';

    out.push({
      ledger_id: l.id,
      customer_id: cust?.id || null,
      party_name: l.party_name,
      phone: cust?.phone || null,
      due_amount: due,
      days_overdue: daysOverdue,
      stage,
      reachable: !skip,
      skip_reason: skip,
    });
  }

  out.sort((a, b) => b.days_overdue - a.days_overdue);
  return out;
}

// ── GET: preview only ───────────────────────────────────────────────────────
export async function GET(req) {
  try {
    const ctx = await requireBizPermission(req, 'billing', 'view');
    if (ctx.error) return ctx.error;

    const db = createWriteClient();
    const candidates = await loadCandidates(db, ctx.workspace.id);

    return NextResponse.json({
      preview: true,
      total: candidates.length,
      reachable: candidates.filter((c) => c.reachable).length,
      total_due: candidates.reduce((s, c) => s + c.due_amount, 0),
      candidates,
    });
  } catch (e) {
    console.error('[dunning:GET]', e?.message || e);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

// ── POST: send the reminders ────────────────────────────────────────────────
export async function POST(req) {
  try {
    const ctx = await requireBizPermission(req, 'billing', 'create');
    if (ctx.error) return ctx.error;

    const body = await req.json().catch(() => ({}));
    const includePayLink = body.include_pay_link !== false;
    const onlyLedgerIds = Array.isArray(body.ledger_ids) ? new Set(body.ledger_ids) : null;

    const sid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const from = process.env.TWILIO_WHATSAPP_FROM || '+14155238886';
    if (!sid || !authToken) {
      return NextResponse.json(
        { error: 'WhatsApp not configured. Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN.' },
        { status: 503 },
      );
    }

    const db = createWriteClient();
    const all = await loadCandidates(db, ctx.workspace.id);
    const targets = all.filter(
      (c) => c.reachable && (!onlyLedgerIds || onlyLedgerIds.has(c.ledger_id)),
    );

    const bizName = ctx.workspace.name || 'our shop';
    const origin = new URL(req.url).origin;
    const results = [];

    for (const t of targets) {
      // Optional UPI pay link. Reuses create-qr with the caller's own token so
      // the QR logic lives in one place. Best-effort: if payments aren't
      // configured the reminder still goes out, just without a link.
      let payLink = null;
      let paymentId = null;
      if (includePayLink) {
        try {
          const qr = await fetch(`${origin}/api/business/payments/create-qr`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${ctx.token}`,
            },
            body: JSON.stringify({
              amount: t.due_amount,
              customer_name: t.party_name,
              customer_id: t.customer_id,
              note: `Payment reminder (${t.days_overdue} days overdue)`,
            }),
          });
          if (qr.ok) {
            const qj = await qr.json().catch(() => null);
            payLink = qj?.qr_image_url || null;
            paymentId = qj?.payment_id || null;
          }
        } catch { /* reminder still goes without a link */ }
      }

      const message =
        `Namaste ${t.party_name}, this is a payment reminder from ${bizName}.\n\n` +
        `Amount pending: ₹${money(t.due_amount)}\n` +
        `Overdue by: ${t.days_overdue} days\n` +
        (payLink ? `\nPay here: ${payLink}\n` : '') +
        `\nIf you have already paid, please ignore this message.`;

      let status = 'sent';
      let errorMessage = null;
      try {
        const form = new URLSearchParams({
          From: `whatsapp:${from}`,
          To: `whatsapp:${t.phone}`,
          Body: message,
        });
        const tw = await fetch(
          `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
          {
            method: 'POST',
            headers: {
              Authorization: 'Basic ' + Buffer.from(`${sid}:${authToken}`).toString('base64'),
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: form,
          },
        );
        if (!tw.ok) {
          status = 'failed';
          errorMessage = (await tw.text().catch(() => '')).slice(0, 200);
        }
      } catch (e) {
        status = 'failed';
        errorMessage = String(e?.message || e).slice(0, 200);
      }

      // Log every attempt. The unique index means a 'sent' row for this
      // (receivable, stage) can only exist once — so a re-run cannot spam.
      await db.from('business_dunning_log').insert({
        workspace_id: ctx.workspace.id,
        customer_id: t.customer_id,
        ledger_id: t.ledger_id,
        stage: t.stage,
        amount: t.due_amount,
        phone: t.phone,
        channel: 'whatsapp',
        message,
        status,
        error_message: errorMessage,
        payment_id: paymentId,
        created_by: ctx.user.id,
      });

      results.push({
        ledger_id: t.ledger_id,
        party_name: t.party_name,
        stage: t.stage,
        amount: t.due_amount,
        status,
        pay_link: payLink,
        error: errorMessage,
      });
    }

    return NextResponse.json({
      sent: results.filter((r) => r.status === 'sent').length,
      failed: results.filter((r) => r.status === 'failed').length,
      skipped: all.length - targets.length,
      results,
    });
  } catch (e) {
    console.error('[dunning:POST]', e?.message || e);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
