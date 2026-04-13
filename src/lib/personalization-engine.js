// src/lib/personalization-engine.js
// Agent Layer v4 — Personalization Engine
// Derives per-user profile, scoring weights, and decision thresholds
// from existing behavior_patterns + geo_events tables.
//
// NO new DB tables. NO writes. Compute-on-demand, fail-safe.
// Falls back to global defaults for new users with no data.
//
// Exports:
//   getUserProfile(supabase, userId) → UserProfile
//   getPersonalizedWeights(profile)  → { frequency, recency, distance, time }
//   getUserThresholds(profile)       → { show, maybe, auto_trigger }

import { createClient } from '@supabase/supabase-js';

// ── Global defaults (v4 tuned values) ───────────────────────────────────────
const DEFAULT_WEIGHTS = {
  frequency: 0.25,
  recency:   0.25,
  distance:  0.35,
  time:      0.15,
};

const DEFAULT_THRESHOLDS = {
  show:         0.50,
  maybe:        0.35,
  auto_trigger: 0.65,
};

// ── Thresholds: heavy vs light user definition ───────────────────────────────
// Heavy user: behavior_patterns exist AND avg frequency > 3 (repeated visits)
// Light user: new or low-data users — lower bar to encourage engagement
const HEAVY_USER_FREQ_THRESHOLD = 3;

function svcClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

/**
 * getUserProfile
 * Derives a lightweight behavioral profile for a user from existing tables.
 * Returns safe defaults for new users (no data → no personalization applied).
 *
 * @param {string} userId
 * @returns {Promise<UserProfile>}
 *
 * UserProfile shape:
 * {
 *   has_data:              boolean,   // false → global defaults used everywhere
 *   pattern_count:         number,    // total behavior_patterns rows
 *   avg_frequency:         number,
 *   max_frequency:         number,
 *   dominant_time_bucket:  string,    // 'morning' | 'afternoon' | 'evening' | 'night' | null
 *   frequent_locations:    string[],  // names with frequency >= 3
 *   avg_distance_m:        number,    // from geo_events
 *   p90_distance_m:        number,
 *   event_count:           number,    // total geo_events
 *   is_heavy_user:         boolean,   // avg_frequency > threshold
 *   activity_pattern:      string,    // 'morning_dominant' | 'evening_dominant' | 'mixed' | 'none'
 * }
 */
export async function getUserProfile(userId) {
  if (!userId) return _defaultProfile();

  try {
    const db = svcClient();

    // ── Fetch behavior_patterns for user ─────────────────────────────────
    const { data: patterns } = await db
      .from('behavior_patterns')
      .select('location_name, time_bucket, frequency, last_seen_at')
      .eq('user_id', userId)
      .eq('pattern_type', 'location')
      .order('frequency', { ascending: false })
      .limit(50);

    // ── Fetch geo_events aggregates for user ─────────────────────────────
    const geoStats = null; // not used — derived from select queries below

    // Manual aggregate of geo_events
    const { data: geoEvents } = await db
      .from('geo_events')
      .select('distance_meters')
      .eq('user_id', userId)
      .not('distance_meters', 'is', null)
      .limit(200);

    const { data: geoTimeBuckets } = await db
      .from('geo_events')
      .select('created_at')
      .eq('user_id', userId)
      .limit(200);

    // ── No patterns → new user, return defaults ───────────────────────────
    if (!patterns || patterns.length === 0) {
      return _defaultProfile();
    }

    // ── Derive stats from patterns ────────────────────────────────────────
    const freqs        = patterns.map(p => p.frequency);
    const avg_freq     = freqs.reduce((a, b) => a + b, 0) / freqs.length;
    const max_freq     = Math.max(...freqs);

    // Time bucket distribution
    const bucketCounts = { morning: 0, afternoon: 0, evening: 0, night: 0 };
    for (const p of patterns) {
      if (p.time_bucket && p.time_bucket !== 'any' && bucketCounts[p.time_bucket] !== undefined) {
        bucketCounts[p.time_bucket] += p.frequency; // weight by frequency
      }
    }
    const dominant_bucket = Object.entries(bucketCounts)
      .sort(([, a], [, b]) => b - a)
      .find(([, v]) => v > 0)?.[0] || null;

    // Frequent locations (freq >= 3)
    const frequent_locations = patterns
      .filter(p => p.frequency >= HEAVY_USER_FREQ_THRESHOLD && p.location_name)
      .map(p => p.location_name.toLowerCase());

    // ── Derive stats from geo_events ─────────────────────────────────────
    let avg_distance_m = 50;  // neutral default
    let p90_distance_m = 100;
    const event_count  = geoEvents?.length || 0;

    if (geoEvents && geoEvents.length > 0) {
      const distances = geoEvents.map(e => e.distance_meters).sort((a, b) => a - b);
      avg_distance_m  = distances.reduce((a, b) => a + b, 0) / distances.length;
      p90_distance_m  = distances[Math.floor(distances.length * 0.9)] || avg_distance_m;
    }

    // Time of day from geo_events (IST)
    let morningEvents = 0, eveningEvents = 0, totalGeoEvents = 0;
    if (geoTimeBuckets) {
      for (const e of geoTimeBuckets) {
        const totalMin = new Date(e.created_at).getUTCHours() * 60
          + new Date(e.created_at).getUTCMinutes() + 330;
        const istHour = Math.floor(totalMin / 60) % 24;
        totalGeoEvents++;
        if (istHour >= 6  && istHour < 12) morningEvents++;
        if (istHour >= 17 && istHour < 21) eveningEvents++;
      }
    }
    const activity_pattern = totalGeoEvents === 0 ? 'none'
      : morningEvents / totalGeoEvents > 0.7 ? 'morning_dominant'
      : eveningEvents / totalGeoEvents > 0.7 ? 'evening_dominant'
      : 'mixed';

    const is_heavy_user = avg_freq > HEAVY_USER_FREQ_THRESHOLD;

    console.log(
      `[PERSONALIZATION] user=${userId.slice(0,8)} patterns=${patterns.length}` +
      ` avg_freq=${avg_freq.toFixed(2)} heavy=${is_heavy_user}` +
      ` activity=${activity_pattern} dom_bucket=${dominant_bucket}`
    );

    return {
      has_data:             true,
      pattern_count:        patterns.length,
      avg_frequency:        Math.round(avg_freq   * 100) / 100,
      max_frequency:        max_freq,
      dominant_time_bucket: dominant_bucket,
      frequent_locations,
      avg_distance_m:       Math.round(avg_distance_m),
      p90_distance_m:       Math.round(p90_distance_m),
      event_count,
      is_heavy_user,
      activity_pattern,
    };

  } catch (e) {
    console.error('[PERSONALIZATION] getUserProfile error (fail-safe):', e.message);
    return _defaultProfile();
  }
}

