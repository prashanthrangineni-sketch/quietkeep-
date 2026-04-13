// src/lib/behavior-intelligence.js
// Phase 3 Step 3 — Behavior Intelligence Engine
//
// Builds TRUE predictive intelligence on top of behavior_patterns (already written
// by behavior-engine.js for location visits). This file adds:
//   • Action patterns  (what the user does, when)
//   • Contact patterns (who they call, when)
//   • Sequence patterns (A → B co-occurrence stored in metadata)
//   • Temporal decay   (patterns older than 14 days lose weight)
//   • Feedback loop    (accepted/ignored suggestions reinforce/decay patterns)
//   • Unified score    (frequency × recency_weight × time_match × sequence_boost)
//
// NO new DB tables. Everything stored in behavior_patterns using existing columns:
//   pattern_type = 'action'   → location_name = intent_type key
//   pattern_type = 'contact'  → location_name = contact name (lowercase)
//   pattern_type = 'sequence' → location_name = "prev_intent→next_intent"
//   metadata.decay_weight     → float 0–1, reduced on ignored feedback
//   metadata.accept_count     → incremented on 'acted' feedback
//   metadata.ignore_count     → incremented on 'ignored'/'dismissed' feedback
//
// All functions are fail-safe: any error returns empty / null.
//
// Exports:
//   recordActionPattern(userId, intentType, timeBucket, contactName?)
//   recordSequence(userId, prevIntentType, nextIntentType, timeBucket)
//   applyFeedback(userId, intentType, outcome, contactName?)
//   computeBehaviorProfile(userId, context)
//   predictNextActions(userId, context, limit?)

import { updatePatternFrequency, getTopPatterns, getTimeBucket } from '@/lib/behavior-engine';
import { createClient } from '@supabase/supabase-js';

function svcClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

// ── Human labels for intent types ─────────────────────────────────────────────
const ACTION_LABELS = {
  reminder:     'log a reminder',
  task:         'add a task',
  expense:      'log an expense',
  contact:      'call or message someone',
  meeting:      'schedule a meeting',
  invoice:      'create an invoice',
  note:         'save a note',
  purchase:     'add a purchase',
  trip:         'plan a trip',
  document:     'file a document',
  ledger_credit:'record a payment received',
  ledger_debit: 'record a payment made',
};

// ── Temporal decay ─────────────────────────────────────────────────────────────
// Returns a multiplier 0–1 based on days since last_seen_at.
// Recent patterns get full weight; patterns older than 30 days lose 70% weight.
function decayMultiplier(lastSeenAt) {
  if (!lastSeenAt) return 0.5;
  const ageDays = (Date.now() - new Date(lastSeenAt).getTime()) / 86_400_000;
  if (ageDays < 2)  return 1.00;
  if (ageDays < 7)  return 0.85;
  if (ageDays < 14) return 0.65;
  if (ageDays < 30) return 0.40;
  return 0.20;
}

// ── 1. recordActionPattern ─────────────────────────────────────────────────────
/**
 * Called from voice/capture/route.js after every successful keep INSERT.
 * Records intent_type + time_bucket → behavior_patterns (pattern_type='action').
 * Also records contact patterns for contact/meeting intents.
 *
 * @param {string}      userId
 * @param {string}      intentType
 * @param {string}      timeBucket  — morning|afternoon|evening|night
 * @param {string|null} contactName
 */
export async function recordActionPattern(userId, intentType, timeBucket, contactName = null) {
  if (!userId || !intentType || intentType === 'unknown') return;
  try {
    await Promise.all([
      // Action pattern: intent_type stored in location_name column
      updatePatternFrequency(userId, 'action', {
        location_name: intentType,
        time_bucket:   timeBucket || 'any',
        metadata: {
          intent_type:  intentType,
          label:        ACTION_LABELS[intentType] || intentType,
          // Note: decay_weight, accept_count, ignore_count are NOT set here —
          // they are initialized on first INSERT by updatePatternFrequency
          // and only modified by applyFeedback. Passing them here would
          // overwrite feedback-adjusted values on every voice capture.
        },
      }),
      // Contact pattern if applicable
      contactName && ['contact', 'meeting'].includes(intentType)
        ? updatePatternFrequency(userId, 'contact', {
            location_name: contactName.toLowerCase().trim(),
            time_bucket:   timeBucket || 'any',
            metadata: {
              contact_name: contactName,
              intent_type:  intentType,
            },
          })
        : Promise.resolve(),
    ]);
  } catch {
    // fail silently — never block the response
  }
}

