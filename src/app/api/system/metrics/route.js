// src/app/api/system/metrics/route.js
// Phase 11 — Monitoring API
// GET → protocol adoption %, decision/execution stats, circuit breaker, queue

export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { computeBill }  from '@/lib/billing-engine';

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
    if (!anon) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { data: { user } } = await anon.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const svc    = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const dayAgo = new Date(Date.now() - 86_400_000).toISOString();
    const hrAgo  = new Date(Date.now() - 3_600_000).toISOString();

    const [decisions24h, queue24h, usage24h, bill, circuitBreaker] = await Promise.all([
      svc.from('decision_logs').select('decision, execution_status, protocol_version, mode')
        .eq('user_id', user.id).gte('created_at', dayAgo),
      svc.from('execution_queue').select('status, action_type')
        .eq('user_id', user.id).gte('created_at', dayAgo),
      svc.from('usage_logs').select('action, cost_units, status, latency_ms')
        .eq('user_id', user.id).gte('created_at', dayAgo),
      computeBill(user.id, 30),
      svc.from('decision_logs').select('id', { count: 'exact', head: true })
        .eq('user_id', user.id).eq('decision', 'circuit_breaker_tripped')
        .gte('created_at', new Date(Date.now() - 2*3_600_000).toISOString()),
    ]);

    const logs  = decisions24h.data || [];
    const queue = queue24h.data || [];
    const usageRows = usage24h.data || [];

    const total        = logs.length;
    const p8Plus       = logs.filter(l => (l.protocol_version||1) >= 8).length;
    const autoTriggers = logs.filter(l => l.decision === 'auto_trigger').length;
    const governed     = logs.filter(l => l.decision?.startsWith('governed_')).length;
    const success      = logs.filter(l => l.execution_status === 'success').length;
    const errors       = logs.filter(l => l.execution_status === 'error').length;
    const avgLatency   = usageRows.filter(r => r.latency_ms).reduce((s,r) => s + r.latency_ms, 0) /
                         Math.max(1, usageRows.filter(r => r.latency_ms).length);

    return NextResponse.json({
      generated_at: new Date().toISOString(),
      protocol: {
        v8_adoption_pct: total ? Math.round(p8Plus / total * 100) : 0,
        total_decisions_24h:   total,
        auto_triggers_24h:     autoTriggers,
        governed_24h:          governed,
        success_rate:          total ? Math.round(success / Math.max(1, success+errors) * 100) : 100,
        failure_rate:          total ? Math.round(errors / Math.max(1, total) * 100) : 0,
      },
      queue: {
        pending:  queue.filter(q => q.status === 'pending').length,
        success:  queue.filter(q => q.status === 'success').length,
        failed:   queue.filter(q => q.status === 'failed').length,
        total:    queue.length,
      },
      circuit_breaker: {
        tripped: (circuitBreaker.count ?? 0) > 0,
        status:  (circuitBreaker.count ?? 0) > 0 ? 'OPEN' : 'CLOSED',
      },
      usage_24h: {
        total_units: usageRows.reduce((s,r) => s + (r.cost_units||0), 0),
        avg_latency_ms: Math.round(avgLatency),
        by_action: usageRows.reduce((acc, r) => { acc[r.action] = (acc[r.action]||0)+1; return acc; }, {}),
      },
      billing: bill || { tier: 'FREE', total_cost: 0, currency: 'INR' },
    });
  } catch(e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
