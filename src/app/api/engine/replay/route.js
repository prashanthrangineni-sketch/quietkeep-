// src/app/api/engine/replay/route.js
// Phase 8/9 — Decision Replay Engine
// Replays a past decision from decision_logs using original inputs + current engine.
// Supports: behavior predictions, governance decisions.
// Does NOT re-execute — computes what would happen today with original context.
//
// POST { decision_id }
// Returns: { original, replayed, diverged, replay_input }

export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { buildReplayInput } from '@/lib/decision-protocol';
import { predictNextActions } from '@/lib/behavior-intelligence';
import { governAction } from '@/lib/governor-engine';
import { getTimeBucket } from '@/lib/behavior-engine';

function bearerClient(req) {
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );
}

export async function POST(request) {
  try {
    const anon = bearerClient(request);
    if (!anon) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: { user } } = await anon.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    let body;
    try { body = await request.json(); } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const { decision_id } = body;
    if (!decision_id) return NextResponse.json({ error: 'decision_id required' }, { status: 400 });

    const svc = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    // Fetch the original decision record
    const { data: logRow } = await svc
      .from('decision_logs')
      .select('*')
      .eq('id', decision_id)
      .eq('user_id', user.id)
      .single();

    if (!logRow) return NextResponse.json({ error: 'Decision not found' }, { status: 404 });

    const original = {
      decision:        logRow.decision,
      reason:          logRow.reason,
      confidence:      logRow.priority_score,
      risk_score:      logRow.risk_score,
      agent_id:        logRow.agent_id,
      created_at:      logRow.created_at,
      execution_status: logRow.execution_status,
      evaluation_path: logRow.evaluation_path,
    };

    // Build replay input — deterministic snapshot
    const replayInput = buildReplayInput({
      protocol_version: logRow.protocol_version,
      agent_id:         logRow.agent_id,
      user_id:          user.id,
      intent_type:      logRow.inputs?.intentType || logRow.inputs?.intent_type,
      confidence:       logRow.priority_score,
      risk_level:       logRow.inputs?.risk_level,
      inputs:           logRow.replayable_input || logRow.inputs || {},
      created_at:       logRow.created_at,
      correlation_id:   logRow.correlation_id,
    });

    // Replay: recompute what the engine would predict today with same context
    const intentType = replayInput.intent_type;
    let replayed = { decision: 'no_replay_engine_for_type', reason: 'Agent type not replayable' };

    if (logRow.agent_id === 'behavior_agent' || logRow.mode === 'autonomous') {
      // Replay behavior prediction with original context
      try {
        const ctx = {
          timeBucket:     getTimeBucket(new Date(logRow.created_at)),
          is_weekend:     false,
          prevIntentType: logRow.inputs?.prevIntentType,
        };
        const predictions = await predictNextActions(user.id, ctx, 5);
        const match = predictions.find(p => p.intentType === intentType);

        if (match) {
          // Re-run governance with replayed score
          const govResult = await governAction(user.id, match, {
            frequency: 3, accept_count: 2, decay_weight: 1.0,
          }).catch(() => null);

          replayed = {
            decision:     govResult?.tier || 'unknown',
            reason:       match.reason,
            confidence:   match.score,
            gov_tier:     govResult?.tier,
            gov_reason:   govResult?.reason,
            risk_level:   govResult?.risk_level,
          };
        } else {
          replayed = { decision: 'not_predicted', reason: 'Pattern not in current top predictions' };
        }
      } catch (e) {
        replayed = { decision: 'replay_error', reason: e.message };
      }
    }

    // Diverged: did the governance outcome change?
    const diverged = original.decision !== replayed.decision;

    return NextResponse.json({
      original,
      replayed,
      diverged,
      replay_input:   replayInput,
      decision_id,
    });

  } catch (e) {
    console.error('[ENGINE/REPLAY] error:', e.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
