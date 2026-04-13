'use client';
import { useEffect, useState, useRef } from 'react';
import NavbarClient from '@/components/NavbarClient';

export default function CompassPage() {
  const [heading, setHeading]     = useState(null);
  const [location, setLocation]   = useState(null);
  const [locError, setLocError]   = useState('');
  const [permError, setPermError] = useState('');
  const [watching, setWatching]   = useState(false);
  const watchRef = useRef(null);
  const compassRef = useRef(null);

  useEffect(() => {
    startLocation();
    return () => {
      if (watchRef.current) navigator.geolocation.clearWatch(watchRef.current);
      window.removeEventListener('deviceorientationabsolute', handleOrientation);
      window.removeEventListener('deviceorientation', handleOrientation);
    };
  }, []);

  function handleOrientation(e) {
    let deg = null;
    if (e.webkitCompassHeading != null) {
      deg = e.webkitCompassHeading; // iOS
    } else if (e.absolute && e.alpha != null) {
      deg = 360 - e.alpha; // Android absolute
    } else if (e.alpha != null) {
      deg = 360 - e.alpha;
    }
    if (deg != null) setHeading(Math.round(deg));
    if (compassRef.current && deg != null) {
      compassRef.current.style.transform = `rotate(${-deg}deg)`;
    }
  }

  async function startCompass() {
    // iOS 13+ requires permission
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      try {
        const perm = await DeviceOrientationEvent.requestPermission();
        if (perm !== 'granted') { setPermError('Compass permission denied'); return; }
      } catch { setPermError('Could not request compass permission'); return; }
    }
    window.addEventListener('deviceorientationabsolute', handleOrientation, true);
    window.addEventListener('deviceorientation', handleOrientation, true);
  }

  function startLocation() {
    if (!navigator.geolocation) { setLocError('GPS not supported'); return; }
    setWatching(true);
    watchRef.current = navigator.geolocation.watchPosition(
      pos => setLocation({ lat: pos.coords.latitude.toFixed(5), lon: pos.coords.longitude.toFixed(5), acc: Math.round(pos.coords.accuracy) }),
      err => setLocError(err.message),
      { enableHighAccuracy: true, maximumAge: 5000 }
    );
    startCompass();
  }

  const dirLabel = (h) => {
    if (h == null) return '—';
    const dirs = ['N','NE','E','SE','S','SW','W','NW'];
    return dirs[Math.round(h / 45) % 8];
  };

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--bg)', color: 'var(--text)', fontFamily: 'system-ui, sans-serif' }}>
      <NavbarClient />
      <div style={{ maxWidth: 420, margin: '0 auto', padding: '6rem 16px 6rem', textAlign: 'center' }}>

        <h1 style={{ fontSize: 22, fontWeight: 800, marginBottom: 4 }}>🧭 Compass</h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 32 }}>Offline compass + location</p>

        {permError && <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 10, padding: '10px 14px', fontSize: 13, color: '#fca5a5', marginBottom: 20 }}>⚠️ {permError}</div>}

        {/* Compass rose */}
        <div style={{ position: 'relative', width: 220, height: 220, margin: '0 auto 32px' }}>
          {/* Outer ring */}
          <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: '2px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.03)' }} />
          {/* Cardinal labels */}
          {[['N',0],['E',90],['S',180],['W',270]].map(([d, deg]) => {
            const rad = (deg - 90) * Math.PI / 180;
            const x = 110 + 90 * Math.cos(rad);
            const y = 110 + 90 * Math.sin(rad);
            return <div key={d} style={{ position: 'absolute', left: x - 8, top: y - 10, fontSize: 13, fontWeight: 700, color: d === 'N' ? '#ef4444' : '#64748b' }}>{d}</div>;
          })}
          {/* Needle */}
          <div ref={compassRef} style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'transform 0.2s ease-out' }}>
            <div style={{ position: 'relative', width: 4, height: 160 }}>
              <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '50%', background: '#ef4444', borderRadius: '2px 2px 0 0' }} />
              <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '50%', background: '#475569', borderRadius: '0 0 2px 2px' }} />
            </div>
          </div>
          {/* Center dot */}
          <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: 12, height: 12, borderRadius: '50%', background: '#e2e8f0', border: '2px solid #0d1117' }} />
        </div>

        {/* Heading readout */}
        <div style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)', borderRadius: 16, padding: '20px', marginBottom: 20 }}>
          <div style={{ fontSize: 56, fontWeight: 800, letterSpacing: '-0.03em', color: 'var(--text)', lineHeight: 1 }}>
            {heading != null ? `${heading}°` : '—'}
          </div>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#6366f1', marginTop: 4 }}>{dirLabel(heading)}</div>
          <div style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 6 }}>
            {heading == null ? 'Tap button below to start compass' : 'Magnetic heading'}
          </div>
        </div>

        {/* Location */}
        <div style={{ background: 'var(--surface)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: '14px 16px', marginBottom: 20, textAlign: 'left' }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>📍 Location</div>
          {locError ? (
            <div style={{ fontSize: 13, color: '#f87171' }}>{locError}</div>
          ) : location ? (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
              {[['Latitude', location.lat], ['Longitude', location.lon], ['Accuracy', `±${location.acc}m`]].map(([l, v]) => (
                <div key={l}>
                  <div style={{ fontSize: 10, color: 'var(--text-subtle)', marginBottom: 2 }}>{l}</div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', fontFamily: 'monospace' }}>{v}</div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: 13, color: 'var(--text-subtle)' }}>Acquiring GPS…</div>
          )}
        </div>

        {heading == null && (
          <button onClick={startCompass}
            style={{ width: '100%', padding: '14px', borderRadius: 12, border: 'none', background: 'linear-gradient(135deg, #6366f1, #818cf8)', color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>
            🧭 Start Compass
          </button>
        )}

        <div style={{ marginTop: 16, fontSize: 11, color: 'var(--text-subtle)' }}>
          Works offline · Uses device sensors · No internet required
        </div>
      </div>
    </div>
  );
}
