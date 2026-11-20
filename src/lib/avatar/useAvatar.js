'use client';
// src/lib/avatar/useAvatar.js
// The two hooks every face uses: which pose, and what the mouth is doing.
import { useEffect, useRef, useState } from 'react';
import { avatarBus } from './events';
import { createPoseMachine } from './pose';
import { attachMouth, cycleShapes, smoothShapes, SILENT } from './mouth';
import { isFaceOn, onFaceChange } from './face-pref';

/** The pose to draw, from the dock's status plus confirmed outcomes. */
export function usePose(status) {
  const machine = useRef(null);
  if (!machine.current) machine.current = createPoseMachine();
  const [pose, setPose] = useState('idle');
  useEffect(() => { machine.current.setStatus(status); setPose(machine.current.pose()); }, [status]);
  // Tell the rest of the app which pose is on screen (the contract's "emotion").
  const lastPose = useRef(null);
  useEffect(() => {
    if (lastPose.current === pose) return;
    lastPose.current = pose;
    avatarBus.emit({ type: 'emotion', pose });
  }, [pose]);
  useEffect(() => {
    // Outcomes come through the checked event list (src/lib/avatar/events.js).
    const off = avatarBus.on((e) => {
      if (e.type !== 'outcome') return;
      machine.current.setOutcome({ status: e.status });
      setPose(machine.current.pose());
    });
    // A flash ends by itself; look again a few times a second while idle.
    const t = setInterval(() => setPose(machine.current.pose()), 250);
    return () => { off(); clearInterval(t); };
  }, []);
  return pose;
}

/**
 * Live mouth shapes in a ref (read it inside an animation frame; it changes
 * 60 times a second and must not re-render React each time).
 * Returns { shapes: ref, source: 'audio' | 'cycle' | null }.
 */
export function useMouth() {
  const shapes = useRef({ ...SILENT });
  const [source, setSource] = useState(null);
  useEffect(() => {
    let reader = null, speaking = false, cycle = false, raf = 0, startedAt = 0, alive = true;
    const tick = () => {
      if (!alive) return;
      const target = !speaking ? SILENT : reader ? reader.read() : cycle ? cycleShapes(performance.now() - startedAt) : SILENT;
      shapes.current = smoothShapes(shapes.current, target);
      raf = requestAnimationFrame(tick);
    };
    // Speech start and end come through the checked event list.
    const off = avatarBus.on(async (e) => {
      if (e.type === 'speech.start') {
        speaking = true; startedAt = performance.now(); reader = null; cycle = true; setSource('cycle');
        if (e.source === 'aaria' && typeof window !== 'undefined' && window.__qkActiveAudio) {
          const r = await attachMouth(window.__qkActiveAudio);
          if (r && speaking) { reader = r; cycle = false; setSource('audio'); }
        }
      } else if (e.type === 'speech.end') {
        speaking = false; reader = null; cycle = false; setSource(null);
      }
    });
    raf = requestAnimationFrame(tick);
    return () => { alive = false; off(); cancelAnimationFrame(raf); };
  }, []);
  return { shapes, source };
}

/** Is the animated face switched on? Re-reads when the switch changes. */
export function useFaceOn() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const read = () => setOn(isFaceOn());
    read();
    return onFaceChange(read);
  }, []);
  return on;
}
