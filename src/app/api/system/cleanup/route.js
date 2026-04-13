// src/app/api/system/cleanup/route.js
// Telemetry table archival — called by Vercel cron or manually.
//
// Vercel cron config (vercel.json):
//   { "crons": [{ "path": "/api/system/cleanup", "schedule": "0 3 * * *" }] }
//
// Alternatively, if pg_cron is enabled in Supabase, this route is not needed —
// the Supabase migration sets up the pg_cron job directly.
//
// Security: requires CRON_SECRET header to prevent unauthorized calls.
// Set CRON_SECRET in Vercel env vars to any strong random string.

export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

async function runCleanup() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
  const { data, error } = await supabase.rpc('archive_old_telemetry');
  if (error) throw new Error(error.message);
  return data;
}

function verifySecret(request) {
  const secret = request.headers.get('x-cron-secret') || '';
  const expected = process.env.CRON_SECRET || '';
  return expected && secret === expected;
}

export async function POST(request) {
  if (!verifySecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const result = await runCleanup();
    console.log('[cleanup] completed:', result);
    return NextResponse.json({ ok: true, result });
  } catch (e) {
    console.error('[cleanup] error:', e.message);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// Vercel cron sends GET by default
export async function GET(request) {
  return POST(request);
}
