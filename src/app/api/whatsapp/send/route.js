// src/app/api/whatsapp/send/route.js
// Send outbound WhatsApp message via Twilio with business limits enforcement.
// Used by: keeps action layer, nudge delivery, manual send, business messaging
// Requires: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM in env

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import {
  evaluatePromotionSend,
  isCustomerOptedOutInDb,
  logBusinessLimitEvent,
  sanitizeSnippet,
  normalizePhoneNumber,
  getIstStartOfDay,
} from '@/lib/business-limits';

export async function POST(request) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const sid   = process.env.TWILIO_ACCOUNT_SID;
  const auth  = process.env.TWILIO_AUTH_TOKEN;
  const from  = process.env.TWILIO_WHATSAPP_FROM || '+14155238886';
  if (!sid || !auth) {
    return NextResponse.json({ error: 'Twilio credentials not configured. Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN.' }, { status: 503 });
  }

  let body;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  let { to, message, keep_id = null } = body;

  // If 'to' not provided, use user's stored phone number
  if (!to) {
    const { data: settings } = await supabase
      .from('user_settings')
      .select('phone_number, whatsapp_enabled')
      .eq('user_id', user.id)
      .single();

    if (!settings?.phone_number) {
      return NextResponse.json({ error: 'No phone number. Provide "to" or set phone_number in settings.' }, { status: 400 });
    }
    if (!settings.whatsapp_enabled) {
      return NextResponse.json({ error: 'WhatsApp not enabled for this user. Enable in settings.' }, { status: 403 });
    }
    to = settings.phone_number;
  }

  if (!message) return NextResponse.json({ error: 'message required' }, { status: 400 });

  const normTo = normalizePhoneNumber(to);
  if (!normTo) return NextResponse.json({ error: 'Invalid destination phone number' }, { status: 400 });

  // Use service-role client on server for privileged verification, RLS bypass and secure audit logging
  const adminDb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  // ── WORKSPACE RESOLUTION & MEMBERSHIP VERIFICATION (Item B) ─────────────────
  let workspace = null;
  let isBusiness = false;
  let workspacesToCheck = [];

  if (body.workspace_id) {
    // Caller specified a workspace: MUST verify caller is owner or active member
    const { data: ownedWs, error: ownedErr } = await adminDb
      .from('business_workspaces')
      .select('id, created_at, daily_promo_limit, name')
      .eq('id', body.workspace_id)
      .eq('owner_user_id', user.id)
      .limit(1);

    if (ownedErr) {
      console.error('[whatsapp/send] workspace owner check error:', ownedErr.message);
      return NextResponse.json({
        error: 'Failed to verify workspace ownership',
        code: 'workspace_check_failed',
      }, { status: 500 });
    }

    const ownedRow = Array.isArray(ownedWs) ? ownedWs[0] : ownedWs;
    if (ownedRow) {
      workspace = ownedRow;
      isBusiness = true;
    } else {
      const { data: member, error: memberErr } = await adminDb
        .from('business_members')
        .select('id, workspace_id')
        .eq('workspace_id', body.workspace_id)
        .eq('user_id', user.id)
        .eq('status', 'active')
        .limit(1);

      if (memberErr) {
        console.error('[whatsapp/send] member check error:', memberErr.message);
        return NextResponse.json({
          error: 'Failed to verify workspace membership',
          code: 'membership_check_failed',
        }, { status: 500 });
      }

      const memRow = Array.isArray(member) ? member[0] : member;
      if (memRow) {
        const { data: ws, error: wsErr } = await adminDb
          .from('business_workspaces')
          .select('id, created_at, daily_promo_limit, name')
          .eq('id', body.workspace_id)
          .limit(1);

        if (wsErr) {
          console.error('[whatsapp/send] ws query error:', wsErr.message);
          return NextResponse.json({
            error: 'Failed to load workspace',
            code: 'workspace_check_failed',
          }, { status: 500 });
        }
        workspace = Array.isArray(ws) ? ws[0] : ws;
        isBusiness = true;
      }
    }

    if (!workspace) {
      return NextResponse.json({
        error: 'Forbidden: caller is not an owner or active member of this workspace',
        code: 'forbidden_workspace',
      }, { status: 403 });
    }
    workspacesToCheck = [workspace];
  } else {
    // Item 2: when workspace_id is omitted, check all workspaces the caller owns or is a member of
    const [{ data: ownedList, error: ownedErr }, { data: memberList, error: memErr }] = await Promise.all([
      adminDb.from('business_workspaces')
        .select('id, created_at, daily_promo_limit, name')
        .eq('owner_user_id', user.id),
      adminDb.from('business_members')
        .select('workspace_id')
        .eq('user_id', user.id)
        .eq('status', 'active'),
    ]);

    if (ownedErr || memErr) {
      console.error('[whatsapp/send] owned/member workspaces error:', ownedErr?.message || memErr?.message);
      return NextResponse.json({
        error: 'Failed to query user workspaces',
        code: 'workspace_lookup_failed',
      }, { status: 500 });
    }

    const wsMap = new Map();
    (ownedList || []).forEach(w => wsMap.set(w.id, w));

    const memberWsIds = (memberList || []).map(m => m.workspace_id).filter(id => !wsMap.has(id));
    if (memberWsIds.length > 0) {
      const { data: mWsList, error: mWsErr } = await adminDb
        .from('business_workspaces')
        .select('id, created_at, daily_promo_limit, name')
        .in('id', memberWsIds);
      if (mWsErr) {
        console.error('[whatsapp/send] member ws fetch error:', mWsErr.message);
        return NextResponse.json({
          error: 'Failed to query member workspaces',
          code: 'workspace_lookup_failed',
        }, { status: 500 });
      }
      (mWsList || []).forEach(w => wsMap.set(w.id, w));
    }

    workspacesToCheck = Array.from(wsMap.values());
    if (workspacesToCheck.length > 0) {
      isBusiness = true;
      workspace = workspacesToCheck[0];
    }
  }

  // ── SERVER DECIDES: PROMOTIONAL VS TRANSACTIONAL (Item B, F & 3) ───────────
  let promoLogId = null;

  if (isBusiness && workspacesToCheck.length > 0) {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 3600 * 1000).toISOString();

    // Proof 1: Inbound customer message in last 24h across candidate workspaces
    let isCustomerInitiatedReply = false;
    for (const ws of workspacesToCheck) {
      const { data: recentApprovals, error: rApprErr } = await adminDb
        .from('business_approvals')
        .select('id, payload')
        .eq('workspace_id', ws.id)
        .gte('created_at', twentyFourHoursAgo)
        .limit(20);

      if (rApprErr) {
        console.error('[whatsapp/send] recent approvals query error:', rApprErr.message);
        return NextResponse.json({
          error: 'Failed to check recent customer communications',
          code: 'approvals_query_failed',
        }, { status: 500 });
      }

      if ((recentApprovals || []).some(a => {
        const p = normalizePhoneNumber(
          a.payload?.customerPhone ||
          a.payload?.customer_phone ||
          a.payload?.who ||
          a.payload?.phone ||
          ''
        );
        return p === normTo;
      })) {
        isCustomerInitiatedReply = true;
        break;
      }
    }

    // Proof 2: Order / booking status update tied to a real order/invoice (Item 3 & Round 4 Item 2)
    let isOrderUpdate = false;
    if (body.order_id) {
      for (const ws of workspacesToCheck) {
        // 1. Check business_invoices
        const { data: invoice, error: invErr } = await adminDb
          .from('business_invoices')
          .select('id, customer_phone')
          .eq('id', body.order_id)
          .eq('workspace_id', ws.id)
          .limit(1);

        if (invErr) {
          console.error('[whatsapp/send] invoice query error:', invErr.message);
          return NextResponse.json({
            error: 'Failed to verify invoice record',
            code: 'invoice_lookup_failed',
          }, { status: 500 });
        }

        const invRow = Array.isArray(invoice) ? invoice[0] : invoice;
        if (invRow) {
          const invPhone = normalizePhoneNumber(invRow.customer_phone);
          if (invPhone && invPhone === normTo) {
            isOrderUpdate = true;
            break;
          }
        }

        // 2. Check business_approvals
        // Drop customer_phone from select (does not exist in live business_approvals table)
        const { data: orderAppr, error: apprErr } = await adminDb
          .from('business_approvals')
          .select('id, action_type, payload, status')
          .eq('id', body.order_id)
          .eq('workspace_id', ws.id)
          .limit(1);

        if (apprErr) {
          console.error('[whatsapp/send] approval query error:', apprErr.message);
          return NextResponse.json({
            error: 'Failed to verify approval record',
            code: 'approval_lookup_failed',
          }, { status: 500 });
        }

        const apprRow = Array.isArray(orderAppr) ? orderAppr[0] : orderAppr;
        if (apprRow) {
          let apprPhone = normalizePhoneNumber(
            apprRow.payload?.customerPhone ||
            apprRow.payload?.customer_phone ||
            apprRow.payload?.who ||
            apprRow.payload?.phone ||
            ''
          );

          if (!apprPhone && (apprRow.payload?.order_id || apprRow.payload?.invoice_id)) {
            const linkedId = apprRow.payload?.order_id || apprRow.payload?.invoice_id;
            const { data: linkedInv, error: linkedErr } = await adminDb
              .from('business_invoices')
              .select('customer_phone')
              .eq('id', linkedId)
              .eq('workspace_id', ws.id)
              .limit(1);

            if (linkedErr) {
              console.error('[whatsapp/send] linked invoice query error:', linkedErr.message);
              return NextResponse.json({
                error: 'Failed to verify linked invoice record',
                code: 'linked_invoice_lookup_failed',
              }, { status: 500 });
            }

            const linkedRow = Array.isArray(linkedInv) ? linkedInv[0] : linkedInv;
            if (linkedRow?.customer_phone) {
              apprPhone = normalizePhoneNumber(linkedRow.customer_phone);
            }
          }

          const what = String(apprRow.payload?.what || apprRow.payload?.type || '').toLowerCase();
          const actionType = String(apprRow.action_type || '').toLowerCase();
          // Remove status === 'out_for_delivery' from isOrderType (Round 4 Item 2)
          const isOrderType =
            actionType.includes('order') ||
            actionType.includes('booking') ||
            what.includes('order') ||
            what.includes('booking');

          if (isOrderType && apprPhone && apprPhone === normTo) {
            isOrderUpdate = true;
            break;
          }
        }
      }
    }

    const isTransactional = isCustomerInitiatedReply || isOrderUpdate;
    const isPromotional = !isTransactional;

    // 1. Opt-out check: block if ANY workspace has customer opt-out (Item 2 & Round 4 Item 1)
    let isOptedOut = false;
    let optedOutWsId = null;
    for (const ws of workspacesToCheck) {
      const { optedOut, error: optOutErr } = await isCustomerOptedOutInDb(adminDb, ws.id, normTo);
      if (optOutErr) {
        console.error('[whatsapp/send] opt-out check error:', optOutErr.message || optOutErr);
        return NextResponse.json({
          error: 'Failed to verify customer opt-out status',
          code: 'opt_out_check_failed',
        }, { status: 500 });
      }
      if (optedOut) {
        isOptedOut = true;
        optedOutWsId = ws.id;
        break;
      }
    }

    if (isOptedOut) {
      if (!isTransactional) {
        await logBusinessLimitEvent(adminDb, optedOutWsId || workspace.id, {
          who: normTo,
          what: 'promotion_blocked',
          why: 'customer_opted_out',
          rawMessage: message,
        });
        return NextResponse.json({
          error: 'Customer has opted out (STOP / వద్దు / बंद करो). Only direct replies to questions or order updates may be sent.',
          code: 'customer_opted_out',
        }, { status: 403 });
      }
    }

    // 2. Promotional limits check across workspaces (Item 6: message_type='promotional' and Asia/Kolkata start of day)
    if (isPromotional) {
      const todayStart = getIstStartOfDay();
      const weekStart = new Date(Date.now() - 7 * 24 * 3600 * 1000);

      for (const ws of workspacesToCheck) {
        const [{ count: bizTodayCount, error: err1 }, { count: custTodayCount, error: err2 }, { count: custWeekCount, error: err3 }] = await Promise.all([
          adminDb.from('business_promo_log')
            .select('id', { count: 'exact', head: true })
            .eq('workspace_id', ws.id)
            .eq('message_type', 'promotional')
            .eq('status', 'sent')
            .gte('sent_at', todayStart.toISOString()),
          adminDb.from('business_promo_log')
            .select('id', { count: 'exact', head: true })
            .eq('workspace_id', ws.id)
            .eq('phone', normTo)
            .eq('message_type', 'promotional')
            .eq('status', 'sent')
            .gte('sent_at', todayStart.toISOString()),
          adminDb.from('business_promo_log')
            .select('id', { count: 'exact', head: true })
            .eq('workspace_id', ws.id)
            .eq('phone', normTo)
            .eq('message_type', 'promotional')
            .eq('status', 'sent')
            .gte('sent_at', weekStart.toISOString()),
        ]);

        if (err1 || err2 || err3) {
          console.error('[whatsapp/send] promo log count error:', err1?.message || err2?.message || err3?.message);
          return NextResponse.json({ error: 'Failed to verify promotional limits', code: 'count_failed' }, { status: 500 });
        }

        const promoEval = evaluatePromotionSend({
          businessCreatedAt: ws.created_at,
          ownerDailyLimit: ws.daily_promo_limit,
          businessSentToday: bizTodayCount || 0,
          customerSentToday: custTodayCount || 0,
          customerSentThisWeek: custWeekCount || 0,
          isCustomerOptedOut: false,
          isTransactional: false,
          isCustomerInitiatedReply: false,
          isOrderUpdate: false,
          now: new Date(),
        });

        if (!promoEval.allowed) {
          await logBusinessLimitEvent(adminDb, ws.id, {
            who: normTo,
            what: 'promotion_blocked',
            why: promoEval.reason,
            rawMessage: message,
            metadata: { limit: promoEval.limit },
          });

          const { error: blockedLogErr } = await adminDb.from('business_promo_log').insert({
            workspace_id: ws.id,
            phone: normTo,
            message_type: 'promotional',
            status: 'blocked',
            blocked_reason: promoEval.reason,
            snippet: sanitizeSnippet(message),
            sent_at: new Date().toISOString(),
            created_at: new Date().toISOString(),
          });

          if (blockedLogErr) {
            console.error('[whatsapp/send] recording blocked promo failed:', blockedLogErr.message);
          }

          return NextResponse.json({
            error: promoEval.ownerMessage || promoEval.reason,
            code: promoEval.reason,
          }, { status: 429 });
        }
      }
    }

    // Fail-closed promo log insert (Item A): if log write fails, do NOT send promotion!
    const { data: promoRow, error: logErr } = await adminDb.from('business_promo_log').insert({
      workspace_id: workspace.id,
      phone: normTo,
      message_type: isPromotional ? 'promotional' : 'transactional',
      status: 'sent',
      snippet: sanitizeSnippet(message),
      sent_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    }).select('id').single();

    if (logErr) {
      console.error('[whatsapp/send] business_promo_log write failed (failing closed):', logErr.message);
      return NextResponse.json({
        error: 'Failed to record promo log. Message blocked for audit compliance.',
        code: 'promo_log_failed',
      }, { status: 500 });
    }
    promoLogId = promoRow?.id;

    if (isPromotional) {
      await logBusinessLimitEvent(adminDb, workspace.id, {
        who: normTo,
        what: 'promotion_sent',
        why: 'within_limits',
        rawMessage: message,
      });
    }
  }

  // Send via Twilio
  const params = new URLSearchParams({
    From: `whatsapp:${from}`,
    To:   `whatsapp:${normTo}`,
    Body: message,
  });

  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${Buffer.from(`${sid}:${auth}`).toString('base64')}`,
      },
      body: params.toString(),
    }
  );

  const json = await res.json();
  if (!res.ok || json.status === 'failed') {
    const errorMsg = json.message || json.error_message || 'Twilio send failed';

    // Log failed attempt
    const { error: outErr } = await adminDb.from('whatsapp_outbound').insert({
      user_id: user.id, phone_number: normTo, message_body: message,
      keep_id, status: 'failed',
      error_message: errorMsg,
    });
    if (outErr) console.error('[whatsapp/send] outbound failure log error:', outErr.message);

    if (isBusiness && promoLogId) {
      const { error: updateErr } = await adminDb.from('business_promo_log').update({
        status: 'failed',
        blocked_reason: errorMsg,
      }).eq('id', promoLogId);
      if (updateErr) console.error('[whatsapp/send] promo log update error:', updateErr.message);
    }

    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }

  // Record successful send
  const { error: outOkErr } = await adminDb.from('whatsapp_outbound').insert({
    user_id: user.id, phone_number: normTo, message_body: message,
    keep_id, status: 'sent', twilio_sid: json.sid, sent_at: new Date().toISOString(),
  });
  if (outOkErr) console.error('[whatsapp/send] outbound ok log error:', outOkErr.message);

  return NextResponse.json({ ok: true, sid: json.sid, to: normTo, status: json.status });
}