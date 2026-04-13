// src/lib/intent-engine.js
// Persistent Intent Engine — client-side deterministic helpers
// Mirrors DB functions is_actionable() and compute_similarity_hash() exactly.
// No randomness. No AI. No emotional language.
// Used by: personal dashboard, business dashboard, voice capture

/**
 * Context-to-action mapping (mirrors DB is_actionable() SQL function exactly).
 * Personal and business keeps both use this — mode is contextual not structural.
 * @param {string} intentType
 * @param {string} userState  START_OF_DAY | WORKING_HOURS | EVENING | OFF_HOURS | IN_TRANSIT | AT_HOME | AT_WORK
 * @returns {boolean}
 */
export function isActionable(intentType, userState) {
  const t = (intentType || '').toLowerCase();
  const s = (userState  || '').toUpperCase();

  // Communication — actionable while moving or at work
  if (['call','contact','communication','meeting'].includes(t) &&
      ['IN_TRANSIT','AT_WORK','WORKING_HOURS'].includes(s)) return true;

  // Home / personal errands — actionable only at home or off-hours
  if (['home_task','errand','purchase','shopping'].includes(t) &&
      ['AT_HOME','OFF_HOURS','EVENING'].includes(s)) return true;

  // Work / business tasks
  if (['task','work_task','business','invoice','compliance'].includes(t) &&
      ['AT_WORK','WORKING_HOURS','START_OF_DAY'].includes(s)) return true;

  // Reminders and notes
  if (['reminder','note'].includes(t) &&
      ['START_OF_DAY','EVENING'].includes(s)) return true;

  // Finance / expenses
  if (['expense','finance','budget'].includes(t) &&
      ['WORKING_HOURS','EVENING','AT_WORK'].includes(s)) return true;

  // Travel / documents — actionable when NOT in transit
  if (['trip','travel','document'].includes(t) && s !== 'IN_TRANSIT') return true;

  // Catch-all: START_OF_DAY nudges anything unmatched
  if (s === 'START_OF_DAY') return true;

  return false;
}

/**
 * Detect user state from local clock (IST).
 * CHANGE D: Accepts optional user_behavior_model to use learned active window.
 * When model is provided and current time is within active_hour_start..active_hour_end,
 * returns WORKING_HOURS (the user's personal active period) instead of clock-based state.
 * Falls back to clock-only when no model provided.
 * @param {object|null} model  { active_hour_start: number, active_hour_end: number }
 * @returns {string}
 */
export function detectUserState(model = null) {
  const now = new Date();
  const totalMin = now.getUTCHours() * 60 + now.getUTCMinutes() + 330; // IST = UTC+5:30
  const istHour  = Math.floor(totalMin / 60) % 24;

  // START_OF_DAY always wins — morning brief context
  if (istHour >= 6 && istHour < 9) return 'START_OF_DAY';

  // CHANGE D: if user has a learned active window, use it
  if (model && model.active_hour_start != null && model.active_hour_end != null) {
    if (istHour >= model.active_hour_start && istHour <= model.active_hour_end) {
      return 'WORKING_HOURS'; // inside user's personal active window
    }
  }

  // Clock fallback
  if (istHour >= 9  && istHour < 18) return 'WORKING_HOURS';
  if (istHour >= 18 && istHour < 21) return 'EVENING';
  return 'OFF_HOURS';
}

/**
 * Compute similarity key for dedup (mirrors DB compute_similarity_hash).
 * Strips punctuation, lowercases, trims.
 * @param {string} text
 * @returns {string}
 */
export function computeSimilarityKey(text) {
  return (text || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').trim().slice(0, 60);
}

/**
 * Check if new text is a near-duplicate of a recent keep within a time window.
 * Used by voice capture to prevent multiple keeps from one spoken sentence.
 * @param {string} newText
 * @param {Array<{content:string, created_at:string}>} recentKeeps
 * @param {number} windowMs  default 5 minutes
 * @returns {{isDuplicate:boolean, matchedId:string|null}}
 */
export function checkDuplicate(newText, recentKeeps, windowMs = 5 * 60 * 1000) {
  const newKey = computeSimilarityKey(newText);
  const cutoff = Date.now() - windowMs;

  for (const k of (recentKeeps || [])) {
    if (new Date(k.created_at).getTime() < cutoff) continue;
    const existKey = computeSimilarityKey(k.content);
    const minLen = Math.min(newKey.length, existKey.length);
    if (minLen < 8) continue;
    // Match if either is an 80%+ prefix of the other
    const threshold = Math.floor(minLen * 0.8);
    if (newKey === existKey ||
        existKey.startsWith(newKey.slice(0, threshold)) ||
        newKey.startsWith(existKey.slice(0, threshold))) {
      return { isDuplicate: true, matchedId: k.id };
    }
  }
  return { isDuplicate: false, matchedId: null };
}

/**
 * Build deterministic structured response (no emotion, no suggestions).
 * Used for TTS output and API responses.
 * @param {object} keep
 * @returns {string}
 */
export function buildStructuredResponse(keep) {
  const content    = (keep.content || '').slice(0, 80);
  const status     = (keep.status  || 'open').toUpperCase();
  const loopState  = keep.loop_state || 'open';
  return `Intent: ${content}. Status: ${status}. State: ${loopState}. Next step unresolved.`;
}


// ── Additions for Pranix Decision Engine ──────────────────────────

/**
 * Compute weighted priority score client-side.
 * Mirrors DB compute_priority() for optimistic UI updates.
 * @param {object} keep  — { intent_type, created_at, success_rate, ignore_count }
 * @param {string} userState
 * @returns {number}  0.05–1.0
 */
export function computePriority(keep, userState) {
  const ageDays = Math.max(0, (Date.now() - new Date(keep.created_at).getTime()) / 86400000);
  const ageFactor = Math.min(0.25, 0.25 * Math.log(1 + ageDays / 5) / Math.log(7));

  const typeWeights = {
    reminder: 0.25, meeting: 0.25, call: 0.22,
    task: 0.20, invoice: 0.22, compliance: 0.23,
    expense: 0.18, purchase: 0.15, note: 0.10,
    trip: 0.12,
  };
  const typeWeight = typeWeights[keep.intent_type] || 0.13;
  const contextScore = isActionable(keep.intent_type, userState) ? 0.20 : 0.05;
  const successScore = (keep.success_rate ?? 0.5) * 0.15;
  const ignorePenalty = Math.min(0.15, (keep.ignore_count ?? 0) * 0.05);

  return Math.max(0.05, Math.min(1.0, ageFactor + typeWeight + contextScore + successScore - ignorePenalty));
}

/**
 * Get domain type from intent type (for multi-domain routing).
 * @param {string} intentType
 * @returns {string}
 */
export function getDomainFromIntent(intentType) {
  const COMMERCE  = ['purchase', 'shopping', 'expense'];
  const WARRANTY  = ['document', 'warranty'];
  const EDUCATION = ['task', 'compliance'];
  if (COMMERCE.includes(intentType))  return 'commerce';
  if (WARRANTY.includes(intentType))  return 'warranty';
  if (EDUCATION.includes(intentType)) return 'education';
  return 'personal';
}
