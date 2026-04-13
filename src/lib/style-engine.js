// src/lib/style-engine.js
// Phase 6 — Learn My Style Engine + Memory Context Injection
//
// Derives a personal style profile from live behavior_patterns.
// Reads only — never writes. Pure computation, always fail-safe.
//
// Exports:
//   computeStyleProfile(userId)               → StyleProfile
//   adjustThresholdByStyle(base, type, profile) → number
//   buildMemoryContext(userId, context)        → string (voice prompt injection)

import { getTopPatterns, getTimeBucket } from '@/lib/behavior-engine';

// ── computeStyleProfile ───────────────────────────────────────────────────────
/**
 * StyleProfile shape:
 * {
 *   topIntents:     string[],  — types with highest accept rate × frequency
 *   avoidedIntents: string[],  — types with high ignore rate (accept rate < 0.2)
 *   dominantBucket: string,    — morning|afternoon|evening|night|any
 *   autoSafeTypes:  string[],  — freq≥4 + accept≥60% → safe to auto-trigger
 *   styleLabel:     string,    — 'task-driven'|'contact-driven'|'reminder-driven'|'note-taker'|'balanced'
 * }
 */
export async function computeStyleProfile(userId) {
  const DEFAULT = {
    topIntents: [], avoidedIntents: [], dominantBucket: 'any',
    autoSafeTypes: [], styleLabel: 'balanced',
  };
  if (!userId) return DEFAULT;

  try {
    const [actionPats, contactPats, locPats] = await Promise.all([
      getTopPatterns(userId, { type: 'action',   limit: 15 }),
      getTopPatterns(userId, { type: 'contact',  limit: 8  }),
      getTopPatterns(userId, { type: 'location', limit: 20 }),
    ]);

    const all = [...actionPats, ...contactPats];
    if (!all.length) return DEFAULT;

    const scored = all
      .filter(p => p.metadata?.never_show !== true)
      .map(p => {
        const accepts    = p.metadata?.accept_count  || 0;
        const ignores    = p.metadata?.ignore_count  || 0;
        const total      = accepts + ignores;
        const acceptRate = total > 0 ? accepts / total : 0.5;
        const decay      = p.metadata?.decay_weight ?? 1.0;
        return {
          intentType:  p.metadata?.intent_type || p.metadata?.contact_name || p.location_name,
          frequency:   p.frequency,
          acceptRate,
          decay,
          score: acceptRate * decay * Math.min(p.frequency / 5, 1.0),
        };
      });

    scored.sort((a, b) => b.score - a.score);

    const topIntents     = scored.filter(p => p.score >= 0.45).map(p => p.intentType).slice(0, 4);
    const avoidedIntents = scored.filter(p => p.acceptRate < 0.2 && p.frequency >= 2).map(p => p.intentType);
    const autoSafeTypes  = scored
      .filter(p => p.frequency >= 4 && p.acceptRate >= 0.60 && !avoidedIntents.includes(p.intentType))
      .map(p => p.intentType)
      .slice(0, 3);

    // Dominant time bucket from location patterns (weighted by frequency)
    const bucketFreq = {};
    for (const p of locPats) {
      if (p.time_bucket && p.time_bucket !== 'any') {
        bucketFreq[p.time_bucket] = (bucketFreq[p.time_bucket] || 0) + p.frequency;
      }
    }
    const dominantBucket = Object.entries(bucketFreq).sort((a,b)=>b[1]-a[1])[0]?.[0] || 'any';

    // Style label from most-used intent type
    const typeFreq = {};
    for (const s of scored) {
      typeFreq[s.intentType] = (typeFreq[s.intentType] || 0) + s.frequency;
    }
    const topType    = Object.entries(typeFreq).sort((a,b)=>b[1]-a[1])[0]?.[0] || '';
    const styleLabel = topType === 'task'     ? 'task-driven'
                     : topType === 'contact'  ? 'contact-driven'
                     : topType === 'reminder' ? 'reminder-driven'
                     : topType === 'note'     ? 'note-taker'
                     : 'balanced';

    return { topIntents, avoidedIntents, dominantBucket, autoSafeTypes, styleLabel };
  } catch (e) {
    console.error('[STYLE-ENGINE] computeStyleProfile (fail-safe):', e.message);
    return DEFAULT;
  }
}

// ── adjustThresholdByStyle ────────────────────────────────────────────────────
/**
 * Adaptive autonomy: lower threshold for trusted types, raise for avoided ones.
 * This is how the system "increases automation for trusted patterns".
 */
export function adjustThresholdByStyle(baseThreshold, intentType, profile) {
  try {
    if (!profile || !intentType) return baseThreshold;
    if (profile.topIntents.includes(intentType))     return Math.max(0.35, baseThreshold - 0.10);
    if (profile.avoidedIntents.includes(intentType)) return Math.min(0.95, baseThreshold + 0.15);
    return baseThreshold;
  } catch { return baseThreshold; }
}

// ── buildMemoryContext ────────────────────────────────────────────────────────
/**
 * Returns a compact string injected into the voice capture TTS response
 * to make the AI feel context-aware. Called from voice/capture after keep save.
 *
 * Example:
 *   "User frequently: expense, reminder. Style: task-driven. Most active: evening."
 */
export async function buildMemoryContext(userId, context = {}) {
  if (!userId) return '';
  try {
    const profile = await computeStyleProfile(userId);
    if (!profile.topIntents.length) return '';

    const timeBucket = context.timeBucket || getTimeBucket();
    const parts = [];

    if (profile.topIntents.length) {
      parts.push(`User frequently: ${profile.topIntents.slice(0,3).join(', ')}`);
    }
    if (profile.styleLabel !== 'balanced') {
      parts.push(`Style: ${profile.styleLabel}`);
    }
    if (profile.dominantBucket !== 'any') {
      parts.push(`Most active: ${profile.dominantBucket}`);
    }
    if (timeBucket === profile.dominantBucket) {
      parts.push(`Currently in peak window`);
    }

    return parts.join('. ') + '.';
  } catch { return ''; }
}
