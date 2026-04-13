'use client';
import { useAuth } from '@/lib/context/auth';
// src/app/driving/page.jsx — Trip Tracker (GPS session logger)
// FIXED v2: Added real GPS tracking via navigator.geolocation.watchPosition()
//   - Tracks distance using Haversine formula
//   - Saves start/end coords and distance_km to driving_sessions table
//   - Feature buttons now functional (link to actual pages)
//   - Replaced alert() with inline status messages (mobile-safe)

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import NavbarClient from '@/components/NavbarClient';
import { supabase } from '@/lib/supabase';

// Haversine distance between two lat/lng points in km
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng/2) * Math.sin(dLng/2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export default function DrivingPage() {
  const { user, accessToken, loading: authLoading } = useAuth();
  const router = useRouter();
  const [isDriving, setIsDriving] = useState(false);
  const [sessionId, setSessionId] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const [distanceKm, setDistanceKm] = useState(0);
  const [currentSpeed, setCurrentSpeed] = useState(null); // km/h
  const [gpsStatus, setGpsStatus] = useState(''); // 'active' | 'error' | ''
  const [statusMsg, setStatusMsg] = useState('');
  const [loading, setLoading] = useState(true);

  const geoWatchRef = useRef(null);
  const lastPosRef = useRef(null);
  const distanceRef = useRef(0);
  const startCoordsRef = useRef(null);

  useEffect(() => {
    checkDrivingStatus();
    return () => stopGeoWatch();
  }, []);

  useEffect(() => {
    if (!isDriving) return;
    const interval = setInterval(() => setElapsed(e => e + 1), 1000);
    return () => clearInterval(interval);
  }, [isDriving]);

  function stopGeoWatch() {
    if (geoWatchRef.current !== null) {
      navigator.geolocation?.clearWatch(geoWatchRef.current);
      geoWatchRef.current = null;
    }
  }

  function startGeoWatch() {
    if (!navigator.geolocation) {
      setGpsStatus('error');
      return;
    }
    setGpsStatus('active');
    geoWatchRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude: lat, longitude: lng, speed } = pos.coords;
        // Speed from GPS is in m/s — convert to km/h
        if (speed !== null) setCurrentSpeed(Math.round(speed * 3.6));

        if (lastPosRef.current) {
          const added = haversineKm(lastPosRef.current.lat, lastPosRef.current.lng, lat, lng);
          // Only count movement > 5m to filter GPS drift
          if (added > 0.005) {
            distanceRef.current = distanceRef.current + added;
            setDistanceKm(Math.round(distanceRef.current * 10) / 10);
          }
        } else {
          startCoordsRef.current = { lat, lng };
        }
        lastPosRef.current = { lat, lng };
      },
      (err) => {
        console.warn('GPS error:', err.message);
        setGpsStatus('error');
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 2000 }
    );
  }

  const checkDrivingStatus = async () => {
    try {
      if (user) {
        const { data } = await supabase
          .from('driving_sessions')
          .select('*')
          .eq('user_id', user?.id)
          .is('ended_at', null)
          .order('started_at', { ascending: false })
          .limit(1)
          .single();

        if (data) {
          setIsDriving(true);
          setSessionId(data.id);
          const startTime = new Date(data.started_at).getTime();
          setElapsed(Math.floor((Date.now() - startTime) / 1000));
          if (data.distance_km) {
            distanceRef.current = data.distance_km;
            setDistanceKm(data.distance_km);
          }
          startGeoWatch();
        }
      }
    } catch {
      // No active session — normal state
    } finally {
      setLoading(false);
    }
  };

  const handleStartDriving = async () => {
    if (authLoading) return;
    if (!user) return;
    try {
      const { data, error } = await supabase
        .from('driving_sessions')
        .insert({ user_id: user.id })
        .select()
        .single();

      if (error) throw error;

      setIsDriving(true);
      setSessionId(data.id);
      setElapsed(0);
      distanceRef.current = 0;
      setDistanceKm(0);
      lastPosRef.current = null;
      startCoordsRef.current = null;
      setStatusMsg('');
      startGeoWatch();

      if ('speechSynthesis' in window) {
        const u = new SpeechSynthesisUtterance('Driving mode activated. Stay safe!');
        try { u.lang = localStorage.getItem('qk_voice_lang') || 'en-IN'; } catch { u.lang = 'en-IN'; }
        speechSynthesis.speak(u);
      }
    } catch (error) {
      setStatusMsg('Could not start session: ' + error.message);
    }
  };

  const handleEndDriving = async () => {
    if (!sessionId) return;
    try {
      stopGeoWatch();
      await supabase
        .from('driving_sessions')
        .update({
          ended_at: new Date().toISOString(),
          duration_seconds: elapsed,
          distance_km: distanceRef.current,
          end_lat: lastPosRef.current?.lat || null,
          end_lng: lastPosRef.current?.lng || null,
          start_lat: startCoordsRef.current?.lat || null,
          start_lng: startCoordsRef.current?.lng || null,
        })
        .eq('id', sessionId);

      setIsDriving(false);
      setSessionId(null);
      setElapsed(0);
      setDistanceKm(0);
      setCurrentSpeed(null);
      setGpsStatus('');
      setStatusMsg(`Trip saved — ${distanceRef.current.toFixed(1)} km in ${formatTime(elapsed)}.`);
      distanceRef.current = 0;
    } catch (error) {
      setStatusMsg('Error ending session: ' + error.message);
    }
  };

  const formatTime = (seconds) => {
    const hrs  = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  if (loading) return (
    <div style={{ padding: '20px', textAlign: 'center', color: '#94a3b8',
      minHeight: '100vh', backgroundColor: 'var(--bg)',
      display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      Loading...
    </div>
  );

  return (
    <>
      <NavbarClient />
      <div style={{ minHeight: '100vh', backgroundColor: 'var(--bg)', color: '#f1f5f9',
        padding: '20px', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', paddingTop: '112px' }}>
        <div style={{ maxWidth: '500px', width: '100%', textAlign: 'center' }}>

          <h1 style={{ fontSize: '28px', fontWeight: '800', marginBottom: '4px' }}>🚗 Trip Tracker</h1>
          <div style={{ fontSize: 13, color: '#64748b', marginBottom: 24 }}>
            GPS-tracked driving sessions
          </div>

          {/* Timer */}
          <div style={{ fontSize: '48px', fontWeight: '700', color: '#6366f1',
            margin: '0 0 8px', fontFamily: 'monospace' }}>
            {formatTime(elapsed)}
          </div>

          {/* Distance + Speed */}
          <div style={{ display: 'flex', gap: 16, justifyContent: 'center', marginBottom: 24 }}>
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)',
              borderRadius: 10, padding: '10px 20px', minWidth: 90 }}>
              <div style={{ fontSize: 20, fontWeight: 700, color: '#22c55e' }}>
                {distanceKm.toFixed(1)}
              </div>
              <div style={{ fontSize: 11, color: '#64748b' }}>km</div>
            </div>
            {isDriving && (
              <div style={{ background: 'var(--surface)', border: '1px solid var(--border)',
                borderRadius: 10, padding: '10px 20px', minWidth: 90 }}>
                <div style={{ fontSize: 20, fontWeight: 700, color: '#60a5fa' }}>
                  {currentSpeed !== null ? currentSpeed : '--'}
                </div>
                <div style={{ fontSize: 11, color: '#64748b' }}>km/h</div>
              </div>
            )}
            {isDriving && (
              <div style={{ background: 'var(--surface)', border: '1px solid var(--border)',
                borderRadius: 10, padding: '10px 20px', minWidth: 90 }}>
                <div style={{ fontSize: 18, fontWeight: 700,
                  color: gpsStatus === 'active' ? '#22c55e' : gpsStatus === 'error' ? '#ef4444' : '#64748b' }}>
                  {gpsStatus === 'active' ? '📍' : gpsStatus === 'error' ? '⚠️' : '—'}
                </div>
                <div style={{ fontSize: 11, color: '#64748b' }}>
                  {gpsStatus === 'active' ? 'GPS' : gpsStatus === 'error' ? 'No GPS' : 'GPS'}
                </div>
              </div>
            )}
          </div>

          {/* Status message */}
          {statusMsg && (
            <div style={{ background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)',
              borderRadius: 10, padding: '10px 16px', marginBottom: 16,
              color: '#6ee7b7', fontSize: 13 }}>
              {statusMsg}
            </div>
          )}

          {/* Start / End button */}
          {!isDriving ? (
            <button onClick={handleStartDriving} style={{
              width: '100%', backgroundColor: '#6366f1', color: '#fff', border: 'none',
              padding: '16px', borderRadius: '12px', cursor: 'pointer',
              fontSize: '18px', fontWeight: '700', marginBottom: '20px' }}>
              🟢 START DRIVING
            </button>
          ) : (
            <>
              <button onClick={handleEndDriving} style={{
                width: '100%', backgroundColor: '#ef4444', color: '#fff', border: 'none',
                padding: '16px', borderRadius: '12px', cursor: 'pointer',
                fontSize: '18px', fontWeight: '700', marginBottom: '12px' }}>
                🔴 END TRIP
              </button>
              <div style={{ backgroundColor: 'var(--surface)', border: '2px solid #6366f1',
                borderRadius: '12px', padding: '12px 16px', marginBottom: '20px',
                fontSize: 13, color: '#94a3b8' }}>
                {gpsStatus === 'error'
                  ? '⚠️ GPS unavailable — distance not tracked'
                  : '📍 GPS active — tracking distance'}
              </div>
            </>
          )}

          {/* Feature links */}
          <div style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: '12px', padding: '16px', marginBottom: '20px' }}>
            <h3 style={{ fontSize: '13px', fontWeight: '600', marginBottom: '12px',
              color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Drive Tools
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              <a href="/drive" style={{ backgroundColor: isDriving ? '#6366f1' : '#1a1a2e',
                color: '#f1f5f9', border: '1px solid #334155', padding: '12px',
                borderRadius: '8px', fontSize: '13px', fontWeight: '600',
                textDecoration: 'none', display: 'block', textAlign: 'center' }}>
                🛣️ Drive Mode UI
              </a>
              <a href="https://maps.google.com" target="_blank" rel="noopener noreferrer"
                style={{ backgroundColor: isDriving ? '#6366f1' : '#1a1a2e',
                color: '#f1f5f9', border: '1px solid #334155', padding: '12px',
                borderRadius: '8px', fontSize: '13px', fontWeight: '600',
                textDecoration: 'none', display: 'block', textAlign: 'center' }}>
                📍 Maps
              </a>
              <a href="tel:" style={{ backgroundColor: isDriving ? '#6366f1' : '#1a1a2e',
                color: '#f1f5f9', border: '1px solid #334155', padding: '12px',
                borderRadius: '8px', fontSize: '13px', fontWeight: '600',
                textDecoration: 'none', display: 'block', textAlign: 'center' }}>
                📞 Dialer
              </a>
              <a href={`https://wa.me/?text=${encodeURIComponent("I'm driving — will reply later. 🚗")}`}
                target="_blank" rel="noopener noreferrer"
                style={{ backgroundColor: isDriving ? '#6366f1' : '#1a1a2e',
                color: '#f1f5f9', border: '1px solid #334155', padding: '12px',
                borderRadius: '8px', fontSize: '13px', fontWeight: '600',
                textDecoration: 'none', display: 'block', textAlign: 'center' }}>
                💬 WhatsApp
              </a>
            </div>
          </div>

          <button onClick={() => router.push('/dashboard')} style={{
            width: '100%', backgroundColor: '#1a1a2e', color: '#94a3b8',
            border: '1px solid #334155', padding: '12px', borderRadius: '8px',
            cursor: 'pointer', fontSize: '14px', fontWeight: '600' }}>
            ← Back to Dashboard
          </button>

        </div>
      </div>
    </>
  );
          }
