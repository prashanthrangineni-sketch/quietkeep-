'use client';
// src/components/avatar/AariaLiveFace.jsx
// The face the person chose, drawn wherever Aaria's panel is open.
//
// The choice is made on /aaria-stage (style, woman or man, look) and kept on
// the device. This component reads that choice and draws it - 2D face, anime
// character or realistic person - driven by the dock's own status, so it
// moves and lip-syncs on EVERY screen the dock is on, including while
// keep-listening mode is running. Only rendered when the "Animated Aaria
// face" switch is on (off by default).
//
// The 3D engine and the character file are fetched only if a 3D face was
// chosen, and only once the panel opens.
import { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import AariaFace from '@/components/AariaFace';
import { readChosenFace, onFaceChange, ANIME_MODELS, ALL_LOOKS_FEATURE, allowedFace } from '@/lib/avatar/face-pref';
import { useFeatureGate } from '@/lib/hooks/useFeatureGate';

const VrmStage = dynamic(() => import('@/components/avatar/VrmStage'), { ssr: false });
const HumanStage = dynamic(() => import('@/components/avatar/HumanStage'), { ssr: false });

export default function AariaLiveFace({ status = 'idle', height = 190 }) {
  const [saved, setSaved] = useState({ style: '2d', who: 'woman', look: 'woman-1' });
  // A paid look falls back to Look 1 when the person's plan does not include it.
  const gate = useFeatureGate(ALL_LOOKS_FEATURE);
  const choice = allowedFace(saved, gate.status !== 'LOCKED');
  useEffect(() => {
    const read = () => setSaved(readChosenFace());
    read();
    return onFaceChange(read);
  }, []);

  // Never-break rule (master plan A5): the conversation must never wait on a
  // face. The simple face shows at once while a 3D file downloads; if the file
  // is broken, the 3D engine fails, nothing is drawn for 2 seconds, or the
  // phone draws it too slowly (2 readings in a row under 12 frames a second,
  // about 2 seconds), the simple face stays for the rest of this visit.
  const [fallback, setFallback] = useState(false);
  const [stage, setStage] = useState('loading');
  const slow = useRef(0);
  const lastFps = useRef(0);
  useEffect(() => { setFallback(false); setStage('loading'); slow.current = 0; lastFps.current = 0; }, [choice.style, choice.who, choice.look]);
  const onState = useCallback((s) => {
    setStage(s);
    if (s === 'failed') setFallback(true);
    if (s === 'ready') lastFps.current = Date.now();
  }, []);
  const onFps = useCallback((f) => {
    lastFps.current = Date.now();
    slow.current = f.medianFps < 12 ? slow.current + 1 : 0;
    if (slow.current >= 2) setFallback(true);
  }, []);
  // A face that is "ready" but has stopped drawing (no reading for 2.5 s).
  const is3d = choice.style === 'anime3d' || choice.style === 'realistic';
  useEffect(() => {
    if (!is3d || fallback || stage !== 'ready') return undefined;
    const id = setInterval(() => { if (Date.now() - lastFps.current > 2500) setFallback(true); }, 500);
    return () => clearInterval(id);
  }, [is3d, fallback, stage]);
  const style = fallback ? '2d' : choice.style;
  const showSimple = style === '2d' || (is3d && stage !== 'ready');

  return (
    <div data-testid="aaria-live-face" data-face={showSimple ? '2d' : style} data-chosen={choice.style} data-stage={fallback ? 'fallback' : stage} style={{
      position: 'relative', height, display: 'flex', alignItems: 'center', justifyContent: 'center',
      marginBottom: 10, borderRadius: 12, overflow: 'hidden',
    }}>
      {style !== '2d' && (
        <div style={{ width: '100%', height: '100%', opacity: stage === 'ready' ? 1 : 0, transition: 'opacity 250ms' }}>
          {style === 'anime3d' && <VrmStage key={choice.who} status={status} modelUrl={ANIME_MODELS[choice.who] || ANIME_MODELS.woman} height={height} onFps={onFps} onState={onState} />}
          {style === 'realistic' && <HumanStage key={choice.look} status={status} who={choice.look} height={height} onFps={onFps} onState={onState} />}
        </div>
      )}
      {showSimple && (
        <div style={{ position: style === '2d' ? 'static' : 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <AariaFace status={status} size={Math.min(height - 20, 150)} />
        </div>
      )}
    </div>
  );
}
