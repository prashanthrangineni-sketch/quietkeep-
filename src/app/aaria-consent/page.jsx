'use client';
// Aaria on-device listening: first-launch notice and consent.
// The wording is NOT written here. It comes from the Aaria Edge plugin
// (assets/ui/<lang>.json, keys s1_*), which holds the founder-approved text.
// On plain web / PWA / iOS the plugin does not exist, so this page only says so.
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { setWakeMode } from '@/lib/wake-word-engine';

const MODELS_MANIFEST_URL =
  'https://github.com/PranixQuick/aaria-edge-models/releases/download/models-2026-10/manifest.json';
// Public key (safe to ship): the phone rejects any model list not signed with the matching private key.
const MODELS_MANIFEST_PUBLIC_KEY =
  'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE4hSD5nmqhyiuU76UNMOhBFAJDQDfkq3NqDpHB14Wc7Y9WjDqvQP2eBMyvQ05UdHDBDbr3sqinRzefOETbw2VXg==';

// Set-up status lines. Wording approved by the founder on 2 Oct 2026 - do not edit or add lines here.
const SETUP_TEXT = {
  en: {
    downloading: 'Downloading speech files on Wi-Fi…',
    no_wifi: 'Connect to Wi-Fi to finish setting up.',
    ready: 'Ready. Say "Hey {name}".',
    failed: 'Download failed. Try again.',
  },
  hi: {
    downloading: 'वाई-फ़ाई पर स्पीच फ़ाइलें डाउनलोड हो रही हैं…',
    no_wifi: 'सेट-अप पूरा करने के लिए वाई-फ़ाई से जुड़ें।',
    ready: 'तैयार। "हे {name}" कहें।',
    failed: 'डाउनलोड नहीं हो पाया। फिर कोशिश करें।',
  },
  te: {
    downloading: 'వై-ఫైలో స్పీచ్ ఫైల్స్ డౌన్‌లోడ్ అవుతున్నాయి…',
    no_wifi: 'సెటప్ పూర్తి చేయడానికి వై-ఫైకి కనెక్ట్ అవ్వండి.',
    ready: 'సిద్ధం. "హే {name}" అనండి.',
    failed: 'డౌన్‌లోడ్ కాలేదు. మళ్లీ ప్రయత్నించండి.',
  },
};

