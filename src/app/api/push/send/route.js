// src/app/api/push/send/route.js
// FIXED: cookies() → Bearer token auth
import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

function createBearerClient(req) {
  const auth  = (req.headers.get('Authorization') || '').trim();
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : auth;
  if (!token) return null;
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );
}

export async function POST(request) {
  const supabase = createBearerClient(request);
  if (!supabase) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const appId  = process.env.ONESIGNAL_APP_ID;
  const apiKey = process.env.ONESIGNAL_API_KEY;
  if (!appId || !apiKey) {
    return NextResponse.json({ error: 'ONESIGNAL_APP_ID and ONESIGNAL_API_KEY not configured' }, { status: 503 });
  }

  let body;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { title, message, keep_id = null, data: extraData = {} } = body;
  if (!title || !message) return NextResponse.json({ error: 'title and message required' }, { status: 400 });

  const { data: settings } = await supabase
    .from('user_settings').select('onesignal_player_id').eq('user_id', user.id).single();

  if (!settings?.onesignal_player_id) {
    return NextResponse.json({ error: 'No push token registered for this user' }, { status: 404 });
  }

  const res = await fetch('https://onesignal.com/api/v1/notifications', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Basic ${apiKey}` },
    body: JSON.stringify({
      app_id: appId,
      include_player_ids: [settings.onesignal_player_id],
      headings: { en: title }, contents: { en: message },
      data: { keep_id: keep_id || '', ...extraData },
      android_channel_id: 'quietkeep-nudges', priority: 10,
    }),
  });

  const json = await res.json();
  if (!res.ok) return NextResponse.json({ error: json.errors || json }, { status: 500 });
  return NextResponse.json({ ok: true, notification_id: json.id, recipients: json.recipients });
}
