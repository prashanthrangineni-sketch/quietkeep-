// src/app/api/business/approvals/route.js
// Business approvals API: list queued items and execute One-Tap Send / Edit / Ignore (Rule 1 & 2).

export const dynamic = 'force-dynamic';
import { requireBizPermission } from '@/lib/biz-rbac';
import { createWriteClient } from '@/lib/supabase-bearer';
import { NextResponse } from 'next/server';
import { normalizePhoneNumber, maskPhoneNumber, sanitizeSnippet } from '@/lib/business-limits';

export async function GET(req) {
  try {
    const ctx = await requireBizPermission(req, 'customers', 'view');
    if (ctx.error) return ctx.error;

    const db = createWriteClient();
    const { data, error } = await db
      .from('business_approvals')
      .select('id, action_type, action_label, payload, status, created_at')
      .eq('workspace_id', ctx.workspace.id)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[approvals:GET] error:', error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ approvals: data || [] });
  } catch (e) {
    console.error('[approvals:GET] error:', e?.message || e);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const ctx = await requireBizPermission(req, 'customers', 'edit');
    if (ctx.error) return ctx.error;

    const body = await req.json().catch(() => ({}));
    const { approval_id, action, edited_message } = body;

    if (!approval_id || !action) {
      return NextResponse.json({ error: 'approval_id and action required' }, { status: 400 });
    }

    const normAction = String(action).toLowerCase();
    const db = createWriteClient();

    const { data: approval, error: fetchErr } = await db
      .from('business_approvals')
      .select('*')
      .eq('id', approval_id)
      .eq('workspace_id', ctx.workspace.id)
      .limit(1);

    if (fetchErr) {
      console.error('[approvals:POST] fetch error:', fetchErr.message);
      return NextResponse.json({ error: fetchErr.message }, { status: 500 });
    }

    const apprRow = Array.isArray(approval) ? approval[0] : approval;
    if (!apprRow) {
      return NextResponse.json({ error: 'Approval not found' }, { status: 404 });
    }

    if (apprRow.status !== 'pending') {
      return NextResponse.json({
        error: 'Approval already processed or currently being sent',
        code: 'already_processed',
      }, { status: 409 });
    }

    const targetCustomerPhone = normalizePhoneNumber(
      apprRow.payload?.customerPhone ||
      apprRow.payload?.customer_phone ||
      apprRow.payload?.who ||
      apprRow.payload?.phone ||
      ''
    );
    const maskedCustomerPhone = maskPhoneNumber(targetCustomerPhone);

    const isOrderOrBooking =
      apprRow.action_type === 'business_order_confirm' ||
      apprRow.action_type === 'business_booking_confirm' ||
      apprRow.payload?.what === 'order_request' ||
      apprRow.payload?.what === 'booking_request' ||
      apprRow.payload?.what === 'order' ||
      apprRow.payload?.what === 'booking';

    // ── 1. APPROVE / SEND / CONFIRM / EDIT (Item K & 4) ───────────────────────
    if (['send', 'edit', 'confirm', 'approve'].includes(normAction)) {
      let replyMessage = (normAction === 'edit' && edited_message)
        ? String(edited_message).trim()
        : (apprRow.payload?.suggested_reply || null);

      if (!replyMessage && isOrderOrBooking) {
        if (apprRow.action_type === 'business_booking_confirm' || apprRow.payload?.what === 'booking_request' || apprRow.payload?.what === 'booking') {
          replyMessage = `Your booking with ${ctx.workspace.name || 'our shop'} has been confirmed!`;
        } else {
          replyMessage = `Your order with ${ctx.workspace.name || 'our shop'} has been confirmed! Thank you for ordering with us.`;
        }
      }

      // Refuse send without reply text (Item 4)
      if (!replyMessage) {
        return NextResponse.json({
          error: 'Cannot send without reply text. Please use Edit to provide a reply.',
          code: 'missing_reply_text',
        }, { status: 400 });
      }

      // Atomically claim the approval: pending -> 'sending' (Round 4 Item 3)
      const { data: claimedRows, error: claimErr } = await db
        .from('business_approvals')
        .update({
          status: 'sending',
        })
        .eq('id', approval_id)
        .eq('status', 'pending')
        .select();

      if (claimErr) {
        console.error('[approvals:POST] claim error:', claimErr.message);
        return NextResponse.json({ error: claimErr.message }, { status: 500 });
      }

      if (!claimedRows || claimedRows.length === 0) {
        return NextResponse.json({
          error: 'Approval already processed or currently being sent',
          code: 'already_processed',
        }, { status: 409 });
      }

      // Actually send to the customer via Twilio
      let sentSuccess = false;
      let sendErrorMsg = null;
      const sid = process.env.TWILIO_ACCOUNT_SID;
      const authToken = process.env.TWILIO_AUTH_TOKEN;
      const from = process.env.TWILIO_WHATSAPP_FROM || '+14155238886';

      if (sid && authToken && targetCustomerPhone) {
        try {
          const form = new URLSearchParams({
            From: `whatsapp:${from}`,
            To: `whatsapp:${targetCustomerPhone}`,
            Body: replyMessage,
          });

          const twRes = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
            method: 'POST',
            headers: {
              Authorization: 'Basic ' + Buffer.from(`${sid}:${authToken}`).toString('base64'),
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: form,
          });
          if (twRes.ok) {
            sentSuccess = true;
          } else {
            sendErrorMsg = `Twilio returned HTTP ${twRes.status}`;
            console.error('[approvals:POST] Twilio error:', sendErrorMsg);
          }
        } catch (e) {
          sendErrorMsg = e?.message || 'Twilio send exception';
          console.error('[approvals:POST] twilio send failed:', sendErrorMsg);
        }
      } else {
        sendErrorMsg = 'Twilio credentials not configured';
      }

      // On send failure, revert status to pending and return error (Round 4 Item 3)
      if (!sentSuccess) {
        await db
          .from('business_approvals')
          .update({
            status: 'pending',
          })
          .eq('id', approval_id)
          .eq('status', 'sending');

        return NextResponse.json({
          error: 'Failed to send WhatsApp message to customer. Approval kept pending.',
          code: 'send_failed',
          detail: sendErrorMsg,
        }, { status: 502 });
      }

      const { error: updErr } = await db
        .from('business_approvals')
        .update({
          status: 'approved',
          approved_at: new Date().toISOString(),
        })
        .eq('id', approval_id)
        .eq('status', 'sending');

      if (updErr) {
        console.error('[approvals:POST] approval update error:', updErr.message);
        return NextResponse.json({ error: updErr.message }, { status: 500 });
      }

      // Log promo/transactional send in business_promo_log (Item 7: check error)
      if (targetCustomerPhone) {
        const { error: promoLogErr } = await db.from('business_promo_log').insert({
          workspace_id: ctx.workspace.id,
          phone: targetCustomerPhone,
          message_type: 'transactional',
          status: 'sent',
          snippet: sanitizeSnippet(replyMessage),
          sent_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
        });
        if (promoLogErr) {
          console.error('[approvals:POST] promo log insert error:', promoLogErr.message);
        }
      }

      // Item 5: Use maskedCustomerPhone in description and metadata
      // Item 7: Check error on insert
      const { error: actErr } = await db.from('business_activity_log').insert({
        workspace_id: ctx.workspace.id,
        action: 'approval_executed',
        description: `Owner ${normAction}ed queued reply to customer ${maskedCustomerPhone}.`,
        entity_type: 'customer_message',
        metadata: { approval_id, action: normAction, reply_message: replyMessage, sent: sentSuccess, phone: maskedCustomerPhone },
        created_at: new Date().toISOString(),
      });
      if (actErr) {
        console.error('[approvals:POST] activity log insert error:', actErr.message);
      }

      return NextResponse.json({ ok: true, status: 'approved', sent: true, message: replyMessage });
    }

    // ── 2. IGNORE / DISMISS ──────────────────────────────────────────────────
    if (['ignore', 'dismiss', 'reject'].includes(normAction)) {
      const { error: updErr } = await db
        .from('business_approvals')
        .update({
          status: 'rejected',
          approved_at: new Date().toISOString(),
        })
        .eq('id', approval_id)
        .eq('status', 'pending');

      if (updErr) {
        console.error('[approvals:POST] reject update error:', updErr.message);
        return NextResponse.json({ error: updErr.message }, { status: 500 });
      }

      // Item 5: Use maskedCustomerPhone in description and metadata
      // Item 7: Check error on insert
      const { error: actErr } = await db.from('business_activity_log').insert({
        workspace_id: ctx.workspace.id,
        action: 'approval_dismissed',
        description: `Owner ignored/dismissed queued inquiry from customer ${maskedCustomerPhone}.`,
        entity_type: 'customer_message',
        metadata: { approval_id, action: normAction, sent: false, phone: maskedCustomerPhone },
        created_at: new Date().toISOString(),
      });
      if (actErr) {
        console.error('[approvals:POST] reject activity log insert error:', actErr.message);
      }

      return NextResponse.json({ ok: true, status: 'rejected', sent: false });
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (e) {
    console.error('[approvals:POST] error:', e?.message || e);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}