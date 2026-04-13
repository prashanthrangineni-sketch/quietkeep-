// src/app/api/calendar/oauth/callback/route.js
// Delegates to /api/calendar/oauth — handles alternate callback path

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  const url   = new URL(request.url);
  const params = new URLSearchParams();
  const code  = url.searchParams.get('code');
  const error = url.searchParams.get('error');
  const state = url.searchParams.get('state');
  if (code)  params.set('code',  code);
  if (error) params.set('error', error);
  if (state) params.set('state', state);
  return NextResponse.redirect(new URL(`/api/calendar/oauth?${params}`, request.url));
}
