'use client';
// src/app/aaria-stage/page.jsx
// One page to show Aaria's faces side by side. (AARIA demo build, 20 Nov 2026)
//
// DEMO ONLY. Nothing here is switched on for anyone by default: the dock keeps
// its plain microphone button unless the switch on this page (or on the Voice
// screen) is turned on.
//
// What is honest on this page:
//   * 2D face         - Pranix's own drawing, mouth from the reply audio.
//   * Anime 3D        - a SAMPLE character from pixiv's three-vrm project, not
//                       Aaria's own look. Its licence is beside the file.
//   * Realistic human - a SAMPLE 3D person from Microsoft's Rocketbox library
//                       (MIT). It looks like a game character, not a filmed
//                       person, and the page says so.
//   * The frames-per-second line is a live measurement on this device.

import { useCallback, useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { useAaria } from '@/lib/context/aaria';
import { speak } from '@/components/VoiceTalkback';
import AariaFace, { AariaFaceToggle } from '@/components/AariaFace';
import { onSpeechSignal } from '@/lib/avatar/speech-signal';
import { usePose, useMouth } from '@/lib/avatar/useAvatar';

const VrmStage = dynamic(() => import('@/components/avatar/VrmStage'), { ssr: false });
const HumanStage = dynamic(() => import('@/components/avatar/HumanStage'), { ssr: false });

const ANIME_MODEL = '/avatars/anime-sample/VRM1_Constraint_Twist_Sample.vrm';

const LINES = [
  { lang: 'te-IN', label: 'తెలుగు', text: 'నమస్కారం, నేను ఆరియా. మీకు ఏం సహాయం చేయాలి?' },
  { lang: 'hi-IN', label: 'हिन्दी', text: 'नमस्ते, मैं आरिया हूँ। मैं आपकी क्या मदद करूँ?' },
  { lang: 'en-IN', label: 'English', text: 'Hello, I am Aaria. Tell me what you need and I will get it done.' },
];

const FACES = [
  { id: '2d', label: '2D face' },
  { id: 'anime3d', label: 'Anime 3D' },
  { id: 'realistic', label: 'Realistic human' },
];

export default function AariaStagePage() {
  const aaria = useAaria();
  const [face, setFace] = useState('2d');
  const [fps, setFps] = useState(null);
  const [heard, setHeard] = useState(false);     // sound is audible right now

  // Signed out (or on a screen where the dock is hidden) there is no dock
  // status to follow, so follow the sound itself.
  useEffect(() => onSpeechSignal((e) => {
    if (e.type === 'start') setHeard(true);
    if (e.type === 'end') setHeard(false);
  }), []);
  const status = aaria.status !== 'idle' ? aaria.status : heard ? 'speaking' : 'idle';
  const pose = usePose(status);
  const { source } = useMouth();

  useEffect(() => { try { setFace(localStorage.getItem('qk_aaria_stage_face') || '2d'); } catch { } }, []);
  const pick = (id) => { setFace(id); setFps(null); try { localStorage.setItem('qk_aaria_stage_face', id); } catch { } };

  const sayLine = useCallback((line) => {
    if (aaria.signedIn && !aaria.silent) aaria.say(line.text, { lang: line.lang });
    else speak(line.text, { lang: line.lang, useAaria: true, priority: 'high' });
  }, [aaria]);

  // Keep the last reading where a phone test can pick it up.
  const onFps = useCallback((f) => { setFps(f); try { window.__qkStageFps = { ...f, at: Date.now() }; } catch { } }, []);

  const card = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, padding: 16 };

  return (
    <main style={{ maxWidth: 560, margin: '0 auto', padding: '20px 16px 180px', color: 'var(--text)' }}>
      <h1 style={{ fontSize: 22, margin: '0 0 4px' }}>Aaria’s faces</h1>
      <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5 }}>
        A preview. The mouth follows Aaria’s own voice as it plays, in any language.
      </p>

      <div role="tablist" style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        {FACES.map((f) => (
          <button key={f.id} role="tab" aria-selected={face === f.id} onClick={() => pick(f.id)} style={{
            flex: 1, padding: '10px 6px', borderRadius: 12, cursor: 'pointer', fontFamily: 'inherit',
            fontSize: 13, fontWeight: 600,
            border: face === f.id ? '2px solid var(--primary)' : '1px solid var(--border)',
            background: face === f.id ? 'var(--primary)' : 'transparent',
            // On the filled accent colour, so it stays light in every theme.
            color: face === f.id ? '#fff' : 'var(--text)',
          }}>{f.label}</button>
        ))}
      </div>

      <div style={{ ...card, minHeight: 380, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        {face === '2d' && <AariaFace status={status} size={220} />}
        {face === 'anime3d' && <VrmStage status={status} modelUrl={ANIME_MODEL} height={360} onFps={onFps} />}
        {face === 'realistic' && <HumanStage status={status} height={360} onFps={onFps} />}
      </div>

      <p data-testid="stage-readout" style={{ margin: '10px 2px 16px', fontSize: 12, color: 'var(--text-subtle)', lineHeight: 1.6 }}>
        State: <strong>{pose}</strong>
        {' · '}Mouth: {source === 'audio' ? 'following the reply audio' : source === 'cycle' ? 'simple open-close (this voice cannot be heard by the page)' : 'at rest'}
        {face !== '2d' && (fps
          ? <>{' · '}{fps.medianFps} frames per second on this device (slowest frame {fps.worstFrameMs} ms)</>
          : <>{' · '}measuring frames per second…</>)}
      </p>

      <div style={{ ...card, marginBottom: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Hear Aaria speak</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {LINES.map((l) => (
            <button key={l.lang} onClick={() => sayLine(l)} style={{
              padding: '9px 14px', borderRadius: 10, border: '1.5px solid var(--primary)',
              background: 'transparent', color: 'var(--text)', fontSize: 14, fontWeight: 600,
              fontFamily: 'inherit', cursor: 'pointer',
            }}>{l.label}</button>
          ))}
        </div>
        <p style={{ margin: '10px 0 0', fontSize: 12, color: 'var(--text-subtle)', lineHeight: 1.5 }}>
          Or use the microphone button and ask for something real. The face shows “done” only after
          the action is confirmed, never just because Aaria understood.
        </p>
      </div>

      <AariaFaceToggle />

      <p style={{ margin: '14px 2px 0', fontSize: 11.5, color: 'var(--text-subtle)', lineHeight: 1.6 }}>
        2D face: drawn by Pranix AI Labs. Anime 3D: “VRM1_Constraint_Twist_Sample”, © 2022 pixiv Inc.,
        a sample character under the VRM Public License 1.0 — a stand-in, not Aaria’s final look.
        Realistic human: “Female_Adult_01” from the Microsoft Rocketbox avatar library, © 2020 Microsoft, MIT licence —
        a 3D person drawn on this device, like a game character; not a real person and not Aaria’s final look.
        3D engine: three.js and three-vrm (MIT).
      </p>
    </main>
  );
}
