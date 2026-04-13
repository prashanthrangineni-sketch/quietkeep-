// src/lib/geo-intelligence.js
// Phase 3 Step 2 — Geo + Predictive Intelligence
//
// Runs on the CLIENT (browser/Android) inside dashboard.
// Bridges LocationService GPS data → geo/check API → proactive dashboard cards.
//
// Responsibilities:
//   1. startDashboardGeoWatch()  — polls geolocation every GEO_INTERVAL_MS
//                                   calls /api/geo/check when position changes
//                                   calls onTriggered(keeps, location) when keeps fire
//   2. stopDashboardGeoWatch()  — cancels watch + timer
//   3. buildProactiveContext()  — enriches triggered keeps with prediction context
//
// This is additive and non-blocking. All errors are caught silently.
// The Android LocationService already handles background geo — this adds
// web/foreground awareness to the dashboard without touching native code.

import { apiPost } from '@/lib/safeFetch';

const GEO_INTERVAL_MS   = 60_000;   // poll every 60 s when in foreground
const MIN_MOVE_METERS   = 50;       // don't recheck if user moved < 50 m
const MAX_AGE_MS        = 30_000;   // don't use GPS older than 30 s

let _watchId     = null;
let _timer       = null;
let _lastPos     = null;  // { lat, lng, ts }
let _token       = '';
let _onTriggered = null;  // (keeps: Keep[], locationName: string) => void
let _onPosition  = null;  // (lat: number, lng: number) => void

// ── Haversine ─────────────────────────────────────────────────────────────────
function metersApart(a, b) {
  if (!a || !b) return Infinity;
  const R = 6371000;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const x = Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

// ── Core check ────────────────────────────────────────────────────────────────
async function doGeoCheck(lat, lng) {
  if (!_token) return;
  try {
    const { data, error } = await apiPost('/api/geo/check', {
      lat, lng,
      // speed/heading not available from browser Geolocation API
    }, _token);
    if (error || !data) return;

    // Fire callback when keeps are triggered
    if (data.triggered > 0 && Array.isArray(data.keeps) && data.keeps.length > 0) {
      const locationName = data.keeps[0]?.location_name || null;
      _onTriggered?.(data.keeps, locationName, { lat, lng });
    }
  } catch {
    // fail silently — never crash dashboard
  }
}

// ── GPS handler ───────────────────────────────────────────────────────────────
function handlePosition(pos) {
  const lat = pos.coords.latitude;
  const lng = pos.coords.longitude;
  const ts  = Date.now();

  // Notify dashboard of current position (for AgentSuggestionCard)
  _onPosition?.(lat, lng);

  // Only call geo/check if user moved enough or it's been a while
  const movedEnough  = metersApart(_lastPos, { lat, lng }) >= MIN_MOVE_METERS;
  const timeElapsed  = !_lastPos || (ts - (_lastPos.ts || 0)) >= GEO_INTERVAL_MS;

  if (movedEnough || timeElapsed) {
    _lastPos = { lat, lng, ts };
    doGeoCheck(lat, lng);
  }
}

// ── Public API ────────────────────────────────────────────────────────────────
/**
 * Start watching GPS and calling geo/check on the dashboard.
 *
 * @param {string}   token        - Supabase Bearer access token
 * @param {function} onTriggered  - called with (keeps[], locationName, coords)
 * @param {function} onPosition   - called with (lat, lng) for every GPS update
 */
export function startDashboardGeoWatch(token, onTriggered, onPosition) {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return;

  _token       = token;
  _onTriggered = onTriggered;
  _onPosition  = onPosition;

  // Use watchPosition for continuous updates
  _watchId = navigator.geolocation.watchPosition(
    handlePosition,
    () => {}, // ignore errors — user may have denied
    { enableHighAccuracy: false, maximumAge: MAX_AGE_MS, timeout: 10_000 }
  );

  // Safety timer: if watchPosition stalls, do a one-shot check every interval
  _timer = setInterval(() => {
    navigator.geolocation.getCurrentPosition(
      handlePosition,
      () => {},
      { enableHighAccuracy: false, maximumAge: MAX_AGE_MS, timeout: 8_000 }
    );
  }, GEO_INTERVAL_MS);
}

/**
 * Stop watching GPS.
 */
export function stopDashboardGeoWatch() {
  if (_watchId !== null) {
    navigator.geolocation?.clearWatch(_watchId);
    _watchId = null;
  }
  if (_timer !== null) {
    clearInterval(_timer);
    _timer = null;
  }
  _lastPos     = null;
  _onTriggered = null;
  _onPosition  = null;
}

/**
 * Enrich triggered keeps with display-ready fields for the proactive card.
 * Groups keeps by location and counts pending items.
 *
 * @param {Array}  keeps      - keeps[] from geo/check response
 * @param {string} locationName
 * @returns {{ locationName: string, keeps: Array, pendingCount: number, summary: string }}
 */
export function buildProactiveContext(keeps, locationName) {
  if (!keeps?.length) return null;

  const name    = locationName || keeps[0]?.location_name || 'this location';
  const pending = keeps.filter(k => k.status !== 'done' && k.status !== 'dismissed');
  const types   = [...new Set(pending.map(k => k.intent_type || 'keep'))];

  const typeLabel = (t) => ({
    task:     'task',     reminder: 'reminder', note:   'note',
    contact:  'contact',  invoice:  'invoice',  expense:'expense',
  }[t] || 'keep');

  const typeStr = types.slice(0, 2).map(typeLabel).join(' & ');
  const count   = pending.length;

  const summary = count === 1
    ? `1 ${typeStr} waiting at ${name}`
    : `${count} ${typeStr}s waiting at ${name}`;

  return { locationName: name, keeps: pending, pendingCount: count, summary };
}
