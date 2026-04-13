// src/app/api/engine/audit/route.js
// Returns system-wide audit: which integrations are active,
// missing configs, Android connection status

export const dynamic = 'force-dynamic';

import { NextResponse }             from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase-server';

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const missing = [];

  const push_active      = !!process.env.ONESIGNAL_APP_ID && !!process.env.ONESIGNAL_API_KEY;
  const whatsapp_active  = !!process.env.TWILIO_ACCOUNT_SID && !!process.env.TWILIO_AUTH_TOKEN;
  const email_active     = !!process.env.RESEND_API_KEY && !!process.env.FROM_EMAIL;
  const sarvam_active    = !!process.env.SARVAM_API_KEY;
  const elevenlabs_active= !!process.env.ELEVENLABS_API_KEY;
  const google_cal_active= !!process.env.GOOGLE_CLIENT_ID && !!process.env.GOOGLE_CLIENT_SECRET;
  const razorpay_active  = !!process.env.RAZORPAY_KEY_ID && !!process.env.RAZORPAY_KEY_SECRET;

  if (!push_active)       missing.push('ONESIGNAL_APP_ID', 'ONESIGNAL_API_KEY');
  if (!whatsapp_active)   missing.push('TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_WHATSAPP_FROM');
  if (!email_active)      missing.push('RESEND_API_KEY', 'FROM_EMAIL');
  if (!sarvam_active)     missing.push('SARVAM_API_KEY');
  if (!elevenlabs_active) missing.push('ELEVENLABS_API_KEY');
  if (!google_cal_active) missing.push('GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET');
  if (!razorpay_active)   missing.push('RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET');

  // Check Android device token for this user
  const { count: androidCount } = await supabase
    .from('device_tokens')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .eq('platform', 'android');

  // Check calendar connected
  const { data: calData } = await supabase
    .from('user_settings')
    .select('calendar_refresh_token, calendar_enabled')
    .eq('user_id', user.id)
    .maybeSingle();

  // Last nudge delivery stats
  const { data: nudgeStats } = await supabase.rpc('get_system_health', { p_hours_back: 24 });

  return NextResponse.json({
    push_active,
    whatsapp_active,
    email_active,
    sarvam_active,
    elevenlabs_active,
    google_cal_active,
    razorpay_active,
    android_connected:    (androidCount || 0) > 0,
    calendar_connected:   !!calData?.calendar_refresh_token,
    missing_configs:      [...new Set(missing)],
    system_health:        nudgeStats || null,
    checked_at:           new Date().toISOString(),
  });
}
