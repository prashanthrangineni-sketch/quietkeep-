'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

export default function DrivingMode() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [active, setActive] = useState(false);
  const [reminders, setReminders] = useState([]);
  const [currentReminder, setCurrentReminder] = useState(null);
  const [sessionId, setSessionId] = useState(null);
  const [listening, setListening] = useState(false);
  const [command, setCommand] = useState('');
  const [sessionStats, setSessionStats] = useState({ reminders_read: 0, maps_opened: 0, music_opened: 0 });
  const [sessionStart, setSessionStart] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const recognitionRef = useRef(null);
  const timerRef = useRef(null);
  const synthRef = useRef(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) { router.replace('/login'); return; }
      setUser(session.user);
      loadReminders(session.user.id);
    });
    return () => {
      clearInterval(timerRef.current);
      recognitionRef.current?.stop();
      window.speechSynthesis?.cancel();
    };
  }, [router]);

  async function loadReminders(uid) {
    const now = new Date();
    const soon = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const { data } = await supabase
      .from('intents')
      .select('id, content, remind_at, intent_type')
      .eq('user_id', uid)
      .eq('state', 'open')
      .not('remind_at', 'is', null)
      .lte('remind_at', soon.toISOString())
      .order('remind_at');
    if (data) setReminders(data);
  }

  function speak(text) {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utt = new SpeechSynthesisUtterance(text);
    utt.lang = 'en-IN';
    utt.rate = 0.9;
    utt.pitch = 1;
    window.speechSynthesis.speak(utt);
    synthRef.current = utt;
  }

  async function startSession() {
    setActive(true);
    setSessionStart(new Date());
    timerRef.current = setInterval(() => setElapsed(e => e + 1), 1000);

    const { data } = await supabase.from('driving_sessions').insert([{
      user_id: user.id, started_at: new Date().toISOString()
    }]).select().single();
    if (data) setSessionId(data.id);

    speak(`Driving mode started. You have ${reminders.length} reminder${reminders.length !== 1 ? 's' : ''} coming up. Say 'read reminders', 'maps', 'music', or 'stop driving' at any time.`);
    setTimeout(() => startListening(), 3000);
  }

  async function endSession() {
    clearInterval(timerRef.current);
    window.speechSynthesis?.cancel();
    recognitionRef.current?.stop();
    setActive(false);
    setListening(false);

    if (sessionId) {
      await supabase.from('driving_sessions').update({
        ended_at: new Date().toISOString(),
        duration_seconds: elapsed,
        ...sessionStats,
      }).eq('id', sessionId);

      await supabase.from('audit_log').insert([{
        user_id: user.id, action: 'driving_session_ended',
        service: 'driving-mode',
        details: { duration_seconds: elapsed, ...sessionStats },
      }]);
    }
    speak('Drive safe. Driving mode ended.');
    setTimeout(() => router.push('/dashboard'), 2000);
  }

  function startListening() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;
    const r = new SR();
    r.lang = 'en-IN';
    r.continuous = true;
    r.interimResults = false;
    recognitionRef.current = r;
    r.onstart = () => setListening(true);
    r.onend = () => { setListening(false); if (active) setTimeout(startListening, 1000); };
    r.onerror = () => setListening(false);
    r.onresult = (e) => {
      const transcript = e.results[e.results.length - 1][0].transcript.toLowerCase().trim();
      setCommand(transcript);
      handleVoiceCommand(transcript);
    };
    r.start();
  }

  function handleVoiceCommand(cmd) {
    if (/read reminder|what.*reminder|upcoming/.test(cmd)) {
      if (reminders.length === 0) { speak('No upcoming reminders.'); return; }
      const texts = reminders.slice(0, 3).map((r, i) => `${i + 1}: ${r.content}`).join('. ');
      speak(texts);
      setSessionStats(s => ({ ...s, reminders_read: s.reminders_read + 1 }));
    } else if (/maps|navigate|direction|take me to|go to/.test(cmd)) {
      const dest = cmd.replace(/maps|navigate|take me to|go to|directions? to/gi, '').trim();
      const url = dest ? `https://maps.google.com/?q=${encodeURIComponent(dest)}` : 'https://maps.google.com';
      window.open(url, '_blank');
      speak(`Opening Google Maps${dest ? ` for ${dest}` : ''}.`);
      setSessionStats(s => ({ ...s, maps_opened: s.maps_opened + 1 }));
    } else if (/music|play|spotify|song|gaana/.test(cmd)) {
      window.open('https://open.spotify.com', '_blank');
      speak('Opening Spotify.');
      setSessionStats(s => ({ ...s, music_opened: s.music_opened + 1 }));
    } else if (/stop|end|exit|finish/.test(cmd)) {
      speak('Ending driving mode.');
      setTimeout(() => endSession(), 1500);
    } else if (/call|phone/.test(cmd)) {
      const name = cmd.replace(/call|phone/gi, '').trim();
      speak(`To call ${name}, please use your phone safely after parking.`);
    } else if (/time|clock/.test(cmd)) {
      const t = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
      speak(`The time is ${t}`);
    } else if (/weather/.test(cmd)) {
      speak('I will check the weather for you. Please keep your eyes on the road.');
    } else {
      speak('Command not recognised. Say reminders, maps, music, time, or stop driving.');
    }
  }

  const fmt = (s) => `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;

  if (!active) return (
    <div style={{ minHeight: '100vh', backgroundColor: '#0a0a0f', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
      <div style={{ maxWidth: '400px', width: '100%', textAlign: 'center' }}>
        <div style={{ fontSize: '64px', marginBottom: '16px' }}>🚗</div>
        <h1 style={{ fontSize: '28px', fontWeight: '800', color: '#f1f5f9', marginBottom: '8px' }}>Driving Mode</h1>
        <p style={{ color: '#475569', fontSize: '14px', marginBottom: '32px', lineHeight: 1.6 }}>Voice-only controls. Large UI. Reads your reminders aloud. Hands-free navigation.</p>

        {reminders.length > 0 && (
          <div style={{ backgroundColor: '#0f0f1a', border: '1px solid #1e1e2e', borderRadius: '14px', padding: '16px', marginBottom: '24px', textAlign: 'left' }}>
            <div style={{ fontSize: '11px', color: '#6366f1', fontWeight: '700', marginBottom: '10px', textTransform: 'uppercase' }}>⏰ Reminders coming up</div>
            {reminders.slice(0, 3).map((r, i) => (
              <div key={i} style={{ fontSize: '13px', color: '#94a3b8', padding: '6px 0', borderBottom: i < 2 ? '1px solid #1a1a2e' : 'none' }}>
                {r.content.substring(0, 50)}{r.content.length > 50 ? '...' : ''}
              </div>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '24px', textAlign: 'left' }}>
          {[
            { cmd: '"Read reminders"', desc: 'Reads upcoming keeps aloud' },
            { cmd: '"Navigate to [place]"', desc: 'Opens Google Maps' },
            { cmd: '"Music"', desc: 'Opens Spotify' },
            { cmd: '"What time is it"', desc: 'Tells current time' },
            { cmd: '"Stop driving"', desc: 'Ends session' },
          ].map((c, i) => (
            <div key={i} style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
              <span style={{ backgroundColor: 'rgba(99,102,241,0.15)', color: '#a5b4fc', padding: '3px 8px', borderRadius: '6px', fontSize: '11px', fontWeight: '700', whiteSpace: 'nowrap' }}>{c.cmd}</span>
              <span style={{ color: '#475569', fontSize: '12px', paddingTop: '3px' }}>{c.desc}</span>
            </div>
          ))}
        </div>

        <button onClick={startSession} style={{
          width: '100%', padding: '18px', borderRadius: '16px', border: 'none',
          backgroundColor: '#22c55e', color: '#fff', fontSize: '18px', fontWeight: '800',
          cursor: 'pointer', letterSpacing: '0.02em',
        }}>🚦 Start Driving Mode</button>
        <button onClick={() => router.push('/dashboard')} style={{ marginTop: '12px', background: 'none', border: 'none', color: '#475569', fontSize: '13px', cursor: 'pointer' }}>← Back to Dashboard</button>
      </div>
    </div>
  );

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#020207', display: 'flex', flexDirection: 'column', padding: '20px' }}>
      {/* Status bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ width: '10px', height: '10px', backgroundColor: '#22c55e', borderRadius: '50%', display: 'inline-block', animation: 'pulse 1.5s ease infinite' }} />
          <span style={{ color: '#22c55e', fontWeight: '700', fontSize: '14px' }}>DRIVING</span>
        </div>
        <span style={{ color: '#334155', fontWeight: '700', fontSize: '18px', fontVariantNumeric: 'tabular-nums' }}>{fmt(elapsed)}</span>
        <div style={{ display: 'flex', gap: '12px', fontSize: '11px', color: '#334155' }}>
          <span>🔊{sessionStats.reminders_read}</span>
          <span>🗺️{sessionStats.maps_opened}</span>
          <span>🎵{sessionStats.music_opened}</span>
        </div>
      </div>

      {/* Voice indicator */}
      <div style={{
        flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '20px',
      }}>
        <div style={{
          width: '140px', height: '140px', borderRadius: '50%',
          backgroundColor: listening ? 'rgba(99,102,241,0.2)' : 'rgba(30,30,46,0.8)',
          border: `3px solid ${listening ? '#6366f1' : '#1e1e2e'}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '56px',
          boxShadow: listening ? '0 0 40px rgba(99,102,241,0.4)' : 'none',
          animation: listening ? 'glow 1.5s ease infinite' : 'none',
        }}>🎙️</div>
        <div style={{ color: listening ? '#a5b4fc' : '#334155', fontSize: '16px', fontWeight: '600' }}>
          {listening ? 'Listening...' : 'Tap mic or say command'}
        </div>
        {command && (
          <div style={{ color: '#64748b', fontSize: '13px', fontStyle: 'italic' }}>"{command}"</div>
        )}
      </div>

      {/* Quick action buttons */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
        {[
          { label: '🗺️ Maps', action: () => { window.open('https://maps.google.com', '_blank'); speak('Opening maps.'); setSessionStats(s => ({ ...s, maps_opened: s.maps_opened + 1 })); } },
          { label: '🎵 Music', action: () => { window.open('https://open.spotify.com', '_blank'); speak('Opening music.'); setSessionStats(s => ({ ...s, music_opened: s.music_opened + 1 })); } },
          { label: '⏰ Reminders', action: () => { if (reminders.length === 0) { speak('No reminders.'); return; } speak(reminders[0].content); setSessionStats(s => ({ ...s, reminders_read: s.reminders_read + 1 })); } },
          { label: '🕐 Time', action: () => speak(new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })) },
        ].map((btn, i) => (
          <button key={i} onClick={btn.action} style={{
            padding: '20px', borderRadius: '16px', border: '1px solid #1e1e2e',
            backgroundColor: '#0f0f1a', color: '#f1f5f9', fontSize: '16px', fontWeight: '700',
            cursor: 'pointer', textAlign: 'center',
          }}>{btn.label}</button>
        ))}
      </div>

      <button onClick={endSession} style={{
        width: '100%', padding: '18px', borderRadius: '16px', border: 'none',
        backgroundColor: '#ef4444', color: '#fff', fontSize: '18px', fontWeight: '800', cursor: 'pointer',
      }}>⏹ End Driving Mode</button>

      <style>{`
        @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }
        @keyframes glow { 0%,100% { box-shadow: 0 0 40px rgba(99,102,241,0.4); } 50% { box-shadow: 0 0 60px rgba(99,102,241,0.7); } }
      `}</style>
    </div>
  );
      }
