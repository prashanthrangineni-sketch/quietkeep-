// src/app/api/ride/hazards-near/route.js
// Honda 2.0 step 4 — the spots near a rider, so the phone can warn about them.
//
// Every rider's hard-braking reports feed one shared map, the way Honda's
// SAFETY MAP in Japan was built from Internavi braking data. So this reads
// ACROSS riders — but it hands back only clustered points: where, what kind,
// how bad, and how many reports. No user ids, no timestamps, nothing that
// could put a person at a place.
//
//   POST { lat, lng, radiusMetres? }  ->  { spots: [{ id, lat, lng, kind, severity, reports }] }

import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const MAX_RADIUS_M = 5000;
const DEFAULT_RADIUS_M = 2000;
const CLUSTER_PRECISION = 4; // ~11 m of latitude — one junction, not one street
const SEVERITY_RANK = { moderate: 1, hard: 2, severe: 3 };

export async function POST(req) {
  const auth = (req.headers.get('Authorization') || '').trim();
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : auth;
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const lat = Number(body?.lat);
  const lng = Number(body?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ error: 'location required' }, { status: 400 });
  }
  const radius = Math.min(MAX_RADIUS_M, Math.max(200, Number(body?.radiusMetres) || DEFAULT_RADIUS_M));

  // The caller must be a signed-in rider; the reading itself is anonymous.
  const asUser = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );
  const { data: { user } } = await asUser.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const db = serviceKey
    ? createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, serviceKey)
    : asUser; // without the shared key, a rider still gets their own spots

  const latDelta = radius / 111_320;
  const lngDelta = radius / (111_320 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));

  const { data, error } = await db
    .from('ride_road_events')
    .select('kind, location_lat, location_lng, severity')
    .gte('location_lat', lat - latDelta).lte('location_lat', lat + latDelta)
    .gte('location_lng', lng - lngDelta).lte('location_lng', lng + lngDelta)
    .limit(2000);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Cluster to a grid so ten reports at one junction become one spot.
  const clusters = new Map();
  for (const row of data || []) {
    const rLat = Number(row.location_lat), rLng = Number(row.location_lng);
    if (!Number.isFinite(rLat) || !Number.isFinite(rLng)) continue;
    const key = `${row.kind}:${rLat.toFixed(CLUSTER_PRECISION)}:${rLng.toFixed(CLUSTER_PRECISION)}`;
    const found = clusters.get(key);
    if (found) {
      found.reports += 1;
      found.sumLat += rLat;
      found.sumLng += rLng;
      if ((SEVERITY_RANK[row.severity] || 0) > (SEVERITY_RANK[found.severity] || 0)) found.severity = row.severity;
    } else {
      clusters.set(key, { id: key, kind: row.kind, severity: row.severity, reports: 1, sumLat: rLat, sumLng: rLng });
    }
  }

  const spots = [...clusters.values()].map(c => ({
    id: c.id,
    kind: c.kind,
    severity: c.severity,
    reports: c.reports,
    lat: c.sumLat / c.reports,
    lng: c.sumLng / c.reports,
  }));

  return NextResponse.json({ spots, shared: !!serviceKey });
}
