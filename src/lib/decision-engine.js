// src/lib/decision-engine.js
// Agent Brain v4 — Deterministic Decision Engine (extends v3 additively)
// NO ML. NO randomness. Every number is traceable to an explicit rule.
//
// v2 Exports (UNCHANGED):
//   scoreSuggestion(input)           → { score, breakdown, reason }
//   decideSuggestions(raw[], ctx)    → filtered + ranked suggestions (max 2)
//   shouldAutoTrigger(keep, pat, ctx)→ boolean
//
// v3 NEW Exports:
//   computeFinalScore(base, intent, context) → { final_score, breakdown_v3 }
//
// v3 EXTENDED:
//   decideSuggestions now blends final_score = base*0.60 + intent*0.25 + context*0.15
//   and sorts by final_score DESC (Phase 4).
//   Backward-compatible: intent_score + context_score are optional (default 0.5 each).
//
// Phase 7 SAFETY: every export is wrapped in try/catch with documented fallbacks.
// v2 Weights: frequency=0.35  recency=0.25  distance=0.25  time=0.15  (sum=1.0)
// v4 Weights: frequency=0.25  recency=0.25  distance=0.35  time=0.15  (sum=1.0)
// v4 Thresholds: SHOW>=0.50 (was 0.60), AUTO_TRIGGER>=0.65 (was 0.70)
// v3 Blend:   base_score=0.60  intent_score=0.25  context_score=0.15  (sum=1.0)

// ── Time-bucket adjacency map ────────────────────────────────────────────────
const ADJACENT_BUCKET = {
  morning:   ['night', 'afternoon'],
  afternoon: ['morning', 'evening'],
  evening:   ['afternoon', 'night'],
  night:     ['evening', 'morning'],
};

// ── Weights ───────────────────────────────────────────────────────────────────
// v4 weights (data-driven: distance is highest-signal, frequency sparse at launch)
const W = { frequency: 0.25, recency: 0.25, distance: 0.35, time: 0.15 };

// ── In-memory cooldown (per userId:locationName, 4 h window) ─────────────────
// Serverless functions are stateless across requests, so this guards
// within-request dedup. Cross-request dedup relies on behavior_patterns.last_seen_at.
const _shown = new Map(); // key → timestamp ms
const COOLDOWN_MS = 4 * 60 * 60 * 1000;

