// src/lib/geocode.js
//
// WHY THIS EXISTS
// 30 September 2026, 20:08 IST: "Set reminder to pick beers while going home
// near chintal kunta today". The place was detected, no saved location
// matched, so the keep was written with location_name and NO coordinates,
// geo_trigger_enabled=false. It could never fire. The only way a place could
// ever get coordinates was the user standing there and tapping "Save here"
// on the Geo page - which nobody does before the first time they need it.
//
// A place name is enough to put a pin on a map. This asks OpenStreetMap's
// Nominatim, which needs no key, and biases the answer toward India and,
// when the client sent it, toward where the user is now.
//
// Fail-safe: null on anything - no network, no match, rate limit. The caller
// then behaves exactly as it did before this file existed.

const NOMINATIM = 'https://nominatim.openstreetmap.org/search'

// Words that ride along on the end of a spoken place and are not the place.
const TRAILING_TIME_WORDS =
  /\b(today|tomorrow|tonight|now|later|evening|morning|afternoon|night|aaj|kal|abhi|ippudu|repu|ivala)\b\.?\s*$/i

/** "chintal kunta today" -> "chintal kunta". Pure. */
export function cleanPlaceName(name) {
  let s = String(name || '').replace(/\s+/g, ' ').trim()
  for (let i = 0; i < 3; i++) s = s.replace(TRAILING_TIME_WORDS, '').trim()
  return s
}

// Words that mean a place only THIS person can define. "Home" is wherever they
// saved it, never a map search: on 2 October 2026 "going home" was looked up
// on the map, matched a village 150 km away, and was then stored as the
// user's home. If one of these is not saved yet, there is no pin - by design.
const PERSONAL_PLACES = new Set([
  'home', 'house', 'my home', 'my house', 'office', 'my office', 'work', 'workplace',
  'ghar', 'ghar pe', 'illu', 'intiki', 'inti', 'intlo', 'ఇల్లు', 'ఇంటికి', 'घर', 'ऑफिस', 'ఆఫీస్',
])

/** Is this a "home / office" kind of word rather than a place on a map? Pure. */
export function isPersonalPlace(name) {
  return PERSONAL_PLACES.has(cleanPlaceName(name).toLowerCase())
}

/** "mansoorabad" -> "Mansoorabad", "chintal kunta" -> "Chintal Kunta". Pure. */
export function prettyPlaceName(name) {
  return cleanPlaceName(name).replace(/(^|[\s-])(\p{L})/gu, (m, sep, ch) => sep + ch.toUpperCase())
}

/** Straight-line kilometres between two points. Pure. */
export function distanceKm(lat1, lng1, lat2, lng2) {
  const R = 6371, rad = (d) => (d * Math.PI) / 180
  const dLat = rad(lat2 - lat1), dLng = rad(lng2 - lng1)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

/**
 * Coordinates for a spoken place name, or null.
 *
 * WHICH ONE, WHEN THERE ARE SEVERAL (3 October 2026)
 * "Remind me to buy milk when I reach Mansurabad" was pinned to a Mansurabad
 * in Uttar Pradesh, about 970 km from the user, because the first answer in the
 * whole country was taken. Now up to five answers are asked for and, when we
 * know roughly where the person is (their phone, or failing that a place they
 * saved such as home), the NEAREST one wins. `distance_km` is returned so the
 * caller can see how far the chosen pin is.
 *
 * @param {string} name
 * @param {{ nearLat?: number|null, nearLng?: number|null, fetchImpl?: typeof fetch }} [opts]
 * @returns {Promise<{ latitude:number, longitude:number, display_name:string }|null>}
 */
export async function geocodePlace(name, opts = {}) {
  const q = cleanPlaceName(name)
  if (q.length < 3) return null
  const f = opts.fetchImpl || fetch
  try {
    const params = new URLSearchParams({
      q, format: 'jsonv2', limit: '1', countrycodes: 'in', addressdetails: '0',
    })
    // Bias toward the user's current position when the client sent one: a
    // "Chintal Kunta" near them beats one 600 km away. ~0.5 degrees is about
    // a city and its outskirts. Not bounded, so a genuine far-away place still
    // resolves.
    if (typeof opts.nearLat === 'number' && typeof opts.nearLng === 'number') {
      const d = 0.5
      params.set('viewbox', `${opts.nearLng - d},${opts.nearLat + d},${opts.nearLng + d},${opts.nearLat - d}`)
    }
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 4000)
    let res
    try {
      res = await f(`${NOMINATIM}?${params}`, {
        headers: {
          // Nominatim's usage policy requires an identifying agent.
          'User-Agent': 'QuietKeep/1.0 (founder@pranixailabs.com)',
          'Accept-Language': 'en',
        },
        signal: ctrl.signal,
      })
    } finally {
      clearTimeout(timer)
    }
    if (!res?.ok) return null
    const rows = await res.json().catch(() => null)
    const hit = Array.isArray(rows) ? rows[0] : null
    const latitude = Number(hit?.lat), longitude = Number(hit?.lon)
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null
    return { latitude, longitude, display_name: String(hit.display_name || q) }
  } catch {
    return null
  }
}
