// tests/geocode.test.mjs
import assert from 'node:assert/strict'
import test from 'node:test'
import { cleanPlaceName, geocodePlace } from '../src/lib/geocode.js'

test('trailing time words are not part of the place', () => {
  assert.equal(cleanPlaceName('chintal kunta today'), 'chintal kunta')
  assert.equal(cleanPlaceName('office tomorrow morning'), 'office')
  assert.equal(cleanPlaceName('  Charminar  '), 'Charminar')
  assert.equal(cleanPlaceName('kondapur kal'), 'kondapur')
})

test('a real-looking answer becomes coordinates', async () => {
  let url = ''
  const fetchImpl = async (u, init) => {
    url = String(u)
    assert.ok(init.headers['User-Agent'].startsWith('QuietKeep'))
    return { ok: true, json: async () => [{ lat: '17.4512', lon: '78.3801', display_name: 'Chintal Kunta, Hyderabad' }] }
  }
  const pin = await geocodePlace('chintal kunta today', { fetchImpl, nearLat: 17.4, nearLng: 78.4 })
  // distance_km: how far the chosen pin is from where the person is (new 3 Oct).
  assert.deepEqual(pin, { latitude: 17.4512, longitude: 78.3801, display_name: 'Chintal Kunta, Hyderabad', distance_km: 6.1 })
  assert.ok(url.includes('q=chintal+kunta'))
  assert.ok(url.includes('countrycodes=in'))
  assert.ok(url.includes('viewbox='))
})

test('no match, bad answer, or a thrown fetch all give null', async () => {
  assert.equal(await geocodePlace('chintal kunta', { fetchImpl: async () => ({ ok: true, json: async () => [] }) }), null)
  assert.equal(await geocodePlace('chintal kunta', { fetchImpl: async () => ({ ok: false }) }), null)
  assert.equal(await geocodePlace('chintal kunta', { fetchImpl: async () => { throw new Error('offline') } }), null)
  assert.equal(await geocodePlace('x', { fetchImpl: async () => { throw new Error('must not be called') } }), null)
})

// ── which one, when the map has several (3 October 2026) ─────────────────────
import { isPersonalPlace, prettyPlaceName, distanceKm } from '../src/lib/geocode.js'

const TWO_MANSURABADS = [
  { lat: '25.5912144', lon: '81.6711482', display_name: 'Mansurabad, Prayagraj, Uttar Pradesh' },
  { lat: '17.3541765', lon: '78.5652906', display_name: 'Mansoorabad, Hyderabad, Telangana' },
]

test('the nearest of several same-named places wins when we know where the person is', async () => {
  let url = ''
  const fetchImpl = async (u) => { url = String(u); return { ok: true, json: async () => TWO_MANSURABADS } }
  const pin = await geocodePlace('mansurabad', { fetchImpl, nearLat: 17.3441, nearLng: 78.5706 })
  assert.equal(pin.latitude, 17.3541765)
  assert.match(pin.display_name, /Hyderabad/)
  assert.ok(pin.distance_km < 5, `expected a nearby pin, got ${pin.distance_km} km`)
  assert.ok(url.includes('limit=5'))
})

test('with no idea where the person is, the first answer is kept (old behaviour)', async () => {
  const fetchImpl = async () => ({ ok: true, json: async () => TWO_MANSURABADS })
  const pin = await geocodePlace('mansurabad', { fetchImpl })
  assert.equal(pin.latitude, 25.5912144)
})

test('"home" and "office" are never looked up on a map', async () => {
  const mustNotFetch = async () => { throw new Error('must not be called') }
  assert.equal(await geocodePlace('home', { fetchImpl: mustNotFetch }), null)
  assert.equal(await geocodePlace('Office tomorrow', { fetchImpl: mustNotFetch }), null)
  assert.equal(isPersonalPlace('intiki'), true)
  assert.equal(isPersonalPlace('Mansoorabad'), false)
})

test('place names are shown with capitals; distances are sane', () => {
  assert.equal(prettyPlaceName('mansoorabad'), 'Mansoorabad')
  assert.equal(prettyPlaceName('chintal kunta today'), 'Chintal Kunta')
  const d = distanceKm(17.3441, 78.5706, 25.5912, 81.6711)
  assert.ok(d > 900 && d < 1050, `Hyderabad to Prayagraj is ~970 km, got ${d}`)
})
