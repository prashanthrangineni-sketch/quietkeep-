// src/lib/geo.js
//
// Watches where the phone is, while QuietKeep is open, and asks the server
// whether any "remind me when I reach X" keep is now in range.
//
// WHAT WAS WRONG UNTIL 1 OCTOBER 2026
//   1. Nothing ever called startGeoFencing(). Checked across the repository:
//      the only mention of it was its own definition.
//   2. Had anything called it, every check would have been refused: it posted
//      to /api/geo/check with no Authorization header, and that route answers
//      401 without one.
//   So no place reminder has ever fired, however it was saved.
//   It is now started by the Aaria provider (src/lib/context/aaria.jsx) for a
//   signed-in user, with the token.
//
// WHAT THIS DOES NOT DO - and is not claimed to
//   It runs while QuietKeep is open (in front, or in Drive mode). It does not
//   run with the app closed: that needs Android's background-location
//   permission, which was removed for the Play submission until the required
//   disclosure screen exists (see android/app/src/main/AndroidManifest.xml).

const GEO_CHECK_INTERVAL = 30_000;
const GEO_OPTIONS = { enableHighAccuracy: true, timeout: 15_000, maximumAge: 15_000 };

let _watchId = null, _lastCheck = 0, _onTrigger = null, _getToken = null;
let _lastPos = null; // { latitude, longitude, at } - the most recent fix, kept in memory only

/**
 * Where the phone last was, if we were told within `maxAgeMs`. Sent with a
 * spoken reminder so "Mansurabad" means the one near the person. Never stored.
 */
export function lastKnownPosition(maxAgeMs = 30 * 60 * 1000) {
  if (!_lastPos || Date.now() - _lastPos.at > maxAgeMs) return null;
  return { latitude: _lastPos.latitude, longitude: _lastPos.longitude };
}

/**
 * @param onTriggerCallback (keep) => void, called once per keep the server
 *        says has just been reached.
 * @param getToken () => string|null, the signed-in user's access token.
 */
export function startGeoFencing(onTriggerCallback, getToken) {
  if (typeof window === 'undefined' || !navigator.geolocation) return;
  _onTrigger = onTriggerCallback;
  _getToken = getToken || null;
  if (_watchId !== null) return;
  _lastCheck = 0; // first position is checked at once, not 30 s later
  _watchId = navigator.geolocation.watchPosition(_onPosition, _onError, GEO_OPTIONS);
}

export function stopGeoFencing() {
  if (_watchId !== null && typeof navigator !== 'undefined' && navigator.geolocation) {
    navigator.geolocation.clearWatch(_watchId);
  }
  _watchId = null;
}

export function isGeoFencing() { return _watchId !== null; }

async function _onPosition(pos) {
  const now = Date.now();
  if (now - _lastCheck < GEO_CHECK_INTERVAL) return;
  _lastCheck = now;
  const token = _getToken ? _getToken() : null;
  if (!token) return;
  try {
    const res = await fetch('/api/geo/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy_m: typeof pos.coords.accuracy === 'number' ? pos.coords.accuracy : undefined,
        heading_deg: typeof pos.coords.heading === 'number' ? pos.coords.heading : undefined,
        speed_mps: typeof pos.coords.speed === 'number' ? pos.coords.speed : undefined,
      }),
    });
    if (!res.ok) return;
    const data = await res.json();
    if (data.triggered > 0 && Array.isArray(data.keeps)) {
      for (const keep of data.keeps) {
        if (_onTrigger) _onTrigger(keep);
      }
    }
  } catch { /* offline or server busy - next position tries again */ }
}

// Permission refused: stop asking. Timeouts and "unavailable" just wait for
// the next fix.
function _onError(err) { if (err && err.code === 1) stopGeoFencing(); }