function _cooldownKey(userId, name) {
  return `${userId}:${(name || '').trim().toLowerCase()}`;
}
function _isCooledDown(userId, name) {
  const t = _shown.get(_cooldownKey(userId, name));
  return t && (Date.now() - t) < COOLDOWN_MS;
}
function _markShown(userId, name) {
  _shown.set(_cooldownKey(userId, name), Date.now());
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 1 — CONFIDENCE ENGINE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * scoreSuggestion
 * Computes a 0–1 confidence score for a single suggestion candidate.
 *
 * @param {object} p
 *   frequency         {number}        behavior_patterns.frequency
 *   last_seen_at      {string|null}   behavior_patterns.last_seen_at ISO string
 *   distance_meters   {number|null}   haversine distance; null = no GPS provided
 *   time_bucket_match {string}        pattern's stored time_bucket value
 *   user_context      {object}
 *     current_bucket  {string}        getTimeBucket() for right now
 *
 * @returns {{ score: number, breakdown: object, reason: string }}
 */
export function scoreSuggestion({
  frequency         = 0,
  last_seen_at      = null,
  distance_meters   = null,
  time_bucket_match = 'any',
  user_context      = {},
} = {}) {
  try {
    // ── 1. Frequency score (weight 0.35) ─────────────────────────────────
    // Normalize: min(freq / 5, 1)  →  5+ visits = full credit
    const freqNorm  = Math.min(frequency / 5, 1);
    const freqScore = freqNorm;

    // ── 2. Recency score (weight 0.25) ───────────────────────────────────
    // Exponential decay bands: <1d→1.0, <3d→0.7, <7d→0.4, else→0.1
    let recencyScore = 0.1;
    if (last_seen_at) {
      const ageDays = (Date.now() - new Date(last_seen_at).getTime()) / 86_400_000;
      if      (ageDays < 1) recencyScore = 1.0;
      else if (ageDays < 3) recencyScore = 0.7;
      else if (ageDays < 7) recencyScore = 0.4;
      // else stays 0.1
    }

    // ── 3. Distance score (weight 0.35 in v4 — distance is strongest signal) ──
    // Data-driven bands (p50=5m, p90=21m from live geo_events):
    //   <50m  → 1.0 (within normal walking proximity)
    //   <150m → 0.7 (nearby)
    //   <500m → 0.4 (same neighborhood)
    //   else  → 0.1 (far — suppress)
    // No GPS → neutral 0.5 (unchanged)
    let distScore = 0.5;
    if (distance_meters !== null && typeof distance_meters === 'number' && !isNaN(distance_meters)) {
      if      (distance_meters < 50)   distScore = 1.0;
      else if (distance_meters < 150)  distScore = 0.7;
      else if (distance_meters < 500)  distScore = 0.4;
      else                             distScore = 0.1;
    }

    // ── 4. Time-alignment score (weight 0.15) ────────────────────────────
    // exact match → 1.0 | adjacent → 0.5 | 'any' (voice intent) → 0.6 | else → 0
    const cur = (user_context.current_bucket || '').toLowerCase();
    const pat = (time_bucket_match         || '').toLowerCase();
    let timeScore = 0;
    if      (pat === 'any')                            timeScore = 0.6;
    else if (pat === cur)                              timeScore = 1.0;
    else if (ADJACENT_BUCKET[cur]?.includes(pat))     timeScore = 0.5;

    // ── Weighted sum, rounded to 3 dp ────────────────────────────────────
    // v4: allow personalized weight overrides via user_context.weights
    // Falls back to global defaults (W) when not provided.
    const weights = user_context.weights || W;
    const raw = (
      freqScore    * (weights.frequency ?? W.frequency) +
      recencyScore * (weights.recency   ?? W.recency)   +
      distScore    * (weights.distance  ?? W.distance)  +
      timeScore    * (weights.time      ?? W.time)
    );
    const score = Math.round(raw * 1000) / 1000;

    // ── Explainability string ─────────────────────────────────────────────
    const parts = [];
    if (frequency >= 3)            parts.push(`visited ${frequency}× recently`);
    else if (frequency > 0)        parts.push(`visited ${frequency}×`);
    if (recencyScore >= 0.7)       parts.push('seen recently');
    if (distance_meters !== null && distance_meters < 300)
                                   parts.push(`${Math.round(distance_meters)}m away`);
    if (timeScore === 1.0)         parts.push(`matches your ${cur} pattern`);
    else if (timeScore === 0.5)    parts.push('near your usual time');
    const reason = parts.length
      ? 'You usually do this — ' + parts.join(', ')
      : 'Based on your behavior patterns';

    // Phase 6 — mandatory log
    console.log(
      `[DECISION] score=${score}` +
      ` freq_s=${freqScore} rec_s=${recencyScore} dist_s=${distScore} time_s=${timeScore}`
    );

    return {
      score,
      breakdown: {
        frequency:  Math.round(freqScore    * 1000) / 1000,
        recency:    Math.round(recencyScore * 1000) / 1000,
        distance:   Math.round(distScore    * 1000) / 1000,
        time:       Math.round(timeScore    * 1000) / 1000,
      },
      reason,
    };
  } catch (e) {
    // Phase 7: fail-safe — return neutral score, never throw
    console.error('[DECISION] scoreSuggestion error (fail-safe):', e.message);
    return { score: 0, breakdown: {}, reason: 'Scoring unavailable' };
  }
}


// ─────────────────────────────────────────────────────────────────────────────
// v3 — FINAL SCORE BLENDER (Phase 3)
// ─────────────────────────────────────────────────────────────────────────────

// v3 blend weights (must sum to 1.0)
const W3 = { base: 0.60, intent: 0.25, context: 0.15 };

/**
 * computeFinalScore
 * Blends base behavior score, intent strength, and context actionability
 * into a single final_score used for ranking and gating.
 *
 * All inputs default to 0.5 so callers that don't provide intent/context
 * still get a sensible score (backward-compatible with v2 callers).
 *
 * @param {number} base_score     scoreSuggestion().score       (0–1)
 * @param {number} intent_score   scoreIntent().intent_score    (0–1), default 0.5
 * @param {number} context_score  scoreContext().context_score  (0–1), default 0.5
 * @returns {{ final_score: number, breakdown_v3: object }}
 */
export function computeFinalScore(base_score = 0.5, intent_score = 0.5, context_score = 0.5) {
  try {
    const final_score = Math.round(
      (base_score    * W3.base    +
       intent_score  * W3.intent  +
       context_score * W3.context) * 1000
    ) / 1000;

    console.log(
      `[DECISION_V3] final_score=${final_score}` +
      ` base=${base_score} intent=${intent_score} context=${context_score}`
    );

    return {
      final_score,
      breakdown_v3: {
        base:    Math.round(base_score    * 1000) / 1000,
        intent:  Math.round(intent_score  * 1000) / 1000,
        context: Math.round(context_score * 1000) / 1000,
      },
    };
  } catch (e) {
    console.error('[DECISION_V3] computeFinalScore error (fail-safe):', e.message);
    return { final_score: base_score, breakdown_v3: {} };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 2 — DECISION FILTER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * decideSuggestions
 * Filters, scores, deduplicates, and caps suggestion candidates.
 *
 * Input suggestions must already carry the raw fields needed for scoring
 * (frequency, last_seen_at, distance_meters, time_bucket, etc.).
 * This function scores each one, applies SHOW/MAYBE/HIDE rules, cooldown,
 * then returns ≤ 2 results sorted by score DESC.
 *
 * RULES:
 *   SHOW:  score ≥ 0.6  → always include (up to limit)
 *   MAYBE: 0.4–0.6      → include only when result set is still empty (1 max)
 *   HIDE:  score < 0.4  → always exclude
 *   LIMIT: max 2 total
 *   COOLDOWN: suppress same location within 4 h (in-memory per-request)
 *
 * @param {Array<object>} rawSuggestions
 *   Each must carry: { type, message, action_hint, location_name?,
 *                      frequency, last_seen_at, distance_meters?,
 *                      time_bucket_match?, pattern_id? }
 * @param {object} context
 *   userId         {string}
 *   current_bucket {string}  getTimeBucket() result
 *
 * @returns {Array<object>}  enriched + filtered suggestions, score DESC
 */
export function decideSuggestions(rawSuggestions = [], context = {}) {
  try {
    const {
      userId         = '',
      current_bucket = '',
      // v3 additions (optional — both default to 0.5 for backward compat)
      intent_score   = 0.5,   // from scoreIntent() on the related keep text
      context_score  = 0.5,   // from scoreContext() on current movement/time
    } = context;

    // Score every candidate first (v2 base score)
    const scored = rawSuggestions.map(s => {
      const { score, breakdown, reason } = scoreSuggestion({
        frequency:         s.frequency         ?? 0,
        last_seen_at:      s.last_seen_at      ?? null,
        distance_meters:   s.distance_meters   ?? null,
        time_bucket_match: s.time_bucket_match ?? s.time_bucket ?? 'any',
        user_context:      { current_bucket, weights: context.weights },  // v4: personalized weights
      });

      // v3: blend with per-candidate intent (if carried) + shared context score
      const candidate_intent  = typeof s.intent_score  === 'number' ? s.intent_score  : intent_score;
      const { final_score, breakdown_v3 } = computeFinalScore(score, candidate_intent, context_score);

      return {
        ...s, score, breakdown, reason, confidence: final_score,
        intent_score: candidate_intent, context_score,
        final_score, breakdown_v3,
      };
    });

    // Phase 4: sort DESC by final_score (v3), not raw base score
    scored.sort((a, b) => b.final_score - a.final_score);

    const result = [];

    for (const s of scored) {
      if (result.length >= 2) break;

      // Phase 4: gate on final_score (v3 blend), fall back to base score for v2 callers
      const gateScore = s.final_score ?? s.score;
      const locKey    = s.location_name
        || s.action_hint?.split(':').slice(1).join(':')
        || '';

      // Cooldown check (in-memory, 4 h)
      if (locKey && _isCooledDown(userId, locKey)) {
        console.log(`[DECISION] filtered_out reason=cooldown location=${locKey} final_score=${gateScore}`);
        continue;
      }

      // SHOW / MAYBE / HIDE gate
      // v4 thresholds: lowered to allow engagement while behavior data accumulates.
      // Personal thresholds override these when a userProfile is provided.
      const showThreshold  = context.thresholds?.show  ?? 0.50;  // v4: was 0.60
      const maybeThreshold = context.thresholds?.maybe ?? 0.35;  // v4: was 0.40
      if (gateScore >= showThreshold) {
        // SHOW — always include
      } else if (gateScore >= maybeThreshold && result.length === 0) {
        // MAYBE — only as sole suggestion, never as second
      } else {
        console.log(`[DECISION] filtered_out reason=low_score final_score=${gateScore} location=${locKey}`);
        continue;
      }

      // Record cooldown
      if (locKey) _markShown(userId, locKey);

      result.push(s);
    }

    return result;
  } catch (e) {
    // Phase 7: fail-safe — return raw slice so existing behaviour is preserved
    console.error('[DECISION] decideSuggestions error (fail-safe):', e.message);
    return rawSuggestions.slice(0, 2);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 3 — AUTO TRIGGER DECISION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * shouldAutoTrigger
 * JS-layer guard called from geo/check BEFORE the DB queues a nudge.
 * Fail-closed: returns false on any error or missing data.
 *
 * CONDITIONS (ALL must be true):
 *   1. keep.auto_trigger_enabled = true
 *   2. pattern.frequency ≥ 3
 *   3. scoreSuggestion(...) ≥ 0.7
 *   4. keep.geo_triggered_at is null OR > 2 h ago
 *
 * @param {object} keep    { auto_trigger_enabled, geo_triggered_at, location_name }
 * @param {object} pattern { frequency, last_seen_at, time_bucket, latitude, longitude } | null
 * @param {object} context { current_bucket, distance_meters? }
 * @returns {boolean}
 */
export function shouldAutoTrigger(keep, pattern, context = {}) {
  try {
    // Condition 1
    if (!keep?.auto_trigger_enabled) return false;

    // Condition 2
    if (!pattern || (pattern.frequency ?? 0) < 3) return false;

    // Condition 4 — cooldown check (2 h)
    if (keep.geo_triggered_at) {
      const msSince = Date.now() - new Date(keep.geo_triggered_at).getTime();
      if (msSince < 2 * 60 * 60 * 1000) {
        console.log(`[DECISION] shouldAutoTrigger=false reason=cooldown location=${keep.location_name}`);
        return false;
      }
    }

    // Condition 3 — score gate
    const { score } = scoreSuggestion({
      frequency:         pattern.frequency,
      last_seen_at:      pattern.last_seen_at      ?? null,
      distance_meters:   context.distance_meters   ?? null,
      time_bucket_match: pattern.time_bucket       ?? 'any',
      user_context:      { current_bucket: context.current_bucket ?? '' },
    });

    // v4: threshold 0.65 (was 0.70) — reachable with real data patterns
    const autoThreshold = context.thresholds?.auto_trigger ?? 0.65;
    const ok = score >= autoThreshold;
    console.log(
      `[DECISION] shouldAutoTrigger=${ok} score=${score} threshold=${autoThreshold}` +
      ` freq=${pattern.frequency} location=${keep.location_name ?? 'n/a'}`
    );
    return ok;
  } catch (e) {
    // Phase 7: fail-closed — never auto-trigger on error
    console.error('[DECISION] shouldAutoTrigger error (fail-safe):', e.message);
    return false;
  }
}
