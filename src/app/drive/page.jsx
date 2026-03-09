'use client';
// NEW FILE: src/app/drive/page.jsx
// Sprint 2B — Drive Mode UI (full-screen big-button layout)
// Uses Web Speech API (built-in, no API key) for TTS
// Sarvam STT plugs in later as upgrade
// Existing /driving page (session logging) is UNTOUCHED

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';

const btn = (color, bg) => ({
  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
  width: '100%', padding: '22px 10px', borderRadius: 16, border: 'none',
  background: bg, color: color, fontSize: 28, cursor: 'pointer',
  fontFamily: 'system-ui,sans-serif', gap: 8, minHeight: 90,
  WebkitTapHighlightColor: 'transparent',
});

function speak(text) {
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'en-IN';
  window.speechSynthesis.speak(u);
}

export default function DriveModePage() {
  const [keeps, setKeeps] = useState([]);
  const [keepIdx, setKeepIdx] = useState(0);
  const [speaking, setSpeaking] = useState(false);
  const [user, setUser] = useState(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      setUser(user);
      // Load open keeps for voice reading
      supabase.from('keeps').select('content').eq('user_id', user.id).eq('status', 'open').order('created_at', { ascending: false }).limit(10)
        .then(({ data }) => setKeeps(data || []));
    });

    // Lock screen orientation to portrait on mobile if supported
    try {
      if (screen.orientation && screen.orientation.lock) {
        screen.orientation.lock('portrait').catch(() => {});
      }
    } catch {}

    return () => {
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    };
  }, []);

  function readNextKeep() {
    if (!keeps.length) { speak('No pending keeps.'); return; }
    const k = keeps[keepIdx % keeps.length];
    setSpeaking(true);
    const u = new SpeechSynthesisUtterance(k.content);
    u.lang = 'en-IN';
    u.onend = () => setSpeaking(false);
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
    setKeepIdx(i => i + 1);
  }

  const grid = [
    {
      icon: '🗺️', label: 'Maps',
      color: '#60a5fa', bg: 'rgba(96,165,250,0.12)',
      action: () => { speak('Opening Maps'); window.open('https://maps.google.com', '_blank'); },
    },
    {
      icon: '🎵', label: 'Music',
      color: '#a78bfa', bg: 'rgba(167,139,250,0.12)',
      action: () => { speak('Opening Music'); window.open('spotify://', '_blank'); setTimeout(() => window.open('https://music.youtube.com', '_blank'), 1000); },
    },
    {
      icon: '📞', label: 'Contacts',
      color: '#34d399', bg: 'rgba(52,211,153,0.12)',
      action: () => { speak('Opening Contacts'); window.location.href = 'tel:'; },
    },
    {
      icon: '🔊', label: speaking ? 'Reading…' : 'Read Keep',
      color: '#fbbf24', bg: 'rgba(251,191,36,0.12)',
      action: readNextKeep,
    },
    {
      icon: '🆘', label: 'SOS',
      color: '#f87171', bg: 'rgba(248,113,113,0.15)',
      action: () => { speak('SOS activated'); window.location.href = '/emergency'; },
    },
    {
      icon: '🏠', label: 'Dashboard',
      color: '#94a3b8', bg: 'rgba(148,163,184,0.08)',
      action: () => { speak('Going home'); window.location.href = '/dashboard'; },
    },
  ];

  return (
    <div style={{
      minHeight: '100vh', background: '#000', color: '#fff',
      display: 'flex', flexDirection: 'column',
      fontFamily: 'system-ui,sans-serif', userSelect: 'none',
      paddingBottom: 'env(safe-area-inset-bottom)',
    }}>
      {/* Header bar */}
      <div style={{ background: '#0a0a0f', borderBottom: '1px solid #1a1a2a', padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 20 }}>🛣️</span>
          <span style={{ fontSize: 16, fontWeight: 700, color: '#f1f5f9' }}>Drive Mode</span>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: '#475569' }}>
            {keeps.length} pending keep{keeps.length !== 1 ? 's' : ''}
          </span>
          <a href="/driving" style={{ fontSize: 11, color: '#6366f1', textDecoration: 'none', background: '#6366f115', border: '1px solid #6366f130', padding: '4px 10px', borderRadius: 8 }}>
            Session Log ›
          </a>
        </div>
      </div>

      {/* Big button grid */}
      <div style={{ flex: 1, padding: '20px 16px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        {grid.map((item, i) => (
          <button key={i} onClick={item.action} style={btn(item.color, item.bg)}>
            <span style={{ fontSize: 36 }}>{item.icon}</span>
            <span style={{ fontSize: 14, fontWeight: 700, color: item.color }}>{item.label}</span>
          </button>
        ))}
      </div>

      {/* WhatsApp quick send */}
      <div style={{ padding: '0 16px 20px' }}>
        <button
          onClick={() => {
            const text = encodeURIComponent("I'm driving — will reply later. Sent from QuietKeep 🚗");
            window.open(`https://wa.me/?text=${text}`, '_blank');
          }}
          style={{ ...btn('#86efac', 'rgba(34,197,94,0.1)'), flexDirection: 'row', gap: 10, fontSize: 16 }}
        >
          <span style={{ fontSize: 22 }}>💬</span>
          <span style={{ fontSize: 14, fontWeight: 700, color: '#86efac' }}>WhatsApp — I'm Driving</span>
        </button>
      </div>

      {/* Safety notice */}
      <div style={{ textAlign: 'center', padding: '0 16px 16px', color: '#334155', fontSize: 11 }}>
        🛡️ Keep eyes on road. Use voice commands only while moving.
      </div>
    </div>
  );
      }
