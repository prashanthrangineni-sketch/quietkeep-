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
      .eq('status', 'pending')
      .maybeSingle();

    if (fetchErr) {
      console.error('[approvals:POST] fetch error:', fetchErr.message);
      return NextResponse.json({ error: fetchErr.message }, { status: 500 });
    }

    if (!approval) {
      return NextResponse.json({ error: 'Pending approval not found' }, { status: 404 });
    }

    const targetCustomerPhone = normalizePhoneNumber(
      approval.payload?.customerPhone ||
      approval.payload?.customer_phone ||
      approval.payload?.who ||
      approval.payload?.phone ||
      ''
    );
    const maskedCustomerPhone = maskPhoneNumber(targetCustomerPhone);

    const isOrderOrBooking =
      approval.action_type === 'business_order_confirm' ||
      approval.action_type === 'business_booking_confirm' ||
      approval.payload?.what === 'order_request' ||
      approval.payload?.what === 'booking_request' ||
      approval.payload?.what === 'order' ||
      approval.payload?.what === 'booking';

    // ── 1. APPROVE / SEND / CONFIRM / EDIT (Item K & 4) ───────────────────────
    if (['send', 'edit', 'confirm', 'approve'].includes(normAction)) {
      let replyMessage = (normAction === 'edit' && edited_message)
        ? String(edited_message).trim()
        : (approval.payload?.suggested_reply || null);

      if (!replyMessage && isOrderOrBooking) {
        if (approval.action_type === 'business_booking_confirm' || approval.payload?.what === 'booking_request' || approval.payload?.what === 'booking') {
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

      // On send failure, keep status pending and return error (Item 4)
      if (!sentSuccess) {
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
        .eq('status', 'pending');

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