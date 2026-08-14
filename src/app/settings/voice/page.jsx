'use client';
// src/app/settings/voice/page.jsx — Voice & Language (Aaria talk-back, your own voice, wake word)
// Aurora-styled. Uses existing /api/voice/clone + new /api/voice/preferences.
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/context/auth';
import { availableWakeModes, getWakeMode, setWakeMode } from '@/lib/wake-word-engine';
import { isWebHotwordEnabled, setWebHotwordEnabled, isHotwordSupported } from '@/lib/aaria-hotword';

const P = '#6366f1';
const LANGS = [
  { v: 'en-IN', l: 'English' }, { v: 'hi-IN', l: 'हिन्दी Hindi' }, { v: 'te-IN', l: 'తెలుగు Telugu' },
  { v: 'ta-IN', l: 'தமிழ் Tamil' }, { v: 'kn-IN', l: 'ಕನ್ನಡ Kannada' }, { v: 'ml-IN', l: 'മലയാളം Malayalam' },
  { v: 'mr-IN', l: 'मराठी Marathi' }, { v: 'bn-IN', l: 'বাংলা Bengali' }, { v: 'gu-IN', l: 'ગુજરાતી Gujarati' },
];
const TONES = [['warm', '☺️ Warm'], ['formal', '🎩 Formal'], ['energetic', '⚡ Energetic']];
const PRESETS = [['aaria_f', 'Aaria (female)'], ['aaria_m', 'Arjun (male)'], ['calm', 'Calm']];
const WAKE_LABELS = { manual: 'Tap to talk', invoke: 'Instant (power / widget)', counter: 'Always-on “Aaria” (counter)' };
const SAMPLE_LINE = 'Hello, I am setting up my QuietKeep voice. Please remind me and read my day out loud in my own voice.';

