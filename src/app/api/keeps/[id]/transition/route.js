// src/app/api/keeps/[id]/transition/route.js
// FIXED v2: Replaced createSupabaseServerClient (cookies) with Bearer token auth.
// Dashboard was already calling this without Authorization header (line 738 dashboard/page.jsx).
// That is fixed in the updated dashboard/page.jsx.

import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

const VALID_STATES = ['open','active','blocked','deferred','done','closed'];

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

  const { new_state, reason } = body;

  if (!new_state || !VALID_STATES.includes(new_state)) {
    return NextResponse.json({
      error: `Invalid state. Allowed: ${VALID_STATES.join(', ')}`,
    }, { status: 400 });
  }

  const { data, error } = await supabase.rpc('transition_keep_state', {
    p_keep_id:    id,
    p_user_id:    user.id,
    p_new_state:  new_state,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data?.ok) return NextResponse.json({ error: data?.error, details: data }, { status: 422 });

  supabase.from('behaviour_signals').insert({
    user_id: user.id, signal_type: 'keep_state_changed',
    source_table: 'keeps', source_id: id,
    signal_data: { from: data.from, to: new_state, reason: reason || null },
    trigger_type: 'event', processed: false,
  }).then(() => {});

  return NextResponse.json({ success: true, transition: data });
}
