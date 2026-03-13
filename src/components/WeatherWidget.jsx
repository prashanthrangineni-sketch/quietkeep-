'use client';
// WeatherWidget.jsx — reads from /api/connectors/weather
// Shown only when feature flag 'weather' or daily_brief is enabled
// 1-hour client cache via localStorage
import { useEffect, useState } from 'react';

const CACHE_KEY = 'qk_weather_cache';
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

export default function WeatherWidget({ city = 'Hyderabad', lat = 17.385, lon = 78.487 }) {
  const [weather, setWeather] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    loadWeather();
  }, []);

  async function loadWeather() {
    // Check localStorage cache first
    try {
      const cached = localStorage.getItem(CACHE_KEY);
      if (cached) {
        const { data, ts } = JSON.parse(cached);
        if (Date.now() - ts < CACHE_TTL) {
          setWeather(data);
          setLoading(false);
          return;
        }
      }
    } catch {}

    try {
      const res = await fetch(`/api/connectors/weather?lat=${lat}&lon=${lon}&city=${encodeURIComponent(city)}`);
      if (!res.ok) throw new Error('unavailable');
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setWeather(data);
      // Cache it
      try { localStorage.setItem(CACHE_KEY, JSON.stringify({ data, ts: Date.now() })); } catch {}
    } catch {
      setError(true);
    }
    setLoading(false);
  }

  if (loading) return (
    <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14, padding: '14px 16px', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
      <div style={{ fontSize: 28 }}>🌤️</div>
      <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 13 }}>Loading weather…</div>
    </div>
  );

  if (error || !weather) return (
    <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px dashed rgba(255,255,255,0.08)', borderRadius: 14, padding: '14px 16px', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
      <div style={{ fontSize: 22 }}>🌤️</div>
      <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 13 }}>Weather unavailable</div>
    </div>
  );

  const isGood = weather.temp <= 32;
  const accentColor = isGood ? '#34d399' : '#f97316';

  return (
    <div style={{
      background: 'rgba(255,255,255,0.04)',
      border: `1px solid ${accentColor}28`,
      borderRadius: 14,
      padding: '14px 16px',
      marginBottom: 12,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
    }}>
      {/* Left: icon + city */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ fontSize: 36, lineHeight: 1 }}>{weather.icon}</div>
        <div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>
            {weather.city}
          </div>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#fff', lineHeight: 1 }}>
            {weather.temp}°C
          </div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', marginTop: 2 }}>
            {weather.description}
          </div>
        </div>
      </div>

      {/* Right: stats */}
      <div style={{ textAlign: 'right' }}>
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginBottom: 4 }}>
          Feels {weather.feels_like}°C
        </div>
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginBottom: 2 }}>
          💧 {weather.humidity}%
        </div>
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>
          💨 {weather.wind} km/h
        </div>
      </div>
    </div>
  );
}
