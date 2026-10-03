// src/lib/geo-resolver.js  v2
// v2: shouldSuggestSave(), createRouteKeep() added. Backward-compatible.
// v1: resolveLocation(), autoSaveLocation()

/**
 * Look up a saved location by name (case-insensitive) for a user.
 */
export async function resolveLocation(supabase, userId, name) {
  if (!userId || !name) return null;
  try {
    // NOT .maybeSingle(). A person who tapped "Save here" for home more than
    // once has two rows called "home", and maybeSingle() answers "more than
    // one row" with an error and no data - so their saved home silently did
    // not exist (found 3 October 2026: three "home" rows, none ever used).
    // The most recently saved one is the one they meant.
    const { data } = await supabase
      .from('user_locations')
      .select('latitude, longitude, radius_meters, name, visit_count')
      .eq('user_id', userId)
      .ilike('name', name.trim())
      .order('created_at', { ascending: false })
      .limit(1);
    return (Array.isArray(data) && data[0]) || null;
  } catch { return null; }
}

/**
 * Roughly where this person lives their life: their saved home, else any
 * place they saved. Used only to choose between same-named places on the map.
 */
export async function anchorPoint(supabase, userId) {
  if (!userId) return null;
  try {
    const { data } = await supabase
      .from('user_locations')
      .select('name, latitude, longitude, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(20);
    const rows = (data || []).filter((r) => typeof r.latitude === 'number' && typeof r.longitude === 'number');
    const home = rows.find((r) => String(r.name || '').toLowerCase() === 'home');
    const pick = home || rows[0];
    return pick ? { latitude: pick.latitude, longitude: pick.longitude } : null;
  } catch { return null; }
}

/**
 * Auto-save a location by name + coords. Upserts. Non-blocking.
 */
export async function autoSaveLocation(supabase, userId, name, latitude, longitude, radius_meters = 200) {
  if (!userId || !name || typeof latitude !== 'number' || typeof longitude !== 'number') return;
  try {
    const { data: existing } = await supabase
      .from('user_locations')
      .select('id')
      .eq('user_id', userId)
      .ilike('name', name.trim())
      .maybeSingle();
    if (existing) {
      await supabase.from('user_locations')
        .update({ latitude, longitude, radius_meters, updated_at: new Date().toISOString() })
        .eq('id', existing.id);
    } else {
      await supabase.from('user_locations')
        .insert({ user_id: userId, name: name.trim().toLowerCase(), latitude, longitude, radius_meters });
    }
  } catch {}
}

/**
 * v2: Returns true if user has mentioned this location name ≥2 times without saving coords.
 * Drives the "suggest saving this location" UX prompt.
 */
export async function shouldSuggestSave(supabase, userId, locationName) {
  if (!userId || !locationName) return false;
  try {
    const { data: existing } = await supabase
      .from('user_locations')
      .select('id')
      .eq('user_id', userId)
      .ilike('name', locationName.trim())
      .maybeSingle();
    if (existing) return false;  // already saved

    const { count } = await supabase
      .from('keeps')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .ilike('location_name', locationName.trim())
      .is('latitude', null);
    return (count || 0) >= 2;
  } catch { return false; }
}

/**
 * v2: Create a route_keep entry for "on the way to X" keeps.
 * destLoc must be provided (resolved from user_locations or null check handled by caller).
 */
export async function createRouteKeep(supabase, userId, keepId, routeIntent, originLoc, destLoc) {
  if (!userId || !keepId || !destLoc?.latitude) return false;
  try {
    await supabase.from('route_keeps').insert({
      user_id:          userId,
      keep_id:          keepId,
      origin_name:      originLoc?.name || null,
      origin_lat:       originLoc?.latitude || null,
      origin_lng:       originLoc?.longitude || null,
      destination_name: routeIntent.destination || destLoc.name,
      destination_lat:  destLoc.latitude,
      destination_lng:  destLoc.longitude,
      radius_meters:    100,  // audit: ≈100m threshold per spec
      is_active:        true,
    });
    return true;
  } catch { return false; }
}
