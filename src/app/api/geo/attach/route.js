// src/app/api/geo/attach/route.js
// FIXED: cookies() → Bearer token auth
export const dynamic = 'force-dynamic';
import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

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
  const supabase = createBearerClient(request);
  if (!supabase) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const {
    keep_id, intent_id, lat, lng,
    location_name = null, radius_meters = 200,
    place_name = null, enable = true,
  } = body;
  const target_id = keep_id || intent_id;
  if (!target_id) return NextResponse.json({ error: 'keep_id or intent_id required' }, { status: 400 });

  let finalLat = lat, finalLng = lng, finalName = location_name;

  if (place_name && finalLat == null) {
    const mapsKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!mapsKey) return NextResponse.json({ error: 'GOOGLE_MAPS_API_KEY not configured' }, { status: 503 });
    const r = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(place_name)}&region=IN&key=${mapsKey}`);
    const g = await r.json();
    if (g.status !== 'OK') return NextResponse.json({ error: 'Geocoding failed: ' + g.status }, { status: 400 });
    finalLat = g.results[0].geometry.location.lat;
    finalLng = g.results[0].geometry.location.lng;
    finalName = finalName || g.results[0].formatted_address;
  }

  if (typeof finalLat !== 'number' || typeof finalLng !== 'number') {
    return NextResponse.json({ error: 'lat/lng or place_name required' }, { status: 400 });
  }

  if (!finalName) {
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${finalLat}&lon=${finalLng}&format=json`, { headers: { 'User-Agent': 'QuietKeep/1.0' } });
      const n = await r.json();
      finalName = n.display_name?.split(',').slice(0, 3).join(', ') || null;
    } catch {}
  }

  let updated = null;
  const keepsUpdate = await supabase.from('keeps')
    .update({ latitude: finalLat, longitude: finalLng, radius_meters: Math.max(50, Math.min(5000, radius_meters)), location_name: finalName, geo_trigger_enabled: enable })
    .eq('id', target_id).eq('user_id', user.id).select('id,content,latitude,longitude,location_name').maybeSingle();
  if (keepsUpdate.data) {
    updated = keepsUpdate.data;
  } else {
    const intentsUpdate = await supabase.from('intents')
      .update({ contact_info: JSON.stringify({ geo: { lat: finalLat, lng: finalLng, name: finalName, radius: radius_meters } }) })
      .eq('id', target_id).eq('user_id', user.id).select('id,subject,raw_text').maybeSingle();
    updated = intentsUpdate.data;
  }

  if (!updated) return NextResponse.json({ error: 'Record not found' }, { status: 404 });
  return NextResponse.json({ ok: true, record: updated, lat: finalLat, lng: finalLng, location_name: finalName });
}
