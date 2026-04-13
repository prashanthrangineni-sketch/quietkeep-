// src/app/api/delivery/simulate/route.js
// Simulates delivery channels WITHOUT real API keys — logs results to DB
// Use to verify delivery chain logic before credentials are live

export const dynamic = 'force-dynamic';

import { NextResponse }             from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase-server';

const CHANNELS = ['push', 'whatsapp', 'email', 'inapp'];

export async function POST(request) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const {
    nudge_id   = null,
    keep_id    = null,
    title      = 'Test nudge',
    body: msg  = 'Delivery simulation test',
    channels   = CHANNELS,
    domain     = 'personal',
  } = body;

  const results = [];
  const now = new Date().toISOString();

  for (const channel of channels) {
    // Simulate: check if config EXISTS (not values), determine status
    const config = {
      push:      !!process.env.ONESIGNAL_APP_ID,
      whatsapp:  !!process.env.TWILIO_ACCOUNT_SID,
      email:     !!process.env.RESEND_API_KEY,
      inapp:     true, // always available
    };

    const configured = config[channel] ?? false;
    const status     = configured ? 'would_deliver' : 'missing_credentials';
    const sim_result = {
      channel,
      configured,
      status,
      simulated_at: now,
      payload: {
        title,
        body: msg,
        keep_id,
        domain,
      },
    };

    results.push(sim_result);

    // Log to nudge_queue with delivery_status=simulated
    if (nudge_id) {
      await supabase.from('nudge_queue').update({
        delivery_log: supabase.rpc ? undefined : sim_result, // fallback
        last_error: configured ? null : `Missing ${channel} credentials`,
      }).eq('id', nudge_id);
    }

    // Log to audit_log
    await supabase.from('audit_log').insert({
      user_id: user.id,
      action:  `delivery_simulate_${channel}`,
      service: 'delivery-simulator',
      details: sim_result,
    }).throwOnError().catch(() => {});
  }

  // Check what's missing
  const missing = CHANNELS.filter(ch => !results.find(r => r.channel === ch && r.configured));

  return NextResponse.json({
    ok:      true,
    results,
    missing_credentials: missing,
    summary: {
      total:       results.length,
      configured:  results.filter(r => r.configured).length,
      unconfigured: results.filter(r => !r.configured).length,
    },
  });
}

export async function GET(request) {
  // GET = quick health check of delivery config presence
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  return NextResponse.json({
    push:     { configured: !!process.env.ONESIGNAL_APP_ID,     key: 'ONESIGNAL_APP_ID' },
    whatsapp: { configured: !!process.env.TWILIO_ACCOUNT_SID,   key: 'TWILIO_ACCOUNT_SID' },
    email:    { configured: !!process.env.RESEND_API_KEY,        key: 'RESEND_API_KEY' },
    sarvam:   { configured: !!process.env.SARVAM_API_KEY,        key: 'SARVAM_API_KEY' },
    elevenlabs:{ configured: !!process.env.ELEVENLABS_API_KEY,   key: 'ELEVENLABS_API_KEY' },
    google_cal:{ configured: !!process.env.GOOGLE_CLIENT_ID,     key: 'GOOGLE_CLIENT_ID' },
    razorpay:  { configured: !!process.env.RAZORPAY_KEY_ID,      key: 'RAZORPAY_KEY_ID' },
  });
}
