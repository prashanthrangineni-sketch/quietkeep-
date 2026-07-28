'use client';
// src/components/aurora/index.jsx — QuietKeep "Aurora" UI kit
//
// WHY THIS EXISTS
// The homepage Aurora redesign (#22) is deliberately self-contained — it touches
// no shared CSS — which means app pages had no way to reuse that language. This
// is the shared kit so any page adopts it with ONE import:
//
//   import { AuroraPage, GlassCard, StatTile, AariaOrb } from '@/components/aurora';
//
// SAFETY: every style here is scoped under `.qk-aurora`, so importing the kit
// cannot leak into or break a page that hasn't adopted it. Adoption is opt-in
// per page and reversible — which is what makes a 40-page rollout safe to do in
// batches.
//
// NO NEW DEPENDENCIES: pure CSS animation (no framer-motion).
// ACCESSIBILITY: honours prefers-reduced-motion, keeps AA contrast on light,
// and every decorative layer is aria-hidden.
//
// BOTH VERSIONS: `mode="personal" | "business"` swaps the accent ramp so the two
// products share structure and rhythm while still reading as distinct.
import { useEffect, useRef, useState } from 'react';

/* ───────────────────────── Page shell ───────────────────────── */
export function AuroraPage({ mode = 'personal', children, className = '' }) {
  return (
    <div className={`qk-aurora ${className}`} data-mode={mode}>
      <AuroraBackground />
      <div className="qk-page">{children}</div>
      <AuroraStyles />
    </div>
  );
}

export function AuroraBackground() {
  return (
    <div className="qk-bg" aria-hidden="true">
      <span className="qk-blob b1" />
      <span className="qk-blob b2" />
      <span className="qk-blob b3" />
      <span className="qk-spark s1" />
      <span className="qk-spark s2" />
      <span className="qk-spark s3" />
      <span className="qk-spark s4" />
    </div>
  );
}

/* ───────────────────────── Building blocks ───────────────────────── */
export function PageHeader({ title, subtitle, action }) {
  return (
    <header className="qk-head">
      <div>
        <h1 className="qk-h1">{title}</h1>
        {subtitle && <p className="qk-sub">{subtitle}</p>}
      </div>
      {action && <div className="qk-head-action">{action}</div>}
    </header>
  );
}

export function SectionTitle({ children, hint }) {
  return (
    <div className="qk-section">
      <h2>{children}</h2>
      {hint && <span>{hint}</span>}
    </div>
  );
}

export function Pill({ children, tone = 'default' }) {
  return <span className={`qk-pill qk-pill-${tone}`}>{children}</span>;
}

export function GlassCard({ children, className = '', hue, interactive = false, ...rest }) {
  return (
    <div
      className={`qk-card ${interactive ? 'qk-card-i' : ''} ${className}`}
      style={hue ? { '--card-hue': hue } : undefined}
      {...rest}
    >
      {children}
    </div>
  );
}

/* Animated count-up. Runs once on scroll-in; static if motion is reduced. */
export function StatTile({ label, value, suffix = '', prefix = '', hue = '#6366f1', hint }) {
  const numeric = typeof value === 'number' ? value : Number(String(value).replace(/[^0-9.-]/g, ''));
  const isNumeric = Number.isFinite(numeric);
  const [shown, setShown] = useState(isNumeric ? 0 : value);
  const ref = useRef(null);

  useEffect(() => {
    if (!isNumeric) { setShown(value); return; }
    const reduce = typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce) { setShown(numeric); return; }

    const el = ref.current;
    if (!el) { setShown(numeric); return; }

    const obs = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      obs.disconnect();
      const startedAt = performance.now();
      const DURATION = 900;
      let raf;
      const tick = (now) => {
        const p = Math.min((now - startedAt) / DURATION, 1);
        // easeOutCubic — fast then settling, reads as "counting up"
        setShown(numeric * (1 - Math.pow(1 - p, 3)));
        if (p < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      return () => cancelAnimationFrame(raf);
    }, { threshold: 0.25 });

    obs.observe(el);
    return () => obs.disconnect();
  }, [numeric, isNumeric, value]);

  const display = isNumeric
    ? Math.round(shown).toLocaleString('en-IN')
    : shown;

  return (
    <GlassCard className="qk-stat" hue={hue}>
      <div ref={ref} className="qk-stat-val">
        {prefix}{display}{suffix}
      </div>
      <div className="qk-stat-label">{label}</div>
      {hint && <div className="qk-stat-hint">{hint}</div>}
    </GlassCard>
  );
}

/*
 * Living Aaria orb.
 *
 * `state` drives the animation: idle | listening | thinking | speaking.
 * It also watches window.__qkVisualCompanion — the expression + caption timing
 * Aaria returns from /api/voice/speak (wired in #41) — so the orb reflects what
 * Aaria is ACTUALLY doing instead of animating blindly.
 */