// True only when the phone positively reports a non-Wi-Fi connection. Unknown counts as "maybe Wi-Fi".
function onMobileData() {
  try {
    const c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    return !!(c && c.type && c.type !== 'wifi' && c.type !== 'ethernet' && c.type !== 'unknown');
  } catch {
    return false;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function getPlugin() {
  if (typeof window === 'undefined') return null;
  const p = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.AariaEdge;
  return p || null;
}

function readLang() {
  try {
    const v = (localStorage.getItem('qk_voice_lang') || 'en').slice(0, 2).toLowerCase();
    return v === 'hi' || v === 'te' ? v : 'en';
  } catch {
    return 'en';
  }
}

function readName() {
  try {
    const w = (localStorage.getItem('qk_wake_word') || 'aaria').trim();
    return w ? w.charAt(0).toUpperCase() + w.slice(1) : 'Aaria';
  } catch {
    return 'Aaria';
  }
}

// Turns "**bold** text" into React nodes, after putting the chosen name in.
function rich(text, name) {
  const filled = String(text || '').split('{name}').join(name);
  return filled.split('**').map((part, i) => (i % 2 === 1 ? <strong key={i}>{part}</strong> : part));
}

export default function AariaConsentPage() {
  const router = useRouter();
  const [state, setState] = useState('loading'); // loading | ready | unavailable
  const [s, setS] = useState(null);
  const [lang, setLang] = useState('en');
  const [name, setName] = useState('Aaria');
  const [busy, setBusy] = useState(false);
  const [wakeOnBattery, setWakeOnBattery] = useState(false);
  // '' | downloading | no_wifi | ready | failed | paused:<reason>
  const [setup, setSetup] = useState('');
  const listeners = useRef([]);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      listeners.current.forEach((h) => { try { h && h.remove && h.remove(); } catch {} });
      listeners.current = [];
    };
  }, []);

  useEffect(() => {
    const plugin = getPlugin();
    const l = readLang();
    setLang(l);
    setName(readName());
    if (!plugin) {
      setState('unavailable');
      return;
    }
    plugin
      .getNotice({ lang: l })
      .then((res) => {
        if (res && res.strings && res.strings.s1_title) {
          setS(res.strings);
          setState('ready');
        } else {
          setState('unavailable');
        }
      })
      .catch(() => setState('unavailable'));
  }, []);

  // The voice files are on the phone: remember that the wake word is on, start listening, say so, go back.
  const finishSetup = async (plugin) => {
    // Android asks for the microphone here, while this screen is open. No microphone, no "Ready".
    let mic = '';
    try { const perm = await plugin.requestPermissions(); mic = (perm && perm.microphone) || ''; } catch {}
    if (!alive.current) return;
    if (mic !== 'granted') { setSetup(''); setBusy(false); return; }
    try { localStorage.setItem('qk_wake_word_available', 'true'); } catch {}
    try { setWakeMode('counter'); } catch {}
    let st = null;
    for (let i = 0; i < 8; i++) {
      await sleep(500);
      try { st = await plugin.isBackgroundListening(); } catch { st = null; }
      if (st && (st.listening || st.paused)) break;
    }
    if (!alive.current) return;
    if (st && st.paused && st.reason) setSetup('paused:' + st.reason);
    else if (st && st.listening) setSetup('ready');
    else { setSetup(''); setBusy(false); return; } // listening not proven: say nothing rather than claim it
    await sleep(3500);
    if (alive.current) router.back();
  };

  const turnOn = async () => {
    const plugin = getPlugin();
    if (!plugin || busy) return;
    setBusy(true);
    setSetup('');
    try {
      await plugin.setLanguage({ lang });
      await plugin.recordConsent({
        lang,
        choices: { wakeWord: true, rememberCommands: false, keepTranscripts: false, nightlyDownloads: true, wakeOnBattery },
      });
      await plugin.configureSync({
        manifestUrl: MODELS_MANIFEST_URL,
        manifestPublicKey: MODELS_MANIFEST_PUBLIC_KEY,
      });
      const wake = window.__QK_WAKE__;
      const available = async () =>
        !!(wake && typeof wake.isWakeWordAvailable === 'function' && (await wake.isWakeWordAvailable()));

      if (await available()) {
        await finishSetup(plugin);
        return;
      }

      // First time: fetch the voice files now, on Wi-Fi only (never on mobile data).
      setSetup(onMobileData() ? 'no_wifi' : 'downloading');
      let progressed = false;
      const done = new Promise((resolve) => {
        Promise.resolve(plugin.addListener('syncProgress', () => {
          progressed = true;
          if (alive.current) setSetup('downloading');
        })).then((h) => listeners.current.push(h)).catch(() => {});
        Promise.resolve(plugin.addListener('syncFinished', (ev) => resolve(ev || {})))
          .then((h) => listeners.current.push(h)).catch(() => {});
      });
      await plugin.syncNow({ allowMobileData: false });
      // Nothing moving after half a minute almost always means the phone is not on Wi-Fi.
      setTimeout(() => { if (alive.current && !progressed) setSetup((v) => (v === 'downloading' ? 'no_wifi' : v)); }, 30000);

      const ev = await done;
      if (!alive.current) return;
      if (ev.ok && (await available())) {
        await finishSetup(plugin);
        return;
      }
      setSetup('failed');
      setBusy(false);
    } catch (e) {
      console.warn('[QK] Aaria set-up did not finish', e);
      if (alive.current) { setSetup('failed'); setBusy(false); }
    }
  };

  const box = { padding: '1.25rem', maxWidth: 640, margin: '0 auto', lineHeight: 1.5 };
  const btn = { flex: 1, padding: '0.9rem', borderRadius: 8, fontSize: '1rem' };

  if (state === 'loading') return <div style={box}>…</div>;

  if (state === 'unavailable') {
    return (
      <div style={box}>
        <p>This feature is available in the QuietKeep Android app.</p>
        <button onClick={() => router.back()} style={btn}>Back</button>
      </div>
    );
  }

  const bullets = [1, 2, 3, 4].filter((n) => s['s1_bullet' + n + '_title']);
  return (
    <div style={box}>
      <h1 style={{ fontSize: '1.4rem' }}>{rich(s.s1_title, name)}</h1>
      <p>{rich(s.s1_intro, name)}</p>
      <ul style={{ paddingLeft: '1.2rem' }}>
        {bullets.map((n) => (
          <li key={n} style={{ marginBottom: '0.6rem' }}>
            <strong>{rich(s['s1_bullet' + n + '_title'], name)}</strong>{' '}
            {rich(s['s1_bullet' + n + '_body'], name)}
          </li>
        ))}
      </ul>
      <p>{rich(s.s1_choices, name)}</p>
      <p>{rich(s.s1_contact, name)}</p>
      <p>
        <a href="/privacy">{rich(s.s1_link_privacy, name)}</a>
      </p>
      {s.s2_wake_on_battery && s.s2_wake_on_battery_hint && (
        <div style={{ marginBottom: '1rem', display: 'flex', flexDirection: 'column' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <input type="checkbox" checked={wakeOnBattery} onChange={(e) => setWakeOnBattery(e.target.checked)} disabled={busy} />
            <strong>{rich(s.s2_wake_on_battery, name)}</strong>
          </label>
          <div style={{ fontSize: '0.85rem', marginTop: '0.25rem', paddingLeft: '1.5rem', opacity: 0.8 }}>
            {rich(s.s2_wake_on_battery_hint, name)}
          </div>
        </div>
      )}
      {setup && (
        <p role="status" style={{ margin: '0.5rem 0', fontWeight: 600 }}>
          {setup.startsWith('paused:') ? (
            <>
              {s.s4_paused_title}
              {s['s4_paused_' + setup.slice(7)] ? <><br />{s['s4_paused_' + setup.slice(7)]}</> : null}
            </>
          ) : (
            rich((SETUP_TEXT[lang] || SETUP_TEXT.en)[setup], name)
          )}
        </p>
      )}
      <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem' }}>
        <button onClick={() => router.back()} style={btn} disabled={busy}>
          {rich(s.s1_btn_not_now, name)}
        </button>
        <button onClick={turnOn} style={{ ...btn, background: '#1f6b52', color: '#fff' }} disabled={busy}>
          {rich(s.s1_btn_turn_on, name)}
        </button>
      </div>
    </div>
  );
}
