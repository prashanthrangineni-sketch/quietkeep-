// src/app/api/auth/beta-verify/route.js
// Server-side beta credential verification — credentials NEVER sent to client
export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function parseBetaCreds() {
  const raw = process.env.BETA_CREDS || ''; // NOT NEXT_PUBLIC_ — server-only
  if (!raw) return {};
  return Object.fromEntries(
    raw.split(',').map(pair => {
      const idx = pair.indexOf(':');
      if (idx === -1) return ['', ''];
      return [pair.slice(0, idx).trim().toLowerCase(), pair.slice(idx + 1).trim()];
    }).filter(([k]) => k && k.includes('@'))
  );
}

export async function POST(request) {
  try {
    const { email } = await request.json();
    if (!email) return NextResponse.json({ error: 'Email required' }, { status: 400 });

    const norm = email.trim().toLowerCase();
    const betaCreds = parseBetaCreds();

    if (!betaCreds[norm]) {
      return NextResponse.json({ isBeta: false });
    }

    // Sign in with Supabase on server side — password never touches client
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    );

    const { data, error } = await supabase.auth.signInWithPassword({
      email: norm,
      password: betaCreds[norm],
    });

    if (error || !data.session) {
      return NextResponse.json({ isBeta: true, error: 'Beta sign-in failed. Check your credentials.' }, { status: 401 });
    }

    // Return session tokens so client can set them
    return NextResponse.json({
      isBeta: true,
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
    });
  } catch (e) {
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
