// src/lib/trust-engine.js
// Phase 5 — Trust + Human Control Layer
//
// Manages per-prediction trust scores and anti-spam guards.
// Wraps over behavior_patterns feedback signals to produce a unified
// "trust score" per intentType that rises with accepts and falls with ignores.
//
// ANTI-SPAM GUARDS (all enforced server-side):
//   MAX_SUGGESTIONS_PER_HOUR = 3     total across all types
//   MAX_AUTO_TRIGGERS_PER_DAY = 3    enforced in autonomous-engine.js
//   DUPLICATE_WINDOW_MS = 15 minutes same-type suppress
//
// TRUST SCORE FORMULA:
//   trust = decay_weight × accept_rate_bonus × frequency_factor
//   range: 0.0 → 1.0
//   new user: 0.5 (neutral)
//   never-ignored, often-accepted: approaches 1.0
//   often-ignored: approaches 0.1
//
// Exports:
//   computeTrustScore(pattern)             → 0–1
//   checkAntiSpam(userId, type?)           → { allowed, reason }
//   recordSuggestionShown(userId, type)    → void (non-blocking)
//   getSuggestionAggressiveness(userId)    → 'low'|'medium'|'high'

import { createClient } from '@supabase/supabase-js';

const MAX_SUGGESTIONS_PER_HOUR = 3;
const DUPLICATE_WINDOW_MS      = 15 * 60 * 1000; // 15 min

function svcClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

// ── computeTrustScore ─────────────────────────────────────────────────────────
/**
 * Computes a 0–1 trust score for a single behavior pattern.
 * Higher trust → surface more prominently / lower threshold to show.
 *
 * New patterns (no feedback yet): neutral score 0.5
 * Consistently accepted: up to 0.95
 * Consistently ignored:  down to 0.10
 *
 * @param {{ metadata?: { decay_weight?, accept_count?, ignore_count? }, frequency? }} pattern
 * @returns {number} 0–1
 */
export function computeTrustScore(pattern) {
  try {
    const meta       = pattern?.metadata || {};
    const decay      = typeof meta.decay_weight === 'number' ? meta.decay_weight : 1.0;
    const accepts    = meta.accept_count  || 0;
    const ignores    = meta.ignore_count  || 0;
    const freq       = pattern?.frequency || 1;
    const total_fb   = accepts + ignores;

    // No feedback yet: neutral (0.5) scaled by frequency
    if (total_fb === 0) {
      return Math.min(0.5 + freq * 0.02, 0.65); // new pattern gets slight boost from usage
    }

    // Accept rate: what fraction of times user acted on this type
    const accept_rate = accepts / total_fb;

    // Frequency factor: more usage = slightly higher baseline (capped)
    const freq_factor = Math.min(1.0 + freq * 0.03, 1.20);

    // Trust = decay × accept_rate blend × frequency
    const raw = decay * (0.3 + accept_rate * 0.7) * freq_factor;

    return Math.min(Math.max(raw, 0.05), 0.97);
  } catch { return 0.5; }
}

// ── checkAntiSpam ─────────────────────────────────────────────────────────────
/**
 * Checks whether showing a suggestion is allowed right now.
 * Reads suggestion_impressions from decision_logs (reusing existing table).
 *
 * @param {string}       userId
 * @param {string|null}  intentType  — if provided, also checks per-type duplicate window
 * @returns {Promise<{ allowed: boolean, reason: string | null }>}
 */
export async function checkAntiSpam(userId, intentType = null) {
  if (!userId) return { allowed: true, reason: null };
  try {
    const db      = svcClient();
    const hourAgo = new Date(Date.now() - 3_600_000).toISOString();

    // Check total impressions in last hour
    const { count: hourlyCount } = await db
      .from('decision_logs')
      .select('id', { count: 'exact', head: true })
      .eq('user_id',  userId)
      .eq('decision', 'suggestion_shown')
      .eq('mode',     'autonomous')
      .gte('created_at', hourAgo);

    if ((hourlyCount ?? 0) >= MAX_SUGGESTIONS_PER_HOUR) {
      return { allowed: false, reason: 'hourly_cap_reached' };
    }

    // Per-type duplicate window
    if (intentType) {
      const dupCutoff = new Date(Date.now() - DUPLICATE_WINDOW_MS).toISOString();
      const { count: dupCount } = await db
        .from('decision_logs')
        .select('id', { count: 'exact', head: true })
        .eq('user_id',  userId)
        .eq('decision', 'suggestion_shown')
        .eq('mode',     'autonomous')
        .gte('created_at', dupCutoff)
        .contains('inputs', { intentType });

      if ((dupCount ?? 0) > 0) {
        return { allowed: false, reason: 'duplicate_window' };
      }
    }

    return { allowed: true, reason: null };
  } catch { return { allowed: true, reason: null }; } // fail-open for suggestions
}

// ── recordSuggestionShown ─────────────────────────────────────────────────────
/**
 * Records that a suggestion was shown (for anti-spam counting).
 * Non-blocking, fail-safe.
 *
 * @param {string} userId
 * @param {string} intentType
 * @param {number} score
 */
export function recordSuggestionShown(userId, intentType, score) {
  if (!userId || !intentType) return;
  try {
    svcClient()
      .from('decision_logs')
      .insert({
        user_id:   userId,
        decision:  'suggestion_shown',
        mode:      'autonomous',
        reason:    `${intentType} suggestion shown to user`,
        inputs:    { intentType, score },
        priority_score: score,
      })
      .then(() => {})
      .catch(() => {});
  } catch { /* fail-safe */ }
}

// ── getSuggestionAggressiveness ───────────────────────────────────────────────
/**
 * Reads user's aggressiveness preference from user_settings.settings.
 * Controls how many suggestions appear and how low the score threshold drops.
 *
 * @param {string} userId
 * @returns {Promise<'low'|'medium'|'high'>}
 */
export async function getSuggestionAggressiveness(userId) {
  if (!userId) return 'medium';
  try {
    const { data } = await svcClient()
      .from('user_settings')
      .select('settings')
      .eq('user_id', userId)
      .maybeSingle();
    return data?.settings?.suggestion_aggressiveness ?? 'medium';
  } catch { return 'medium'; }
}

// ── aggressiveness → threshold map ────────────────────────────────────────────
export const AGGRESSIVENESS_THRESHOLDS = {
  low:    { suggest: 0.75, strong: 0.88, max_per_hour: 1 },
  medium: { suggest: 0.60, strong: 0.80, max_per_hour: 3 },
  high:   { suggest: 0.45, strong: 0.70, max_per_hour: 6 },
};
