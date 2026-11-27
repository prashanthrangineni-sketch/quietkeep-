// src/lib/nearby-client.js
// Phone-side helper for "shops near me". Used by the nearby map and by Aaria (later steps).
//
//  - The position is rounded to about 1 km HERE, on the phone, before it is sent anywhere.
//  - It is sent in the request body, never in a web address.
//  - Recent answers are kept on this phone only, for at most 24 hours, then cleared.
import { supabase } from '@/lib/supabase';

const CACHE_KEY = 'qk_nearby_recent';
const CACHE_HOURS = 24;
const CACHE_MAX = 10;

export function roundCoarse(value) {
  const n = Number(value);
  if (value === null || value === undefined || value === '' || !Number.isFinite(n)) return null;
  return Math.round(n * 100) / 100;
}

// Asks the phone for its position once (the phone shows its own permission box) and rounds it.
// Resolves to { lat, lng } or null if the person says no.
export function getCoarsePosition() {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: roundCoarse(pos.coords.latitude), lng: roundCoarse(pos.coords.longitude) }),
      () => resolve(null),
      { enableHighAccuracy: false, maximumAge: 600000, timeout: 10000 }
    );
  });
}

function readCache(now = Date.now()) {
  try {
    const list = JSON.parse(localStorage.getItem(CACHE_KEY) || '[]');
    const fresh = Array.isArray(list) ? list.filter((e) => e && now - e.at < CACHE_HOURS * 3600000) : [];
    if (!Array.isArray(list) || fresh.length !== list.length) localStorage.setItem(CACHE_KEY, JSON.stringify(fresh));
    return fresh;
  } catch { return []; }
}
function writeCache(entry) {
  try {
    const list = [entry, ...readCache().filter((e) => e.k !== entry.k)].slice(0, CACHE_MAX);
    localStorage.setItem(CACHE_KEY, JSON.stringify(list));
  } catch {}
}
export function clearNearbyCache() { try { localStorage.removeItem(CACHE_KEY); } catch {} }

// where: { lat, lng } (any precision; rounded here) or { pincode }.
// Returns { ok:true, shops, fromCache } or { ok:false, error }.
export async function searchNearby(query, where = {}) {
  const q = String(query || '').replace(/\s+/g, ' ').trim();
  const lat = roundCoarse(where.lat), lng = roundCoarse(where.lng);
  const body = lat !== null && lng !== null ? { query: q, lat, lng } : { query: q, pincode: String(where.pincode || '').trim() };
  const k = JSON.stringify(body).toLowerCase();
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return { ok: false, error: 'Please sign in.' };
    const res = await fetch('/api/nearby/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Nearby shops are not available right now.');
    writeCache({ k, at: Date.now(), shops: data.shops || [] });
    return { ok: true, shops: data.shops || [], fromCache: false };
  } catch (e) {
    const hit = readCache().find((c) => c.k === k);
    if (hit) return { ok: true, shops: hit.shops, fromCache: true };
    return { ok: false, error: e.message || 'Nearby shops are not available right now.' };
  }
}
