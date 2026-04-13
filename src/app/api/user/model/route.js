// src/app/api/user/model/route.js
// FIXED: cookies() → Bearer token auth
import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

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

export async function GET(request) {
  const supabase = createBearerClient(request);
  // user/model is non-critical — fail open with defaults rather than 401
  if (!supabase) return NextResponse.json({ exists: false, defaults: { active_hour_start: 18, active_hour_end: 21, avg_response_hours: 4.0, success_rate_30d: 0.5, ignore_rates: {}, peak_hours: [8,9,18,19,20], total_acted: 0, total_ignored: 0 } });

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ exists: false, defaults: { active_hour_start: 18, active_hour_end: 21, avg_response_hours: 4.0, success_rate_30d: 0.5, ignore_rates: {}, peak_hours: [8,9,18,19,20], total_acted: 0, total_ignored: 0 } });

  const { data: model } = await supabase
    .from('user_behavior_model').select('*').eq('user_id', user.id).single();

  if (!model) {
    return NextResponse.json({ exists: false, defaults: { active_hour_start: 18, active_hour_end: 21, avg_response_hours: 4.0, success_rate_30d: 0.5, ignore_rates: {}, peak_hours: [8,9,18,19,20], total_acted: 0, total_ignored: 0 } });
  }

  return NextResponse.json({ exists: true, model });
}
