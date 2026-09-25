// src/app/api/ride/road-event/route.js
// Honda 2.0 step 3 — record where riders brake hard.
//
// One POST per event, sent from the ride guard while riding. Kept small on
// purpose: a point, how fast the rider was going, how hard they slowed, and
// when. No route, no continuous location trail — we are building a map of
// risky SPOTS, not a record of where a person went.
//
//   POST { lat, lng, accuracy?, speedBeforeKmh?, speedAfterKmh?, decelKmhPerS?, kind? }
//     -> { recorded: true, id }
//
// Writes run as the signed-in rider, so the row-level rules on the table are
// what actually keep one rider's data away from another.
import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const KINDS = new Set(['hard_brake', 'swerve', 'pothole']);

function severityFor(decel) {
  if (decel >= 25) return 'severe';
  if (decel >= 18) return 'hard';
  return 'moderate';
}

export async function POST(req) {
  const auth = (req.headers.get('Authorization') || '').trim();
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : auth;
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const lat = Number(body?.lat);
  const lng = Number(body?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ error: 'location required' }, { status: 400 });
  }

  const decel = Number(body?.decelKmhPerS);
  const row = {
    user_id: user.id,
    kind: KINDS.has(body?.kind) ? body.kind : 'hard_brake',
    location_lat: lat,
    location_lng: lng,
    location_accuracy: Number.isFinite(Number(body?.accuracy)) ? Number(body.accuracy) : null,
    speed_before_kmh: Number.isFinite(Number(body?.speedBeforeKmh)) ? Number(body.speedBeforeKmh) : null,
    speed_after_kmh: Number.isFinite(Number(body?.speedAfterKmh)) ? Number(body.speedAfterKmh) : null,
    decel_kmh_per_s: Number.isFinite(decel) ? decel : null,
    severity: Number.isFinite(decel) ? severityFor(decel) : null,
  };

  const { data, error } = await sb.from('ride_road_events').insert(row).select('id').single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ recorded: true, id: data.id });
}
