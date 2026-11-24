// src/app/api/cron/cart2save-feed/route.js
// ─────────────────────────────────────────────────────────────────────────────
// Cart2Save Feed Cron & Outbox Processing Endpoint (AG-1 / AG-3)
// ─────────────────────────────────────────────────────────────────────────────
// - Dispatches outbox batches to Cart2Save with HMAC header.
// - Retries failed deliveries with exponential backoff.
// - Handles nightly full re-send when requested (mode=nightly_full).
// - Off by default behind CART2SAVE_FEED_ENABLED.
// ─────────────────────────────────────────────────────────────────────────────

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { processFeedOutboxBatch } from '@/lib/cart2save/feed-sender';
import { enqueueNightlyFullResend } from '@/lib/cart2save/outbox';

async function handle(req) {
  // 1. Cron secret authorization (if CRON_SECRET is configured)
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = req.headers.get('Authorization') || '';
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  // 2. Feature flag check: Off by default behind CART2SAVE_FEED_ENABLED
  if (process.env.CART2SAVE_FEED_ENABLED !== 'true') {
    return NextResponse.json({
      enabled: false,
      message: 'Cart2Save feed is disabled by default. Set CART2SAVE_FEED_ENABLED=true to enable.',
    });
  }

  // 3. Supabase DB client setup
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return NextResponse.json({ error: 'Database environment variables not configured' }, { status: 500 });
  }
  const db = createClient(url, key, { auth: { persistSession: false } });

  // 4. Check query parameters / request body for nightly full resend
  const reqUrl = new URL(req.url);
  const isNightlyFull = reqUrl.searchParams.get('mode') === 'nightly_full' ||
                        reqUrl.searchParams.get('full_resend') === 'true';

  let fullResendResult = null;
  if (isNightlyFull) {
    fullResendResult = await enqueueNightlyFullResend(db);
  }

  // 5. Process pending outbox batch
  const batchResult = await processFeedOutboxBatch({ db });

  return NextResponse.json({
    ok: true,
    enabled: true,
    nightly_full_resend: fullResendResult,
    feed_result: batchResult,
  });
}

export async function GET(req) { return handle(req); }
export async function POST(req) { return handle(req); }
