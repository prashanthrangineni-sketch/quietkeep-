// src/app/api/protocol/decide/route.js
// Phase 10 — Pranix Core: Unified Decision API
//
// POST { context }
//
// context: {
//   text?:          string,     — voice transcript
//   intentType?:    string,     — pre-parsed intent
//   confidence?:    number,
//   lat?:           number,
//   lng?:           number,
//   prevIntentType?: string,
//   workspaceId?:   string,     — finance agent
//   agents?:        string[],   — which agents to run (default: all)
// }
//
// Returns: SDK-standard response
// {
//   decision_id, agent_ids, signals, decisions[], confidence,
//   risk_level, explanation, protocol_version
// }

export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { runAgents, mergeSignals } from '@/lib/agent-registry';
import { governAction } from '@/lib/governor-engine';
import { createDecisionRecord, writeAuditRecord, AGENTS, PROTOCOL_VERSION } from '@/lib/decision-protocol';
import { getTimeBucket } from '@/lib/behavior-engine';
import { getContext } from '@/lib/context-engine';

function bearerClient(req) {
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );
}

function svcClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

export async function POST(request) {
  try {
    const anon = bearerClient(request);
    if (!anon) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { data: { user } } = await anon.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    let body = {};
    try { body = await request.json(); } catch {}

    const ctx = getContext();
    const agentContext = {
      userId:         user.id,
      timeBucket:     getTimeBucket(),
      hour:           ctx.hour,
      is_weekend:     ctx.is_weekend,
      lat:            typeof body.context?.lat === 'number' ? body.context.lat : undefined,
      lng:            typeof body.context?.lng === 'number' ? body.context.lng : undefined,
      text:           body.context?.text,
      intentType:     body.context?.intentType,
      confidence:     body.context?.confidence ?? 0.5,
      prevIntentType: body.context?.prevIntentType,
      workspaceId:    body.context?.workspaceId,
      geoDetected:    !!(body.context?.lat && body.context?.lng),
      source:         body.context?.source ?? 'api',
    };

    // Run specified agents (or all)
    const agentIds    = body.context?.agents || null;
    const agentOutputs = await runAgents(agentContext, agentIds);
    const merged      = mergeSignals(agentOutputs);

    // Run governance on top prediction from each agent
    const decisions = [];
    for (const pred of merged.predictions.slice(0, 3)) {
      const govResult = await governAction(user.id, pred, {
        frequency: 3, accept_count: 2, decay_weight: 1.0,
      }).catch(() => ({ allowed: true, tier: 'suggest', reason: 'gov_error', risk_level: pred.risk_level ?? 'moderate', details: {} }));

      decisions.push({
        intentType:   pred.intentType,
        label:        pred.label || pred.intentType,
        score:        pred.score,
        confidence:   pred.confidence,
        tier:         govResult.tier,          // 'auto' | 'suggest' | 'blocked'
        risk_level:   govResult.risk_level,
        gov_reason:   govResult.reason,
        why_text:     pred.reason,
        signal_weights: pred.signal_weights || null,
        agent:        pred._agent,
        action_hint:  pred.contactName ? `contact:${pred.contactName}` : `predicted:${pred.intentType}`,
      });
    }

    // Build SDK-standard record
    const decisionId = crypto.randomUUID();
    const topDecision = decisions[0];

    // Write audit record (non-blocking)
    const svc = svcClient();
    const auditRecord = createDecisionRecord(AGENTS.system.id, user.id, {
      intentType:  topDecision?.intentType || 'unknown',
      action:      `Protocol decide: ${agentOutputs.length} agents, ${decisions.length} decisions`,
      confidence:  topDecision?.score ?? 0,
      inputs: {
        agent_ids:   merged.agent_ids,
        signals:     merged.signals,
        prediction_count: merged.predictions.length,
      },
    });
    auditRecord.id = decisionId; // use as the response decision_id
    auditRecord.status = 'completed';
    auditRecord.execution_status = 'decision_computed';
    auditRecord.evaluation_path = merged.agent_ids.map(a => `agent:${a}`).concat(['decide_merged', 'governed']);
    writeAuditRecord(svc, auditRecord);

    // SDK-standard response
    return NextResponse.json({
      decision_id:      decisionId,
      agent_ids:        merged.agent_ids,
      signals:          merged.signals,
      decisions,
      confidence:       topDecision?.score ?? 0,
      risk_level:       topDecision?.risk_level ?? 'unknown',
      explanation:      topDecision?.why_text ?? 'Insufficient signal data',
      protocol_version: PROTOCOL_VERSION,
      errors:           merged.errors,
    });

  } catch (e) {
    console.error('[PROTOCOL/DECIDE] error:', e.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
