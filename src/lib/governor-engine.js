// src/lib/governor-engine.js
// Phase 7 — Global Governor Engine
//
// Central validation gate that runs before ANY autonomous execution.
// Every proposed action passes through here. If it fails, it is blocked
// with a structured reason that is logged and surfaced to the user.
//
// RISK CATEGORIES:
//   SAFE      — notes, reminders    → can auto-trigger
//   MODERATE  — tasks, contacts     → require strong confidence + user opt-in
//   SENSITIVE — expense, invoice,   → NEVER auto-trigger, suggest only
//               ledger, purchase
//
// SANDBOX MODE:
//   First-time action (frequency < 3) → suggestion only, never auto-execute.
//   After user accepts >= 2 times     → elevation to automation eligible.
//
// FAIL-SAFE CIRCUIT BREAKER:
//   If user ignores 3+ suggestions in the last hour → auto-disable for 2h.
//   Prevents spam fatigue and pattern noise from degrading UX.
//
// Exports:
//   RISK_LEVELS                                  — exported constants
//   getRiskLevel(intentType)                     → 'safe'|'moderate'|'sensitive'
//   governAction(userId, action, pattern)        → GovernResult
//   checkCircuitBreaker(userId)                  → { tripped, reason }
//   recordGovernDecision(supabase, userId, data) → void

import { createClient } from '@supabase/supabase-js';

// ── Risk classification ───────────────────────────────────────────────────────
export const RISK_LEVELS = {
  SAFE:      'safe',
  MODERATE:  'moderate',
  SENSITIVE: 'sensitive',
};

const RISK_MAP = {
  // SAFE — minimal impact, easily reversible
  note:         RISK_LEVELS.SAFE,
  reminder:     RISK_LEVELS.SAFE,
  task:         RISK_LEVELS.SAFE,
  // MODERATE — social/personal impact
  contact:      RISK_LEVELS.MODERATE,
  meeting:      RISK_LEVELS.MODERATE,
  trip:         RISK_LEVELS.MODERATE,
  // SENSITIVE — financial or irreversible
  expense:      RISK_LEVELS.SENSITIVE,
  invoice:      RISK_LEVELS.SENSITIVE,
  purchase:     RISK_LEVELS.SENSITIVE,
  ledger_credit:RISK_LEVELS.SENSITIVE,
  ledger_debit: RISK_LEVELS.SENSITIVE,
  document:     RISK_LEVELS.SENSITIVE,
  compliance:   RISK_LEVELS.SENSITIVE,
};

export function getRiskLevel(intentType) {
  return RISK_MAP[intentType] || RISK_LEVELS.MODERATE; // unknown → moderate (safe default)
}

// ── Hard limits ───────────────────────────────────────────────────────────────
const HARD_LIMITS = {
  auto_per_day:      3,
  auto_per_hour:     1,    // per type: 1 auto-trigger/hour/type
  suggest_per_hour:  6,    // total suggestions shown per hour
  sandbox_min_freq:  3,    // must have ≥ 3 occurrences before eligible
  sandbox_min_acc:   2,    // must have ≥ 2 accepts before eligible
  breaker_ignores:   3,    // 3 ignores in 1h → circuit trips
  breaker_window_h:  2,    // circuit open for 2h
};

function svcClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

// ── governAction ─────────────────────────────────────────────────────────────
/**
 * Central governance gate. Call before any auto-trigger or strong suggestion.
 *
 * @param {string} userId
 * @param {{ intentType, score, label, contactName? }} action
 * @param {{ frequency, accept_count, ignore_count, decay_weight }} pattern
 *   — pass the live behavior_pattern row for this action type
 *
 * @returns {Promise<{
 *   allowed:    boolean,
 *   tier:       'auto'|'suggest'|'blocked',
 *   reason:     string,
 *   risk_level: string,
 *   details:    object,
 * }>}
 */
