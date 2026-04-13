// src/app/api/protocol/monitor/route.js
// Phase 9 — System Monitoring
// Returns live metrics: failure rates, auto-trigger stats, circuit breaker, latency.
// GET → { metrics }

export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function bearerClient(req) {
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );
}

export async function GET(request) {
  try {
    const anon = bearerClient(request);
    if (!anon) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { data: { user } } = await anon.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const svc = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const oneDayAgo = new Date(Date.now() - 86_400_000).toISOString();
    const oneHourAgo= new Date(Date.now() - 3_600_000).toISOString();

    // Run monitoring queries in parallel
    const [decisionsDay, decisionsHour, queueStats, breaker] = await Promise.all([
      // 24h decision summary
      svc.from('decision_logs')
        .select('decision, execution_status, mode, risk_score, protocol_version')
        .eq('user_id', user.id)
        .gte('created_at', oneDayAgo),

      // 1h decision summary
      svc.from('decision_logs')
        .select('decision, execution_status, mode')
        .eq('user_id', user.id)
        .gte('created_at', oneHourAgo),

      // Queue stats
      svc.from('execution_queue')
        .select('status, action_type, created_at')
        .eq('user_id', user.id)
        .gte('created_at', oneDayAgo),

      // Circuit breaker check
      svc.from('decision_logs')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('decision', 'circuit_breaker_tripped')
        .eq('mode', 'autonomous')
        .gte('created_at', new Date(Date.now() - 2 * 3_600_000).toISOString()),
    ]);

    const dayLogs  = decisionsDay.data  || [];
    const hourLogs = decisionsHour.data || [];
    const queue    = queueStats.data    || [];

    // Compute metrics
    const autoTriggersDay  = dayLogs.filter(d => d.decision === 'auto_trigger').length;
    const governedAuto     = dayLogs.filter(d => d.decision === 'governed_auto').length;
    const governedSuggest  = dayLogs.filter(d => d.decision === 'governed_suggest').length;
    const blocked          = dayLogs.filter(d => d.decision?.includes('blocked')).length;
    const failed           = dayLogs.filter(d => d.execution_status === 'error').length;
    const success          = dayLogs.filter(d => d.execution_status === 'success').length;
    const p8Logs           = dayLogs.filter(d => d.protocol_version >= 8).length;

    const suggestionsHour  = hourLogs.filter(d => d.decision === 'suggestion_shown').length;
    const autoHour         = hourLogs.filter(d => d.decision === 'auto_trigger').length;

    const queuePending  = queue.filter(q => q.status === 'pending').length;
    const queueSuccess  = queue.filter(q => q.status === 'success').length;
    const queueFailed   = queue.filter(q => q.status === 'failed').length;

    const circuitOpen = (breaker.count ?? 0) > 0;

    return NextResponse.json({
      generated_at: new Date().toISOString(),
      period: '24h',
      decisions: {
        total:            dayLogs.length,
        auto_triggers:    autoTriggersDay,
        governed_auto:    governedAuto,
        governed_suggest: governedSuggest,
        blocked,
        execution: { success, failed, failure_rate: dayLogs.length ? (failed / dayLogs.length) : 0 },
        protocol_v8_adoption: dayLogs.length ? (p8Logs / dayLogs.length) : 0,
      },
      hourly: {
        suggestions_shown: suggestionsHour,
        auto_triggers:     autoHour,
      },
      queue: {
        pending: queuePending,
        success: queueSuccess,
        failed:  queueFailed,
        total:   queue.length,
      },
      circuit_breaker: {
        tripped: circuitOpen,
        status:  circuitOpen ? 'OPEN — suggestions suppressed' : 'CLOSED — normal operation',
      },
    });

  } catch (e) {
    console.error('[PROTOCOL/MONITOR] error:', e.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