function _defaultProfile() {
  return {
    has_data:             false,
    pattern_count:        0,
    avg_frequency:        0,
    max_frequency:        0,
    dominant_time_bucket: null,
    frequent_locations:   [],
    avg_distance_m:       50,
    p90_distance_m:       100,
    event_count:          0,
    is_heavy_user:        false,
    activity_pattern:     'none',
  };
}

/**
 * getPersonalizedWeights
 * Shifts global weights ±10–15% based on user's observed patterns.
 * Always falls back to global defaults for new users.
 *
 * Rules (kept within ±15% of globals):
 *   - High p90_distance (<30m) → distance weight +0.10 (it's highly predictive)
 *   - morning_dominant/evening_dominant → time weight +0.05 (strong signal)
 *   - heavy user (avg_freq > 3) → frequency weight +0.05 (reliable signal)
 *   - Weights re-normalized to always sum to 1.0
 *
 * @param {UserProfile} profile
 * @returns {{ frequency, recency, distance, time }}  (sum = 1.0)
 */
export function getPersonalizedWeights(profile) {
  try {
    if (!profile?.has_data) return { ...DEFAULT_WEIGHTS };

    let { frequency, recency, distance, time } = { ...DEFAULT_WEIGHTS };

    // Distance boost: if user is consistently very close when triggering
    if (profile.p90_distance_m < 30) {
      distance  = Math.min(distance + 0.10, 0.50);
      frequency = Math.max(frequency - 0.05, 0.10);
      recency   = Math.max(recency   - 0.05, 0.10);
    }

    // Time boost: if activity is strongly time-patterned
    if (profile.activity_pattern === 'morning_dominant' ||
        profile.activity_pattern === 'evening_dominant') {
      time      = Math.min(time + 0.05, 0.25);
      frequency = Math.max(frequency - 0.05, 0.10);
    }

    // Frequency boost: if user has established repeated patterns
    if (profile.is_heavy_user) {
      frequency = Math.min(frequency + 0.05, 0.40);
      recency   = Math.max(recency   - 0.05, 0.10);
    }

    // Re-normalize to ensure sum = 1.0
    const total = frequency + recency + distance + time;
    const w = {
      frequency: Math.round(frequency / total * 100) / 100,
      recency:   Math.round(recency   / total * 100) / 100,
      distance:  Math.round(distance  / total * 100) / 100,
      time:      Math.round(time      / total * 100) / 100,
    };
    // Fix rounding drift on largest weight
    const drift = 1.0 - (w.frequency + w.recency + w.distance + w.time);
    w.distance += Math.round(drift * 1000) / 1000;

    console.log(
      `[PERSONALIZATION] weights freq=${w.frequency} rec=${w.recency}` +
      ` dist=${w.distance} time=${w.time}`
    );

    return w;
  } catch (e) {
    console.error('[PERSONALIZATION] getPersonalizedWeights error (fail-safe):', e.message);
    return { ...DEFAULT_WEIGHTS };
  }
}

/**
 * getUserThresholds
 * Adjusts SHOW/MAYBE/AUTO_TRIGGER thresholds per user engagement level.
 *
 * Part 7 rules:
 *   new user (no data)  → lower thresholds (encourage discovery)
 *   light user          → default thresholds
 *   heavy user          → stricter thresholds (avoid noise for engaged users)
 *
 * @param {UserProfile} profile
 * @returns {{ show, maybe, auto_trigger }}
 */
export function getUserThresholds(profile) {
  try {
    if (!profile?.has_data) {
      // New user: lower bar to show at least something
      return { show: 0.40, maybe: 0.25, auto_trigger: 0.65 };
    }

    if (profile.is_heavy_user && profile.pattern_count >= 5) {
      // Heavy user: stricter — only show high-confidence suggestions
      return { show: 0.58, maybe: 0.42, auto_trigger: 0.70 };
    }

    // Default (data exists but not yet heavy user)
    return { ...DEFAULT_THRESHOLDS };
  } catch (e) {
    console.error('[PERSONALIZATION] getUserThresholds error (fail-safe):', e.message);
    return { ...DEFAULT_THRESHOLDS };
  }
}
