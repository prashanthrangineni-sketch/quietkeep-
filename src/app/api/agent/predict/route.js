// src/app/api/agent/predict/route.js
// Phase 2 (original) + Phase 4 upgrade — Decision Engine integration
// Now uses decision-engine.js: scoreSuggestion + decideSuggestions.
// Every suggestion carries: score, confidence, breakdown, reason (Phase 5).
// Fully backward-compatible: response shape is a superset of the old one.
// FAIL-SAFE: any error returns empty suggestions (original fallback preserved).
//
// GET /api/agent/predict?lat=<float>&lng=<float>
// Returns:
// {
//   suggestions: [{
//     type, message, action_hint, confidence, score,
//     breakdown: { frequency, recency, distance, time },
//     reason: string
//   }],
//   time_bucket: string
// }

export const dynamic = 'force-dynamic';
import { createClient } from '@supabase/supabase-js';
import { NextResponse }  from 'next/server';
import { getTimeBucket, getTopPatterns, haversineMeters } from '@/lib/behavior-engine';
import { decideSuggestions }                              from '@/lib/decision-engine';
import { getContext, scoreContext }                        from '@/lib/context-engine';   // v3
import { scoreIntent }                                     from '@/lib/intent-strength';  // v3
import { getUserProfile, getPersonalizedWeights, getUserThresholds } from '@/lib/personalization-engine'; // v4
import { predictNextActions } from '@/lib/behavior-intelligence'; // v5: Behavior Intel

function anonClient(req) {
  const auth  = (req.headers.get('Authorization') || '').trim();
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : auth;
  if (!token) return null;
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );
}

function svcClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

// Data-fetch guards (unchanged from original)
const MIN_FREQUENCY      = 2;    // don't pull patterns below this
const PROXIMITY_RADIUS_M = 300;  // proximity window for geo suggestions

