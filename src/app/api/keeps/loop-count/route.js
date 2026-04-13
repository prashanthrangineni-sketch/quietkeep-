// src/app/api/keeps/loop-count/route.js
// FIXED v2: Replaced createSupabaseServerClient (cookies) with Bearer token auth.
// Dashboard sends no auth header to this endpoint — fixed in dashboard/page.jsx.
// Fails open (returns 0) if no auth, so UI never crashes.

import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.replace('Bearer ', '').trim();
  if (!token) return NextResponse.json({ count: 0 });

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ count: 0 });

  const { data, error } = await supabase.rpc('get_open_loop_count', { p_user_id: user.id });
  return NextResponse.json({ count: error ? 0 : (data || 0) });
}