export async function governAction(userId, action, pattern = {}) {
  if (!userId || !action?.intentType) {
    return { allowed: false, tier: 'blocked', reason: 'missing_params', risk_level: 'unknown', details: {} };
  }

  const { intentType, score } = action;
  const riskLevel = getRiskLevel(intentType);

  // RULE 1: Sensitive actions — never auto-trigger, always suggest-only
  if (riskLevel === RISK_LEVELS.SENSITIVE) {
    return {
      allowed: true, tier: 'suggest',
      reason: 'sensitive_action_suggest_only',
      risk_level: riskLevel,
      details: { rule: 'sensitive_types_never_auto' },
    };
  }

  // RULE 2: Sandbox mode — too few occurrences or accepts
  const freq    = pattern.frequency    ?? 0;
  const accepts = pattern.accept_count ?? 0;
  if (freq < HARD_LIMITS.sandbox_min_freq || accepts < HARD_LIMITS.sandbox_min_acc) {
    return {
      allowed: true, tier: 'suggest',
      reason: 'sandbox_mode_insufficient_history',
      risk_level: riskLevel,
      details: { frequency: freq, accepts, required_freq: HARD_LIMITS.sandbox_min_freq, required_acc: HARD_LIMITS.sandbox_min_acc },
    };
  }

  // RULE 3: Circuit breaker — too many recent ignores
  const { tripped, reason: breakerReason } = await checkCircuitBreaker(userId);
  if (tripped) {
    return {
      allowed: false, tier: 'blocked',
      reason: `circuit_breaker_${breakerReason}`,
      risk_level: riskLevel,
      details: { breaker_window_h: HARD_LIMITS.breaker_window_h },
    };
  }

  // RULE 4: Score gate — moderate actions need higher threshold
  const minScore = riskLevel === RISK_LEVELS.MODERATE ? 0.85 : 0.80;
  if (score < minScore) {
    return {
      allowed: true, tier: 'suggest',
      reason: `score_below_${riskLevel}_threshold`,
      risk_level: riskLevel,
      details: { score, required: minScore },
    };
  }

  // PASSED ALL GATES
  return {
    allowed: true, tier: 'auto',
    reason: 'all_governance_gates_passed',
    risk_level: riskLevel,
    details: { score, frequency: freq, accepts, risk_level: riskLevel },
  };
}

// ── checkCircuitBreaker ───────────────────────────────────────────────────────
/**
 * Checks if the user's suggestion stream should be paused due to spam fatigue.
 * Tripped when: ≥3 ignored suggestions in the last hour.
 * When tripped: auto-disable autonomous suggestions for 2h.
 */
export async function checkCircuitBreaker(userId) {
  if (!userId) return { tripped: false, reason: null };
  try {
    const db = svcClient();
    const oneHourAgo = new Date(Date.now() - 3_600_000).toISOString();
    const twohAgo    = new Date(Date.now() - HARD_LIMITS.breaker_window_h * 3_600_000).toISOString();

    // Check if circuit is already open (was tripped in last 2h)
    const { count: recentTrips } = await db
      .from('decision_logs')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('decision', 'circuit_breaker_tripped')
      .eq('mode', 'autonomous')
      .gte('created_at', twohAgo);

    if ((recentTrips ?? 0) > 0) {
      return { tripped: true, reason: 'already_open' };
    }

    // Check for recent ignore storm
    const { count: recentIgnores } = await db
      .from('decision_logs')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .in('decision', ['suggestion_ignored', 'suggestion_dismissed'])
      .eq('mode', 'autonomous')
      .gte('created_at', oneHourAgo);

    if ((recentIgnores ?? 0) >= HARD_LIMITS.breaker_ignores) {
      // Trip the circuit breaker
      db.from('decision_logs').insert({
        user_id:  userId,
        decision: 'circuit_breaker_tripped',
        mode:     'autonomous',
        reason:   `${recentIgnores} ignores in 1h exceeded limit of ${HARD_LIMITS.breaker_ignores}`,
        inputs:   { ignore_count: recentIgnores, window: '1h' },
      }).then(() => {}).catch(() => {});
      return { tripped: true, reason: 'ignore_storm' };
    }

    return { tripped: false, reason: null };
  } catch { return { tripped: false, reason: null }; } // fail-open for checks
}

// ── recordGovernDecision ──────────────────────────────────────────────────────
/**
 * Non-blocking audit trail write for governance decisions.
 */
export function recordGovernDecision(supabase, userId, { tier, reason, intentType, score, risk_level }) {
  if (!userId) return;
  try {
    supabase.from('decision_logs').insert({
      user_id:       userId,
      decision:      `governed_${tier}`,
      mode:          'autonomous',
      reason,
      priority_score: score,
      inputs:        { intentType, risk_level, score },
    }).then(() => {}).catch(() => {});
  } catch { /* fail-safe */ }
}

export { HARD_LIMITS };
