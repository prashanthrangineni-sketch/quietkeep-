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

/**
 * Coordinates for a spoken place name, or null.
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
