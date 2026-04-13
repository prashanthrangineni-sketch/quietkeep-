// src/app/api/keeps/[id]/feedback/route.js
// FIXED v2: Replaced createSupabaseServerClient (cookies) with Bearer token auth.
// Dashboard already sends Authorization: Bearer on all feedback calls.

import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { applyFeedback } from '@/lib/behavior-intelligence'; // v2: Feedback loop

function createSupabaseClientFromBearer(req) {
  const auth = req.headers.get('Authorization') || '';
  const token = auth.replace('Bearer ', '').trim();
  if (!token) return { supabase: null };
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );
  return { supabase };
}

export async function POST(request, { params }) {
  const { supabase } = createSupabaseClientFromBearer(request);
  if (!supabase) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = params;
  let body;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { outcome, latency_seconds = null } = body;
  const VALID_OUTCOMES = ['acted', 'ignored', 'dismissed', 'deferred'];

  if (!outcome || !VALID_OUTCOMES.includes(outcome)) {
    return NextResponse.json({
      error: `Invalid outcome. Must be one of: ${VALID_OUTCOMES.join(', ')}`,
    }, { status: 400 });
  }

  const { data: keep } = await supabase
    .from('keeps')
    .select('id, user_id, intent_type, domain_type')
    .eq('id', id)
    .eq('user_id', user.id)
    .single();

  if (!keep) return NextResponse.json({ error: 'Keep not found' }, { status: 404 });

  const { data, error } = await supabase.rpc('update_intent_priority', {
    p_keep_id:         id,
    p_user_id:         user.id,
    p_outcome:         outcome,
    p_latency_seconds: latency_seconds,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // v2: Feedback loop — adjust behavior_patterns decay_weight (non-blocking)
  applyFeedback(user.id, keep.intent_type, outcome, keep.contact_name || null)
    .catch(() => {});

  return NextResponse.json({
    success: true,
    outcome,
    new_priority:      data?.new_priority,
    new_success_rate:  data?.new_success_rate,
    new_ignore_count:  data?.new_ignore_count,
  });
}
