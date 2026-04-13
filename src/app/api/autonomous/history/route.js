// src/app/api/autonomous/history/route.js
// Phase 6 — Last 10 auto actions for the Review panel
// GET → { history: [{ decision, reason, priority_score, inputs, created_at }] }

export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function anonClient(req) {
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
    const anon = anonClient(request);
    if (!anon) return NextResponse.json({ history: [] }, { status: 401 });

    const { data: { user } } = await anon.auth.getUser();
    if (!user) return NextResponse.json({ history: [] }, { status: 401 });

    // Service role needed to read decision_logs (RLS: owned by system)
    const svc = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const { data, error } = await svc
      .from('decision_logs')
      .select('decision, reason, priority_score, inputs, created_at')
      .eq('user_id', user.id)
      .eq('mode', 'autonomous')
      .in('decision', ['auto_trigger', 'strong_suggest', 'suggestion_shown'])
      .order('created_at', { ascending: false })
      .limit(10);

    if (error) return NextResponse.json({ history: [] });
    return NextResponse.json({ history: data || [] });

  } catch (e) {
    console.error('[AUTONOMOUS/HISTORY] error:', e.message);
    return NextResponse.json({ history: [] });
  }
}
