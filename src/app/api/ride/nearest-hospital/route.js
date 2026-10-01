// src/app/api/ride/nearest-hospital/route.js
// Honda 2.0 step 7 — the nearest hospital to a point.
//
// POST { lat, lng, radiusMetres? } -> { hospital: { name, lat, lng, metres } | null }
//
// Source is OpenStreetMap's Overpass service: free, no key, and covers Indian
// towns reasonably well. Two reasons it is the right choice here rather than a
// paid maps service: it costs nothing per lookup, which matters when this runs
// after every crash; and it has no per-user terms that would stop us using the
// answer inside an emergency message.
//
// This is used in two places: a rider asking "nearest hospital" out loud, and
// the crash alert, so the people who get the message know where to go.
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const OVERPASS = 'https://overpass-api.de/api/interpreter';
const LOOKUP_TIMEOUT_MS = 6000;

function metresBetween(a, b) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

export async function POST(req) {
  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const lat = Number(body?.lat);
  const lng = Number(body?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ error: 'location required' }, { status: 400 });
  }
  const radius = Math.min(Math.max(Number(body?.radiusMetres) || 8000, 1000), 25000);

  // Hospitals and clinics with a name, nodes and ways both: a district hospital
  // is usually drawn as a building, not a point.
  const query = `
    [out:json][timeout:8];
    (
      node["amenity"~"^(hospital|clinic)$"]["name"](around:${radius},${lat},${lng});
      way["amenity"~"^(hospital|clinic)$"]["name"](around:${radius},${lat},${lng});
    );
    out center 30;`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);
  try {
    const res = await fetch(OVERPASS, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `data=${encodeURIComponent(query)}`,
      signal: controller.signal,
    });
    const data = await res.json();
    const here = { lat, lng };

    const found = (data?.elements || [])
      .map((el) => {
        const plat = el.lat ?? el.center?.lat;
        const plng = el.lon ?? el.center?.lon;
        if (!Number.isFinite(plat) || !Number.isFinite(plng)) return null;
        return {
          name: el.tags?.name,
          emergency: el.tags?.emergency === 'yes',
          isHospital: el.tags?.amenity === 'hospital',
          lat: plat,
          lng: plng,
          metres: metresBetween(here, { lat: plat, lng: plng }),
        };
      })
      .filter(Boolean)
      // A hospital beats a clinic even if the clinic is a little closer: after a
      // crash the rider needs a casualty department, not a consulting room.
      .sort((a, b) => (b.isHospital - a.isHospital) || (a.metres - b.metres));

    return NextResponse.json({ hospital: found[0] || null, considered: found.length });
  } catch {
    // Offline, or the lookup service is slow. Say so plainly rather than
    // guessing a hospital; a wrong address in an emergency is worse than none.
    return NextResponse.json({ hospital: null, unavailable: true });
  } finally {
    clearTimeout(timer);
  }
}
