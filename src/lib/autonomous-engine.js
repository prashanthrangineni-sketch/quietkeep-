// src/lib/autonomous-engine.js
// Phase 4 — Autonomous Intelligence Engine
//
// Non-blocking background evaluator. Runs after every voice capture and on
// geo/time triggers. Evaluates the user's current context against behavior
// patterns and decides whether to suggest, strongly suggest, or auto-act.
//
// CONFIDENCE TIERS (all explainable to the user):
//   ≥ 0.90 → AUTO-TRIGGER (if user has enabled automation for this type)
//   ≥ 0.80 → STRONG SUGGEST (surface in UI with "Do it" pre-filled)
//   ≥ 0.60 → SUGGEST (normal predicted card)
//   < 0.60 → silent (don't surface)
//
// AUTOMATION SAFETY RULES:
//   1. User must explicitly enable per-action-type automation (user_settings.settings)
//   2. Auto-trigger fires at most once per action-type per 4 hours (cooldown)
//   3. Every auto-trigger is logged to decision_logs with full reason chain
//   4. User can cancel any auto-action within 5 seconds (countdown in dashboard)
//
// Exports:
//   evaluateAutonomousActions(userId, context)  — main entry point
//   getAutomationSettings(userId)               — reads user's per-type toggles
//   logDecision(supabase, userId, decision)     — audit trail
//   CONFIDENCE_THRESHOLDS                       — exported for UI use

import { predictNextActions }   from '@/lib/behavior-intelligence';
import {
  governAction, getRiskLevel, recordGovernDecision, RISK_LEVELS, HARD_LIMITS,
} from '@/lib/governor-engine';
import { getTimeBucket }        from '@/lib/behavior-engine';
import { getContext, scoreContext } from '@/lib/context-engine';
import { createClient }         from '@supabase/supabase-js';

// ── Confidence thresholds (exported for UI) ───────────────────────────────────
export const CONFIDENCE_THRESHOLDS = {
  AUTO_TRIGGER:    0.90,  // act without prompting (if user enabled)
  STRONG_SUGGEST:  0.80,  // surface with pre-filled action
  SUGGEST:         0.60,  // normal predicted card
  SILENT:          0.00,  // suppress
};

// ── Action types that support automation ─────────────────────────────────────
// Only these types can be auto-triggered — irreversible ones excluded.
const AUTOMATABLE_TYPES = new Set([
  'reminder',   // create reminder silently
  'contact',    // open WhatsApp pre-filled
  'task',       // add task to list
  'expense',    // create expense keep
  'note',       // save note
]);

// ── DB-backed cooldown (survives serverless cold starts) ─────────────────────
// Checks decision_logs for recent auto_trigger entries for this user+intentType.
// 4-hour cooldown per action type per user, capped at 3 auto-triggers/day total.
const AUTO_COOLDOWN_HOURS = 4;
const AUTO_DAILY_CAP = 3;

async function _isCooled(userId, intentType) {
  try {
    const db = svcClient();
    const cutoff = new Date(Date.now() - AUTO_COOLDOWN_HOURS * 3_600_000).toISOString();
    const dayCutoff = new Date(Date.now() - 24 * 3_600_000).toISOString();

    const [recentType, dailyAll] = await Promise.all([
      // Per-type cooldown: any auto_trigger for this intentType in last 4h
      db.from('decision_logs')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('decision', 'auto_trigger')
        .eq('mode', 'autonomous')
        .gte('created_at', cutoff)
        .contains('inputs', { intentType }),
      // Daily cap: total auto_triggers in last 24h
      db.from('decision_logs')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('decision', 'auto_trigger')
        .eq('mode', 'autonomous')
        .gte('created_at', dayCutoff),
    ]);

    const typeCount  = recentType.count ?? 0;
    const dailyCount = dailyAll.count   ?? 0;
    return typeCount > 0 || dailyCount >= AUTO_DAILY_CAP;
  } catch { return true; } // fail-closed: if DB check fails, suppress auto-trigger
}

// _markFired is now implicit: logDecision writes to decision_logs with decision='auto_trigger'
// so the next _isCooled call will see it.

function svcClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

// ── getAutomationSettings ─────────────────────────────────────────────────────
/**
 * Reads user's automation preferences from user_settings.settings JSONB.
 * Returns defaults (all false) for new users.
 *
 * Shape of user_settings.settings.automation:
 * {
 *   enabled: boolean,           // master toggle
 *   types: {
 *     reminder: boolean,
 *     contact:  boolean,
 *     task:     boolean,
 *     expense:  boolean,
 *     note:     boolean,
 *   },
 *   auto_threshold: number,     // override CONFIDENCE_THRESHOLDS.AUTO_TRIGGER (default 0.90)
 * }
 */
export async function getAutomationSettings(userId) {
  const DEFAULT = {
    enabled: false,
    types:   { reminder: false, contact: false, task: false, expense: false, note: false },
    auto_threshold: CONFIDENCE_THRESHOLDS.AUTO_TRIGGER,
  };
  if (!userId) return DEFAULT;
  try {
    const db = svcClient();
    const { data } = await db
      .from('user_settings')
      .select('settings')
      .eq('user_id', userId)
      .maybeSingle();
    const automation = data?.settings?.automation;
    if (!automation) return DEFAULT;
    return {
      enabled:        automation.enabled        ?? false,
      types:          { ...DEFAULT.types, ...automation.types },
      auto_threshold: automation.auto_threshold ?? CONFIDENCE_THRESHOLDS.AUTO_TRIGGER,
    };
  } catch { return DEFAULT; }
}

