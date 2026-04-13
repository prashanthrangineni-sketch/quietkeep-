// src/app/api/geo/check/route.js  v2
// v2: passes accuracy_m, heading_deg, speed_mps to check_geo_triggers (new params).
//     Backward-compatible: new params are optional with defaults in the DB function.
//     Existing LocationService.java calls still work (lat/lng only).
export const dynamic = 'force-dynamic';
import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { recordGeoVisit, getTopPatterns, getTimeBucket } from '@/lib/behavior-engine';
import { shouldAutoTrigger } from '@/lib/decision-engine';
import { getContext, scoreContext }   from '@/lib/context-engine';  // v3

function createBearerClient(req) {
  const auth  = (req.headers.get('Authorization') || '').trim();
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : auth;
  if (!token) return null;
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );
}

export async function POST(request) {
  const anon = createBearerClient(request);
  if (!anon) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: { user } } = await anon.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { lat, lng, accuracy_m, heading_deg, speed_mps } = body;
  if (typeof lat !== 'number' || typeof lng !== 'number') {
    return NextResponse.json({ error: 'lat and lng required' }, { status: 400 });
  }

  // Use service role for the RPC call (SECURITY DEFINER fn already, but consistent pattern)
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  const { data, error } = await supabase.rpc('check_geo_triggers', {
    p_user_id:     user.id,
    p_lat:         lat,
    p_lng:         lng,
    p_accuracy_m:  typeof accuracy_m  === 'number' ? accuracy_m  : null,
    p_heading_deg: typeof heading_deg === 'number' ? heading_deg : null,
    p_speed_mps:   typeof speed_mps   === 'number' ? speed_mps   : null,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const result = data || { triggered: 0, keeps: [] };

  // Phase 4 / Decision Engine: JS-layer auto-trigger guard (non-blocking, fail-safe)
  // Runs BEFORE evaluate_keep so we can log the decision without blocking the response.
  // shouldAutoTrigger adds the full 4-signal confidence score on top of the DB freq check.
  if (result.triggered > 0 && Array.isArray(result.keeps)) {
    const currentBucket = getTimeBucket();
    for (const keep of result.keeps) {
      if (!keep.keep_id || !keep.auto_trigger) continue;
      // Fetch the behavior pattern for this location to feed the scorer
      getTopPatterns(user.id, { type: 'location', limit: 5 })
        .then(patterns => {
          const pattern = patterns.find(
            p => p.location_name?.toLowerCase() === (keep.location_name || '').toLowerCase()
          ) || null;
          const allowed = shouldAutoTrigger(
            {
              auto_trigger_enabled: keep.auto_trigger,
              geo_triggered_at:     null,  // DB already enforced cooldown, pass null here
              location_name:        keep.location_name,
            },
            pattern,
            {
              current_bucket:  currentBucket,
              distance_meters: keep.distance_meters ?? null,
            }
          );
          if (!allowed) {
            console.log(
              `[DECISION] auto_trigger suppressed by JS layer keep_id=${keep.keep_id}` +
              ` location=${keep.location_name}`
            );
          }
        })
        .then(() => {}).catch(() => {});
    }
  }

  // Non-blocking: evaluate triggered keeps
  if (result.triggered > 0 && Array.isArray(result.keeps)) {
    for (const keep of result.keeps) {
      if (!keep.keep_id) continue;
      supabase.rpc('evaluate_keep', {
        p_keep_id:    keep.keep_id,
        p_user_id:    user.id,
        p_user_state: 'AT_LOCATION',
        p_mode:       keep.domain_type === 'business' ? 'business' : 'personal',
      }).then(() => {}).catch(() => {});
    }
  }

  // Phase 1: Record geo visits into behavior_patterns (non-blocking, fail-safe)
  if (result.triggered > 0 && Array.isArray(result.keeps)) {
    for (const keep of result.keeps) {
      if (keep.location_name) {
        recordGeoVisit(user.id, {
          name:      keep.location_name,
          latitude:  lat,
          longitude: lng,
        }).then(() => {}).catch(() => {});
      }
    }
  }

  // Phase 5 (v3): compute rich context + attach to response
  const ctx = getContext({ speed_mps, heading_deg });
  const context_score = scoreContext(ctx);
  console.log(`[CONTEXT] state=${ctx.movement_state} bucket=${ctx.time_bucket} weekend=${ctx.is_weekend} ctx_score=${context_score}`);

  // backward-compat: keep existing 'movement' field shape unchanged
  const movement = {
    speed_mps:      typeof speed_mps   === 'number' ? Math.round(speed_mps * 10) / 10 : null,
    heading_deg:    ctx.heading_deg,
    state:          ctx.movement_state,  // v3: richer than 'moving'|'stationary'
  };

  return NextResponse.json({ ...result, movement, context: { ...ctx, context_score } });
}