// ── 2. recordSequence ──────────────────────────────────────────────────────────
/**
 * Records an A→B action sequence. Called when voice/capture fires and there
 * is a recent (< 30 min) previous keep from the same user.
 *
 * Sequence key format: "expense→reminder" stored in location_name.
 * time_bucket = when the sequence occurred.
 *
 * @param {string} userId
 * @param {string} prevIntentType
 * @param {string} nextIntentType
 * @param {string} timeBucket
 */
// In-memory cooldown for sequence writes: same user+seqKey within 5 min → skip
const _seqCooldowns = new Map();
const SEQ_COOLDOWN_MS = 5 * 60_000;

export async function recordSequence(userId, prevIntentType, nextIntentType, timeBucket) {
  if (!userId || !prevIntentType || !nextIntentType) return;
  if (prevIntentType === nextIntentType) return; // don't track X→X

  // Client-side dedup: suppress rapid-fire writes for the same sequence
  const cooldownKey = `${userId}:${prevIntentType}→${nextIntentType}`;
  const lastWritten = _seqCooldowns.get(cooldownKey);
  if (lastWritten && (Date.now() - lastWritten) < SEQ_COOLDOWN_MS) return;
  _seqCooldowns.set(cooldownKey, Date.now());

  try {
    const seqKey = `${prevIntentType}→${nextIntentType}`;
    await updatePatternFrequency(userId, 'sequence', {
      location_name: seqKey,
      time_bucket:   timeBucket || 'any',
      metadata: {
        prev_intent:  prevIntentType,
        next_intent:  nextIntentType,
},
    });
  } catch { /* fail-safe */ }
}

// ── 3. applyFeedback ───────────────────────────────────────────────────────────
/**
 * Adjusts decay_weight in behavior_patterns when user acts on or ignores
 * a suggestion. Called from keeps/[id]/feedback route.
 *
 * accepted (acted)    → decay_weight += 0.15 (capped at 1.0)
 * ignored/dismissed  → decay_weight -= 0.10 (floored at 0.1)
 *
 * @param {string}      userId
 * @param {string}      intentType
 * @param {'acted'|'ignored'|'dismissed'|'deferred'} outcome
 * @param {string|null} contactName
 */
