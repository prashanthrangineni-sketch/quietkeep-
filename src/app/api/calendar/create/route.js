// src/app/api/calendar/create/route.js
// Create Google Calendar event from a keep intent
// Auth: uses user's stored calendar_refresh_token from user_settings
// Requires: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET in env vars
// 
// Setup: User must complete OAuth flow at /settings → "Connect Google Calendar"
// The OAuth callback stores refresh_token in user_settings.calendar_refresh_token

export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase-server';

const GOOGLE_TOKEN_URL  = 'https://oauth2.googleapis.com/token';
const GOOGLE_CAL_API    = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';

async function getAccessToken(refreshToken) {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type:    'refresh_token',
    }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`Token refresh failed: ${json.error_description || json.error}`);
  return json.access_token;
}

export async function POST(request) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return NextResponse.json({ error: 'GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET not configured.' }, { status: 503 });
  }

  let body;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { keep_id, title, description = '', start_time, end_time, timezone = 'Asia/Kolkata' } = body;
  if (!title || !start_time) return NextResponse.json({ error: 'title and start_time required' }, { status: 400 });

  // Get user's calendar refresh token
  const { data: settings } = await supabase
    .from('user_settings')
    .select('calendar_refresh_token, calendar_enabled')
    .eq('user_id', user.id).single();

  if (!settings?.calendar_refresh_token) {
    return NextResponse.json({ error: 'Calendar not connected. Go to settings → Connect Google Calendar.' }, { status: 403 });
  }
  if (!settings.calendar_enabled) {
    return NextResponse.json({ error: 'Calendar integration not enabled.' }, { status: 403 });
  }

  // Get access token
  const accessToken = await getAccessToken(settings.calendar_refresh_token).catch(e => {
    throw new Error('Calendar auth failed: ' + e.message);
  });

  // Compute end time if not provided (default: 1 hour)
  const startDt = new Date(start_time);
  const endDt = end_time ? new Date(end_time) : new Date(startDt.getTime() + 3600_000);

  const event = {
    summary: title,
    description: keep_id ? `QuietKeep: ${description}\nkeep_id:${keep_id}` : description,
    start: { dateTime: startDt.toISOString(), timeZone: timezone },
    end:   { dateTime: endDt.toISOString(),   timeZone: timezone },
    reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 15 }] },
  };

  const res = await fetch(GOOGLE_CAL_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
    body: JSON.stringify(event),
  });

  const json = await res.json();
  if (!res.ok) return NextResponse.json({ error: json.error?.message || 'Calendar API error' }, { status: 500 });

  // Log to intent_actions
  if (keep_id) {
    await supabase.rpc('log_intent_action', {
      p_keep_id: keep_id, p_user_id: user.id,
      p_action_type: 'calendar_created',
      p_payload: { event_id: json.id, html_link: json.htmlLink, title, start_time },
      p_triggered_by: 'user',
    }).catch(() => {});
  }

  return NextResponse.json({
    ok: true,
    event_id: json.id,
    html_link: json.htmlLink,
    summary: json.summary,
    start: json.start,
  });
}
