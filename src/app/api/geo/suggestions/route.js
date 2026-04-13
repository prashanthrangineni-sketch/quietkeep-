// src/app/api/geo/suggestions/route.js
// Feature 6: Predictive Geo Prompts
// Returns location-based suggestions based on:
//   - visit_count (frequent locations)
//   - last_visited_at time patterns
//   - open keeps with location_name but no coordinates (unresolved)
//
// Called by the Geo page to show contextual prompts like:
//   "You usually visit Office around this time. Want to add a reminder?"
export const dynamic = 'force-dynamic';
import { createClient } from '@supabase/supabase-js';
import { NextResponse }  from 'next/server';

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

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

export async function GET(request) {
  const anon = anonClient(request);
  if (!anon) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { data: { user } } = await anon.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const db = serviceClient();
  const suggestions = [];
  const nowHour = new Date().getHours(); // 0-23 local server hour

  // 1. Routine locations — frequently visited, pattern match by hour window
  const { data: locations } = await db
    .from('user_locations')
    .select('id, name, latitude, longitude, visit_count, last_visited_at')
    .eq('user_id', user.id)
    .gte('visit_count', 3)           // visited at least 3 times
    .order('visit_count', { ascending: false })
    .limit(5);

  if (locations) {
    for (const loc of locations) {
      if (!loc.last_visited_at) continue;
      const lastVisit = new Date(loc.last_visited_at);
      const lastHour  = lastVisit.getHours();
      const hourDiff  = Math.abs(nowHour - lastHour);
      // If user typically visits this location around this time of day (±2 hours)
      if (hourDiff <= 2) {
        suggestions.push({
          type:     'routine',
          location: loc.name,
          message:  `You usually visit ${loc.name} around this time. Add a reminder?`,
          location_id: loc.id,
          lat:      loc.latitude,
          lng:      loc.longitude,
        });
      }
    }
  }

  // 2. Unresolved geo keeps — keeps that have a location_name but no coordinates
  //    These are keeps where the user said "when I reach office" but office isn't saved yet
  const { data: unresolvedKeeps } = await db
    .from('keeps')
    .select('id, content, location_name')
    .eq('user_id', user.id)
    .eq('geo_trigger_enabled', false)
    .not('location_name', 'is', null)
    .is('latitude', null)
    .eq('status', 'open')
    .limit(3);

  if (unresolvedKeeps) {
    // Group by location_name to avoid duplicate suggestions
    const seen = new Set();
    for (const keep of unresolvedKeeps) {
      if (seen.has(keep.location_name)) continue;
      seen.add(keep.location_name);
      suggestions.push({
        type:          'unresolved',
        location:      keep.location_name,
        message:       `Save "${keep.location_name}" to activate: "${keep.content.slice(0, 50)}"`,
        keep_id:       keep.id,
        action:        'save_location',  // UI should open the save flow
      });
    }
  }

  // 3. Suggest saving current location if user has been saving keeps "here"
  //    (keep_id groups with location_name = null AND use_current_location)
  const { count: hereCount } = await db
    .from('keeps')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .is('location_name', null)
    .not('latitude', 'is', null)
    .eq('geo_trigger_enabled', true)
    .eq('status', 'open');

  if ((hereCount || 0) >= 2) {
    suggestions.push({
      type:    'save_current',
      message: `You have ${hereCount} location-based reminders without a saved place name. Name them for easier voice recall.`,
      action:  'name_locations',
    });
  }

  return NextResponse.json({ suggestions });
}