export default function VoiceSettings() {
  const { accessToken } = useAuth();
  const [prefs, setPrefs] = useState(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [wakeModes, setWakeModes] = useState(['manual']);
  const [wake, setWake] = useState('manual');

  // recording state
  const [consent, setConsent] = useState(false);
  const [rec, setRec] = useState('idle'); // idle | recording | recorded | creating
  const [audioUrl, setAudioUrl] = useState('');
  const mrRef = useRef(null); const chunksRef = useRef([]); const blobRef = useRef(null); const stopTimer = useRef(null);

  useEffect(() => {
    if (!accessToken) return;
    (async () => {
      try {
        const r = await fetch('/api/voice/preferences', { headers: { Authorization: `Bearer ${accessToken}` } });
        const d = await r.json(); if (r.ok) setPrefs(d);
      } catch {}
      try { setWakeModes(availableWakeModes()); setWake(getWakeMode()); } catch {}
    })();
  }, [accessToken]);

  async function save(patch) {
    setPrefs(p => ({ ...p, ...patch })); setSaving(true); setMsg('');
    try {
      await fetch('/api/voice/preferences', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify(patch),
      });
      setMsg('Saved ✓'); setTimeout(() => setMsg(''), 1500);
    } catch { setMsg('Could not save'); } finally { setSaving(false); }
  }

  function applyWake(m) { try { const applied = setWakeMode(m); setWake(applied); } catch { setWake(m); } }

  // ── own-voice recording ──
  async function startRec() {
    setMsg('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      chunksRef.current = [];
      const mr = new MediaRecorder(stream);
      mr.ondataavailable = e => { if (e.data.size) chunksRef.current.push(e.data); };
      mr.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        blobRef.current = blob; setAudioUrl(URL.createObjectURL(blob)); setRec('recorded');
      };
      mrRef.current = mr; mr.start(); setRec('recording');
      stopTimer.current = setTimeout(() => { try { mr.stop(); } catch {} }, 25000); // safety cap 25s
    } catch { setMsg('Microphone permission needed to record.'); }
  }
  function stopRec() { clearTimeout(stopTimer.current); try { mrRef.current?.stop(); } catch {} }

  async function createVoice() {
    if (!consent) { setMsg('Please tick the consent box first.'); return; }
    if (!blobRef.current) { setMsg('Record a sample first.'); return; }
    setRec('creating'); setMsg('');
    try {
      const fd = new FormData();
      fd.append('consent', 'true');
      fd.append('voice_name', 'My QuietKeep voice');
      fd.append('audio_0', blobRef.current, 'sample.webm');
      const r = await fetch('/api/voice/clone', { method: 'POST', headers: { Authorization: `Bearer ${accessToken}` }, body: fd });
      const d = await r.json();
      if (!r.ok) { setMsg(d.error || 'Could not create voice.'); setRec('recorded'); return; }
      setPrefs(p => ({ ...p, has_own_voice: true, consent: true, provider: 'own' }));
      await save({ provider: 'own' });
      setRec('idle'); setAudioUrl(''); blobRef.current = null; setMsg('Your voice is ready 🎉');
    } catch { setMsg('Could not reach the voice service.'); setRec('recorded'); }
  }

  async function deleteVoice() {
    if (!confirm('Delete your recorded voice? This removes it from QuietKeep and the voice provider.')) return;
    try {
      await fetch('/api/voice/preferences', { method: 'DELETE', headers: { Authorization: `Bearer ${accessToken}` } });
      setPrefs(p => ({ ...p, has_own_voice: false, consent: false, provider: 'system' }));
      setMsg('Your voice was deleted.');
    } catch { setMsg('Could not delete.'); }
  }

  if (!prefs) return <div style={wrap}><p style={{ color: '#64748b' }}>Loading…</p></div>;

  return (
    <div style={wrap}>
      <div style={{ position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none', overflow: 'hidden' }}>
        <span style={blob('#a5b4fc', '-120px', 'auto', 'auto', '-80px')} />
        <span style={blob('#a7f3d0', 'auto', '-100px', '-100px', 'auto')} />
      </div>
      <div style={{ position: 'relative', zIndex: 1 }}>
        <Link href="/settings" style={{ color: P, textDecoration: 'none', fontWeight: 700, fontSize: 14 }}>← Settings</Link>
        <h1 style={{ fontSize: 24, fontWeight: 900, letterSpacing: '-.6px', margin: '6px 0 2px' }}>Voice &amp; Language</h1>
        <p style={{ color: '#64748b', fontSize: 14, margin: '0 0 18px' }}>Choose how Aaria talks back, in your language — or teach it your own voice.</p>
        {msg && <div style={{ ...card, padding: '10px 14px', background: '#eef0fb', color: '#4749d4', fontWeight: 700, fontSize: 13 }}>{msg}</div>}

        {/* Language */}
        <div style={card}>
          <h3 style={h3}>🌐 Language</h3>
          <select value={prefs.voice_language} onChange={e => save({ voice_language: e.target.value })} style={inp}>
            {LANGS.map(l => <option key={l.v} value={l.v}>{l.l}</option>)}
          </select>
          <p style={hint}>Aaria will listen and reply in this language across the app.</p>
        </div>

        {/* Talk-back voice */}
        <div style={card}>
          <h3 style={h3}>🗣️ Talk-back voice</h3>
          {[
            ['system', 'Device voice', 'Free, works offline. Uses your phone’s built-in voice.'],
            ['preset', 'QuietKeep voices', 'Natural AI voices (needs internet).'],
            ['own', 'My own voice', 'Aaria speaks back in your voice — recorded with your consent.'],
          ].map(([v, t, d]) => (
            <label key={v} style={{ ...opt, borderColor: prefs.provider === v ? P : 'rgba(0,0,0,.1)' }}>
              <input type="radio" name="prov" checked={prefs.provider === v} onChange={() => save({ provider: v })} />
              <span><b style={{ fontSize: 14 }}>{t}</b><small style={{ display: 'block', color: '#64748b', fontSize: 12 }}>{d}</small></span>
            </label>
          ))}

          {prefs.provider === 'preset' && (
            <select value={prefs.preset_voice || 'aaria_f'} onChange={e => save({ preset_voice: e.target.value })} style={{ ...inp, marginTop: 10 }}>
              {PRESETS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          )}

          {prefs.provider === 'own' && (
            <div style={{ marginTop: 12, background: '#faf8ff', border: '1px solid #ece9ff', borderRadius: 14, padding: 14 }}>
              {prefs.has_own_voice ? (
                <div>
                  <b style={{ fontSize: 14 }}>✅ Your voice is set up</b>
                  <p style={hint}>Aaria talks back in your voice. You’re in control — you can remove it anytime.</p>
                  <button onClick={deleteVoice} style={{ ...btn, background: '#ef4444' }}>Delete my voice</button>
                </div>
              ) : (
                <div>
                  <b style={{ fontSize: 14 }}>Record your voice</b>
                  <p style={hint}>Read this line aloud once (~15 seconds):</p>
                  <div style={{ background: '#fff', border: '1px dashed #c7c2f0', borderRadius: 10, padding: 10, fontSize: 13, color: '#334155', margin: '8px 0' }}>“{SAMPLE_LINE}”</div>

                  <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12.5, color: '#475569', margin: '8px 0' }}>
                    <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} style={{ marginTop: 2 }} />
                    <span>I consent to QuietKeep creating a voice model from my recording. It’s used only for my account, and I can delete it anytime.</span>
                  </label>

                  {rec === 'idle' && <button onClick={startRec} disabled={!consent} style={{ ...btn, opacity: consent ? 1 : .5 }}>🎙️ Start recording</button>}
                  {rec === 'recording' && <button onClick={stopRec} style={{ ...btn, background: '#ef4444' }}>⏹ Stop</button>}
                  {rec === 'recorded' && (
                    <div style={{ display: 'grid', gap: 8 }}>
                      {audioUrl && <audio controls src={audioUrl} style={{ width: '100%' }} />}
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button onClick={startRec} style={{ ...btn, flex: 1, background: '#64748b' }}>Re-record</button>
                        <button onClick={createVoice} style={{ ...btn, flex: 1 }}>Use this voice</button>
                      </div>
                    </div>
                  )}
                  {rec === 'creating' && <button disabled style={{ ...btn, opacity: .6 }}>Creating your voice…</button>}
                  <p style={{ ...hint, marginTop: 10 }}>🔒 Your recording is used only to build your voice. Requires a Pro plan.</p>
                </div>
              )}
            </div>
          )}

          <div style={{ marginTop: 12, display: 'flex', gap: 10 }}>
            {TONES.map(([v, l]) => (
              <button key={v} onClick={() => save({ voice_tone: v })}
                style={{ ...pill, ...(prefs.voice_tone === v ? { background: P, color: '#fff', borderColor: P } : {}) }}>{l}</button>
            ))}
          </div>
        </div>

        {/* Wake word */}
        <div style={card}>
          <h3 style={h3}>✨ Wake word</h3>
          {wakeModes.map(m => (
            <label key={m} style={{ ...opt, borderColor: wake === m ? P : 'rgba(0,0,0,.1)' }}>
              <input type="radio" name="wake" checked={wake === m} onChange={() => applyWake(m)} />
              <span><b style={{ fontSize: 14 }}>{WAKE_LABELS[m] || m}</b></span>
            </label>
          ))}
          {!wakeModes.includes('counter') && (
            <p style={hint}>Always-on “Aaria” (works with the screen locked) is available in the Android app.</p>
          )}
        </div>

        {/* Voice input */}
        <div style={{ ...card, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div><b style={{ fontSize: 14 }}>🎤 Voice input</b><small style={{ display: 'block', color: '#64748b', fontSize: 12 }}>Let me speak commands to QuietKeep.</small></div>
          <button onClick={() => save({ voice_input_enabled: !prefs.voice_input_enabled })}
            style={{ ...toggle, background: prefs.voice_input_enabled ? P : '#cbd5e1' }}>
            <span style={{ ...knob, transform: prefs.voice_input_enabled ? 'translateX(20px)' : 'translateX(0)' }} />
          </button>
        </div>
        {saving && <p style={{ ...hint, textAlign: 'center' }}>saving…</p>}
      </div>
    </div>
  );
}

const wrap = { minHeight: '100dvh', maxWidth: 560, margin: '0 auto', padding: 16, fontFamily: "'Inter',-apple-system,sans-serif", position: 'relative', background: 'radial-gradient(900px 500px at 90% -10%,#eef1ff 0,transparent 55%),linear-gradient(180deg,#f7f8ff,#f1f3fb)' };
function blob(c, top, bottom, b2, right) { return { position: 'absolute', width: 340, height: 340, borderRadius: '50%', filter: 'blur(60px)', opacity: .45, background: `radial-gradient(circle,${c},transparent 65%)`, top, bottom, right }; }
const card = { background: 'rgba(255,255,255,.85)', backdropFilter: 'blur(8px)', border: '1px solid #fff', borderRadius: 18, padding: 16, marginBottom: 14, boxShadow: '0 10px 26px rgba(80,90,160,.1)' };
const h3 = { fontSize: 15, fontWeight: 800, margin: '0 0 12px' };
const inp = { width: '100%', padding: '11px 13px', border: '1.5px solid rgba(0,0,0,.12)', borderRadius: 10, fontSize: 15, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' };
const opt = { display: 'flex', gap: 10, alignItems: 'center', border: '1.5px solid rgba(0,0,0,.1)', borderRadius: 12, padding: 12, marginBottom: 8, cursor: 'pointer' };
const hint = { color: '#94a3b8', fontSize: 12, margin: '8px 0 0', lineHeight: 1.5 };
const btn = { padding: '11px 16px', border: 0, borderRadius: 11, background: P, color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer' };
const pill = { flex: 1, padding: '9px', border: '1.5px solid rgba(0,0,0,.12)', borderRadius: 10, background: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer' };
const toggle = { width: 44, height: 24, borderRadius: 999, border: 0, position: 'relative', cursor: 'pointer', flex: 'none' };
const knob = { position: 'absolute', top: 2, left: 2, width: 20, height: 20, borderRadius: '50%', background: '#fff', transition: 'transform .2s', boxShadow: '0 1px 3px rgba(0,0,0,.3)' };