export async function applyFeedback(userId, intentType, outcome, contactName = null) {
  if (!userId || !intentType) return;
  const db = svcClient();
  const patternType = contactName ? 'contact' : 'action';
  const locationKey = contactName
    ? contactName.toLowerCase().trim()
    : intentType;
  try {
    const { data: existing } = await db
      .from('behavior_patterns')
      .select('id, metadata, frequency')
      .eq('user_id', userId)
      .eq('pattern_type', patternType)
      .ilike('location_name', locationKey)
      .order('frequency', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!existing) return; // no pattern to update

    const current = existing.metadata?.decay_weight ?? 1.0;
    const accept  = existing.metadata?.accept_count ?? 0;
    const ignore  = existing.metadata?.ignore_count ?? 0;

    let newWeight;
    let newAccept = accept;
    let newIgnore = ignore;

    if (outcome === 'acted') {
      newWeight = Math.min(1.0, current + 0.15);
      newAccept = accept + 1;
    } else if (outcome === 'ignored' || outcome === 'dismissed') {
      newWeight = Math.max(0.1, current - 0.10);
      newIgnore = ignore + 1;
    } else {
      // deferred — no weight change
      newWeight = current;
    }

    await db.from('behavior_patterns')
      .update({
        metadata: {
          ...existing.metadata,
          decay_weight:  newWeight,
          accept_count:  newAccept,
          ignore_count:  newIgnore,
          last_feedback: outcome,
        },
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id);
  } catch { /* fail-safe */ }
}

// ── 4. computeBehaviorProfile ──────────────────────────────────────────────────
/**
 * Fetches action + contact + sequence patterns for the current context.
 *
 * @param {string} userId
 * @param {{ timeBucket?: string, hour?: number, is_weekend?: boolean }} context
 * @returns {Promise<{ topActions, topContacts, topSequences }>}
 */
export async function computeBehaviorProfile(userId, context = {}) {
  const timeBucket = context.timeBucket || getTimeBucket();
  const empty = { topActions: [], topContacts: [], topSequences: [] };
  if (!userId) return empty;

  try {
    const [actionPatterns, contactPatterns, sequencePatterns] = await Promise.all([
      getTopPatterns(userId, { type: 'action', timeBucket, limit: 10 }),
      getTopPatterns(userId, { type: 'contact', limit: 8 }),
      getTopPatterns(userId, { type: 'sequence', timeBucket, limit: 10 }),
    ]);

    const topActions = actionPatterns.map(p => ({
      intentType:   p.location_name,
      frequency:    p.frequency,
      label:        p.metadata?.label || ACTION_LABELS[p.location_name] || p.location_name,
      timeBucket:   p.time_bucket,
      decayWeight:  p.metadata?.decay_weight ?? 1.0,
      lastSeen:     p.last_seen_at,
      acceptRate:   (p.metadata?.accept_count || 0) /
                    Math.max(1, (p.metadata?.accept_count || 0) + (p.metadata?.ignore_count || 0)),
    }));

    const topContacts = contactPatterns.map(p => ({
      name:         p.metadata?.contact_name || p.location_name,
      frequency:    p.frequency,
      decayWeight:  p.metadata?.decay_weight ?? 1.0,
      lastSeen:     p.last_seen_at,
    }));

    const topSequences = sequencePatterns.map(p => ({
      key:         p.location_name,             // "expense→reminder"
      prevIntent:  p.metadata?.prev_intent,
      nextIntent:  p.metadata?.next_intent,
      frequency:   p.frequency,
      timeBucket:  p.time_bucket,
      lastSeen:    p.last_seen_at,
    }));

    return { topActions, topContacts, topSequences };
  } catch (e) {
    console.error('[BEHAVIOR-INTEL] computeBehaviorProfile error:', e.message);
    return empty;
  }
}

// ── 5. predictNextActions ──────────────────────────────────────────────────────
/**
 * Fused multi-signal prediction of the user's next most likely action.
 *
 * Score formula (all signals 0–1, combined with documented weights):
 *   score = freqScore(0.35) × decayWeight
 *         + timeScore(0.25)
 *         + sequenceBoost(0.20)
 *         + recencyGap(0.12)
 *         + acceptRate(0.08)
 *
 * @param {string} userId
 * @param {{ timeBucket, hour, is_weekend, lat?, lng?, prevIntentType? }} context
 *   prevIntentType — optional last intent from the session (for sequence boost)
 * @param {number} limit
 * @returns {Promise<Array<{ intentType, label, score, reason, confidence, contactName? }>>}
 */
export async function predictNextActions(userId, context = {}, limit = 3) {
  if (!userId) return [];
  const timeBucket = context.timeBucket || getTimeBucket();

  try {
    const db = svcClient();
    const [profile, recentKeeps] = await Promise.all([
      computeBehaviorProfile(userId, context),
      db.from('keeps')
        .select('intent_type, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(20)
        .then(({ data }) => data || []),
    ]);

    // Build recency map: hours since last occurrence per intent_type
    const lastSeenHours = {};
    for (const k of recentKeeps) {
      const t = k.intent_type;
      if (!lastSeenHours[t]) {
        lastSeenHours[t] = (Date.now() - new Date(k.created_at).getTime()) / 3_600_000;
      }
    }

    // Build sequence boost map: prevIntent → { nextIntent → frequency }
    const seqBoostMap = {};
    for (const seq of profile.topSequences) {
      if (!seq.prevIntent || !seq.nextIntent) continue;
      if (!seqBoostMap[seq.prevIntent]) seqBoostMap[seq.prevIntent] = {};
      seqBoostMap[seq.prevIntent][seq.nextIntent] = seq.frequency;
    }

    const prevIntent = context.prevIntentType || null;
    // Minimum data guard: don't surface noisy predictions for new users
    // (< 3 total patterns means too few signals for reliable prediction)
    const totalPatterns = profile.topActions.length + profile.topContacts.length;
    if (totalPatterns < 1) return [];

    const candidates = [];

    // ── Score action patterns ──────────────────────────────────────────────
    for (const action of profile.topActions) {
      if (!action.intentType || action.intentType === 'unknown') continue;

      // 1. Frequency score — normalize over 10 occurrences
      const freqScore = Math.min(action.frequency / 10, 1.0);

      // 2. Temporal decay — old patterns lose weight automatically
      const decay = action.decayWeight ?? decayMultiplier(action.lastSeen);

      // 3. Time alignment
      const timeScore = action.timeBucket === timeBucket ? 1.0
        : action.timeBucket === 'any'                    ? 0.6
        : 0.25;

      // 4. Sequence boost — did the user just do something that often precedes this?
      const seqFreq = prevIntent && seqBoostMap[prevIntent]?.[action.intentType]
        ? seqBoostMap[prevIntent][action.intentType]
        : 0;
      const seqBoost = Math.min(seqFreq / 5, 1.0); // max at 5 co-occurrences

      // 5. Recency gap — if user hasn't done this in > 4h, they're "due"
      const hours = lastSeenHours[action.intentType] ?? 999;
      const recencyGap = hours > 8 ? 1.0 : hours > 4 ? 0.6 : hours > 2 ? 0.3 : 0.0;

      // 6. Accept rate — learned from feedback
      const acceptBonus = action.acceptRate ?? 0.5;

      // Fused score
      const score = Math.min(
        freqScore * decay * 0.35
        + timeScore * 0.25
        + seqBoost  * 0.20
        + recencyGap * 0.12
        + acceptBonus * 0.08,
        0.95
      );

      const confidence = score >= 0.72 ? 'high' : score >= 0.45 ? 'medium' : 'low';

      // Build human reason (most specific signal wins)
      let reason;
      if (seqBoost > 0.4 && prevIntent) {
        reason = `You often ${action.label} after ${ACTION_LABELS[prevIntent] || prevIntent}`;
      } else if (action.timeBucket === timeBucket && action.frequency >= 3) {
        reason = `You usually ${action.label} in the ${timeBucket}`;
      } else if (action.frequency >= 5) {
        reason = `You often ${action.label} (${action.frequency}× pattern)`;
      } else {
        reason = `Based on your habits, ${action.label}`;
      }

      candidates.push({
        intentType: action.intentType, label: action.label, score, reason, confidence,
        // Signal weights — passed through to Why This? panel
        signal_weights: {
          frequency:   Math.round(freqScore * decay * 0.35 * 100) / 100,
          time:        Math.round(timeScore  * 0.25 * 100) / 100,
          sequence:    Math.round(seqBoost   * 0.20 * 100) / 100,
          recency:     Math.round(recencyGap * 0.12 * 100) / 100,
          accept_rate: Math.round(acceptBonus * 0.08 * 100) / 100,
        },
      });
    }

    // ── Score contact patterns ─────────────────────────────────────────────
    for (const contact of profile.topContacts.slice(0, 3)) {
      if (!contact.name) continue;
      const decay    = contact.decayWeight ?? decayMultiplier(contact.lastSeen);
      const freqScore= Math.min(contact.frequency / 8, 1.0);
      const seqFreq  = prevIntent && seqBoostMap[prevIntent]?.['contact']
        ? seqBoostMap[prevIntent]['contact'] : 0;
      const seqBoost = Math.min(seqFreq / 5, 1.0);
      const score    = Math.min(freqScore * decay * 0.40 + seqBoost * 0.30 + 0.20, 0.88);
      const name     = contact.name.replace(/\b\w/g, c => c.toUpperCase());
      const reason   = seqBoost > 0.3 && prevIntent
        ? `You often reach out to ${name} after ${ACTION_LABELS[prevIntent] || prevIntent}`
        : `You frequently contact ${name}`;
      candidates.push({
        intentType: 'contact', label: `contact ${name}`, score,
        reason, confidence: score >= 0.60 ? 'medium' : 'low',
        contactName: name,
      });
    }

    // Deduplicate by intentType+contactName, keep highest score
    const deduped = Object.values(
      candidates.reduce((acc, c) => {
        const key = c.intentType + (c.contactName || '');
        if (!acc[key] || c.score > acc[key].score) acc[key] = c;
        return acc;
      }, {})
    );

    return deduped
      .filter(c => c.score >= 0.22)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

  } catch (e) {
    console.error('[BEHAVIOR-INTEL] predictNextActions error:', e.message);
    return [];
  }
}
