'use client';
// src/components/AariaFace.jsx
// Aaria's face, alive. (AARIA 4.3 - behind the settings switch, off by default)
//
// The same violet orb as <AariaMark>, drawn as vector shapes, now with:
//   * blinking and breathing,
//   * a mouth that follows the reply audio itself (src/lib/avatar/mouth.js),
//   * a pose for each state: idle, listening, thinking, speaking, done, oops.
//
// "done" is drawn ONLY when src/lib/avatar/outcome.js reports a confirmed
// completed action. The face never reads the reply text to decide that.
//
// Artwork: original to Pranix AI Labs (see public/avatars/LICENCES.md).
// Animation: framer-motion (MIT), already a dependency of this app.

import { useEffect, useRef, useState } from 'react';
import { motion, useMotionValue, useReducedMotion } from 'framer-motion';
import { usePose, useMouth } from '@/lib/avatar/useAvatar';

const THEMES = {
  personal: { from: '#6366f1', to: '#8b5cf6' },
  business: { from: '#10b981', to: '#059669' },
};

// Where the eyes sit and how tall they are, per pose.
const EYES = {
  idle:      { ry: 4.4, dx: 0,    dy: 0 },
  listening: { ry: 5.3, dx: 0,    dy: -0.4 },
  thinking:  { ry: 3.8, dx: -1.6, dy: -1.8 },
  speaking:  { ry: 4.4, dx: 0,    dy: 0 },
  done:      { ry: 4.4, dx: 0,    dy: 0 },
  oops:      { ry: 2.4, dx: 0,    dy: 0.6 },
};
// The closed mouth, per pose (an open curve, never a filled shape).
const MOUTH = {
  idle:      'M15.5 29.5 Q24 37.5 32.5 29.5',
  listening: 'M18 31 Q24 34.5 30 31',
  thinking:  'M19 32 Q24 32.6 29 32',
  speaking:  'M17 31 Q24 34 31 31',
  done:      'M14 28.5 Q24 40 34 28.5',
  oops:      'M18 34 Q24 30 30 34',
};

