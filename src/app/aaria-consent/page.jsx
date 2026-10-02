'use client';
// Aaria on-device listening: first-launch notice and consent.
// The wording is NOT written here. It comes from the Aaria Edge plugin
// (assets/ui/<lang>.json, keys s1_*), which holds the founder-approved text.
// On plain web / PWA / iOS the plugin does not exist, so this page only says so.
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

const MODELS_MANIFEST_URL =
  'https://github.com/PranixQuick/aaria-edge-models/releases/download/models-2026-10/manifest.json';
// Public key (safe to ship): the phone rejects any model list not signed with the matching private key.
const MODELS_MANIFEST_PUBLIC_KEY =
  'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE4hSD5nmqhyiuU76UNMOhBFAJDQDfkq3NqDpHB14Wc7Y9WjDqvQP2eBMyvQ05UdHDBDbr3sqinRzefOETbw2VXg==';

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

  const turnOn = async () => {
    const plugin = getPlugin();
    if (!plugin || busy) return;
    setBusy(true);
    try {
      await plugin.setLanguage({ lang });
      await plugin.recordConsent({
        lang,
        choices: { wakeWord: true, rememberCommands: false, keepTranscripts: false, nightlyDownloads: true, wakeOnBattery },
      });
      // Voice files download at night, on Wi-Fi, while charging (as the notice says). Never on mobile data.
      await plugin.configureSync({
        manifestUrl: MODELS_MANIFEST_URL,
        manifestPublicKey: MODELS_MANIFEST_PUBLIC_KEY,
      });
      // Start listening only if the voice files are already on the phone.
      const wake = window.__QK_WAKE__;
      if (wake && typeof wake.isWakeWordAvailable === 'function' && (await wake.isWakeWordAvailable())) {
        await wake.startHotword({ word: readName().toLowerCase() });
      }
    } catch (e) {
      console.warn('[QK] Aaria consent could not be saved', e);
    }
    router.back();
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