export function AariaOrb({ state = 'idle', size = 96, label, onClick }) {
  const [companion, setCompanion] = useState(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const read = () => setCompanion(window.__qkVisualCompanion || null);
    read();
    const t = setInterval(read, 400);
    return () => clearInterval(t);
  }, []);

  const expression = companion?.expression || state;
  const face =
    expression === 'listening' ? '◕ ◡ ◕'
    : expression === 'thinking' ? '◔ ‿ ◔'
    : expression === 'speaking' ? '◕ ▽ ◕'
    : expression === 'happy'    ? '^ ‿ ^'
    : '◕ ‿ ◕';

  const Tag = onClick ? 'button' : 'div';

  return (
    <div className="qk-orb-wrap">
      <Tag
        className="qk-orb"
        data-state={state}
        style={{ '--orb-size': `${size}px` }}
        onClick={onClick}
        {...(onClick
          ? { type: 'button', 'aria-label': label || `Aaria — ${state}` }
          : { role: 'img', 'aria-label': label || `Aaria — ${state}` })}
      >
        <span className="qk-orb-ring" aria-hidden="true" />
        <span className="qk-orb-ring qk-orb-ring2" aria-hidden="true" />
        <span className="qk-orb-face">{face}</span>
      </Tag>
      {label && <div className="qk-orb-label">{label}</div>}
    </div>
  );
}

export function NudgeCard({ title, body, icon = '✨', tone = 'violet', action, onDismiss }) {
  return (
    <div className={`qk-nudge qk-nudge-${tone}`}>
      <span className="qk-nudge-icon" aria-hidden="true">{icon}</span>
      <div className="qk-nudge-body">
        <strong>{title}</strong>
        {body && <p>{body}</p>}
      </div>
      {action && <div className="qk-nudge-action">{action}</div>}
      {onDismiss && (
        <button type="button" className="qk-nudge-x" onClick={onDismiss} aria-label="Dismiss">×</button>
      )}
    </div>
  );
}

export function EmptyState({ icon = '🌱', title, body, action }) {
  return (
    <GlassCard className="qk-empty">
      <div className="qk-empty-icon" aria-hidden="true">{icon}</div>
      <h3>{title}</h3>
      {body && <p>{body}</p>}
      {action}
    </GlassCard>
  );
}

export function SkeletonCard({ lines = 3 }) {
  return (
    <GlassCard className="qk-skel" aria-busy="true" aria-live="polite">
      {Array.from({ length: lines }).map((_, i) => (
        <span key={i} className="qk-skel-line" style={{ width: `${100 - i * 18}%` }} />
      ))}
    </GlassCard>
  );
}

export function Grid({ min = 220, gap = 14, children }) {
  return (
    <div className="qk-grid" style={{ '--min': `${min}px`, '--gap': `${gap}px` }}>
      {children}
    </div>
  );
}

