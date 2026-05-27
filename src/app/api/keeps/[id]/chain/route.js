// src/app/api/keeps/[id]/chain/route.js
// SPRINT 1 FIX: Unified auth + service-role write pattern.
//
// BEFORE: anon+Bearer for rpc('link_keep_to_parent') -> auth.uid()=NULL -> silent 403.
//         GET SELECT with .eq('user_id') worked (RLS SELECT uses column not auth.uid()).
//         Result: chain appears in optimistic UI, vanishes on reload (write never landed).
//
// AFTER: POST uses createWriteClient for RPC. GET keeps anon Bearer (SELECT is safe).

import { createBearerClient, createWriteClient, unauthorized } from '@/lib/supabase-bearer';
import { NextResponse } from 'next/server';

export async function POST(request, { params }) {
  const { user } = await createBearerClient(request);
  if (!user) return unauthorized();

  const { id } = params;
  let body;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { parent_keep_id } = body;
  if (!parent_keep_id) return NextResponse.json({ error: 'parent_keep_id required' }, { status: 400 });

  const db = createWriteClient();
  const { data, error } = await db.rpc('link_keep_to_parent', {
    p_child_id:  id,
    p_parent_id: parent_keep_id,
    p_user_id:   user.id,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data?.ok) return NextResponse.json({ error: data?.error }, { status: 422 });

  return NextResponse.json({ success: true, chain: data });
}

export async function GET(request, { params }) {
  // SELECT is safe with anon Bearer — RLS SELECT policies check user_id column,
  // not auth.uid(), so Bearer context is fine for reads.
  const { supabase, user } = await createBearerClient(request);
  if (!user) return unauthorized();

  const { id } = params;
  const { data: children } = await supabase
    .from('keeps')
    .select('id,content,intent_type,status,loop_state,intent_priority,created_at')
    .eq('parent_keep_id', id)
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  return NextResponse.json({ parent_id: id, children: children || [] });
}