export async function GET(request) {
  try {
    const anon = anonClient(request);
    if (!anon) return NextResponse.json({ suggestions: [] }, { status: 401 });

    const { data: { user } } = await anon.auth.getUser();
    if (!user) return NextResponse.json({ suggestions: [] }, { status: 401 });

    const url         = new URL(request.url);
    const currentLat  = parseFloat(url.searchParams.get('lat') || '');
    const currentLng  = parseFloat(url.searchParams.get('lng') || '');
    const hasLocation = !isNaN(currentLat) && !isNaN(currentLng);
    const timeBucket    = getTimeBucket();
    // v3: context (no GPS at predict time, use defaults) + common intent neutral
    const ctx           = getContext();  // time-only, no speed at predict call
    const context_score = scoreContext(ctx);

    // v4: personalization — async but fail-safe (returns defaults on any error)
    const profile    = await getUserProfile(user.id);
    const weights    = getPersonalizedWeights(profile);
    const thresholds = getUserThresholds(profile);
    console.log(`[PERSONALIZATION] user=${user.id.slice(0,8)} has_data=${profile.has_data} heavy=${profile.is_heavy_user}`);

    // ── Phase 5: build a raw candidate carrying all scoring fields ────────
    // decideSuggestions reads these fields to call scoreSuggestion internally.
    function mkCandidate(type, message, action_hint, pattern, extra = {}) {
      // v3: score intent from message text (fail-safe — defaults 0.5)
      const { intent_score } = scoreIntent(extra.content_text || message || '');
      return {
        type,
        message,
        action_hint,
        frequency:         extra.frequency         ?? pattern?.frequency        ?? 0,
        last_seen_at:      extra.last_seen_at      ?? pattern?.last_seen_at     ?? null,
        distance_meters:   extra.distance_meters   ?? null,
        time_bucket_match: extra.time_bucket_match ?? pattern?.time_bucket      ?? 'any',
        location_name:     extra.location_name     ?? pattern?.location_name    ?? null,
        pattern_id:        pattern?.id             ?? null,
        intent_score,   // v3: per-candidate intent strength
      };
    }

    const candidates = [];

    // ── 1. Time-based routine suggestions ────────────────────────────────
    const timePatterns = await getTopPatterns(user.id, {
      type: 'location', timeBucket: timeBucket, limit: 5,
    });
    for (const p of timePatterns) {
      if (p.frequency < MIN_FREQUENCY) continue;
      candidates.push(mkCandidate(
        'routine',
        `You usually visit ${p.location_name} in the ${timeBucket}. Add a reminder?`,
        `save_location:${p.location_name}`,
        p
      ));
    }

    // ── 2. Proximity-based suggestions ───────────────────────────────────
    if (hasLocation) {
      const allPatterns = await getTopPatterns(user.id, { type: 'location', limit: 20 });
      for (const p of allPatterns) {
        if (!p.latitude || !p.longitude) continue;
        if (p.frequency < MIN_FREQUENCY) continue;
        const dist = haversineMeters(currentLat, currentLng, p.latitude, p.longitude);
        if (dist > PROXIMITY_RADIUS_M) continue;
        if (candidates.some(c => c.location_name === p.location_name)) continue;
        candidates.push(mkCandidate(
          'geo',
          `You're near ${p.location_name}. Any reminders for here?`,
          `attach_geo:${p.location_name}`,
          p,
          { distance_meters: Math.round(dist) }
        ));
      }
    }

    // ── 3. Unresolved geo keeps ───────────────────────────────────────────
    const { data: unresolved } = await svcClient()
      .from('keeps')
      .select('location_name')
      .eq('user_id', user.id)
      .eq('geo_trigger_enabled', false)
      .not('location_name', 'is', null)
      .is('latitude', null)
      .eq('status', 'open')
      .limit(3);

    if (unresolved?.length) {
      const names = [...new Set(unresolved.map(k => k.location_name))];
      for (const name of names) {
        if (candidates.some(c => c.location_name === name)) continue;
        candidates.push(mkCandidate(
          'unresolved',
          `Save "${name}" to activate your geo reminder.`,
          `save_location:${name}`,
          null,
          {
            location_name:     name,
            frequency:         2,          // conservative: unresolved = mentioned ≥ once
            last_seen_at:      new Date().toISOString(),
            time_bucket_match: 'any',
          }
        ));
      }
    }

    // ── 4. Contact frequency patterns ────────────────────────────────────
    // "You often call this contact at this time"
    // Reads keeps with intent_type='contact' grouped by contact_name + time_bucket
    try {
      const { data: contactKeeps } = await svcClient()
        .from('keeps')
        .select('contact_name, intent_type, created_at')
        .eq('user_id', user.id)
        .eq('intent_type', 'contact')
        .not('contact_name', 'is', null)
        .order('created_at', { ascending: false })
        .limit(40);

      if (contactKeeps?.length) {
        // Count by contact name
        const freq = {};
        for (const k of contactKeeps) {
          const n = (k.contact_name || '').trim();
          if (!n) continue;
          freq[n] = (freq[n] || 0) + 1;
        }
        // Surface contacts with >= 2 recent interactions in this time bucket
        for (const [name, count] of Object.entries(freq)) {
          if (count < 2) continue;
          if (candidates.some(c => c.message?.includes(name))) continue;
          candidates.push(mkCandidate(
            'routine',
            `You often contact ${name}. Want to reach out?`,
            `contact:${name}`,
            null,
            {
              frequency:         count,
              location_name:     null,
              time_bucket_match: timeBucket,
              content_text:      `call ${name}`,
            }
          ));
        }
      }
    } catch { /* fail-safe */ }

    // ── 5. Pending keeps near current location ────────────────────────────
    // "You have 2 tasks pending near here" — surface geo-tagged open keeps
    if (hasLocation) {
      try {
        const { data: nearbyKeeps } = await svcClient()
          .from('keeps')
          .select('id, content, intent_type, location_name, latitude, longitude')
          .eq('user_id', user.id)
          .eq('status', 'open')
          .eq('geo_trigger_enabled', true)
          .not('latitude', 'is', null)
          .limit(20);

        if (nearbyKeeps?.length) {
          const grouped = {};
          for (const k of nearbyKeeps) {
            const dist = haversineMeters(currentLat, currentLng, k.latitude, k.longitude);
            if (dist > 500) continue; // 500 m radius for dashboard suggestion
            const loc = k.location_name || 'nearby';
            if (!grouped[loc]) grouped[loc] = [];
            grouped[loc].push({ ...k, dist });
          }
          for (const [loc, ks] of Object.entries(grouped)) {
            if (candidates.some(c => c.location_name === loc)) continue;
            const count = ks.length;
            const label = count === 1
              ? `1 pending keep near ${loc}`
              : `${count} pending keeps near ${loc}`;
            candidates.push(mkCandidate(
              'geo',
              label,
              `view_nearby:${loc}`,
              null,
              {
                location_name:   loc,
                frequency:       count + 1, // boost by 1 so it clears MIN_FREQUENCY
                distance_meters: Math.round(Math.min(...ks.map(k => k.dist))),
                time_bucket_match: 'any',
                content_text:    label,
              }
            ));
          }
        }
      } catch { /* fail-safe */ }
    }

    // ── 6. Behavior Intelligence: predict next actions ─────────────────────
    // Fused score: frequency × decay × time_match + sequence_boost + recency_gap
    // Surfaces "You usually log expenses in the evening" type predictions.
    // Runs through decideSuggestions just like geo/routine candidates.
    try {
      const prevIntent = url.searchParams.get('prev_intent') || undefined;
      const predictions = await predictNextActions(user.id, {
        timeBucket,
        hour:            ctx.hour,
        is_weekend:      ctx.is_weekend,
        lat:             hasLocation ? currentLat : undefined,
        lng:             hasLocation ? currentLng : undefined,
        prevIntentType:  prevIntent,
      }, 3);

      for (const pred of predictions) {
        // Skip if we already have a candidate for this intent/contact
        if (candidates.some(c =>
          c.message?.toLowerCase().includes((pred.contactName || pred.intentType).toLowerCase())
        )) continue;

        const message = pred.contactName
          ? `You often reach out to ${pred.contactName}. Contact them now?`
          : `You usually ${pred.label} around this time. Add one now?`;

        candidates.push(mkCandidate(
          'predicted',
          message,
          pred.contactName ? `contact:${pred.contactName}` : `predicted:${pred.intentType}`,
          null,
          {
            frequency:         Math.round(pred.score * 10) + 1, // synthetic freq for scorer
            time_bucket_match: timeBucket,
            content_text:      pred.reason,
            location_name:     null,
            prediction_score:  pred.score,
            prediction_reason: pred.reason,
            prediction_conf:   pred.confidence,
          }
        ));
      }
    } catch { /* fail-safe */ }

    // ── Phase 4: Decision Engine filters, scores, ranks, caps at 3 ───────
    const suggestions = decideSuggestions(candidates, {
      userId:         user.id,
      current_bucket: timeBucket,
      context_score,           // v3
      weights,                 // v4: personalized weights (or global defaults)
      thresholds: { ...thresholds, max_suggestions: 3 }, // v5: allow 3 for predicted tier
    });

    // Split into predicted vs contextual for the dashboard UI
    const predicted  = suggestions.filter(s => s.type === 'predicted');
    const contextual = suggestions.filter(s => s.type !== 'predicted');

    return NextResponse.json({
      suggestions,     // all suggestions (backward-compat — AgentSuggestionCard reads this)
      predicted,       // v5: behavior-predicted only → "Predicted for you" section
      contextual,      // v5: geo/routine only → AgentSuggestionCard
      time_bucket: timeBucket,
    });

  } catch (e) {
    console.error('[AGENT/PREDICT] error (fail-safe):', e.message);
    return NextResponse.json({ suggestions: [] });
  }
}