/* ───────────────────────── Styles (scoped to .qk-aurora) ───────────────────────── */
export function AuroraStyles() {
  return (
    <style jsx global>{`
      .qk-aurora {
        --ink:      #0f172a;
        --muted:    #64748b;
        --glass:    rgba(255, 255, 255, 0.72);
        --stroke:   rgba(255, 255, 255, 0.9);
        --shadow:   0 10px 34px rgba(15, 23, 42, 0.08);
        --radius:   18px;
        --a1: #6366f1; --a2: #8b5cf6; --a3: #ec4899;
        --a4: #f59e0b; --a5: #10b981; --a6: #0ea5e9;
        --card-hue: var(--a1);
        position: relative;
        min-height: 100%;
        color: var(--ink);
        background: linear-gradient(180deg, #f7f8fc 0%, #eef2ff 55%, #fdf2f8 100%);
        -webkit-font-smoothing: antialiased;
      }
      .qk-aurora[data-mode='business'] {
        --a1: #0ea5e9; --a2: #10b981; --a3: #6366f1;
        background: linear-gradient(180deg, #f6fbff 0%, #ecfeff 55%, #eef2ff 100%);
      }

      /* ── animated background ── */
      .qk-bg { position: fixed; inset: 0; overflow: hidden; pointer-events: none; z-index: 0; }
      .qk-blob {
        position: absolute; border-radius: 50%; filter: blur(64px); opacity: 0.5;
        animation: qk-drift 22s ease-in-out infinite;
      }
      .qk-blob.b1 { width: 42vw; height: 42vw; left: -10vw; top: -8vw;  background: var(--a1); }
      .qk-blob.b2 { width: 38vw; height: 38vw; right: -8vw; top: 18vh;  background: var(--a3); animation-delay: -7s; }
      .qk-blob.b3 { width: 34vw; height: 34vw; left: 22vw;  bottom: -12vw; background: var(--a2); animation-delay: -14s; }
      @keyframes qk-drift {
        0%, 100% { transform: translate3d(0, 0, 0) scale(1); }
        33%      { transform: translate3d(3vw, -2vh, 0) scale(1.08); }
        66%      { transform: translate3d(-2vw, 3vh, 0) scale(0.95); }
      }
      .qk-spark {
        position: absolute; width: 6px; height: 6px; border-radius: 50%;
        background: #fff; box-shadow: 0 0 12px 3px rgba(255, 255, 255, 0.9);
        animation: qk-float 9s ease-in-out infinite;
      }
      .qk-spark.s1 { left: 18%; top: 26%; }
      .qk-spark.s2 { left: 72%; top: 18%; animation-delay: -2.5s; }
      .qk-spark.s3 { left: 42%; top: 62%; animation-delay: -5s; }
      .qk-spark.s4 { left: 84%; top: 68%; animation-delay: -7s; }
      @keyframes qk-float {
        0%, 100% { transform: translateY(0);     opacity: 0.35; }
        50%      { transform: translateY(-16px); opacity: 0.95; }
      }

      .qk-page { position: relative; z-index: 1; padding: 18px 16px 96px; max-width: 1080px; margin: 0 auto; }

      /* ── header ── */
      .qk-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; margin: 6px 0 18px; }
      .qk-h1 {
        margin: 0; font-size: clamp(23px, 5vw, 32px); font-weight: 800; letter-spacing: -0.02em;
        background: linear-gradient(92deg, var(--a1), var(--a2) 45%, var(--a3));
        -webkit-background-clip: text; background-clip: text; color: transparent;
      }
      .qk-sub { margin: 5px 0 0; color: var(--muted); font-size: 14px; }
      .qk-section { display: flex; align-items: baseline; justify-content: space-between; margin: 26px 0 10px; }
      .qk-section h2 { margin: 0; font-size: 16px; font-weight: 700; letter-spacing: -0.01em; }
      .qk-section span { font-size: 12px; color: var(--muted); }

      /* ── glass card ── */
      .qk-card {
        position: relative; background: var(--glass); border: 1px solid var(--stroke);
        border-radius: var(--radius); box-shadow: var(--shadow); padding: 16px;
        backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px);
        transition: transform 0.22s ease, box-shadow 0.22s ease;
      }
      .qk-card::before {
        content: ''; position: absolute; inset: 0 0 auto; height: 3px;
        border-radius: var(--radius) var(--radius) 0 0;
        background: linear-gradient(90deg, var(--card-hue), transparent 78%);
        opacity: 0.85;
      }
      .qk-card-i:hover { transform: translateY(-3px); box-shadow: 0 16px 40px rgba(15, 23, 42, 0.13); }
      .qk-card-i:focus-visible { outline: 2px solid var(--a1); outline-offset: 3px; }

      .qk-grid { display: grid; gap: var(--gap); grid-template-columns: repeat(auto-fit, minmax(var(--min), 1fr)); }

      /* ── stat tile ── */
      .qk-stat-val {
        font-size: clamp(24px, 5vw, 30px); font-weight: 800; letter-spacing: -0.02em;
        font-variant-numeric: tabular-nums; color: var(--card-hue);
      }
      .qk-stat-label { margin-top: 3px; font-size: 12.5px; color: var(--muted); font-weight: 600; }
      .qk-stat-hint  { margin-top: 6px; font-size: 11.5px; color: var(--muted); opacity: 0.85; }

      /* ── pills ── */
      .qk-pill {
        display: inline-flex; align-items: center; gap: 6px; padding: 5px 11px;
        border-radius: 999px; font-size: 12px; font-weight: 600;
        background: rgba(99, 102, 241, 0.1); color: #4338ca; border: 1px solid rgba(99, 102, 241, 0.2);
      }
      .qk-pill-success { background: rgba(16, 185, 129, 0.12); color: #047857; border-color: rgba(16, 185, 129, 0.24); }
      .qk-pill-warn    { background: rgba(245, 158, 11, 0.14); color: #b45309; border-color: rgba(245, 158, 11, 0.26); }
      .qk-pill-danger  { background: rgba(244, 63, 94, 0.12);  color: #be123c; border-color: rgba(244, 63, 94, 0.24); }

      /* ── Aaria orb ── */
      .qk-orb-wrap { display: flex; flex-direction: column; align-items: center; gap: 8px; }
      .qk-orb {
        position: relative; width: var(--orb-size); height: var(--orb-size);
        display: grid; place-items: center; border-radius: 50%; border: 0; padding: 0; cursor: inherit;
        background: radial-gradient(circle at 32% 28%, #fff, var(--a1) 62%, var(--a2));
        box-shadow: 0 12px 34px rgba(99, 102, 241, 0.36);
        animation: qk-breathe 3.6s ease-in-out infinite;
      }
      button.qk-orb { cursor: pointer; }
      button.qk-orb:focus-visible { outline: 3px solid var(--a2); outline-offset: 4px; }
      .qk-orb-face {
        color: #fff; font-size: calc(var(--orb-size) * 0.2); font-weight: 700;
        letter-spacing: 1px; text-shadow: 0 1px 6px rgba(0, 0, 0, 0.25); user-select: none;
      }
      .qk-orb-ring {
        position: absolute; inset: -8px; border-radius: 50%;
        border: 2px solid var(--a2); opacity: 0; 
      }
      .qk-orb[data-state='listening'] .qk-orb-ring { animation: qk-ripple 1.5s ease-out infinite; }
      .qk-orb[data-state='listening'] .qk-orb-ring2 { animation-delay: 0.6s; }
      .qk-orb[data-state='speaking']  { animation: qk-breathe 1.1s ease-in-out infinite; }
      .qk-orb[data-state='thinking']  { animation: qk-breathe 2s ease-in-out infinite; }
      .qk-orb-label { font-size: 12.5px; color: var(--muted); font-weight: 600; }
      @keyframes qk-breathe {
        0%, 100% { transform: scale(1); }
        50%      { transform: scale(1.05); }
      }
      @keyframes qk-ripple {
        0%   { opacity: 0.65; transform: scale(1); }
        100% { opacity: 0;    transform: scale(1.5); }
      }

      /* ── nudge ── */
      .qk-nudge {
        display: flex; align-items: flex-start; gap: 11px; padding: 13px 14px;
        border-radius: 15px; border: 1px solid rgba(255, 255, 255, 0.85);
        background: linear-gradient(100deg, rgba(139, 92, 246, 0.14), rgba(236, 72, 153, 0.1));
        box-shadow: 0 6px 20px rgba(15, 23, 42, 0.07);
      }
      .qk-nudge-emerald { background: linear-gradient(100deg, rgba(16, 185, 129, 0.16), rgba(14, 165, 233, 0.1)); }
      .qk-nudge-amber   { background: linear-gradient(100deg, rgba(245, 158, 11, 0.18), rgba(236, 72, 153, 0.08)); }
      .qk-nudge-icon { font-size: 19px; line-height: 1.25; }
      .qk-nudge-body { flex: 1; min-width: 0; }
      .qk-nudge-body strong { display: block; font-size: 14px; }
      .qk-nudge-body p { margin: 3px 0 0; font-size: 13px; color: var(--muted); }
      .qk-nudge-x {
        border: 0; background: transparent; color: var(--muted);
        font-size: 19px; line-height: 1; cursor: pointer; padding: 0 2px;
      }
      .qk-nudge-x:focus-visible { outline: 2px solid var(--a1); outline-offset: 2px; border-radius: 6px; }

      /* ── empty + skeleton ── */
      .qk-empty { text-align: center; padding: 30px 18px; }
      .qk-empty-icon { font-size: 32px; }
      .qk-empty h3 { margin: 9px 0 4px; font-size: 16px; }
      .qk-empty p  { margin: 0 0 12px; color: var(--muted); font-size: 13.5px; }
      .qk-skel { display: flex; flex-direction: column; gap: 9px; }
      .qk-skel-line {
        height: 11px; border-radius: 7px;
        background: linear-gradient(90deg, rgba(148,163,184,0.16), rgba(148,163,184,0.34), rgba(148,163,184,0.16));
        background-size: 200% 100%; animation: qk-shimmer 1.4s linear infinite;
      }
      @keyframes qk-shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }

      /* ── motion & contrast preferences ── */
      @media (prefers-reduced-motion: reduce) {
        .qk-aurora *, .qk-aurora *::before, .qk-aurora *::after {
          animation-duration: 0.001ms !important;
          animation-iteration-count: 1 !important;
          transition-duration: 0.001ms !important;
        }
        .qk-blob { opacity: 0.34; }
        .qk-spark { opacity: 0.4; }
      }
      @media (prefers-contrast: more) {
        .qk-aurora { --glass: rgba(255, 255, 255, 0.95); --muted: #475569; }
        .qk-blob { opacity: 0.22; }
      }
      @media (max-width: 480px) {
        .qk-page { padding: 14px 12px 88px; }
        .qk-head { flex-direction: column; align-items: flex-start; }
      }
    `}</style>
  );
}

export default AuroraPage;
