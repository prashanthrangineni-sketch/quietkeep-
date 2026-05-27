// src/app/api/keeps/[id]/action/route.js
// SPRINT 1 FIX: Unified auth + service-role write pattern.
//
// BEFORE: anon+Bearer client used for both identity check and RPC writes.
//         PostgREST binds Bearer JWT but auth.uid() evaluates to NULL in RLS context.
//         rpc('log_intent_action') -> 403 (silent). rpc('update_intent_priority') and
//         rpc('update_user_behavior_model') -> .catch(() => {}) silenced all failures.
//         Result: marking done, action logging, behavior learning all silently broken.
//
// AFTER: createBearerClient validates identity (JWT check works correctly via anon).
//        createWriteClient (service role) used for all RPC/INSERT writes.
//        user_id always explicit. No RLS ambiguity. Errors surface instead of vanishing.

import { createBearerClient, createWriteClient, unauthorized } from '@/lib/supabase-bearer';
import { NextResponse } from 'next/server';

const VALID_ACTIONS = [
  'reminder_set', 'calendar_created', 'note_linked',
  'marked_done', 'whatsapp_queued', 'deferred_with_reason',
];

export async function POST(request, { params }) {
  const { user } = await createBearerClient(request);
  if (!user) return unauthorized();

  const { id } = params;
  let body;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { action_type, payload = {}, triggered_by = 'user' } = body;
  if (!action_type || !VALID_ACTIONS.includes(action_type)) {
    return NextResponse.json(
      { error: 'action_type must be one of: ' + VALID_ACTIONS.join(', ') },
      { status: 400 }
    );
  }

  const db = createWriteClient();

  const { data, error } = await db.rpc('log_intent_action', {
    p_keep_id:      id,
    p_user_id:      user.id,
    p_action_type:  action_type,
    p_payload:      payload,
    p_triggered_by: triggered_by,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data?.ok) return NextResponse.json({ error: data?.error }, { status: 404 });

  if (action_type === 'marked_done') {
    // These are non-critical side-effects. Still fire-and-forget but now errors
    // are logged rather than silently swallowed.
    db.rpc('update_intent_priority', {
      p_keep_id: id, p_user_id: user.id,
      p_outcome: 'acted', p_latency_seconds: null,
    }).catch((e) => console.error('[action] update_intent_priority failed:', e.message));

    db.rpc('update_user_behavior_model', {
      p_user_id: user.id, p_outcome: 'acted', p_keep_id: id,
    }).catch((e) => console.error('[action] update_user_behavior_model failed:', e.message));
  }

  return NextResponse.json({ success: true, action: data });
}

export async function GET(request, { params }) {
  const { supabase, user } = await createBearerClient(request);
  if (!user) return unauthorized();

  // READ uses anon+Bearer supabase — RLS SELECT policies work correctly with Bearer.
  // Only INSERT/UPDATE/RPC need service role; SELECTs with .eq('user_id') are safe.
  const { data: actions } = await supabase
    .from('intent_actions')
    .select('id,action_type,action_payload,triggered_by,executed_at,status')
    .eq('keep_id', params.id)
    .eq('user_id', user.id)
    .order('executed_at', { ascending: false });

  return NextResponse.json({ actions: actions || [] });
}
