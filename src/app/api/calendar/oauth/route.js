// src/app/api/calendar/oauth/route.js
// GET ?action=init  → redirect to Google consent screen
// GET ?code=...     → exchange code, store refresh_token, redirect to /settings

import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';

const REDIRECT_URI = 'https://quietkeep.com/api/calendar/oauth';
const SCOPE        = 'https://www.googleapis.com/auth/calendar.events';
const AUTH_URL     = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL    = 'https://oauth2.googleapis.com/token';

export async function GET(request) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL('/login', request.url));

  const clientId     = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return NextResponse.json(
      { error: 'GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET not set' },
      { status: 503 }
    );
  }

  const url    = new URL(request.url);
  const action = url.searchParams.get('action');
  const code   = url.searchParams.get('code');
  const error  = url.searchParams.get('error');
  const state  = url.searchParams.get('state');

  // INIT
  if (action === 'init') {
    const params = new URLSearchParams({
      client_id:     clientId,
      redirect_uri:  REDIRECT_URI,
      response_type: 'code',
      scope:         SCOPE,
      access_type:   'offline',
      prompt:        'consent',
      state:         user.id,   // CSRF: verified in callback
    });
    return NextResponse.redirect(`${AUTH_URL}?${params}`);
  }

  // CALLBACK error
  if (error) {
    return NextResponse.redirect(
      new URL(`/settings?calendar_error=${encodeURIComponent(error)}`, request.url)
    );
  }

  // CALLBACK code
  if (code) {
    if (state !== user.id) {
      return NextResponse.json({ error: 'State mismatch' }, { status: 400 });
    }

    const tokenRes = await fetch(TOKEN_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id:     clientId,
        client_secret: clientSecret,
        code,
        redirect_uri:  REDIRECT_URI,
        grant_type:    'authorization_code',
      }),
    });

    const tokens = await tokenRes.json();

    if (!tokenRes.ok || !tokens.refresh_token) {
      const msg = tokens.error_description || tokens.error || 'token_exchange_failed';
      return NextResponse.redirect(
        new URL(`/settings?calendar_error=${encodeURIComponent(msg)}`, request.url)
      );
    }

    await supabase.from('user_settings').upsert(
      { user_id: user.id, calendar_refresh_token: tokens.refresh_token, calendar_enabled: true },
      { onConflict: 'user_id' }
    );

    return NextResponse.redirect(new URL('/settings?calendar_connected=1', request.url));
  }

  return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
}
