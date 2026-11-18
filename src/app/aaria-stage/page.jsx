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
//   * Anime           - SAMPLE characters (a woman from pixiv's three-vrm
//                       project, a man from VRoid's CC0 samples), not Aaria's
//                       own look. Each licence is beside its file.
//   * Realistic       - SAMPLE 3D people from Microsoft's Rocketbox library
//                       (MIT): two women and four men, chosen by the founder,
//                       shown as numbered looks. They look like game
//                       characters, not filmed people, and the page says so.
//                       Indian in a saree / kurta: NOT BUILT - "Coming next".
//   * The frames-per-second line is a live measurement on this device.

import { useCallback, useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { useAaria } from '@/lib/context/aaria';
import { speak } from '@/components/VoiceTalkback';
import AariaFace, { AariaFaceToggle } from '@/components/AariaFace';
import { onSpeechSignal } from '@/lib/avatar/speech-signal';
import { usePose, useMouth } from '@/lib/avatar/useAvatar';
import { announceFaceChoice, ANIME_MODELS } from '@/lib/avatar/face-pref';

const VrmStage = dynamic(() => import('@/components/avatar/VrmStage'), { ssr: false });
const HumanStage = dynamic(() => import('@/components/avatar/HumanStage'), { ssr: false });

const ANIME = ANIME_MODELS;

const LINES = [
  { lang: 'te-IN', label: 'తెలుగు', text: 'నమస్కారం, నేను ఆరియా. మీకు ఏం సహాయం చేయాలి?' },
  { lang: 'hi-IN', label: 'हिन्दी', text: 'नमस्ते, मैं आरिया हूँ। मैं आपकी क्या मदद करूँ?' },
  { lang: 'en-IN', label: 'English', text: 'Hello, I am Aaria. Tell me what you need and I will get it done.' },
];

// The person chooses for themselves: a style, then a woman or a man, and for
// the realistic style an Indian or a Western look.
const FACES = [
  { id: '2d', label: '2D face' },
  { id: 'anime3d', label: 'Anime' },
  { id: 'realistic', label: 'Realistic' },
];
const WHO = [{ id: 'woman', label: 'Woman' }, { id: 'man', label: 'Man' }];
// The realistic people on offer. They are numbered, not labelled by origin:
// none of them was made as an Indian character, and we do not claim one is.
const REALISTIC = {
  woman: [{ id: 'woman-1', label: 'Look 1' }, { id: 'woman-2', label: 'Look 2' }],
  man: [{ id: 'man-1', label: 'Look 1' }, { id: 'man-2', label: 'Look 2' }, { id: 'man-3', label: 'Look 3' }, { id: 'man-4', label: 'Look 4' }],
};

function Chip({ on, onClick, children }) {
  return (
    <button onClick={onClick} aria-pressed={on} style={{
      padding: '7px 14px', borderRadius: 999, cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: 600,
      border: on ? '2px solid var(--primary)' : '1px solid var(--border)',
      background: on ? 'var(--primary)' : 'transparent',
      // On the filled accent colour, so it stays light in every theme.
      color: on ? '#fff' : 'var(--text)',
    }}>{children}</button>
  );
}

export default function AariaStagePage() {
  const aaria = useAaria();
  const [face, setFace] = useState('2d');
  const [who, setWho] = useState('woman');
  const [look, setLook] = useState('woman-1');
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

  useEffect(() => {
    try {
      setFace(localStorage.getItem('qk_aaria_stage_face') || '2d');
      setWho(localStorage.getItem('qk_aaria_stage_who') || 'woman');
      setLook(localStorage.getItem('qk_aaria_stage_look2') || 'woman-1');
    } catch { }
  }, []);
  const remember = (k, v) => { setFps(null); try { localStorage.setItem(k, v); } catch { } announceFaceChoice(); };
  const pick = (id) => { setFace(id); remember('qk_aaria_stage_face', id); };
  const pickWho = (id) => { setWho(id); remember('qk_aaria_stage_who', id); };
  const pickLook = (id) => { setLook(id); remember('qk_aaria_stage_look2', id); };
  // The look must belong to the chosen woman-or-man group.
  const looks = REALISTIC[who] || REALISTIC.woman;
  const lookId = looks.some((l) => l.id === look) ? look : looks[0].id;

  const sayLine = useCallback((line) => {
    if (aaria.signedIn && !aaria.silent) aaria.say(line.text, { lang: line.lang });
    else speak(line.text, { lang: line.lang, useAaria: true, priority: 'high' });
  }, [aaria]);

  // Keep the last reading where a phone test can pick it up.
  const onFps = useCallback((f) => { setFps(f); try { window.__qkStageFps = { ...f, at: Date.now() }; } catch { } }, []);

  const card = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, padding: 16 };

  return (
    <main style={{ maxWidth: 560, margin: '0 auto', padding: '10px 16px 180px', color: 'var(--text)' }}>
      {/* The face comes first, at the top of the screen, so the assistant's
          panel (which opens from the bottom) never covers it during a demo. */}
      <h1 style={{ fontSize: 17, margin: '0 0 8px' }}>Aaria’s faces <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--text-muted)' }}>· preview</span></h1>

      <div style={{ ...card, padding: 8, minHeight: 320, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        {face === '2d' && <AariaFace status={status} size={200} />}
        {face === 'anime3d' && <VrmStage key={who} status={status} modelUrl={ANIME[who]} height={320} onFps={onFps} />}
        {face === 'realistic' && <HumanStage key={lookId} status={status} who={lookId} height={320} onFps={onFps} />}
      </div>

      <p data-testid="stage-readout" style={{ margin: '10px 2px 16px', fontSize: 12, color: 'var(--text-subtle)', lineHeight: 1.6 }}>
        State: <strong>{pose}</strong>
        {' · '}Mouth: {source === 'audio' ? 'following the reply audio' : source === 'cycle' ? 'simple open-close (this voice cannot be heard by the page)' : 'at rest'}
        {face !== '2d' && (fps
          ? <>{' · '}{fps.medianFps} frames per second on this device (slowest frame {fps.worstFrameMs} ms)</>
          : <>{' · '}measuring frames per second…</>)}
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

      {face !== '2d' && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
          {WHO.map((w) => <Chip key={w.id} on={who === w.id} onClick={() => pickWho(w.id)}>{w.label}</Chip>)}
          {face === 'realistic' && <span style={{ width: 8 }} />}
          {face === 'realistic' && looks.map((l) => <Chip key={l.id} on={lookId === l.id} onClick={() => pickLook(l.id)}>{l.label}</Chip>)}
        </div>
      )}

      {face === 'realistic' && (
        <p style={{ margin: '0 2px 14px', fontSize: 12, color: 'var(--text-subtle)', lineHeight: 1.6 }}>
          Coming next: an Indian woman in a saree and an Indian man in a kurta. They are not built yet —
          no character with a licence we can use has been found.
        </p>
      )}

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
          The face you pick here is the one Aaria wears in her panel on every screen, once the switch below is on.
          Press and hold the Aaria button to keep her listening, and ask for something real. The face shows “done” only after
          the action is confirmed, never just because Aaria understood.
        </p>
      </div>

      <AariaFaceToggle />

      <p style={{ margin: '14px 2px 0', fontSize: 11.5, color: 'var(--text-subtle)', lineHeight: 1.6 }}>
        2D face: drawn by Pranix AI Labs. Anime woman: “VRM1_Constraint_Twist_Sample”, © 2022 pixiv Inc., VRM Public License 1.0.
        Anime man: “Sakurada Fumiriya”, a VRoid sample character released under CC0. Realistic people: six everyday adults from the Microsoft Rocketbox avatar library, © 2020 Microsoft, MIT licence —
        3D people drawn on this device, like game characters; not real people. All of these are stand-ins, not Aaria’s final look.
        3D engine: three.js and three-vrm (MIT).
      </p>
    </main>
  );
}
