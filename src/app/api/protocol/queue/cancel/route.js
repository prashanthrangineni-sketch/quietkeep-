// src/app/api/protocol/queue/cancel/route.js
// POST { item_id } — user cancels a pending queue item (always wins)

export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { cancelQueueItem } from '@/lib/execution-queue-engine';

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

    let body;
    try { body = await request.json(); } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const { item_id } = body;
    if (!item_id) return NextResponse.json({ error: 'item_id required' }, { status: 400 });

    const svc = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const result = await cancelQueueItem(svc, item_id, user.id);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

    return NextResponse.json({ ok: true, item_id, status: 'cancelled' });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
