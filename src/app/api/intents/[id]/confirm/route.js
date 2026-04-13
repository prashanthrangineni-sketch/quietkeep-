// src/app/api/intents/[id]/confirm/route.js
// FIXED: cookies() → Bearer token auth
export const dynamic = 'force-dynamic';
import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

function createBearerClient(req) {
  const auth  = (req.headers.get('Authorization') || '').trim();
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : auth;
  if (!token) return null;
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );
}

export async function POST(request, context) {
  const { id } = await context.params;
  const supabase = createBearerClient(request);
  if (!supabase) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body = {};
  try { body = await request.json(); } catch {}
  const { chosen_suggestion } = body;

  const { data: transition, error: txErr } = await supabase.rpc('transition_keep_state', {
    p_keep_id: id, p_user_id: user.id, p_new_state: 'done',
  });

  if (txErr || !transition?.ok) {
    return NextResponse.json({ error: txErr?.message || 'Transition failed', detail: transition }, { status: 500 });
  }

  if (chosen_suggestion) {
    await supabase.from('keeps').update({ ai_summary: chosen_suggestion }).eq('id', id).eq('user_id', user.id);
  }

  const { data: keep } = await supabase.from('keeps')
    .select('id,content,status,loop_state,intent_type,confidence,created_at,reminder_at,stale_at,ai_summary,geo_trigger_enabled,location_name,space_type,domain_type')
    .eq('id', id).eq('user_id', user.id).maybeSingle();

  supabase.rpc('update_user_behavior_model', { p_user_id: user.id, p_outcome: 'acted', p_keep_id: id }).catch(() => {});

  return NextResponse.json({
    intent: keep ? { ...keep, subject: keep.content } : { id, status: 'done', loop_state: 'closed' },
    success: true,
  });
}
