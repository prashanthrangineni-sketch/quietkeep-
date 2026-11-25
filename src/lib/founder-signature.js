// src/lib/founder-signature.js
// Checks that a call really comes from the founder dashboard (pranixailabs.com/founder).
//
// The dashboard and QuietKeep share one long secret (FOUNDER_DASHBOARD_KEY). The
// dashboard never sends the secret itself: it sends the time and a signature made
// from the secret, the time, the method and the exact body. A copied request stops
// working after five minutes, and a changed body no longer matches its signature.
import crypto from 'crypto';

export const MAX_AGE_SECONDS = 300;

export function signFounderRequest(key, timestamp, method, payload) {
  return crypto.createHmac('sha256', key).update(`${timestamp}.${String(method).toUpperCase()}.${payload || ''}`).digest('hex');
}

// Returns { ok: true } or { ok: false, status, error }.
export function verifyFounderRequest({ key, timestamp, signature, method, payload, now = Date.now() }) {
  if (!key || key.length < 32) return { ok: false, status: 503, error: 'Founder dashboard link is not set up yet.' };
  const ts = Number(timestamp);
  if (!timestamp || !signature || !Number.isFinite(ts)) return { ok: false, status: 401, error: 'Unauthorized' };
  if (Math.abs(now / 1000 - ts) > MAX_AGE_SECONDS) return { ok: false, status: 401, error: 'Request is too old.' };
  const expected = Buffer.from(signFounderRequest(key, String(timestamp), method, payload));
  const given = Buffer.from(String(signature));
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
    return { ok: false, status: 401, error: 'Unauthorized' };
  }
  return { ok: true };
}
