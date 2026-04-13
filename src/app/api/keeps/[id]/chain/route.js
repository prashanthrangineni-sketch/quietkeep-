// src/app/api/keeps/[id]/chain/route.js
// FIXED: cookies() → Bearer token auth
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

export async function POST(request, { params }) {
  const supabase = createBearerClient(request);
  if (!supabase) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = params;
  let body;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { parent_keep_id } = body;
  if (!parent_keep_id) return NextResponse.json({ error: 'parent_keep_id required' }, { status: 400 });

  const { data, error } = await supabase.rpc('link_keep_to_parent', {
    p_child_id: id, p_parent_id: parent_keep_id, p_user_id: user.id,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data?.ok) return NextResponse.json({ error: data?.error }, { status: 422 });

  return NextResponse.json({ success: true, chain: data });
}

export async function GET(request, { params }) {
  const supabase = createBearerClient(request);
  if (!supabase) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = params;
  const { data: children } = await supabase
    .from('keeps')
    .select('id,content,intent_type,status,loop_state,intent_priority,created_at')
    .eq('parent_keep_id', id)
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  return NextResponse.json({ parent_id: id, children: children || [] });
}