export default function AariaFace({ status = 'idle', size = 56, variant = 'personal', title = 'Aaria', style }) {
  const theme = THEMES[variant] || THEMES.personal;
  const pose = usePose(status);
  const { shapes } = useMouth();
  const still = useReducedMotion();
  const [blink, setBlink] = useState(false);
  const gid = useRef(`aaria-face-${Math.random().toString(36).slice(2, 8)}`).current;

  // The open mouth: its size is set 60 times a second from the sound, through
  // motion values, so React does not re-render on every frame.
  const mouthRx = useMotionValue(0);
  const mouthRy = useMotionValue(0);
  const smileOpacity = useMotionValue(1);
  useEffect(() => {
    let raf = 0, alive = true;
    const tick = () => {
      if (!alive) return;
      const s = shapes.current;
      const open = pose === 'speaking' ? s.open : 0;
      mouthRy.set(open < 0.04 ? 0 : 0.8 + open * 3.6 + s.aa * 1.0);
      mouthRx.set(open < 0.04 ? 0 : 5.2 + s.ee * 2.4 + s.ih * 1.2 - s.ou * 2.6 - s.oh * 1.2);
      smileOpacity.set(open < 0.04 ? 1 : Math.max(0, 1 - open * 4));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { alive = false; cancelAnimationFrame(raf); };
  }, [pose, shapes, mouthRx, mouthRy, smileOpacity]);

  // Blink at uneven intervals; a regular blink reads as a machine.
  useEffect(() => {
    if (still) return;
    let t1, t2, alive = true;
    const next = () => {
      t1 = setTimeout(() => {
        if (!alive) return;
        setBlink(true);
        t2 = setTimeout(() => { if (alive) { setBlink(false); next(); } }, 130);
      }, 2400 + Math.random() * 3600);
    };
    next();
    return () => { alive = false; clearTimeout(t1); clearTimeout(t2); };
  }, [still]);

  const eyes = EYES[pose] || EYES.idle;
  const happy = pose === 'done';
  const eyeRy = blink && !happy ? 0.5 : eyes.ry;
  const spring = { type: 'spring', stiffness: 260, damping: 22 };

  return (
    <motion.svg
      width={size} height={size} viewBox="0 0 48 48" role="img"
      aria-label={`${title}: ${pose}`} data-pose={pose}
      style={{ display: 'block', flexShrink: 0, borderRadius: size * 0.29, overflow: 'visible', ...style }}
      animate={still ? {} : {
        scale: pose === 'listening' ? [1, 1.05, 1] : [1, 1.025, 1],
        rotate: pose === 'thinking' ? -4 : pose === 'listening' ? 3 : 0,
      }}
      transition={{
        scale: { duration: pose === 'listening' ? 1.3 : 3.6, repeat: Infinity, ease: 'easeInOut' },
        rotate: spring,
      }}
    >
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={pose === 'oops' ? '#64748b' : theme.from} />
          <stop offset="100%" stopColor={pose === 'oops' ? '#475569' : theme.to} />
        </linearGradient>
      </defs>

      <rect x="0" y="0" width="48" height="48" rx="14" fill={`url(#${gid})`} />

      {/* Eyes: ovals normally; two upward arcs when something really got done. */}
      {happy ? (
        <>
          <motion.path d="M13.5 21.5 Q17.5 16 21.5 21.5" stroke="#fff" strokeWidth="3" strokeLinecap="round" fill="none"
            initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.25 }} />
          <motion.path d="M26.5 21.5 Q30.5 16 34.5 21.5" stroke="#fff" strokeWidth="3" strokeLinecap="round" fill="none"
            initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.25 }} />
        </>
      ) : (
        <>
          <motion.ellipse rx="3.6" fill="#fff"
            animate={{ cx: 17.5 + eyes.dx, cy: 20 + eyes.dy, ry: eyeRy }} transition={blink ? { duration: 0.07 } : spring} />
          <motion.ellipse rx="3.6" fill="#fff"
            animate={{ cx: 30.5 + eyes.dx, cy: 20 + eyes.dy, ry: eyeRy }} transition={blink ? { duration: 0.07 } : spring} />
        </>
      )}

      {/* Closed mouth for the pose; fades as the open mouth takes over. */}
      <motion.path stroke="#fff" strokeWidth="3.2" strokeLinecap="round" fill="none"
        animate={{ d: MOUTH[pose] || MOUTH.idle }} transition={spring} style={{ opacity: smileOpacity }} />
      {/* Open mouth: sized by the reply audio. */}
      <motion.ellipse cx="24" cy="32" fill="#1e1b4b" stroke="#fff" strokeWidth="1.6"
        style={{ rx: mouthRx, ry: mouthRy }} />

      {/* Thinking: three small dots that take turns. */}
      {pose === 'thinking' && !still && [0, 1, 2].map((i) => (
        <motion.circle key={i} cx={36 + i * 3.4} cy={9} r="1.3" fill="#fff"
          animate={{ opacity: [0.25, 1, 0.25] }} transition={{ duration: 1, repeat: Infinity, delay: i * 0.2 }} />
      ))}

      {/* Done: a tick, only ever drawn for a confirmed completed action. */}
      {happy && (
        <motion.g initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={spring}
          style={{ transformOrigin: '40px 8px' }}>
          <circle cx="40" cy="8" r="6.5" fill="#10b981" stroke="#fff" strokeWidth="1.5" />
          <path d="M36.8 8.2 L39.2 10.6 L43.4 5.9" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </motion.g>
      )}
    </motion.svg>
  );
}

/** The settings switch. Off by default; drop it into any settings screen. */
export function AariaFaceToggle() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let off = () => { };
    import('@/lib/avatar/face-pref').then(({ isFaceOn, onFaceChange }) => {
      setOn(isFaceOn());
      off = onFaceChange(() => setOn(isFaceOn()));
    });
    return () => off();
  }, []);
  function toggle() {
    const next = !on;
    setOn(next);
    import('@/lib/avatar/face-pref').then(({ setFaceOn }) => setFaceOn(next));
  }
  return (
    <div onClick={toggle} role="switch" aria-checked={on} style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 12, padding: '12px 16px', cursor: 'pointer', userSelect: 'none',
    }}>
      <div>
        <div style={{ fontSize: 14, color: 'var(--text)', fontWeight: 600 }}>Animated Aaria face (preview)</div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
          Aaria blinks, and her mouth follows her voice. Off by default.{' '}
          <a href="/aaria-stage" onClick={(e) => e.stopPropagation()} style={{ color: 'var(--primary)' }}>Choose her face</a>
        </div>
      </div>
      <div style={{
        width: 44, height: 24, borderRadius: 12,
        background: on ? 'var(--primary)' : 'var(--border-strong)',
        position: 'relative', transition: 'background 0.2s', flexShrink: 0,
      }}>
        <div style={{
          width: 18, height: 18, borderRadius: '50%', background: '#fff',
          position: 'absolute', top: 3, left: on ? 23 : 3,
          transition: 'left 0.2s', boxShadow: '0 1px 4px rgba(0,0,0,0.2)',
        }} />
      </div>
    </div>
  );
}
