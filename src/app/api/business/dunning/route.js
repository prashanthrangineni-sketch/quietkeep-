// src/app/api/business/dunning/route.js
// AUTOMATED WHATSAPP DUNNING — owner-triggered payment reminders with business limit enforcement.

export const dynamic = 'force-dynamic';
import { requireBizPermission } from '@/lib/biz-rbac';
import { createWriteClient } from '@/lib/supabase-bearer';
import { NextResponse } from 'next/server';
import {
  isCustomerOptedOutInDb,
  normalizePhoneNumber,
  isWithinPromoHours,
  sanitizeSnippet,
} from '@/lib/business-limits';

const STAGES = [15, 7, 3];          // checked high->low; first match wins
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
  const [{ data: ledger }, { data: customers }, { data: sent }, { data: optOuts }] = await Promise.all([
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
    db.from('business_customer_opt_outs')
      .select('phone')
      .eq('workspace_id', workspaceId),
  ]);

  const optedOutPhones = new Set(
    (optOuts || []).map((o) => normalizePhoneNumber(o.phone)).filter(Boolean)
  );

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
    const normPhone = normalizePhoneNumber(cust?.phone || '');

    let skip = null;
    if (alreadySent.has(`${l.id}:${stage}`)) skip = 'already_reminded_at_this_stage';
    else if (!cust) skip = 'no_customer_record';
    else if (!normPhone) skip = 'no_phone_number';
    else if (cust.whatsapp_opted_in === false) skip = 'not_opted_in_to_whatsapp';
    else if (optedOutPhones.has(normPhone)) skip = 'customer_opted_out';

    out.push({
      ledger_id: l.id,
      customer_id: cust?.id || null,
      party_name: l.party_name,
      phone: normPhone || null,
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

// ── POST: send the reminders (Owner-triggered only, Item G) ───────────────────
export async function POST(req) {
  try {
    const ctx = await requireBizPermission(req, 'billing', 'create');
    if (ctx.error) return ctx.error;

    // Time window enforcement: 10:00 to 21:00 IST (Rule 4, Item G)
    if (!isWithinPromoHours()) {
      return NextResponse.json({
        error: 'Payment reminder messages can only be sent between 10:00 and 21:00 IST (Rule 4).',
        code: 'outside_promo_hours',
      }, { status: 429 });
    }

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

    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    const weekStart = new Date(Date.now() - 7 * 24 * 3600 * 1000);

    for (const t of targets) {
      const normPhone = normalizePhoneNumber(t.phone);

      // Check per-customer caps (1/day, 4/week)
      const [{ count: custTodayCount }, { count: custWeekCount }] = await Promise.all([
        db.from('business_promo_log')
          .select('id', { count: 'exact', head: true })
          .eq('workspace_id', ctx.workspace.id)
          .eq('phone', normPhone)
          .eq('status', 'sent')
          .gte('sent_at', todayStart.toISOString()),
        db.from('business_promo_log')
          .select('id', { count: 'exact', head: true })
          .eq('workspace_id', ctx.workspace.id)
          .eq('phone', normPhone)
          .eq('status', 'sent')
          .gte('sent_at', weekStart.toISOString()),
      ]);

      if ((custTodayCount || 0) >= 1) {
        results.push({
          ledger_id: t.ledger_id,
          party_name: t.party_name,
          stage: t.stage,
          amount: t.due_amount,
          status: 'skipped',
          error: 'Customer daily cap reached (max 1/day)',
        });
        continue;
      }

      if ((custWeekCount || 0) >= 4) {
        results.push({
          ledger_id: t.ledger_id,
          party_name: t.party_name,
          stage: t.stage,
          amount: t.due_amount,
          status: 'skipped',
          error: 'Customer weekly cap reached (max 4/week)',
        });
        continue;
      }

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
          To: `whatsapp:${normPhone}`,
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

      const { error: dunningErr } = await db.from('business_dunning_log').insert({
        workspace_id: ctx.workspace.id,
        customer_id: t.customer_id,
        ledger_id: t.ledger_id,
        stage: t.stage,
        amount: t.due_amount,
        phone: normPhone,
        channel: 'whatsapp',
        message,
        status,
        error_message: errorMessage,
        payment_id: paymentId,
        created_by: ctx.user.id,
      });

      if (dunningErr) {
        console.error('[dunning:POST] dunning log insert error:', dunningErr.message);
      }

      // Record in promo log to ensure customer caps are respected
      const { error: promoLogErr } = await db.from('business_promo_log').insert({
        workspace_id: ctx.workspace.id,
        customer_id: t.customer_id,
        phone: normPhone,
        message_type: 'promotional',
        status,
        blocked_reason: errorMessage,
        snippet: sanitizeSnippet(message),
        sent_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
      });

      if (promoLogErr) {
        console.error('[dunning:POST] promo log insert error:', promoLogErr.message);
      }

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