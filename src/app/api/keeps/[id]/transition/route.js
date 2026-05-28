// src/app/api/keeps/[id]/transition/route.js
// SPRINT 1 FIX: Unified auth + service-role write pattern.
//
// BEFORE: anon+Bearer used for rpc('transition_keep_state') and behaviour_signals.insert.
//         auth.uid()=NULL in RLS context -> RPC 403 silently.
//         behaviour_signals.insert fired with .then(() => {}) — also silently failing.
//         Keep loop_state never actually updated in DB. UI showed false state.
//
// AFTER: createBearerClient for identity. createWriteClient (service role) for writes.
//        behaviour_signals error now logged, not silently swallowed.

import { createBearerClient, createWriteClient, unauthorized } from '@/lib/supabase-bearer';
import { NextResponse } from 'next/server';

const VALID_STATES = ['open', 'active', 'blocked', 'deferred', 'done', 'closed'];

export async function POST(request, { params }) {
  const { user } = await createBearerClient(request);
  if (!user) return unauthorized();

  const { id } = params;
  let body;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { new_state, reason } = body;
  if (!new_state || !VALID_STATES.includes(new_state)) {
    return NextResponse.json(
      { error: 'Invalid state. Allowed: ' + VALID_STATES.join(', ') },
      { status: 400 }
    );
  }

  const db = createWriteClient();

  const { data, error } = await db.rpc('transition_keep_state', {
    p_keep_id:   id,
    p_user_id:   user.id,
    p_new_state: new_state,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data?.ok) return NextResponse.json({ error: data?.error, details: data }, { status: 422 });

  // Non-critical signal — fire-and-forget but log failures.
  db.from('behaviour_signals').insert({
    user_id:      user.id,
    signal_type:  'keep_state_changed',
    source_table: 'keeps',
    source_id:    id,
    signal_data:  { from: data.from, to: new_state, reason: reason || null },
    trigger_type: 'event',
    processed:    false,
  }).then(() => {}).catch((e) => console.error('[transition] behaviour_signals failed:', e.message));

  // Fetch the updated keep so dashboard can schedule SW reminder if reminder_at is set.
  // dashboard code: if (result?.keep?.reminder_at) { postMessage SCHEDULE_REMINDER }
  const { data: keep } = await db
    .from('keeps')
    .select('id, content, status, loop_state, reminder_at, updated_at')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle();

  return NextResponse.json({ success: true, transition: data, keep: keep || null });
}
