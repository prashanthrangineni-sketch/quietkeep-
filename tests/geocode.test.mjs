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
  assert.deepEqual(pin, { latitude: 17.4512, longitude: 78.3801, display_name: 'Chintal Kunta, Hyderabad' })
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
