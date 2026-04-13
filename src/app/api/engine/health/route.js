// src/app/api/engine/health/route.js
// System health API — returns engine stats from existing logs
// No new tables. Reads from nudge_queue + decision_logs via DB function.
// Used by admin dashboard and monitoring.
// Personal + Business: same health check, covers all domains.

import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const hours = Math.min(168, parseInt(searchParams.get('hours') || '24', 10));

  const { data, error } = await supabase.rpc('get_system_health', { p_hours_back: hours });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ health: data, queried_at: new Date().toISOString() });
}
