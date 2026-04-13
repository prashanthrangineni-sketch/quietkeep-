// src/app/api/protocol/queue/process/route.js
// Phase 9 — Queue Worker
// Processes the next N pending items from execution_queue.
// Called by: pg_cron (via edge function), or client after cancel window expires.
//
// POST { limit?: number }   — processes up to `limit` items (default 5)
// Returns: { processed, succeeded, failed }

export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { processQueueItem } from '@/lib/execution-queue-engine';

function bearerClient(req) {
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );
}

export async function POST(request) {
  try {
    const anon = bearerClient(request);
    if (!anon) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { data: { user } } = await anon.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    let body = {};
    try { body = await request.json(); } catch {}
    const limit = Math.min(body.limit ?? 5, 10);

    const svc = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    // Fetch pending items past their cancel window
    const { data: items } = await svc
      .from('execution_queue')
      .select('*')
      .eq('user_id', user.id)
      .eq('status', 'pending')
      .lt('cancel_before', new Date().toISOString()) // past cancel window
      .order('created_at', { ascending: true })
      .limit(limit);

    if (!items?.length) return NextResponse.json({ processed: 0, succeeded: 0, failed: 0 });

    let succeeded = 0, failed = 0;
    for (const item of items) {
      const result = await processQueueItem(svc, item);
      if (result.ok) succeeded++;
      else if (result.error !== 'in_cancel_window') failed++;
    }

    return NextResponse.json({ processed: items.length, succeeded, failed });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
