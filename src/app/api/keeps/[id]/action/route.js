// src/app/api/keeps/[id]/action/route.js
// FIXED v2: Replaced createSupabaseServerClient (cookies) with Bearer token auth.

import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

const VALID_ACTIONS = ['reminder_set','calendar_created','note_linked','marked_done','whatsapp_queued','deferred_with_reason'];

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

  const { action_type, payload = {}, triggered_by = 'user' } = body;
  if (!action_type || !VALID_ACTIONS.includes(action_type)) {
    return NextResponse.json({ error: `action_type must be one of: ${VALID_ACTIONS.join(', ')}` }, { status: 400 });
  }

  const { data, error } = await supabase.rpc('log_intent_action', {
    p_keep_id:      id,
    p_user_id:      user.id,
    p_action_type:  action_type,
    p_payload:      payload,
    p_triggered_by: triggered_by,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data?.ok) return NextResponse.json({ error: data?.error }, { status: 404 });

  if (action_type === 'marked_done') {
    await supabase.rpc('update_intent_priority', {
      p_keep_id: id, p_user_id: user.id,
      p_outcome: 'acted', p_latency_seconds: null,
    }).catch(() => {});
    await supabase.rpc('update_user_behavior_model', {
      p_user_id: user.id, p_outcome: 'acted', p_keep_id: id,
    }).catch(() => {});
  }

  return NextResponse.json({ success: true, action: data });
}

export async function GET(request, { params }) {
  const { supabase } = createSupabaseClientFromBearer(request);
  if (!supabase) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: actions } = await supabase
    .from('intent_actions')
    .select('id,action_type,action_payload,triggered_by,executed_at,status')
    .eq('keep_id', params.id)
    .eq('user_id', user.id)
    .order('executed_at', { ascending: false });

  return NextResponse.json({ actions: actions || [] });
}
