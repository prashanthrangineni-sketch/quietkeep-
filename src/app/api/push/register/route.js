// src/app/api/push/register/route.js
// FIXED: cookies() → Bearer-primary auth. Bearer is always tried first.
// v2: Added app_type (personal | business | web) and device_id.
export const dynamic = 'force-dynamic';
import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

export async function POST(request) {
  const auth  = (request.headers.get('Authorization') || '').trim();
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : auth;
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const {
    token:     deviceToken,
    platform  = 'android',
    provider  = 'onesignal',
    app_id    = process.env.NEXT_PUBLIC_ONESIGNAL_APP_ID || null,
    app_type  = 'personal',
    device_id = null,
  } = body;

  if (!deviceToken) return NextResponse.json({ error: 'token required' }, { status: 400 });

  const { data, error } = await supabase.rpc('register_device_token', {
    p_user_id:   user.id,
    p_token:     deviceToken,
    p_platform:  platform,
    p_provider:  provider,
    p_app_id:    app_id,
    p_app_type:  app_type,
    p_device_id: device_id,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, registered: data });
}
