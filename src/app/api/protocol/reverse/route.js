// src/app/api/protocol/reverse/route.js
// Phase 9 — Reversal Engine
// Reverses a SAFE-tier completed action. MODERATE/SENSITIVE: never reversed by system.
//
// POST { decision_id }
// Returns: { ok, reversed, reason, record_id }

export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { canReverse, createDecisionRecord, writeAuditRecord, AGENTS } from '@/lib/decision-protocol';
import { RISK_LEVELS } from '@/lib/governor-engine';

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

    // Fetch original decision
    const { data: original } = await svc
      .from('decision_logs')
      .select('*')
      .eq('id', decision_id)
      .eq('user_id', user.id)
      .single();

    if (!original) return NextResponse.json({ error: 'Decision not found' }, { status: 404 });

    // Check if reversible
    const reversibleRecord = {
      reversal_possible: original.reversal_possible,
      execution_status:  original.execution_status,
      risk_level:        original.inputs?.risk_level || RISK_LEVELS.MODERATE,
    };

    if (!canReverse(reversibleRecord)) {
      return NextResponse.json({
        ok: false,
        reversed: false,
        reason: original.reversal_possible === false
          ? 'Action was marked non-reversible at creation'
          : original.risk_level === RISK_LEVELS.SENSITIVE || original.inputs?.risk_level === RISK_LEVELS.SENSITIVE
          ? 'Sensitive actions (financial/deletion) cannot be reversed by system'
          : 'Action is not in a reversible state (not completed or already reversed)',
      });
    }

    // SAFE-tier reversal: for auto-triggered keeps, close/dismiss the keep
    const intentType = original.inputs?.intentType || original.inputs?.intent_type;
    let reversed = false;
    let reversalDetail = '';

    if (original.keep_id) {
      // Reverse a keep-based action: update status to 'dismissed' (user explicitly undid it)
      const { error: updateErr } = await svc
        .from('keeps')
        .update({ status: 'closed', loop_state: 'closed', updated_at: new Date().toISOString() })
        .eq('id', original.keep_id)
        .eq('user_id', user.id);

      if (!updateErr) {
        reversed = true;
        reversalDetail = `Keep ${original.keep_id} closed via reversal`;
      }
    }

    // Mark original decision as reversed
    if (reversed) {
      await svc.from('decision_logs')
        .update({ user_override: true, outcome: 'reversed' })
        .eq('id', decision_id);
    }

    // Write reversal audit record
    const reversalRecord = createDecisionRecord(AGENTS.system.id, user.id, {
      intentType:    intentType || 'unknown',
      action:        `Reversal of decision ${decision_id}`,
      confidence:    1.0, // user-initiated = max confidence
      keep_id:       original.keep_id,
      inputs:        { original_decision_id: decision_id, reversal_detail: reversalDetail },
    });
    reversalRecord.status           = reversed ? 'completed' : 'failed';
    reversalRecord.execution_status = reversed ? 'reversed' : 'reversal_failed';
    reversalRecord.user_override    = true;
    writeAuditRecord(svc, reversalRecord);

    return NextResponse.json({
      ok: reversed,
      reversed,
      reason: reversed ? reversalDetail : 'Could not locate reversible resource',
      audit_id: reversalRecord.id,
    });

  } catch (e) {
    console.error('[PROTOCOL/REVERSE] error:', e.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
