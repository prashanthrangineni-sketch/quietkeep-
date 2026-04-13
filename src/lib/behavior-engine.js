// src/lib/behavior-engine.js
// Phase 1 — Behavior Memory Layer
// Reads from: geo_events, behaviour_signals, keeps
// Writes to:  behavior_patterns (service role only)
//
// All functions are FAIL-SAFE: any error is caught and logged, never thrown.
// Called non-blocking from: geo/check (after trigger), voice/capture (when geo detected).
// DO NOT import this in frontend code — server-only (uses SUPABASE_SERVICE_ROLE_KEY).

import { createClient } from '@supabase/supabase-js';

function svcClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

/**
 * Compute time bucket from a Date (or now).
 * morning:   06–12
 * afternoon: 12–17
 * evening:   17–21
 * night:     21–06
 */
export function getTimeBucket(date = new Date()) {
  // Convert to IST (UTC+5:30)
  const totalMin = date.getUTCHours() * 60 + date.getUTCMinutes() + 330;
  const istHour  = Math.floor(totalMin / 60) % 24;
  if (istHour >= 6  && istHour < 12) return 'morning';
  if (istHour >= 12 && istHour < 17) return 'afternoon';
  if (istHour >= 17 && istHour < 21) return 'evening';
  return 'night';
}

/**
 * recordGeoVisit — upsert a location pattern for a user.
 * Called after a geo checkin or keep_triggered event.
 *
 * @param {string} userId
 * @param {{ name: string, latitude: number, longitude: number }} location
 * @param {Date} [visitedAt]
 */
export async function recordGeoVisit(userId, location, visitedAt = new Date()) {
  if (!userId || !location?.name) return;
  try {
    const db          = svcClient();
    const timeBucket  = getTimeBucket(visitedAt);
    const nameLower   = location.name.trim().toLowerCase();

    // Try to find existing pattern for this user + location + time_bucket
    const { data: existing } = await db
      .from('behavior_patterns')
      .select('id, frequency, metadata')
      .eq('user_id', userId)
      .eq('pattern_type', 'location')
      .ilike('location_name', nameLower)
      .eq('time_bucket', timeBucket)
      .maybeSingle();

    if (existing) {
      await db.from('behavior_patterns').update({
        frequency:   existing.frequency + 1,
        last_seen_at: visitedAt.toISOString(),
        latitude:    location.latitude ?? null,
        longitude:   location.longitude ?? null,
        updated_at:  new Date().toISOString(),
      }).eq('id', existing.id);
    } else {
      await db.from('behavior_patterns').insert({
        user_id:       userId,
        pattern_type:  'location',
        location_name: nameLower,
        latitude:      location.latitude ?? null,
        longitude:     location.longitude ?? null,
        time_bucket:   timeBucket,
        frequency:     1,
        last_seen_at:  visitedAt.toISOString(),
        metadata:      { source: 'geo_visit' },
      });
    }
  } catch (e) {
    console.error('[BEHAVIOR] recordGeoVisit failed (non-fatal):', e.message);
  }
}

/**
 * recordVoiceGeoIntent — records that user mentioned a location in voice.
 * Builds a 'location' pattern even before the location is saved.
 * Frequency drives the "suggest saving" prompt.
 *
 * @param {string} userId
 * @param {string} locationName
 * @param {{ latitude?: number, longitude?: number }} [coords]
 */
export async function recordVoiceGeoIntent(userId, locationName, coords = {}) {
  if (!userId || !locationName) return;
  try {
    const db         = svcClient();
    const nameLower  = locationName.trim().toLowerCase();
    const timeBucket = getTimeBucket();

    const { data: existing } = await db
      .from('behavior_patterns')
      .select('id, frequency, metadata')
      .eq('user_id', userId)
      .eq('pattern_type', 'location')
      .ilike('location_name', nameLower)
      .eq('time_bucket', 'any')   // voice intents use 'any' since we don't know which time
      .maybeSingle();

    if (existing) {
      await db.from('behavior_patterns').update({
        frequency:    existing.frequency + 1,
        last_seen_at: new Date().toISOString(),
        latitude:     coords.latitude  ?? existing.latitude  ?? null,
        longitude:    coords.longitude ?? existing.longitude ?? null,
        updated_at:   new Date().toISOString(),
        metadata: {
          ...existing.metadata,
          last_time_bucket: timeBucket,
          source: 'voice_intent',
        },
      }).eq('id', existing.id);
    } else {
      await db.from('behavior_patterns').insert({
        user_id:       userId,
        pattern_type:  'location',
        location_name: nameLower,
        latitude:      coords.latitude  ?? null,
        longitude:     coords.longitude ?? null,
        time_bucket:   'any',
        frequency:     1,
        last_seen_at:  new Date().toISOString(),
        metadata:      { source: 'voice_intent', last_time_bucket: timeBucket },
      });
    }
  } catch (e) {
    console.error('[BEHAVIOR] recordVoiceGeoIntent failed (non-fatal):', e.message);
  }
}

