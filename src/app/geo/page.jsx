'use client';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/context/auth';
import { safeFetch, apiPost } from '@/lib/safeFetch';
// src/app/geo/page.jsx — Personal Geo Fencing dashboard
// Shows: geo-enabled keeps, active location status, trigger history
// User EXPERIENCE: see clearly which keeps have location triggers,
// what location triggers them, and get notified when one fires.

import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import NavbarClient from '@/components/NavbarClient';
import AgentSuggestionCard from '@/components/AgentSuggestionCard';

const GEO_POLL_INTERVAL = 5 * 60 * 1000; // 5 min foreground poll

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export default function GeoPage() {
  const router = useRouter();
  const { user, accessToken, loading: authLoading } = useAuth();
  const [geoKeeps, setGeoKeeps]       = useState([]);
  const [currentPos, setCurrentPos]   = useState(null);
  const [gpsStatus, setGpsStatus]     = useState('idle'); // idle | acquiring | active | error | denied
  const [lastCheck, setLastCheck]     = useState(null);
  const [lastResult, setLastResult]   = useState(null); // { triggered, keeps[] }
  const [loading, setLoading]         = useState(true);
  const [checkLog, setCheckLog]       = useState([]); // last 10 trigger events
  const pollTimerRef = useRef(null);
  const watchRef     = useRef(null);

  // ── Saved Locations state (NEW — additive) ──────────────────────────────
  const [savedLocations, setSavedLocations]   = useState([]);
  const [newLocName, setNewLocName]           = useState('');
  const [savingLoc, setSavingLoc]             = useState(false);
  const [locSaved, setLocSaved]               = useState('');
  const [saveError, setSaveError]             = useState('');  // surface API errors to user
  const [showAttachPrompt, setShowAttachPrompt] = useState(false); // Phase 6: post-save UX
  const [lastSavedLocName, setLastSavedLocName] = useState('');    // Phase 6: name of just-saved location

  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.replace('/login'); return; }
    loadGeoKeeps(user?.id);
    loadSavedLocations(accessToken);
    startGeoWatch(accessToken);
    return () => {
      // P5 FIX: handle both Capacitor watchId and browser watchId
      const w = watchRef.current;
      if (w !== null) {
        if (w?.type === 'capacitor') {
          try { w.plugin?.clearWatch({ id: w.id }); } catch {}
        } else if (w?.type === 'browser') {
          navigator.geolocation?.clearWatch(w.id);
        } else {
          // Legacy: plain number from old code
          navigator.geolocation?.clearWatch(w);
        }
        watchRef.current = null;
      }
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    };
  }, [user]);

  async function loadGeoKeeps(uid) {
    // Phase 4 FIX: fetch BOTH confirmed geo keeps AND keeps with a location_name
    // (unresolved — voice said "reach home" but home not saved yet).
    // Two queries unioned client-side to keep single fetch per type.
    const [{ data: active }, { data: pending }] = await Promise.all([
      supabase
        .from('keeps')
        .select('id, content, location_name, latitude, longitude, radius_meters, status, geo_trigger_enabled')
        .eq('user_id', uid)
        .eq('geo_trigger_enabled', true)
        .eq('status', 'open')
        .order('created_at', { ascending: false }),
      supabase
        .from('keeps')
        .select('id, content, location_name, latitude, longitude, radius_meters, status, geo_trigger_enabled')
        .eq('user_id', uid)
        .eq('geo_trigger_enabled', false)
        .not('location_name', 'is', null)
        .eq('status', 'open')
        .order('created_at', { ascending: false })
        .limit(20),
    ]);
    // Merge, deduplicate by id
    const seen = new Set();
    const merged = [...(active || []), ...(pending || [])].filter(k => {
      if (seen.has(k.id)) return false;
      seen.add(k.id);
      return true;
    });
    setGeoKeeps(merged);
    setLoading(false);
  }

  async function loadSavedLocations(token) {
    try {
      const { data: res, error: resErr } = await safeFetch('/api/geo/locations');
      if (!resErr && res) {
        const j = res;
        setSavedLocations(j.locations || []);
      }
    } catch {}
  }

  async function saveCurrentLocation() {
    if (!newLocName.trim() || !currentPos || !accessToken) return;
    setSavingLoc(true);
    setSaveError('');
    try {
      const { data: saved, error: saveErr } = await apiPost('/api/geo/locations', {
        name: newLocName.trim().toLowerCase(),
        latitude: currentPos.lat,
        longitude: currentPos.lng,
        radius_meters: 200,
      }, accessToken);
      if (!saveErr) {
        setLocSaved('✓ Saved!');
        setNewLocName('');
        loadSavedLocations(accessToken);
        loadGeoKeeps(user.id);  // refresh — some pending keeps may now be activatable
        setLastSavedLocName(saved.location?.name || '');
        setShowAttachPrompt(true);
        setTimeout(() => setLocSaved(''), 2000);
      } else {
        const err = await geoSaveRes.json().catch(() => ({}));
        setSaveError(err.error || `Save failed (${geoSaveRes.status})`);
        setTimeout(() => setSaveError(''), 4000);
      }
    } catch (e) {
      setSaveError('Network error — check connection');
      setTimeout(() => setSaveError(''), 4000);
    }
    setSavingLoc(false);
  }

  async function deleteLocation(id) {
    if (!accessToken) return;
    safeFetch(`/api/geo/locations?id=${id}`, { token: accessToken }).catch(()=>{});
    loadSavedLocations(accessToken);
  }

  async function startGeoWatch(token) {
    // P5 FIX: Use window.Capacitor.Plugins.Geolocation on native Android.
    //
    // WHY cap.toNative() FAILED:
    //   cap.toNative(pluginName, ...) routes to a registered Capacitor plugin.
    //   @capacitor/geolocation is installed by the APK CI npm step and
    //   auto-registered by Capacitor 6 at runtime, BUT it does NOT appear in
    //   capacitor.config.json plugins block, so cap.toNative('Geolocation',...)
    //   silently no-ops — the call resolves with nothing, no permission dialog.
    //
    // FIX: Access the plugin object directly via window.Capacitor.Plugins.Geolocation.
    //   This is how Capacitor 6 exposes auto-registered plugins to JS without
    //   any static import (which would break the Vercel build).
    //
    // WEB/PWA FALLBACK: navigator.geolocation unchanged — browser manages its own
    //   location permission dialog without any Capacitor involvement.

    const isNativeAndroid = typeof window !== 'undefined' &&
      window?.Capacitor?.isNativePlatform?.();

    if (isNativeAndroid) {
      try {
        const GeoPlugin = window?.Capacitor?.Plugins?.Geolocation;
        if (GeoPlugin) {
          // 1. Check current permission state
          const permResult = await GeoPlugin.checkPermissions();
          const locState = permResult?.location ?? permResult?.coarseLocation ?? 'prompt';

          if (locState !== 'granted') {
            // 2. Request permission via native OS dialog
            const reqResult = await GeoPlugin.requestPermissions({
              permissions: ['location', 'coarseLocation'],
            });
            const granted = reqResult?.location === 'granted' ||
                            reqResult?.coarseLocation === 'granted';
            console.log('[QK Geo] Capacitor location permission result:', granted);
            if (!granted) {
              setGpsStatus('denied');
              return; // Don't fall through to browser API — would show second dialog
            }
          }

          // 3. Watch position via Capacitor (avoids WebView browser permission dialog)
          const watchId = await GeoPlugin.watchPosition(
            { enableHighAccuracy: true, timeout: 15000 },
            (pos, err) => {
              if (err) {
                console.warn('[QK Geo] watchPosition error:', err);
                setGpsStatus('error');
                return;
              }
              const { latitude: lat, longitude: lng, accuracy } = pos.coords;
              setCurrentPos({ lat, lng, accuracy });
              setGpsStatus('active');
              callGeoCheck(lat, lng, token);
            }
          );
          // Store Capacitor watchId — cleared differently than navigator.geolocation watchId
          watchRef.current = { type: 'capacitor', id: watchId, plugin: GeoPlugin };
          return;
        }
        // GeoPlugin not available (APK CI didn't install @capacitor/geolocation)
        // Fall through to navigator.geolocation
        console.warn('[QK Geo] Capacitor Geolocation plugin not found — falling back to browser');
      } catch (e) {
        console.warn('[QK Geo] Capacitor geo error (non-fatal):', e?.message);
        // Fall through to navigator.geolocation on any error
      }
    }

    // WEB / PWA fallback — also used when Capacitor plugin unavailable
    if (!navigator.geolocation) { setGpsStatus('error'); return; }
    setGpsStatus('acquiring');
    const navWatchId = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude: lat, longitude: lng, accuracy } = pos.coords;
        setCurrentPos({ lat, lng, accuracy });
        setGpsStatus('active');
        callGeoCheck(lat, lng, token);
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) setGpsStatus('denied');
        else setGpsStatus('error');
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }
    );
    watchRef.current = { type: 'browser', id: navWatchId };
  }

  async function callGeoCheck(lat, lng, token) {
    const t = token || accessToken;
    if (!t) return;
    try {
      const { data: res, error: resErr } = await apiPost('/api/geo/check', { lat, lng });
      const result = res;
      setLastCheck(new Date());
      setLastResult(result);
      if (result.triggered > 0 && Array.isArray(result.keeps)) {
        // Add to check log
        setCheckLog(prev => [
          { time: new Date(), triggered: result.triggered, keeps: result.keeps, lat, lng },
          ...prev.slice(0, 9),
        ]);
        // Show browser notification
        if (Notification.permission === 'granted') {
          result.keeps.forEach(k => {
            new Notification('📍 QuietKeep Geo Reminder', {
              body: k.content || k.location_name || 'Location-based reminder triggered',
              icon: '/icon-192.png',
              tag: `geo-${k.id}`,
            });
          });
        }
      }
    } catch {}
    // Schedule next poll
    pollTimerRef.current = setTimeout(() => {
      if (currentPos) callGeoCheck(currentPos.lat, currentPos.lng, token);
    }, GEO_POLL_INTERVAL);
  }

  async function requestNotifPermission() {
    if (typeof Notification !== 'undefined') await Notification.requestPermission();
  }

  const gpsColors = {
    idle: '#64748b', acquiring: '#f59e0b', active: '#22c55e',
    error: '#ef4444', denied: '#ef4444',
  };
  const gpsLabels = {
    idle: 'Not started', acquiring: 'Acquiring GPS…',
    active: 'GPS Active', error: 'GPS error', denied: 'Location denied',
  };

  return (
    <div className="qk-page">
      <NavbarClient />
      <div className="qk-container">

        {/* Header */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <span style={{ fontSize: 22 }}>📍</span>
            <h1 style={{ fontSize: 20, fontWeight: 800, color: 'var(--text)' }}>Geo Fencing</h1>
          </div>
          <p style={{ fontSize: 13, color: 'var(--text-subtle)' }}>
            Location-based reminders — get alerted when you arrive somewhere.
          </p>
        </div>

        {/* GPS Status bar */}
        <div style={{
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 12, padding: '12px 16px', marginBottom: 16,
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <div style={{
            width: 10, height: 10, borderRadius: '50%',
            background: gpsColors[gpsStatus],
            boxShadow: gpsStatus === 'active' ? `0 0 8px ${gpsColors.active}` : 'none',
          }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
              {gpsLabels[gpsStatus]}
            </div>
            {currentPos && (
              <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 2 }}>
                {currentPos.lat.toFixed(5)}, {currentPos.lng.toFixed(5)}
                {currentPos.accuracy && ` · ±${Math.round(currentPos.accuracy)}m`}
              </div>
            )}
            {lastCheck && (
              <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 2 }}>
                Last check: {lastCheck.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                {lastResult && ` · ${lastResult.triggered || 0} triggered`}
              </div>
            )}
          </div>
          {typeof Notification !== 'undefined' && Notification.permission !== 'granted' && (
            <button
              onClick={requestNotifPermission}
              style={{ fontSize: 11, fontWeight: 600, color: 'var(--primary)',
                background: 'var(--primary-dim)', border: '1px solid var(--primary-glow)',
                borderRadius: 8, padding: '6px 10px', cursor: 'pointer', fontFamily: 'inherit' }}
            >
              Enable alerts
            </button>
          )}
          {gpsStatus === 'denied' && (
            <div style={{ fontSize: 11, color: 'var(--red)' }}>
              Allow location in browser settings
            </div>
          )}
        </div>

        {/* Phase 3: Agent Suggestion Card — 1–2 contextual suggestions, dismissable */}
        <AgentSuggestionCard
          accessToken={accessToken}
          lat={currentPos ? Math.round(currentPos.lat * 1000) / 1000 : undefined}
          lng={currentPos ? Math.round(currentPos.lng * 1000) / 1000 : undefined}
          onAction={(hint) => {
            if (hint?.startsWith('save_location:')) {
              const name = hint.replace('save_location:', '');
              setNewLocName(name);
              // Scroll to save input
              document.getElementById('loc-name-input')?.focus();
            }
          }}
        />

        {/* Geo-enabled keeps */}
        <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-subtle)', marginBottom: 10 }}>
          Location Triggers ({geoKeeps.length})
        </div>

        {loading && <div className="qk-spinner" style={{ margin: '20px auto' }} />}

        {!loading && geoKeeps.length === 0 && (
          <div className="qk-empty">
            <div className="qk-empty-icon">📍</div>
            <div className="qk-empty-title">No geo reminders yet</div>
            <div className="qk-empty-sub">
              Say something like <strong>"Buy milk when I reach home"</strong> to create one automatically.
              Then save "home" below — and it will trigger when you arrive.
            </div>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
          {geoKeeps.map(k => {
            const distKm = currentPos && k.latitude && k.longitude
              ? haversineKm(currentPos.lat, currentPos.lng, k.latitude, k.longitude)
              : null;
            const isNear = distKm !== null && distKm * 1000 <= (k.radius_meters || 200);
            return (
              <div key={k.id} className="qk-card" style={{
                padding: '13px 16px',
                borderLeft: `3px solid ${!k.geo_trigger_enabled ? '#f59e0b' : isNear ? '#22c55e' : 'var(--primary)'}`,
                background: isNear ? 'rgba(34,197,94,0.05)' : !k.geo_trigger_enabled ? 'rgba(245,158,11,0.04)' : undefined,
                opacity: k.geo_trigger_enabled ? 1 : 0.8,
              }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                  <span style={{ fontSize: 16, flexShrink: 0 }}>{isNear ? '🟢' : '📍'}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, color: 'var(--text)', fontWeight: 500, lineHeight: 1.4 }}>
                      {k.content}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                      {k.location_name || `${k.latitude?.toFixed(4)}, ${k.longitude?.toFixed(4)}`}
                      {k.radius_meters && k.geo_trigger_enabled && ` · ${k.radius_meters}m radius`}
                    </div>
                    {!k.geo_trigger_enabled && k.location_name && (
                      <div style={{ fontSize: 11, marginTop: 4, color: '#f59e0b', fontWeight: 600 }}>
                        ⚠ Save "{k.location_name}" below to activate trigger
                      </div>
                    )}
                    {distKm !== null && k.geo_trigger_enabled && (
                      <div style={{ fontSize: 11, marginTop: 4,
                        color: isNear ? '#22c55e' : '#64748b', fontWeight: isNear ? 700 : 400 }}>
                        {isNear
                          ? '✓ You are here — trigger active'
                          : `${distKm < 1 ? Math.round(distKm * 1000) + 'm' : distKm.toFixed(1) + 'km'} away`}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Recent trigger log */}
        {checkLog.length > 0 && (
          <>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-subtle)', marginBottom: 10 }}>
              Recent Triggers
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {checkLog.map((entry, i) => (
                <div key={i} className="qk-card" style={{ padding: '10px 14px', fontSize: 12 }}>
                  <div style={{ color: '#22c55e', fontWeight: 600, marginBottom: 4 }}>
                    🔔 {entry.triggered} keep{entry.triggered !== 1 ? 's' : ''} triggered
                  </div>
                  <div style={{ color: 'var(--text-subtle)' }}>
                    {entry.time.toLocaleTimeString('en-IN')} · {entry.lat.toFixed(4)}, {entry.lng.toFixed(4)}
                  </div>
                  {entry.keeps.map((k, j) => (
                    <div key={j} style={{ color: 'var(--text-muted)', marginTop: 3 }}>
                      • {k.content || k.id}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </>
        )}

        {/* ── Saved Locations Panel (NEW — additive) ─────────────────────── */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-subtle)', marginBottom: 10 }}>
            📍 Saved Locations ({savedLocations.length})
          </div>

          {/* Save current location */}
          {currentPos && (
            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              <input
                id="loc-name-input"
                type="text"
                value={newLocName}
                onChange={e => setNewLocName(e.target.value)}
                placeholder='Name this spot (e.g. "home")'
                style={{ flex: 1, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)', padding: '8px 12px', fontSize: 13, fontFamily: 'inherit', outline: 'none' }}
                onKeyDown={e => e.key === 'Enter' && saveCurrentLocation()}
              />
              <button
                onClick={saveCurrentLocation}
                disabled={savingLoc || !newLocName.trim()}
                style={{ padding: '8px 14px', borderRadius: 8, border: 'none', background: newLocName.trim() ? '#6366f1' : 'rgba(255,255,255,0.06)', color: newLocName.trim() ? '#fff' : '#475569', fontSize: 13, fontWeight: 600, cursor: newLocName.trim() ? 'pointer' : 'not-allowed', fontFamily: 'inherit', whiteSpace: 'nowrap' }}
              >
                {locSaved || (savingLoc ? 'Saving…' : '+ Save here')}
              </button>
            </div>
          )}
          {saveError && (
            <div style={{ fontSize: 12, color: '#ef4444', marginBottom: 8 }}>⚠ {saveError}</div>
          )}

          {/* Phase 6: Post-save UX — suggest attaching to a keep */}
          {showAttachPrompt && lastSavedLocName && (
            <div style={{ padding: '10px 12px', background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.25)', borderRadius: 8, fontSize: 13, marginBottom: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <span style={{ color: 'var(--text)' }}>
                📌 <strong>{lastSavedLocName}</strong> saved! Want to attach it to a pending reminder?
              </span>
              <button
                onClick={() => { setShowAttachPrompt(false); window.location.href = '/dashboard'; }}
                style={{ padding: '4px 10px', borderRadius: 6, background: '#6366f1', border: 'none', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}
              >Go to Dashboard →</button>
              <button onClick={() => setShowAttachPrompt(false)} style={{ background: 'none', border: 'none', color: 'var(--text-subtle)', cursor: 'pointer', fontSize: 16, padding: 0 }}>×</button>
            </div>
          )}

          {!currentPos && gpsStatus !== 'active' && (
            <div style={{ fontSize: 12, color: 'var(--text-subtle)', marginBottom: 10 }}>
              Enable GPS above to save your current location.
            </div>
          )}

          {savedLocations.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--text-subtle)', fontStyle: 'italic' }}>
              No saved locations yet. Say "buy milk when I reach home" after saving "home" here.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {savedLocations.map(loc => {
                const distKm = currentPos
                  ? haversineKm(currentPos.lat, currentPos.lng, loc.latitude, loc.longitude)
                  : null;
                return (
                  <div key={loc.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px' }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
                        📍 {loc.name}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 2 }}>
                        {loc.latitude.toFixed(4)}, {loc.longitude.toFixed(4)} · {loc.radius_meters}m
                        {distKm !== null && ` · ${distKm < 1 ? Math.round(distKm * 1000) + 'm' : distKm.toFixed(1) + 'km'} away`}
                      </div>
                    </div>
                    <button
                      onClick={() => deleteLocation(loc.id)}
                      style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 16, padding: '0 4px' }}
                      title="Delete"
                    >×</button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div style={{ marginTop: 16, padding: '12px 16px', background: 'var(--surface)',
          border: '1px solid var(--border)', borderRadius: 10, fontSize: 12, color: 'var(--text-subtle)', lineHeight: 1.7 }}>
          <strong style={{ color: 'var(--text-muted)' }}>How it works:</strong><br />
          1. Add a location to any keep via the keep's Edit panel.<br />
          2. This page checks your location every 5 minutes while open.<br />
          3. On Android, LocationService checks even when this page is closed.<br />
          4. When you arrive, a notification fires and the keep is evaluated.
        </div>

      </div>
    </div>
  );
}
