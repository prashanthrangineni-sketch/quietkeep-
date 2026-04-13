// src/app/api/autonomous/evaluate/route.js
// Phase 4 — Autonomous Intelligence Evaluation Endpoint
//
// POST { lat?, lng?, prev_intent? }
// Returns:
// {
//   autoTriggers:      [AutonomousAction],  — score >= threshold AND user enabled
//   strongSuggestions: [AutonomousAction],  — score >= 0.80
//   suggestions:       [AutonomousAction],  — score >= 0.60
// }
//
// Called from dashboard after predictions load.
// Separate from /api/agent/predict so it never slows down the main predict call.

export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { evaluateAutonomousActions, getAutomationSettings } from '@/lib/autonomous-engine';
import {
  checkAntiSpam, recordSuggestionShown,
  getSuggestionAggressiveness, AGGRESSIVENESS_THRESHOLDS,
} from '@/lib/trust-engine';
import { adjustThresholdByStyle, computeStyleProfile } from '@/lib/style-engine';
import { getTimeBucket } from '@/lib/behavior-engine';
import { getContext } from '@/lib/context-engine';

function anonClient(req) {
  const auth  = (req.headers.get('Authorization') || '').trim();
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : auth;
  if (!token) return null;
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );
}

export async function POST(request) {
  try {
    const anon = anonClient(request);
    if (!anon) return NextResponse.json({ autoTriggers: [], strongSuggestions: [], suggestions: [] }, { status: 401 });

    const { data: { user } } = await anon.auth.getUser();
    if (!user) return NextResponse.json({ autoTriggers: [], strongSuggestions: [], suggestions: [] }, { status: 401 });

    let body = {};
    try { body = await request.json(); } catch {}

    const { lat, lng, prev_intent } = body;
    const ctx = getContext();

    // Phase 5: anti-spam + aggressiveness + Phase 6: style-adjusted thresholds
    const [spamCheck, aggressiveness, styleProfile, automationSettings] = await Promise.all([
      checkAntiSpam(user.id),
      getSuggestionAggressiveness(user.id),
      computeStyleProfile(user.id),
      getAutomationSettings(user.id),  // Phase 7 fix: server-side pause check
    ]);
    const thresholds = AGGRESSIVENESS_THRESHOLDS[aggressiveness] ?? AGGRESSIVENESS_THRESHOLDS.medium;

    if (!spamCheck.allowed) {
      console.log(`[AUTONOMOUS] spam guard: ${spamCheck.reason} user=${user.id.slice(0,8)}`);
      return NextResponse.json({ autoTriggers: [], strongSuggestions: [], suggestions: [], reason: spamCheck.reason });
    }

    const result = await evaluateAutonomousActions(user.id, {
      timeBucket:     getTimeBucket(),
      hour:           ctx.hour,
      is_weekend:     ctx.is_weekend,
      lat:            typeof lat === 'number' ? lat : undefined,
      lng:            typeof lng === 'number' ? lng : undefined,
      prevIntentType: prev_intent || undefined,
    });

    // Phase 6: adaptive autonomy — style-adjusted thresholds filter results
    // Types the user often accepts: threshold lowered → surface more
    // Types the user avoids: threshold raised → surface less
    result.strongSuggestions = (result.strongSuggestions || []).filter(s =>
      s.score >= adjustThresholdByStyle(thresholds.strong ?? 0.80, s.intentType, styleProfile)
    );
    result.suggestions = (result.suggestions || []).filter(s =>
      s.score >= adjustThresholdByStyle(thresholds.suggest ?? 0.60, s.intentType, styleProfile)
    );

    // Phase 5: record impressions for anti-spam counting (non-blocking)
    const shown = [...(result.strongSuggestions||[]), ...(result.suggestions||[])];
    for (const s of shown) {
      recordSuggestionShown(user.id, s.intentType, s.score);
    }

    // Phase 7 fix: server-side pause enforcement — wipe autoTriggers if paused
    if (automationSettings?.paused === true || automationSettings?.enabled === false) {
      result.autoTriggers = [];
    }

    return NextResponse.json({ ...result, aggressiveness });

  } catch (e) {
    console.error('[AUTONOMOUS/EVALUATE] error (fail-safe):', e.message);
    return NextResponse.json({ autoTriggers: [], strongSuggestions: [], suggestions: [] });
  }
}
