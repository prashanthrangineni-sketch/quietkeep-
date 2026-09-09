'use client';
import { safeFetch } from '@/lib/safeFetch';
// WeatherWidget.jsx — reads the shared connector_values cache (scope='weather').
// The cache is refreshed server-side by the connector-refresh function every 15
// minutes: ONE fetch per distinct city for the whole app, never one per tab.
// A Supabase realtime subscription pushes each refresh, so the card updates
// without a reload and without any client-side polling.
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

// Namespaced by city — a single global key used to show one city's weather
// under another city's name after the user changed their profile.
const CACHE_PREFIX = 'qk_weather_cache_';
const CACHE_TTL = 60 * 60 * 1000;
const DEFAULT_CITY = 'hyderabad';

// Same normalisation the server uses for connector_values.key.
const normCity = (c) => String(c || '').trim().toLowerCase();

function readCache(cityKey) {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + cityKey);
    if (!raw) return null;
    const { row, ts } = JSON.parse(raw);
    if (!row || !row.value || Date.now() - ts > CACHE_TTL) return null;
    return row;
  } catch { return null; }
}

function writeCache(cityKey, row) {
  try {
    localStorage.setItem(CACHE_PREFIX + cityKey, JSON.stringify({ row, ts: Date.now() }));
  } catch {}
}

function freshness(iso) {
  if (!iso) return '';
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  return `${Math.floor(hrs / 24)} d ago`;
}

export default function WeatherWidget({ city: cityProp = 'Hyderabad' }) {
  const [weather, setWeather] = useState(null);
  const [fetchedAt, setFetchedAt] = useState(null);
  const [stale, setStale] = useState(false);
  const [cityLabel, setCityLabel] = useState(cityProp);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let channel = null;

    // A row with status='error' still carries the last good value — show it,
    // quietly flagged, rather than blanking the card.
    function apply(row, cityKey) {
      if (cancelled || !row) return;
      if (row.value) {
        setWeather(row.value);
        setFetchedAt(row.fetched_at || null);
        setStale(row.status === 'error');
        setError(false);
        setLoading(false);
        writeCache(cityKey, row);
      } else if (row.status === 'error') {
        setError(true);
        setLoading(false);
      }
    }

    async function start() {
      // 1. Which city? profiles.city wins; the prop is only a fallback.
      let cityKey = normCity(cityProp) || DEFAULT_CITY;
      let token = '';
      try {
        const { data: { session } } = await supabase.auth.getSession();
        token = session?.access_token || '';
        const uid = session?.user?.id;
        if (uid) {
          const { data: prof } = await supabase
            .from('profiles').select('city').eq('user_id', uid).maybeSingle();
          const c = normCity(prof?.city);
          if (c) cityKey = c;
        }
      } catch {}
      if (cancelled) return;
      setCityLabel(cityKey);

      // 2. Paint this city's last known value immediately.
      const cached = readCache(cityKey);
      if (cached) apply(cached, cityKey);

      // 3. Read the shared cache row.
      let row = null;
      try {
        const { data } = await supabase
          .from('connector_values')
          .select('value,status,error_detail,fetched_at')
          .eq('scope', 'weather')
          .eq('key', cityKey)
          .maybeSingle();
        row = data || null;
      } catch {}
      if (cancelled) return;
      if (row) apply(row, cityKey);

      // 4. First load with nothing cached anywhere: fall back to the (now
      //    authenticated) proxy. Only for the default city — the proxy does not
      //    geocode, so for any other city it would return Hyderabad's sky under
      //    the wrong name. Other cities wait for the next 15-minute refresh.
      if (!row?.value && !cached) {
        if (cityKey === DEFAULT_CITY) {
          const { data: res } = await safeFetch(
            `/api/connectors/weather?city=${encodeURIComponent(cityKey)}`,
            { token }
          );
          if (cancelled) return;
          if (res && !res.error) {
            apply({ value: res, status: 'ok', fetched_at: new Date().toISOString() }, cityKey);
          } else { setError(true); }
        } else {
          setError(true);
        }
      }
      if (!cancelled) setLoading(false);

      // 5. Push, not poll. Same idiom as src/lib/capacitor/realtime.ts:
      //    one channel, postgres_changes, removed on unmount.
      channel = supabase
        .channel(`connector-weather-${cityKey}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'connector_values',
            filter: `key=eq.${cityKey}`,
          },
          (payload) => {
            const next = payload?.new;
            if (!next || next.scope !== 'weather') return;
            apply(next, cityKey);
          }
        )
        .subscribe();
    }

    start();

    return () => {
      cancelled = true;
      if (channel) { supabase.removeChannel(channel); channel = null; }
    };
  }, [cityProp]);

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
        <div style={{ color: 'var(--text-subtle)', fontSize: 11, marginTop: 2 }}>
          No reading for {cityLabel} yet — it refreshes every 15 minutes
        </div>
      </div>
    </div>
  );

  const isGood = weather.temp <= 32;
  const ago = freshness(fetchedAt);

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
            {weather.city || cityLabel}
          </div>
          <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text)', lineHeight: 1 }}>
            {weather.temp}°C
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
            {weather.description}
          </div>
          {(ago || stale) && (
            <div style={{ fontSize: 10, color: stale ? 'var(--amber)' : 'var(--text-subtle)', marginTop: 3 }}>
              {ago ? `Updated ${ago}` : ''}{stale ? `${ago ? ' · ' : ''}may be out of date` : ''}
            </div>
          )}
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
