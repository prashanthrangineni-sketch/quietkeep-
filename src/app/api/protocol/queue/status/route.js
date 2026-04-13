// src/app/api/protocol/queue/status/route.js
// GET → { items: [...], pending, executing, succeeded, failed }

export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getQueueStatus } from '@/lib/execution-queue-engine';

function bearerClient(req) {
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );
}

export async function GET(request) {
  try {
    const anon = bearerClient(request);
    if (!anon) return NextResponse.json({ items: [] }, { status: 401 });
    const { data: { user } } = await anon.auth.getUser();
    if (!user) return NextResponse.json({ items: [] }, { status: 401 });

    const svc = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const { items } = await getQueueStatus(svc, user.id, 20);
    const counts = items.reduce((acc, item) => {
      acc[item.status] = (acc[item.status] || 0) + 1;
      return acc;
    }, {});

    return NextResponse.json({
      items,
      pending:   counts.pending   || 0,
      executing: counts.executing || 0,
      succeeded: counts.success   || 0,
      failed:    counts.failed    || 0,
    });
  } catch (e) {
    return NextResponse.json({ items: [] });
  }
}