/**
 * updatePatternFrequency — generic upsert for any pattern type.
 * Used for action patterns derived from voice intent types.
 *
 * @param {string} userId
 * @param {'location'|'route'|'action'|'time'} patternType
 * @param {object} fields  — { location_name?, time_bucket?, metadata? }
 */
export async function updatePatternFrequency(userId, patternType, fields = {}) {
  if (!userId || !patternType) return;
  try {
    const db = svcClient();
    // FIX: Supabase JS builder is immutable — must reassign after each method call
    let query = db
      .from('behavior_patterns')
      .select('id, frequency')
      .eq('user_id', userId)
      .eq('pattern_type', patternType);

    if (fields.location_name) query = query.ilike('location_name', fields.location_name.toLowerCase());
    if (fields.time_bucket)   query = query.eq('time_bucket', fields.time_bucket);

    const { data: existing } = await query.maybeSingle();

    if (existing) {
      // Merge metadata: preserve decay_weight/counters set by applyFeedback,
      // only overwrite with caller's metadata (label, intent_type, etc.)
      const mergedMeta = {
        ...(existing.metadata || {}),
        ...fields.metadata,
        // Hard-preserve feedback signals — never let recordActionPattern overwrite them
        decay_weight:  existing.metadata?.decay_weight  ?? 1.0,
        accept_count:  existing.metadata?.accept_count  ?? 0,
        ignore_count:  existing.metadata?.ignore_count  ?? 0,
      };
      await db.from('behavior_patterns').update({
        frequency:    existing.frequency + 1,
        last_seen_at: new Date().toISOString(),
        updated_at:   new Date().toISOString(),
        metadata:     mergedMeta,
      }).eq('id', existing.id);
    } else {
      // On INSERT: initialize decay_weight and feedback counters if not already set
      const initMeta = {
        decay_weight:  1.0,
        accept_count:  0,
        ignore_count:  0,
        ...fields.metadata,   // caller's metadata takes precedence (e.g. label, intent_type)
      };
      await db.from('behavior_patterns').insert({
        user_id:       userId,
        pattern_type:  patternType,
        location_name: fields.location_name?.toLowerCase() || null,
        time_bucket:   fields.time_bucket || 'any',
        frequency:     1,
        last_seen_at:  new Date().toISOString(),
        metadata:      initMeta,
      });
    }
  } catch (e) {
    console.error('[BEHAVIOR] updatePatternFrequency failed (non-fatal):', e.message);
  }
}

/**
 * getTopPatterns — returns top N patterns for a user.
 * Used by prediction engine and suggestion card.
 *
 * @param {string} userId
 * @param {{ type?: string, timeBucket?: string, limit?: number }} opts
 * @returns {Promise<Array>}
 */
export async function getTopPatterns(userId, opts = {}) {
  if (!userId) return [];
  try {
    const db = svcClient();
    let query = db
      .from('behavior_patterns')
      .select('id, pattern_type, location_name, latitude, longitude, time_bucket, frequency, last_seen_at, metadata')
      .eq('user_id', userId)
      .order('frequency', { ascending: false })
      .limit(opts.limit || 10);

    if (opts.type)       query = query.eq('pattern_type', opts.type);
    if (opts.timeBucket) query = query.or(`time_bucket.eq.${opts.timeBucket},time_bucket.eq.any`);

    const { data } = await query;
    return data || [];
  } catch (e) {
    console.error('[BEHAVIOR] getTopPatterns failed (non-fatal):', e.message);
    return [];
  }
}

/**
 * haversineMeters — compute distance between two coordinates.
 */
export function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