// ── logDecision ───────────────────────────────────────────────────────────────
/**
 * Writes an explainable decision record to decision_logs.
 * Every auto-trigger and strong-suggest is logged here.
 */
export async function logDecision(supabase, userId, {
  decision,       // 'auto_trigger' | 'strong_suggest' | 'suggest' | 'suppressed'
  intentType,
  reason,         // human-readable explanation
  score,
  inputs = {},    // snapshot of context at decision time
}) {
  try {
    await supabase.from('decision_logs').insert({
      user_id:          userId,
      decision,
      reason,
      inputs,
      context_snapshot: inputs,
      priority_score:   score,
      signal_weights: {
        frequency:   inputs.frequency_contribution,
        time:        inputs.time_contribution,
        sequence:    inputs.sequence_contribution,
        recency:     inputs.recency_contribution,
        accept_rate: inputs.accept_rate_contribution,
      },
      mode: 'autonomous',
    });
  } catch { /* fail-safe — never block caller */ }
}

// ── evaluateAutonomousActions ─────────────────────────────────────────────────
/**
 * Main entry point. Evaluates predictions and decides which tier each falls into.
 * Called from /api/agent/predict and /api/geo/check (non-blocking, fail-safe).
 *
 * @param {string} userId
 * @param {{
 *   timeBucket:      string,
 *   hour:            number,
 *   is_weekend:      boolean,
 *   lat?:            number,
 *   lng?:            number,
 *   prevIntentType?: string,   — last keep's intent_type for sequence boost
 * }} context
 *
 * @returns {Promise<{
 *   autoTriggers:     Array<AutonomousAction>,  — score >= threshold AND user enabled
 *   strongSuggestions:Array<AutonomousAction>,  — score >= 0.80
 *   suggestions:      Array<AutonomousAction>,  — score >= 0.60
 * }>}
 *
 * AutonomousAction: {
 *   intentType, label, score, confidence, reason,
 *   action_hint, decision, why_text, contactName?
 * }
 */
export async function evaluateAutonomousActions(userId, context = {}) {
  const EMPTY = { autoTriggers: [], strongSuggestions: [], suggestions: [] };
  if (!userId) return EMPTY;

  try {
    const [predictions, automationSettings] = await Promise.all([
      predictNextActions(userId, context, 5),
      getAutomationSettings(userId),
    ]);

    if (!predictions.length) return EMPTY;

    const supabase = svcClient();
    const timeBucket = context.timeBucket || getTimeBucket();
    const autoTriggers      = [];
    const strongSuggestions = [];
    const suggestions       = [];

    for (const pred of predictions) {
      const { intentType, label, score, reason, confidence, contactName } = pred;
      const action_hint = contactName
        ? `contact:${contactName}`
        : `predicted:${intentType}`;

      // Why-text: human-readable explanation for the user
      const why_text = contactName
        ? `Based on your pattern of contacting ${contactName} (${pred.score >= 0.8 ? 'high' : 'medium'} confidence)`
        : `You ${reason?.toLowerCase() || `often ${label}`}`;

      const action = {
        intentType, label, score, confidence, reason,
        action_hint, why_text, contactName: contactName || null,
        signal_weights: pred.signal_weights || null, // Phase 7: for Why panel
        decision: null,
      };

      // ── Tier decision — gated through Governor Engine (Phase 7) ────────
      const cooled = await _isCooled(userId, intentType).catch(() => true);
      const patternRow = {
        frequency:    pred.signal_weights  ? (pred.frequency    ?? 0) : 0,
        accept_count: pred.acceptRate !== undefined ? Math.round((pred.acceptRate ?? 0.5) * 5) : 0,
        decay_weight: pred.signal_weights  ? 1.0 : 1.0,
      };
      const govResult = await governAction(userId, action, patternRow).catch(
        () => ({ allowed: true, tier: 'suggest', reason: 'gov_error_fail_open', risk_level: 'moderate', details: {} })
      );
      recordGovernDecision(supabase, userId, {
        tier: govResult.tier, reason: govResult.reason,
        intentType, score, risk_level: govResult.risk_level,
      });

      const canAutoTrigger =
        govResult.tier === 'auto'
        && score >= automationSettings.auto_threshold
        && automationSettings.enabled
        && (automationSettings.types[intentType] ?? false)
        && AUTOMATABLE_TYPES.has(intentType)
        && !cooled;

      if (canAutoTrigger) {
        action.decision = 'auto_trigger';
        autoTriggers.push(action);
        logDecision(supabase, userId, {
          decision: 'auto_trigger', intentType, reason: why_text, score,
          inputs: { ...context, intentType, score, label, risk_level: govResult.risk_level },
        }).catch(() => {});
      } else if (score >= CONFIDENCE_THRESHOLDS.STRONG_SUGGEST && govResult.allowed) {
        action.decision = 'strong_suggest';
        strongSuggestions.push(action);
      } else if (score >= CONFIDENCE_THRESHOLDS.SUGGEST && govResult.allowed) {
        action.decision = 'suggest';
        suggestions.push(action);
      }
      // else: blocked by governor or score too low
    }

    return { autoTriggers, strongSuggestions, suggestions };

  } catch (e) {
    console.error('[AUTONOMOUS-ENGINE] error (fail-safe):', e.message);
    return { autoTriggers: [], strongSuggestions: [], suggestions: [] };
  }
}
