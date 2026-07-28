// src/app/api/auth/beta-verify/route.js
// ─────────────────────────────────────────────────────────────────────────────
// SECURITY FIX (P0): beta login previously signed a user in from EMAIL ALONE.
// The server held each tester's password in BETA_CREDS and called
// signInWithPassword() without the caller proving they knew ANY secret — so
// anyone who guessed a beta tester's email received that tester's full session.
//
// Fix: the caller MUST now supply the beta `code` (the value the biz-login UI
// already collects but never sent). We constant-time-compare it to the stored
// credential before signing in. Email alone is no longer sufficient.
//
// NOTE: biz-login/page.jsx verifyBeta() must send { email, code } (the code the
// user typed). Sending only { email } will now correctly fail with 401.
// ─────────────────────────────────────────────────────────────────────────────
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

// Length-independent constant-time string compare (avoids timing oracles).
function safeEqual(a, b) {
  const sa = String(a || '');
  const sb = String(b || '');
  let diff = sa.length ^ sb.length;
  const len = Math.max(sa.length, sb.length, 1);
  for (let i = 0; i < len; i++) {
    diff |= (sa.charCodeAt(i) || 0) ^ (sb.charCodeAt(i) || 0);
  }
  return diff === 0;
}

export async function POST(request) {
  try {
    const { email, code } = await request.json();
    if (!email) return NextResponse.json({ error: 'Email required' }, { status: 400 });

    const norm = email.trim().toLowerCase();
    const betaCreds = parseBetaCreds();

    // Do not reveal whether the email is a beta tester before a secret is proven.
    if (!betaCreds[norm]) {
      return NextResponse.json({ isBeta: false });
    }

    // ── the fix: caller must present the code, and it must match ──
    if (!code || !safeEqual(code, betaCreds[norm])) {
      return NextResponse.json(
        { isBeta: true, error: 'Invalid beta code.' },
        { status: 401 }
      );
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    );

    const { data, error } = await supabase.auth.signInWithPassword({
      email: norm,
      password: betaCreds[norm],
    });

    if (error || !data.session) {
      return NextResponse.json(
        { isBeta: true, error: 'Beta sign-in failed. Check your credentials.' },
        { status: 401 }
      );
    }

    return NextResponse.json({
      isBeta: true,
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
    });
  } catch (e) {
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
