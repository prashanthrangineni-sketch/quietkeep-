// src/lib/geo.js
const GEO_CHECK_INTERVAL = 30_000;
const GEO_OPTIONS = { enableHighAccuracy: true, timeout: 10_000, maximumAge: 15_000 };

let _watchId = null, _lastCheck = 0, _onTrigger = null;

export function startGeoFencing(onTriggerCallback) {
  if (typeof window === 'undefined' || !navigator.geolocation) return;
  if (_watchId !== null) return;
  _onTrigger = onTriggerCallback;
  _watchId = navigator.geolocation.watchPosition(_onPosition, _onError, GEO_OPTIONS);
}

export function stopGeoFencing() {
  if (_watchId !== null) { navigator.geolocation.clearWatch(_watchId); _watchId = null; }
}

async function _onPosition(pos) {
  const now = Date.now();
  if (now - _lastCheck < GEO_CHECK_INTERVAL) return;
  _lastCheck = now;
  try {
    const res = await fetch('/api/geo/check', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
    });
    if (!res.ok) return;
    const data = await res.json();
    if (data.triggered > 0 && Array.isArray(data.keeps)) {
      for (const keep of data.keeps) {
        _speakAlert(keep);
        if (_onTrigger) _onTrigger(keep);
      }
    }
  } catch {}
}

function _onError(err) { if (err.code === 1) stopGeoFencing(); }

function _speakAlert(keep) {
  if (!('speechSynthesis' in window)) return;
  const text = `QuietKeep reminder near ${keep.location_name || 'saved location'}. ${(keep.content || keep.subject || '').slice(0, 80)}`;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  // Safety pass: read qk_voice_lang from localStorage (same pattern as VoiceTalkback)
  try { u.lang = localStorage.getItem('qk_voice_lang') || 'en-IN'; } catch { u.lang = 'en-IN'; }
  u.rate = 0.93;
  window.speechSynthesis.speak(u);
}
