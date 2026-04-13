// src/app/api/suggestions/feedback/route.js
// Phase 5 — Suggestion Feedback Endpoint
//
// POST { intent_type, outcome, contact_name? }
// outcome: 'acted' | 'ignored' | 'dismissed' | 'never_show'
//
// Unlike /api/keeps/[id]/feedback (which needs a keep_id),
// this handles feedback on predicted suggestions that don't have a keep yet.
// It writes directly to behavior_patterns via applyFeedback.
//
// 'never_show' → sets decay_weight = 0.0 (permanently suppressed)

export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { applyFeedback } from '@/lib/behavior-intelligence';

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
  const sb = bearerClient(request);
  if (!sb) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { intent_type, outcome, contact_name = null } = body;
  const VALID = ['acted', 'ignored', 'dismissed', 'never_show'];
  if (!intent_type || !outcome || !VALID.includes(outcome)) {
    return NextResponse.json({ error: `outcome must be one of: ${VALID.join(', ')}` }, { status: 400 });
  }

  // Map 'never_show' to a hard ignore with extra weight
  const mappedOutcome = outcome === 'never_show' ? 'dismissed' : outcome;

  await applyFeedback(user.id, intent_type, mappedOutcome, contact_name);

  // For 'never_show': additionally set decay_weight to near-zero
  if (outcome === 'never_show') {
    try {
      const svc = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY
      );
      const locKey = contact_name ? contact_name.toLowerCase().trim() : intent_type;
      const pType  = contact_name ? 'contact' : 'action';
      await svc.from('behavior_patterns')
        .update({ metadata: { decay_weight: 0.05, never_show: true } })
        .eq('user_id', user.id)
        .eq('pattern_type', pType)
        .ilike('location_name', locKey);
    } catch { /* fail-safe */ }
  }

  return NextResponse.json({ ok: true, outcome, intent_type });
}
