'use client';
// NEW FILE: src/app/connectors/page.jsx
// Sprint 2B — App Connectors Registry
// Reads/writes user_connectors table (12 rows already live)
// Deep links: Google Maps, Spotify, WhatsApp, Zomato, Blinkit, YouTube Music, etc.

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import NavbarClient from '@/components/NavbarClient';

const CONNECTORS = [
  {
    id: 'google_maps', name: 'Google Maps', icon: '🗺️', category: 'Navigation',
    desc: 'Opens navigation when you add a location keep',
    deep_link: 'https://maps.google.com',
    color: '#60a5fa',
  },
  {
    id: 'whatsapp', name: 'WhatsApp', icon: '💬', category: 'Communication',
    desc: 'Share keeps and briefs via WhatsApp',
    deep_link: 'https://wa.me/',
    color: '#4ade80',
  },
  {
    id: 'zomato', name: 'Zomato', icon: '🍕', category: 'Food',
    desc: 'Opens Zomato when you add a food/restaurant keep',
    deep_link: 'https://zomato.com',
    color: '#f87171',
  },
  {
    id: 'swiggy', name: 'Swiggy', icon: '🛵', category: 'Food',
    desc: 'Opens Swiggy for food delivery keeps',
    deep_link: 'https://swiggy.com',
    color: '#fb923c',
  },
  {
    id: 'blinkit', name: 'Blinkit', icon: '⚡', category: 'Grocery',
    desc: 'Opens Blinkit for grocery/quick commerce keeps',
    deep_link: 'https://blinkit.com',
    color: '#facc15',
  },
  {
    id: 'spotify', name: 'Spotify', icon: '🎵', category: 'Music',
    desc: 'Opens Spotify in Drive Mode',
    deep_link: 'spotify://',
    color: '#4ade80',
  },
  {
    id: 'youtube_music', name: 'YouTube Music', icon: '🎶', category: 'Music',
    desc: 'Opens YouTube Music in Drive Mode',
    deep_link: 'https://music.youtube.com',
    color: '#f87171',
  },
  {
    id: 'cart2save', name: 'Cart2Save', icon: '🛒', category: 'Shopping',
    desc: 'Opens Cart2Save for shopping keeps — neutral ONDC discovery',
    deep_link: 'https://cart2save.com',
    color: '#a78bfa',
  },
  {
    id: 'amazon', name: 'Amazon India', icon: '📦', category: 'Shopping',
    desc: 'Opens Amazon for purchase keeps',
    deep_link: 'https://amazon.in',
    color: '#fbbf24',
  },
  {
    id: 'google_calendar', name: 'Google Calendar', icon: '📅', category: 'Productivity',
    desc: 'Deep link to Google Calendar for scheduling keeps',
    deep_link: 'https://calendar.google.com',
    color: '#60a5fa',
  },
  {
    id: 'gpay', name: 'Google Pay', icon: '💳', category: 'Finance',
    desc: 'Opens GPay for payment and expense keeps',
    deep_link: 'tez://upi/',
    color: '#4ade80',
  },
  {
    id: 'paytm', name: 'Paytm', icon: '💰', category: 'Finance',
    desc: 'Opens Paytm for bill payment keeps',
    deep_link: 'paytmmp://',
    color: '#38bdf8',
  },
];

const CATEGORIES = [...new Set(CONNECTORS.map(c => c.category))];

