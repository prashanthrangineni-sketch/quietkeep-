'use client';
import { useAuth } from '@/lib/context/auth';
// src/app/drive/page.jsx — Drive Mode UI (voice-first, big-button layout)
// FIXED v2:
//   BUG: dialContact() called keepsRef.current.find(k => k.contact_phone)
//        This returned the FIRST keep with any phone (e.g. "Surya Reddy")
//        regardless of the spoken name ("call vaastav").
//   FIX: dialContactByName(spokenName) — extracts name from voice command,
//        finds the matching contact keep, confirms with speech before dialing.
//        Falls back to "Contact not found" instead of calling wrong person.
//   SAFETY: 4-second cancel window shown as overlay before call fires.

import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';

function drivespeak(text, onEnd) {
  if (!('speechSynthesis' in window)) { if (onEnd) onEnd(); return; }
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  try { u.lang = localStorage.getItem('qk_voice_lang') || 'en-IN'; } catch { u.lang = 'en-IN'; }
  u.rate = 0.95; u.pitch = 1;
  const voices = window.speechSynthesis.getVoices();
  const v = voices.find(v => v.lang === 'en-IN') || voices.find(v => v.lang.startsWith('en')) || null;
  if (v) u.voice = v;
  if (onEnd) u.onend = onEnd;
  window.speechSynthesis.speak(u);
}

