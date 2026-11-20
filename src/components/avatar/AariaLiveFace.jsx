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

  // If the 3D face cannot be drawn on this device, or runs too slowly to look
  // alive (three readings in a row under 12 frames a second), fall back to the
  // 2D face for the rest of this visit. A face that stutters is worse than a
  // simple one that moves well.
  const [fallback, setFallback] = useState(false);
  const slow = useRef(0);
  useEffect(() => { setFallback(false); slow.current = 0; }, [choice.style, choice.who, choice.look]);
  const onState = useCallback((s) => { if (s === 'failed') setFallback(true); }, []);
  const onFps = useCallback((f) => {
    slow.current = f.medianFps < 12 ? slow.current + 1 : 0;
    if (slow.current >= 3) setFallback(true);
  }, []);
  const style = fallback ? '2d' : choice.style;

  return (
    <div data-testid="aaria-live-face" data-face={style} data-chosen={choice.style} style={{
      height, display: 'flex', alignItems: 'center', justifyContent: 'center',
      marginBottom: 10, borderRadius: 12, overflow: 'hidden',
    }}>
      {style === 'anime3d' && <VrmStage key={choice.who} status={status} modelUrl={ANIME_MODELS[choice.who] || ANIME_MODELS.woman} height={height} onFps={onFps} onState={onState} />}
      {style === 'realistic' && <HumanStage key={choice.look} status={status} who={choice.look} height={height} onFps={onFps} onState={onState} />}
      {style !== 'anime3d' && style !== 'realistic' && <AariaFace status={status} size={Math.min(height - 20, 150)} />}
    </div>
  );
}
