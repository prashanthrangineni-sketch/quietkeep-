// src/lib/context-engine.js
// Agent Layer v3 — Context Engine (Phase 1)
// Pure, deterministic, no DB calls, no side effects, never throws.
// Called from: geo/check (real sensor data), agent/predict (time only)
//
// Export:
//   getContext({ timestamp, speed_mps, heading_deg }) → ContextObject

import { getTimeBucket } from '@/lib/behavior-engine';

/**
 * Classify movement state from GPS speed.
 * speed_mps null/undefined → 'unknown'
 * < 0.5  m/s → stationary  (standing still, ~1.8 km/h)
 * 0.5–2  m/s → walking     (1.8–7.2 km/h)
 * > 2    m/s → driving     (>7.2 km/h)
 */
function classifyMovement(speed_mps) {
  if (speed_mps === null || speed_mps === undefined || isNaN(speed_mps)) return 'unknown';
  if (speed_mps < 0.5)  return 'stationary';
  if (speed_mps <= 2.0) return 'walking';
  return 'driving';
}

/**
 * getContext
 * Derives full user context from sensor snapshot.
 * All fields are safe-defaults when inputs are missing.
 *
 * @param {object} opts
 *   timestamp   {Date|string|null}  — defaults to now()
 *   speed_mps   {number|null}
 *   heading_deg {number|null}
 *
 * @returns {{
 *   time_bucket:     string,   morning|afternoon|evening|night
 *   hour:            number,   0–23 IST
 *   is_weekend:      boolean,
 *   movement_state:  string,   stationary|walking|driving|unknown
 *   heading_deg:     number|null
 * }}
 */
export function getContext({ timestamp = null, speed_mps = null, heading_deg = null } = {}) {
  try {
    const base = timestamp ? new Date(timestamp) : new Date();

    // IST hour (UTC+5:30)
    const totalMin = base.getUTCHours() * 60 + base.getUTCMinutes() + 330;
    const istHour  = Math.floor(totalMin / 60) % 24;

    // Day of week in IST
    const istDay = new Date(base.getTime() + 330 * 60_000).getUTCDay(); // 0=Sun, 6=Sat
    const isWeekend = istDay === 0 || istDay === 6;

    return {
      time_bucket:    getTimeBucket(base),
      hour:           istHour,
      is_weekend:     isWeekend,
      movement_state: classifyMovement(speed_mps),
      heading_deg:    typeof heading_deg === 'number' && !isNaN(heading_deg) ? heading_deg : null,
    };
  } catch (e) {
    console.error('[CONTEXT] getContext error (fail-safe):', e.message);
    return {
      time_bucket:    'any',
      hour:           0,
      is_weekend:     false,
      movement_state: 'unknown',
      heading_deg:    null,
    };
  }
}

/**
 * scoreContext
 * Returns a 0–1 score representing how actionable a suggestion is given
 * the current context. Used as one input to the v3 final_score blend.
 *
 * Rules:
 *   stationary              → 1.0  (best — user is still, can act)
 *   walking + weekend       → 0.8  (relaxed, can respond)
 *   walking + weekday       → 0.6  (commuting, partial attention)
 *   driving                 → 0.2  (do not interrupt)
 *   unknown                 → 0.5  (neutral)
 *
 * @param {{ movement_state: string, is_weekend: boolean }} ctx
 * @returns {number}  0–1
 */
export function scoreContext(ctx = {}) {
  try {
    const { movement_state = 'unknown', is_weekend = false } = ctx;
    if (movement_state === 'stationary') return 1.0;
    if (movement_state === 'walking')    return is_weekend ? 0.8 : 0.6;
    if (movement_state === 'driving')    return 0.2;
    return 0.5; // unknown
  } catch (e) {
    console.error('[CONTEXT] scoreContext error (fail-safe):', e.message);
    return 0.5;
  }
}
