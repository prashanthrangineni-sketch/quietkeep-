// src/lib/intent-strength.js
// Agent Layer v3 — Intent Strength Engine (Phase 2)
// Pure, deterministic, no DB, no ML, never throws.
// Scores the urgency/strength of a keep's text intent.
//
// Export:
//   scoreIntent(text) → { intent_score, urgency, reason }

// ── Urgency word sets ─────────────────────────────────────────────────────────
const HIGH_URGENCY_WORDS = new Set([
  'now', 'immediately', 'urgent', 'asap', 'emergency', 'critical',
  'deadline', 'today', 'tonight', 'this morning', 'right now', 'hurry',
]);

const MEDIUM_URGENCY_WORDS = new Set([
  'soon', 'this week', 'tomorrow', 'reminder', 'don\'t forget',
  'make sure', 'need to', 'have to', 'must', 'important',
]);

const SOFT_WORDS = new Set([
  'maybe', 'later', 'someday', 'eventually', 'if possible', 'whenever',
  'might', 'could', 'perhaps', 'think about', 'consider',
]);

// Strong action verbs → higher intent score
const STRONG_VERBS = new Set([
  'buy', 'call', 'meet', 'pay', 'send', 'pick up', 'collect', 'order',
  'book', 'reserve', 'submit', 'file', 'confirm', 'sign', 'deliver',
  'fix', 'repair', 'replace', 'renew', 'cancel', 'return',
]);

// Weak verbs → lower intent score
const WEAK_VERBS = new Set([
  'check', 'see', 'look', 'think', 'read', 'browse', 'review', 'explore',
  'visit', 'watch', 'listen', 'search', 'find out',
]);

/**
 * scoreIntent
 * Scores a text string for urgency and intent strength.
 *
 * Algorithm:
 *   1. Detect urgency tier: high → intent_score 0.85–1.0
 *                           medium → 0.55–0.75
 *                           soft → 0.15–0.35
 *                           neutral → 0.5
 *   2. Verb strength adjustment: strong verb → +0.1, weak verb → −0.1
 *   3. Clamp to [0.1, 1.0]
 *
 * @param {string} text
 * @returns {{ intent_score: number, urgency: 'low'|'medium'|'high', reason: string }}
 */
export function scoreIntent(text = '') {
  try {
    const lower = (text || '').toLowerCase().trim();
    if (!lower) return { intent_score: 0.5, urgency: 'medium', reason: 'No text' };

    let base     = 0.5;
    let urgency  = 'medium';
    const found  = [];

    // ── Urgency detection (first match wins, order matters) ───────────────
    for (const w of HIGH_URGENCY_WORDS) {
      if (lower.includes(w)) {
        base = 0.85; urgency = 'high'; found.push(w); break;
      }
    }
    if (urgency === 'medium') {
      for (const w of MEDIUM_URGENCY_WORDS) {
        if (lower.includes(w)) {
          base = 0.65; urgency = 'medium'; found.push(w); break;
        }
      }
    }
    // Soft words suppress even if no urgency word found
    for (const w of SOFT_WORDS) {
      if (lower.includes(w)) {
        base = Math.min(base, 0.3); urgency = 'low'; found.push(w); break;
      }
    }

    // ── Verb strength adjustment ──────────────────────────────────────────
    let verbAdj = 0;
    for (const v of STRONG_VERBS) {
      if (lower.includes(v)) { verbAdj = +0.10; found.push(v); break; }
    }
    if (verbAdj === 0) {
      for (const v of WEAK_VERBS) {
        if (lower.includes(v)) { verbAdj = -0.10; found.push(v); break; }
      }
    }

    const intent_score = Math.round(Math.max(0.1, Math.min(1.0, base + verbAdj)) * 1000) / 1000;

    const reason = found.length
      ? `Intent signals: ${found.slice(0, 3).join(', ')}`
      : 'Standard intent — no urgency signals detected';

    console.log(`[INTENT] score=${intent_score} urgency=${urgency} signals="${found.slice(0,3).join(',')}"`);

    return { intent_score, urgency, reason };
  } catch (e) {
    console.error('[INTENT] scoreIntent error (fail-safe):', e.message);
    return { intent_score: 0.5, urgency: 'medium', reason: 'Scoring unavailable' };
  }
}
