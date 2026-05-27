// src/app/api/keeps/[id]/feedback/route.js
// SPRINT 1 FIX: Unified auth + service-role write pattern.
//
// BEFORE: anon+Bearer for SELECT .eq('user_id') (worked) and rpc('update_intent_priority')
//         (failed — auth.uid()=NULL in RLS). applyFeedback() also silenced with .catch(() => {}).
//         Result: behavioral model never received feedback. AI learned nothing. Felt shallow.
//
// AFTER: Identity via createBearerClient. RPC via createWriteClient (service role).
//        applyFeedback error now logged.

import { createBearerClient, createWriteClient, unauthorized } from '@/lib/supabase-bearer';
import { NextResponse } from 'next/server';
import { applyFeedback } from '@/lib/behavior-intelligence';

export async function POST(request, { params }) {
  const { supabase, user } = await createBearerClient(request);
  if (!user) return unauthorized();

  const { id } = params;
  let body;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { outcome, latency_seconds = null } = body;
  const VALID_OUTCOMES = ['acted', 'ignored', 'dismissed', 'deferred'];

  if (!outcome || !VALID_OUTCOMES.includes(outcome)) {
    return NextResponse.json(
      { error: 'Invalid outcome. Must be one of: ' + VALID_OUTCOMES.join(', ') },
      { status: 400 }
    );
  }

  // SELECT uses anon Bearer client — safe (RLS SELECT uses user_id column, not auth.uid()).
  const { data: keep } = await supabase
    .from('keeps')
    .select('id,user_id,intent_type,domain_type,contact_name')
    .eq('id', id)
    .eq('user_id', user.id)
    .single();

  if (!keep) return NextResponse.json({ error: 'Keep not found' }, { status: 404 });

  const db = createWriteClient();
  const { data, error } = await db.rpc('update_intent_priority', {
    p_keep_id:         id,
    p_user_id:         user.id,
    p_outcome:         outcome,
    p_latency_seconds: latency_seconds,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Non-critical learning loop — fire-and-forget but log failures.
  applyFeedback(user.id, keep.intent_type, outcome, keep.contact_name || null)
    .catch((e) => console.error('[feedback] applyFeedback failed:', e.message));

  return NextResponse.json({
    success:          true,
    outcome,
    new_priority:     data?.new_priority,
    new_success_rate: data?.new_success_rate,
    new_ignore_count: data?.new_ignore_count,
  });
}
