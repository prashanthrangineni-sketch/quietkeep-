// src/app/api/whatsapp/send/route.js
// Send outbound WhatsApp message via Twilio
// Used by: keeps action layer, nudge delivery, manual send, business messaging
// Requires: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM in env

import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import {
  evaluatePromotionSend,
  isCustomerOptedOutInDb,
  logBusinessLimitEvent,
  sanitizeSnippet,
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

  // ── BUSINESS PROMOTION LIMITS ENFORCEMENT (CARD AG-AARIA-25) ───────────────
  const isBusiness = Boolean(body.workspace_id);
  const isPromotional = body.is_promotional === true || body.message_type === 'promotional';
  const isTransactional = body.is_transactional === true || body.message_type === 'transactional';

  if (isBusiness) {
    const wsId = body.workspace_id;

    // 1. Opt-out check: never messaged again (unless purely transactional update)
    const isOptedOut = await isCustomerOptedOutInDb(supabase, wsId, to);
    if (isOptedOut && !isTransactional) {
      await logBusinessLimitEvent(supabase, wsId, {
        who: to,
        what: 'promotion_blocked',
        why: 'customer_opted_out',
        rawMessage: message,
      });
      return NextResponse.json({
        error: 'Customer has opted out (STOP / వద్దు / बंद करो). Never messaged again.',
        code: 'customer_opted_out',
      }, { status: 403 });
    }

    // 2. Promotional limits check (daily/weekly caps, 250/day new-biz cap, 10:00-21:00 IST window)
    if (isPromotional) {
      const { data: ws } = await supabase
        .from('business_workspaces')
        .select('created_at, daily_promo_limit')
        .eq('id', wsId)
        .maybeSingle();

      const todayStart = new Date();
      todayStart.setUTCHours(0, 0, 0, 0);
      const weekStart = new Date(Date.now() - 7 * 24 * 3600 * 1000);

      const [{ count: bizTodayCount }, { count: custTodayCount }, { count: custWeekCount }] = await Promise.all([
        supabase.from('business_promo_log')
          .select('id', { count: 'exact', head: true })
          .eq('workspace_id', wsId)
          .eq('status', 'sent')
          .gte('sent_at', todayStart.toISOString()),
        supabase.from('business_promo_log')
          .select('id', { count: 'exact', head: true })
          .eq('workspace_id', wsId)
          .eq('phone', to)
          .eq('status', 'sent')
          .gte('sent_at', todayStart.toISOString()),
        supabase.from('business_promo_log')
          .select('id', { count: 'exact', head: true })
          .eq('workspace_id', wsId)
          .eq('phone', to)
          .eq('status', 'sent')
          .gte('sent_at', weekStart.toISOString()),
      ]);

      const promoEval = evaluatePromotionSend({
        businessCreatedAt: ws?.created_at,
        ownerDailyLimit: ws?.daily_promo_limit,
        businessSentToday: bizTodayCount || 0,
        customerSentToday: custTodayCount || 0,
        customerSentThisWeek: custWeekCount || 0,
        isCustomerOptedOut: false,
        isTransactional: false,
        now: new Date(),
      });

      if (!promoEval.allowed) {
        await logBusinessLimitEvent(supabase, wsId, {
          who: to,
          what: 'promotion_blocked',
          why: promoEval.reason,
          rawMessage: message,
          metadata: { limit: promoEval.limit },
        });

        await supabase.from('business_promo_log').insert({
          workspace_id: wsId,
          phone: to,
          message_type: 'promotional',
          status: 'blocked',
          blocked_reason: promoEval.reason,
          snippet: sanitizeSnippet(message),
          sent_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
        }).catch(() => {});

        return NextResponse.json({
          error: promoEval.ownerMessage || promoEval.reason,
          code: promoEval.reason,
        }, { status: 429 });
      }
    }
  }

  // Send via Twilio
  const params = new URLSearchParams({
    From: `whatsapp:${from}`,
    To:   `whatsapp:${to}`,
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
    // Log failed attempt
    await supabase.from('whatsapp_outbound').insert({
      user_id: user.id, phone_number: to, message_body: message,
      keep_id, status: 'failed',
      error_message: json.message || json.error_message,
    }).catch(() => {});

    if (isBusiness) {
      await supabase.from('business_promo_log').insert({
        workspace_id: body.workspace_id,
        phone: to,
        message_type: isPromotional ? 'promotional' : 'transactional',
        status: 'failed',
        blocked_reason: json.message || json.error_message,
        snippet: sanitizeSnippet(message),
        sent_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
      }).catch(() => {});
    }

    return NextResponse.json({ error: json.message || json.error_message }, { status: 500 });
  }

  // Record successful send
  await supabase.from('whatsapp_outbound').insert({
    user_id: user.id, phone_number: to, message_body: message,
    keep_id, status: 'sent', twilio_sid: json.sid, sent_at: new Date().toISOString(),
  }).catch(() => {});

  if (isBusiness) {
    await supabase.from('business_promo_log').insert({
      workspace_id: body.workspace_id,
      phone: to,
      message_type: isPromotional ? 'promotional' : 'transactional',
      status: 'sent',
      snippet: sanitizeSnippet(message),
      sent_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    }).catch(() => {});
  }

  return NextResponse.json({ ok: true, sid: json.sid, to, status: json.status });
}