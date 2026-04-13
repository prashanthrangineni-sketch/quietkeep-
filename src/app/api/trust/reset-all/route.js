// src/app/api/trust/reset-all/route.js
// Phase 8 — Reset ALL intelligence for a user (nuclear option from Data Control tab)
// POST {} — clears behavior_patterns decay_weight/counters and decision_logs for user

export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function bearerClient(req) {
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: `Bearer ${token}` } } });
}

export async function POST(request) {
  try {
    const anon = bearerClient(request);
    if (!anon) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { data: { user } } = await anon.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const svc = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    // Reset feedback signals in ALL behavior_patterns for this user
    const { data: patterns } = await svc
      .from('behavior_patterns').select('id, metadata').eq('user_id', user.id);

    if (patterns?.length) {
      for (const p of patterns) {
        await svc.from('behavior_patterns').update({
          metadata: {
            ...(p.metadata || {}),
            decay_weight: 1.0, accept_count: 0, ignore_count: 0,
            never_show: false, last_feedback: null,
          },
          updated_at: new Date().toISOString(),
        }).eq('id', p.id);
      }
    }

    // Log the reset in audit_log
    svc.from('audit_log').insert({
      user_id: user.id, action: 'intelligence.reset_all',
      entity_type: 'user', entity_id: user.id,
      metadata: { pattern_count: patterns?.length || 0, reset_at: new Date().toISOString() },
    }).then(() => {}).catch(() => {});

    return NextResponse.json({ ok: true, patterns_reset: patterns?.length || 0 });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
