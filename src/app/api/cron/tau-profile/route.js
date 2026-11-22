// src/app/api/cron/tau-profile/route.js
// T28 (22 Nov 2026): nightly rebuild of every active person's profile.
//
// Scheduled from pg_cron inside Supabase (migration 20261122_tau_profile_habits.sql),
// exactly like /api/cron/process-nudges: Vercel Hobby rejects extra crons, and
// pg_cron sends `Authorization: Bearer <CRON_SECRET>`. A missing secret fails
// closed. The voice route also refreshes a profile older than 6 hours, so this
// job is the backstop, not the only path.

export const dynamic = 'force-dynamic';
export const maxDuration = 60;
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { refreshTauProfile, PROFILE_WINDOW_DAYS } from '@/lib/tau-profile';

async function handle(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: 'Not configured' }, { status: 503 });
  if ((req.headers.get('Authorization') || '') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: 'Supabase env not configured' }, { status: 500 });
  const db = createClient(url, key, { auth: { persistSession: false } });

  // People who used Aaria in the profile window.
  const since = new Date(Date.now() - PROFILE_WINDOW_DAYS * 864e5).toISOString();
  const { data: recent, error } = await db.from('keeps')
    .select('user_id').gte('created_at', since).order('created_at', { ascending: false }).limit(5000);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const users = [...new Set((recent || []).map((r) => r.user_id).filter(Boolean))].slice(0, 500);

  const results = { users: users.length, built: 0, skipped: 0, failed: 0 };
  for (const userId of users) {
    const r = await refreshTauProfile(db, userId, { force: true });
    if (r.ok && !r.skipped) results.built++;
    else if (r.ok) results.skipped++;
    else results.failed++;
  }
  console.log('[cron/tau-profile]', JSON.stringify(results));
  return NextResponse.json({ ok: true, ...results });
}

export async function GET(req) { return handle(req); }
export async function POST(req) { return handle(req); }
