// src/lib/nearby/search-core.js
// "Which shops near me have X?" - the server side rules (nearby plan, search step, 27 Nov 2026).
//
// Privacy rules kept here (Thread 3 review of the nearby plan, 25 Nov 2026):
//  1. The position is rounded to about 1 km on the phone, and rounded AGAIN here. Nothing finer
//     ever leaves QuietKeep.
//  2. Position and search words travel in the request body, never in a web address.
//  3. Nothing is stored and nothing is logged: search words can reveal health (a medicine name).
//  4. Cart2Save is told the rounded position and the words. Nothing about who asked.
//  5. Sign-in is required, with a limit on searches per minute for each account.
//  6. The call to Cart2Save is signed with a key of its own (QK_NEARBY_SEARCH_KEY).
import crypto from 'crypto';

export const MAX_QUERY_LENGTH = 80;
export const MAX_RESULTS = 20;
export const SEARCHES_PER_MINUTE = 12;
export const CART2SAVE_NEARBY_PATH = '/api/integrations/quietkeep/nearby';

// Off unless switched on. Stays off until the phone test passes (Thread 1's build order).
export function isNearbyEnabled(env = process.env) {
  return String(env.NEARBY_SEARCH_ENABLED || '').toLowerCase() === 'true';
}

// Two decimal places is about 1.1 km.
export function roundCoarse(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100) / 100;
}

// Reads what the phone sent. Returns { ok:true, ask:{query, lat, lng} | {query, pincode} } or { ok:false, status, error }.
export function readAsk(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, status: 400, error: 'Invalid request' };
  const query = String(body.query ?? '').replace(/\s+/g, ' ').trim();
  if (query.length < 2) return { ok: false, status: 400, error: 'Say what you are looking for.' };
  if (query.length > MAX_QUERY_LENGTH) return { ok: false, status: 400, error: 'That search is too long.' };

  const lat = roundCoarse(body.lat);
  const lng = roundCoarse(body.lng);
  if (lat !== null && lng !== null) {
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return { ok: false, status: 400, error: 'Position is not valid.' };
    return { ok: true, ask: { query, lat, lng } };
  }
  const pincode = String(body.pincode ?? '').trim();
  if (/^\d{6}$/.test(pincode)) return { ok: true, ask: { query, pincode } };
  return { ok: false, status: 400, error: 'Allow location or enter your pincode.' };
}

export function signNearbyRequest(key, timestamp, payload) {
  return crypto.createHmac('sha256', key).update(`${timestamp}.POST.${payload || ''}`).digest('hex');
}

// Builds the exact call sent to Cart2Save: only the words and the rounded position (or pincode).
export function buildCart2SaveCall(ask, { key, baseUrl, now = Date.now() }) {
  const payload = JSON.stringify(
    ask.pincode ? { query: ask.query, pincode: ask.pincode } : { query: ask.query, lat: ask.lat, lng: ask.lng }
  );
  const timestamp = String(Math.floor(now / 1000));
  return {
    url: String(baseUrl || '').replace(/\/+$/, '') + CART2SAVE_NEARBY_PATH,
    payload,
    headers: {
      'Content-Type': 'application/json',
      'x-qk-timestamp': timestamp,
      'x-qk-signature': signNearbyRequest(key, timestamp, payload),
    },
  };
}

const SHOP_FIELDS = ['shop_name', 'item_name', 'price', 'distance_km', 'availability', 'is_open_now', 'updated_ago', 'address', 'phone', 'shop_lat', 'shop_lng'];

// Only the listed public fields reach the phone, whatever Cart2Save answers.
export function cleanShops(answer) {
  const list = answer && Array.isArray(answer.shops) ? answer.shops : [];
  return list.slice(0, MAX_RESULTS).map((s) => {
    const out = {};
    for (const f of SHOP_FIELDS) out[f] = s && s[f] !== undefined ? s[f] : null;
    return out;
  });
}

// A limit on searches per minute for each account. It lives in the server's memory only:
// it holds an account id and a count, never the words or the position, and is gone on restart.
export function createRateLimiter({ limit = SEARCHES_PER_MINUTE, windowMs = 60000, maxAccounts = 5000 } = {}) {
  const hits = new Map();
  return function allow(accountId, now = Date.now()) {
    const recent = (hits.get(accountId) || []).filter((t) => now - t < windowMs);
    if (recent.length >= limit) { hits.set(accountId, recent); return false; }
    recent.push(now);
    hits.set(accountId, recent);
    if (hits.size > maxAccounts) {
      for (const [id, times] of hits) { if (!times.some((t) => now - t < windowMs)) hits.delete(id); }
    }
    return true;
  };
}
