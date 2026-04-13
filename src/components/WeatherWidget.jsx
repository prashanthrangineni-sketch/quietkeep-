'use client';
import { safeFetch } from '@/lib/safeFetch';
// WeatherWidget.jsx — Open-Meteo (no API key needed), 1-hour localStorage cache
import { useEffect, useState } from 'react';

const CACHE_KEY = 'qk_weather_cache';
const CACHE_TTL = 60 * 60 * 1000;

export default function WeatherWidget({ city = 'Hyderabad', lat = 17.385, lon = 78.487 }) {
  const [weather, setWeather] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => { loadWeather(); }, []);

  async function loadWeather() {
    try {
      const cached = localStorage.getItem(CACHE_KEY);
      if (cached) {
        const { data, ts } = JSON.parse(cached);
        if (Date.now() - ts < CACHE_TTL) {
          setWeather(data); setLoading(false); return;
        }
      }
    } catch {}
    try {
      const { data: res, error: resErr } = await safeFetch(`/api/connectors/weather?lat=${lat}&lon=${lon}&city=${encodeURIComponent(city)}`);
      if (resErr || !res) throw new Error('unavailable');
      const data = res;
      if (data.error) throw new Error(data.error);
      setWeather(data);
      try { localStorage.setItem(CACHE_KEY, JSON.stringify({ data, ts: Date.now() })); } catch {}
    } catch {
      setError(true);
    }
    setLoading(false);
  }

  if (loading) return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 14, padding: '14px 16px', marginBottom: 12,
      display: 'flex', alignItems: 'center', gap: 10,
      boxShadow: 'var(--shadow-card)',
    }}>
      <div style={{ fontSize: 28 }}>🌤️</div>
      <div style={{ color: 'var(--text-subtle)', fontSize: 13 }}>Loading weather…</div>
    </div>
  );

  if (error || !weather) return (
    <div style={{
      background: 'var(--surface)', border: '1.5px dashed var(--border-strong)',
      borderRadius: 14, padding: '14px 16px', marginBottom: 12,
      display: 'flex', alignItems: 'center', gap: 10,
    }}>
      <div style={{ fontSize: 22 }}>🌤️</div>
      <div>
        <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Weather unavailable</div>
        <div style={{ color: 'var(--text-subtle)', fontSize: 11, marginTop: 2 }}>Open-Meteo could not be reached</div>
      </div>
    </div>
  );

  const isGood = weather.temp <= 32;

  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderLeft: `4px solid ${isGood ? 'var(--accent)' : 'var(--amber)'}`,
      borderRadius: 14, padding: '14px 16px', marginBottom: 12,
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      boxShadow: 'var(--shadow-card)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ fontSize: 36, lineHeight: 1 }}>{weather.icon || '🌤️'}</div>
        <div>
          <div style={{ fontSize: 11, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>
            {weather.city}
          </div>
          <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text)', lineHeight: 1 }}>
            {weather.temp}°C
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
            {weather.description}
          </div>
        </div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginBottom: 3 }}>Feels {weather.feels_like}°C</div>
        <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginBottom: 3 }}>💧 {weather.humidity}%</div>
        <div style={{ fontSize: 11, color: 'var(--text-subtle)' }}>💨 {weather.wind} km/h</div>
      </div>
    </div>
  );
}