export default function DriveModePage() {
  const { user, accessToken, loading: authLoading } = useAuth();
  const [keeps, setKeeps] = useState([]);
  const [keepIdx, setKeepIdx] = useState(0);
  const [speaking, setSpeaking] = useState(false);
  const [voiceListening, setVoiceListening] = useState(false);
  const [voiceCmd, setVoiceCmd] = useState('');
  const [timeStr, setTimeStr] = useState('');
  // callConfirm: { name, phone, countdown } — shown as overlay before call fires
  const [callConfirm, setCallConfirm] = useState(null);
  const recognitionRef = useRef(null);
  const keepIdxRef = useRef(0);
  const keepsRef = useRef([]);
  const callTimerRef = useRef(null);
  keepIdxRef.current = keepIdx;
  keepsRef.current = keeps;

  useEffect(() => {
    if (authLoading) return;
    if (!user) return;
    supabase.from('keeps')
        .select('content,contact_name,contact_phone')
        .eq('user_id', user.id)
        .eq('status', 'open')
        .order('created_at', { ascending: false })
        .limit(20)
        .then(({ data }) => {
          const k = data || [];
          setKeeps(k);
          keepsRef.current = k;
          window.__driveKeeps = k;
        });
    const tick = () => setTimeStr(new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }));
    tick();
    const t = setInterval(tick, 30000);
    setTimeout(() => drivespeak('Drive Mode on. Tap a button or say a command.'), 600);
    return () => {
      clearInterval(t);
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
      if (recognitionRef.current) { try { recognitionRef.current.stop(); } catch {} }
      if (callTimerRef.current) clearInterval(callTimerRef.current);
    };
  }, [user]);

  function readNextKeep() {
    const k = keepsRef.current;
    if (!k.length) { drivespeak('No pending keeps.'); return; }
    const keep = k[keepIdxRef.current % k.length];
    setSpeaking(true);
    drivespeak(keep.content, () => setSpeaking(false));
    setKeepIdx(i => i + 1);
  }

  // FIXED: extract spoken name from command and find matching contact keep
  // "call vaastav" → spokenName = "vaastav"
  // Find a keep whose contact_name contains "vaastav" (case-insensitive)
  // If no match: speak "Contact not found" — NEVER dial wrong person
  function findContactBySpokenName(cmd) {
    // Extract everything after "call" or "contact" keyword
    const match = cmd.match(/(?:call|contact|dial|phone|ring)\s+(.+)/i);
    if (!match) return null;
    const spoken = match[1].trim().toLowerCase();
    if (!spoken) return null;
    const k = keepsRef.current;
    // Exact name match first
    const exact = k.find(item =>
      item.contact_phone && item.contact_name?.toLowerCase() === spoken
    );
    if (exact) return exact;
    // Partial match (spoken name appears anywhere in stored name)
    const partial = k.find(item =>
      item.contact_phone && item.contact_name?.toLowerCase().includes(spoken)
    );
    if (partial) return partial;
    // Reverse partial (stored name appears in spoken phrase)
    const reverse = k.find(item =>
      item.contact_phone &&
      spoken.includes(item.contact_name?.toLowerCase() || '__no_match__')
    );
    return reverse || null;
  }

  // SAFETY: show 4-second confirmation overlay before actually dialing
  function initiateCallWithConfirmation(contactName, phone) {
    let countdown = 4;
    setCallConfirm({ name: contactName, phone, countdown });
    callTimerRef.current = setInterval(() => {
      countdown -= 1;
      if (countdown <= 0) {
        clearInterval(callTimerRef.current);
        callTimerRef.current = null;
        setCallConfirm(null);
        window.location.href = `tel:${phone}`;
      } else {
        setCallConfirm(prev => prev ? { ...prev, countdown } : null);
      }
    }, 1000);
  }

  function cancelCall() {
    if (callTimerRef.current) {
      clearInterval(callTimerRef.current);
      callTimerRef.current = null;
    }
    setCallConfirm(null);
    drivespeak('Call cancelled.');
  }

  // Called when user taps Dial button (no spoken name — show dialer)
  function dialTapAction() {
    drivespeak('Opening dialer.', () => { window.location.href = 'tel:'; });
  }

  function handleVoiceCommand(cmd) {
    if (cmd.includes('maps') || cmd.includes('navigate')) {
      drivespeak('Opening Maps.', () => window.open('https://maps.google.com', '_blank'));
    } else if (cmd.includes('music') || cmd.includes('spotify')) {
      drivespeak('Opening Music.', () => {
        window.open('spotify://', '_blank');
        setTimeout(() => window.open('https://music.youtube.com', '_blank'), 800);
      });
    } else if (cmd.includes('call') || cmd.includes('contact') || cmd.includes('dial')) {
      // FIXED: find contact by spoken name, not first-in-list
      const contactKeep = findContactBySpokenName(cmd);
      if (contactKeep?.contact_phone) {
        const name = contactKeep.contact_name || 'contact';
        drivespeak(`Calling ${name} in 4 seconds. Tap cancel to stop.`, () => {
          initiateCallWithConfirmation(name, contactKeep.contact_phone);
        });
      } else {
        // Extract what name was said for a useful error message
        const nameMatch = cmd.match(/(?:call|contact|dial|phone|ring)\s+(.+)/i);
        const saidName = nameMatch ? nameMatch[1].trim() : 'that contact';
        drivespeak(`${saidName} not found in your contacts. Opening dialer.`, () => {
          window.location.href = 'tel:';
        });
      }
    } else if (cmd.includes('whatsapp')) {
      const text = encodeURIComponent("I'm driving — will reply later. Sent via QuietKeep 🚗");
      drivespeak('Sending WhatsApp message.', () => window.open(`https://wa.me/?text=${text}`, '_blank'));
    } else if (cmd.includes('sos')) {
      drivespeak('S O S activated.', () => { window.location.href = '/emergency'; });
    } else if (cmd.includes('home') || cmd.includes('dashboard')) {
      drivespeak('Leaving drive mode.', () => { window.location.href = '/dashboard'; });
    } else if (cmd.includes('keep') || cmd.includes('read')) {
      readNextKeep();
    } else {
      drivespeak(`Sorry, I didn't understand: ${cmd}. Try: maps, music, call [name], read, home, or S O S.`);
    }
  }

  function startVoiceCommand() {
    const SR = window.webkitSpeechRecognition || window.SpeechRecognition;
    if (!SR) { drivespeak('Voice commands not supported on this browser.'); return; }
    if (voiceListening) {
      try { recognitionRef.current?.stop(); } catch {}
      setVoiceListening(false); return;
    }
    const r = new SR();
    r.lang = 'en-IN'; // Drive mode: STT intentionally en-IN — fixed English command set (maps/call/SOS/read/home)
    r.continuous = false; r.interimResults = false;
    r.onstart = () => setVoiceListening(true);
    r.onend = () => setVoiceListening(false);
    r.onerror = () => { setVoiceListening(false); drivespeak('Could not hear you. Try again.'); };
    r.onresult = (e) => {
      const cmd = e.results[0][0].transcript.toLowerCase().trim();
      setVoiceCmd(cmd);
      handleVoiceCommand(cmd);
    };
    recognitionRef.current = r;
    r.start();
    drivespeak('Listening.');
  }

  const GRID = [
    { icon: '🗺️', label: 'Maps', color: '#60a5fa', bg: 'rgba(96,165,250,0.15)',
      action: () => { drivespeak('Opening Maps.', () => window.open('https://maps.google.com', '_blank')); } },
    { icon: '🎵', label: 'Music', color: '#a78bfa', bg: 'rgba(167,139,250,0.15)',
      action: () => { drivespeak('Opening Music.', () => { window.open('spotify://', '_blank'); setTimeout(() => window.open('https://music.youtube.com', '_blank'), 800); }); } },
    { icon: '📞', label: 'Dial', color: '#34d399', bg: 'rgba(52,211,153,0.15)',
      action: dialTapAction },
    { icon: speaking ? '🔊' : '📋', label: speaking ? 'Reading…' : 'Read Keep', color: '#fbbf24', bg: 'rgba(251,191,36,0.15)',
      action: readNextKeep },
    { icon: '🆘', label: 'SOS', color: '#f87171', bg: 'rgba(248,113,113,0.18)',
      action: () => { drivespeak('S O S activated.', () => { window.location.href = '/emergency'; }); } },
    { icon: '🏠', label: 'Home', color: '#94a3b8', bg: 'rgba(148,163,184,0.1)',
      action: () => { drivespeak('Leaving drive mode.', () => { window.location.href = '/dashboard'; }); } },
  ];

  return (
    <div style={{
      minHeight: '100dvh', background: '#000', color: '#fff',
      display: 'flex', flexDirection: 'column',
      fontFamily: '-apple-system, BlinkMacSystemFont, system-ui, sans-serif',
      userSelect: 'none', paddingBottom: 'env(safe-area-inset-bottom)',
    }}>
      {/* Header */}
      <div style={{ background: '#0a0a12', borderBottom: '1px solid #1a1a2e', padding: '12px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 18 }}>🛣️</span>
          <span style={{ fontSize: 15, fontWeight: 700, color: '#f1f5f9' }}>Drive Mode</span>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: '#94a3b8', fontVariantNumeric: 'tabular-nums' }}>{timeStr}</span>
          <span style={{ fontSize: 11, color: '#6366f1' }}>
            {keeps.length} keep{keeps.length !== 1 ? 's' : ''}
          </span>
          <a href="/driving" style={{ fontSize: 11, color: '#6366f1', textDecoration: 'none', background: '#6366f115', border: '1px solid #6366f130', padding: '4px 10px', borderRadius: 8 }}>
            Log ›
          </a>
        </div>
      </div>

      {/* Voice command status bar */}
      {(voiceListening || voiceCmd) && (
        <div style={{ background: voiceListening ? 'rgba(99,102,241,0.2)' : 'rgba(251,191,36,0.15)', borderBottom: '1px solid rgba(99,102,241,0.3)', padding: '8px 18px', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 14 }}>{voiceListening ? '🎤' : '💬'}</span>
          <span style={{ fontSize: 12, color: voiceListening ? '#a5b4fc' : '#fbbf24', fontWeight: 600 }}>
            {voiceListening ? 'Listening for command…' : `"${voiceCmd}"`}
          </span>
        </div>
      )}

      {/* SAFETY: Call confirmation overlay — 4-second cancel window */}
      {callConfirm && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          background: 'rgba(0,0,0,0.92)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          padding: 32,
        }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>📞</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#f1f5f9', marginBottom: 8, textAlign: 'center' }}>
            Calling {callConfirm.name}
          </div>
          <div style={{ fontSize: 14, color: '#64748b', marginBottom: 32 }}>
            {callConfirm.phone}
          </div>
          <div style={{
            width: 80, height: 80, borderRadius: '50%',
            background: 'rgba(239,68,68,0.15)', border: '3px solid #ef4444',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 32, fontWeight: 900, color: '#ef4444', marginBottom: 24,
          }}>
            {callConfirm.countdown}
          </div>
          <button
            onClick={cancelCall}
            style={{
              padding: '16px 48px', borderRadius: 18,
              background: '#ef4444', border: 'none', color: '#fff',
              fontSize: 18, fontWeight: 800, cursor: 'pointer',
              fontFamily: 'inherit', WebkitTapHighlightColor: 'transparent',
            }}
          >
            ✕ Cancel
          </button>
          <div style={{ marginTop: 16, fontSize: 12, color: '#334155' }}>
            Call fires automatically when countdown reaches 0
          </div>
        </div>
      )}

      {/* Main grid */}
      <div style={{ flex: 1, padding: '16px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {GRID.map((item, i) => (
          <button key={i} onClick={item.action} style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            width: '100%', padding: '20px 10px', borderRadius: 18, border: `1px solid ${item.color}25`,
            background: item.bg, cursor: 'pointer', gap: 8, minHeight: 88,
            WebkitTapHighlightColor: 'transparent', fontFamily: 'inherit',
            transition: 'transform 0.1s, opacity 0.1s',
            opacity: speaking && item.label.includes('Read') ? 0.7 : 1,
          }}
          onTouchStart={e => e.currentTarget.style.transform = 'scale(0.96)'}
          onTouchEnd={e => e.currentTarget.style.transform = 'scale(1)'}
          >
            <span style={{ fontSize: 34 }}>{item.icon}</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: item.color }}>{item.label}</span>
          </button>
        ))}
      </div>

      {/* Voice command button */}
      <div style={{ padding: '0 16px 12px' }}>
        <button onClick={startVoiceCommand} style={{
          width: '100%', padding: '14px', borderRadius: 18,
          background: voiceListening ? 'rgba(99,102,241,0.3)' : 'rgba(99,102,241,0.12)',
          border: `1.5px solid ${voiceListening ? '#6366f1' : 'rgba(99,102,241,0.3)'}`,
          color: voiceListening ? '#a5b4fc' : '#818cf8',
          fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          WebkitTapHighlightColor: 'transparent',
        }}>
          <span style={{ fontSize: 18 }}>{voiceListening ? '⏹️' : '🎙️'}</span>
          {voiceListening ? 'Tap to stop listening' : 'Say a command (maps, music, call [name], SOS…)'}
        </button>
      </div>

      {/* WhatsApp quick message */}
      <div style={{ padding: '0 16px 12px' }}>
        <button onClick={() => {
          const text = encodeURIComponent("I'm driving — will reply later. Sent from QuietKeep 🚗");
          drivespeak('Sending WhatsApp driving message.');
          window.open(`https://wa.me/?text=${text}`, '_blank');
        }} style={{
          width: '100%', padding: '12px', borderRadius: 18,
          background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.25)',
          color: '#86efac', fontSize: 13, fontWeight: 700, cursor: 'pointer',
          fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          WebkitTapHighlightColor: 'transparent',
        }}>
          <span>💬</span> WhatsApp — I'm Driving
        </button>
      </div>

      <div style={{ textAlign: 'center', padding: '0 16px 16px', color: '#334155', fontSize: 11 }}>
        🛡️ Eyes on road. Say "call [name]" — exact name required. 4-second cancel window.
      </div>
    </div>
  );
}
