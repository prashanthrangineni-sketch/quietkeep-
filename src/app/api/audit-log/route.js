// src/app/api/audit-log/route.js
// Phase 8 — Audit log read + export endpoint

export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function bearerClient(req) {
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: `Bearer ${token}` } } });
}

export async function GET(request) {
  try {
    const anon = bearerClient(request);
    if (!anon) return NextResponse.json({ logs: [] }, { status: 401 });
    const { data: { user } } = await anon.auth.getUser();
    if (!user) return NextResponse.json({ logs: [] }, { status: 401 });

    const url    = new URL(request.url);
    const format = url.searchParams.get('format');

    const svc = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const limit = format === 'export' ? 1000 : 100;

    const { data, error } = await svc
      .from('decision_logs')
      .select('id, decision, reason, mode, inputs, context_snapshot, priority_score, risk_score, reversal_possible, user_override, agent_id, protocol_version, execution_status, signal_weights, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) return NextResponse.json({ logs: [] });

    if (format === 'export') {
      // Also include behavior_patterns for full export
      const { data: patterns } = await svc
        .from('behavior_patterns')
        .select('pattern_type, location_name, time_bucket, frequency, metadata, last_seen_at')
        .eq('user_id', user.id);

      return NextResponse.json({
        export_date:   new Date().toISOString(),
        user_id:       user.id,
        decision_logs: data || [],
        behavior_patterns: patterns || [],
      });
    }

    return NextResponse.json({ logs: data || [] });
  } catch (e) {
    return NextResponse.json({ logs: [] });
  }
}