export default function ConnectorsPage() {
  const [enabled, setEnabled] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(null);
  const [user, setUser] = useState(null);
  const [catFilter, setCatFilter] = useState('All');

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) { window.location.href = '/login'; return; }
      setUser(user);
      loadConnectors(user.id);
    });
  }, []);

  async function loadConnectors(uid) {
    const { data } = await supabase
      .from('user_connectors')
      .select('connector_name, is_enabled')
      .eq('user_id', uid);
    const map = {};
    (data || []).forEach(r => { map[r.connector_name] = r.is_enabled; });
    // Default all to enabled if no row exists
    CONNECTORS.forEach(c => { if (!(c.id in map)) map[c.id] = true; });
    setEnabled(map);
    setLoading(false);
  }

  async function toggle(connectorId) {
    if (!user) return;
    const newVal = !enabled[connectorId];
    setSaving(connectorId);
    setEnabled(prev => ({ ...prev, [connectorId]: newVal }));
    await supabase.from('user_connectors').upsert({
      user_id: user.id,
      connector_name: connectorId,
      is_enabled: newVal,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,connector_name' });
    setSaving(null);
  }

  function openConnector(link) {
    window.open(link, '_blank');
  }

  const filtered = catFilter === 'All' ? CONNECTORS : CONNECTORS.filter(c => c.category === catFilter);

  if (loading) return (
    <div style={{ minHeight: '100vh', background: '#0d1117', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ color: '#6366f1' }}>Loading connectors…</div>
    </div>
  );

  return (
    <div style={{ minHeight: '100vh', background: '#0d1117', color: '#f1f5f9', fontFamily: 'system-ui,sans-serif', paddingBottom: 80, paddingTop: '96px' }}>
      <NavbarClient />
      <div style={{ maxWidth: 600, margin: '0 auto', padding: '24px 16px' }}>

        <h1 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 6px' }}>🔌 Connectors</h1>
        <p style={{ color: '#475569', fontSize: 13, marginBottom: 20 }}>
          Enable apps to open automatically from your keeps. Toggle off to disable a connector.
        </p>

        {/* Category filter */}
        <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 8, marginBottom: 20, scrollbarWidth: 'none' }}>
          {['All', ...CATEGORIES].map(cat => (
            <button key={cat} onClick={() => setCatFilter(cat)} style={{
              whiteSpace: 'nowrap', padding: '5px 14px', borderRadius: 20,
              border: `1px solid ${catFilter === cat ? '#6366f1' : '#1e293b'}`,
              background: catFilter === cat ? '#6366f122' : '#1e293b',
              color: catFilter === cat ? '#818cf8' : '#64748b',
              fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
            }}>{cat}</button>
          ))}
        </div>

        {/* Connector cards */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {filtered.map(c => {
            const isOn = enabled[c.id] !== false;
            return (
              <div key={c.id} style={{
                background: '#0d1117', border: `1px solid ${isOn ? c.color + '25' : '#1e293b'}`,
                borderRadius: 12, padding: '14px 16px',
                display: 'flex', alignItems: 'center', gap: 14,
                opacity: isOn ? 1 : 0.5,
              }}>
                <div
                  style={{ fontSize: 28, width: 44, height: 44, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', background: isOn ? c.color + '18' : '#1e293b', flexShrink: 0, cursor: 'pointer' }}
                  onClick={() => openConnector(c.deep_link)}
                >
                  {c.icon}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: isOn ? '#f1f5f9' : '#64748b' }}>{c.name}</div>
                  <div style={{ fontSize: 11, color: '#475569', marginTop: 2 }}>{c.desc}</div>
                  <div style={{ fontSize: 10, color: c.color, marginTop: 4, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>{c.category}</div>
                </div>
                {/* Toggle */}
                <div
                  onClick={() => toggle(c.id)}
                  style={{
                    width: 44, height: 24, borderRadius: 12, cursor: saving === c.id ? 'wait' : 'pointer',
                    background: isOn ? c.color : '#1e293b', position: 'relative', flexShrink: 0, transition: 'background 0.2s',
                    border: `1px solid ${isOn ? c.color : '#334155'}`,
                  }}
                >
                  <div style={{
                    position: 'absolute', top: 3, left: isOn ? 23 : 3,
                    width: 16, height: 16, borderRadius: '50%', background: '#fff', transition: 'left 0.2s',
                  }} />
                </div>
              </div>
            );
          })}
        </div>

        <div style={{ textAlign: 'center', color: '#1e293b', fontSize: 12, marginTop: 24 }}>
          Connector links open in a new tab. No data is shared with third-party apps.
        </div>

      </div>
    </div>
  );
}
