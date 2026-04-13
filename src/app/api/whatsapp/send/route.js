// src/app/api/whatsapp/send/route.js
// Send outbound WhatsApp message via Twilio
// Used by: keeps action layer, nudge delivery, manual send
// Requires: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM in env

import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase-server';

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
    return NextResponse.json({ error: json.message || json.error_message }, { status: 500 });
  }

  // Record successful send
  await supabase.from('whatsapp_outbound').insert({
    user_id: user.id, phone_number: to, message_body: message,
    keep_id, status: 'sent', twilio_sid: json.sid, sent_at: new Date().toISOString(),
  }).catch(() => {});

  return NextResponse.json({ ok: true, sid: json.sid, to, status: json.status });
}
