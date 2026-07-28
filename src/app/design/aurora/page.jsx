'use client';
// src/app/design/aurora/page.jsx
// Live showcase of the shared Aurora kit.
//
// Purpose: make the pattern REVIEWABLE before rolling it across ~40 pages, and
// give whoever converts a page a working reference to copy from. The
// Personal/Business toggle proves one kit serves both versions without forking.
import { useState } from 'react';
import {
  AuroraPage, PageHeader, SectionTitle, Grid, GlassCard,
  StatTile, AariaOrb, NudgeCard, Pill, EmptyState, SkeletonCard,
} from '@/components/aurora';

export default function AuroraShowcase() {
  const [mode, setMode] = useState('personal');
  const [orbState, setOrbState] = useState('idle');
  const [dismissed, setDismissed] = useState(false);
  const isBiz = mode === 'business';

  return (
    <AuroraPage mode={mode}>
      <PageHeader
        title="Aurora UI kit"
        subtitle="One import restyles a page. Scoped, so it can't break anything it hasn't been added to."
        action={
          <div className="qk-toggle">
            <button
              type="button"
              onClick={() => setMode('personal')}
              aria-pressed={!isBiz}
              className={!isBiz ? 'on' : ''}
            >
              Personal
            </button>
            <button
              type="button"
              onClick={() => setMode('business')}
              aria-pressed={isBiz}
              className={isBiz ? 'on' : ''}
            >
              Business
            </button>
          </div>
        }
      />

      <SectionTitle hint="count up on scroll">Stat tiles</SectionTitle>
      <Grid min={168}>
        {isBiz ? (
          <>
            <StatTile label="Today's sales" value={18400} prefix="₹" hue="#0ea5e9" />
            <StatTile label="Outstanding"   value={7250}  prefix="₹" hue="#f59e0b" hint="4 parties overdue" />
            <StatTile label="Items low"     value={6}     hue="#ec4899" />
            <StatTile label="Staff present" value={9}     hue="#10b981" suffix="/11" />
          </>
        ) : (
          <>
            <StatTile label="Open keeps"    value={12}    hue="#6366f1" />
            <StatTile label="Spent today"   value={840}   prefix="₹" hue="#f59e0b" />
            <StatTile label="Reminders"     value={3}     hue="#ec4899" hint="next in 40 min" />
            <StatTile label="Day streak"    value={7}     hue="#10b981" />
          </>
        )}
      </Grid>

      <SectionTitle hint="reacts to Aaria's visual_companion">Aaria orb</SectionTitle>
      <GlassCard>
        <div className="qk-orb-row">
          {['idle', 'listening', 'thinking', 'speaking'].map((s) => (
            <AariaOrb
              key={s}
              state={s}
              size={78}
              label={s}
              onClick={() => setOrbState(s)}
            />
          ))}
        </div>
        <p className="qk-note">
          Selected: <Pill>{orbState}</Pill>{' '}
          The orb also reads <code>window.__qkVisualCompanion</code>, so when Aaria
          returns an expression it reflects what Aaria is actually doing.
        </p>
      </GlassCard>

      <SectionTitle>Nudges</SectionTitle>
      <div className="qk-stack">
        {!dismissed && (
          <NudgeCard
            title={isBiz ? '₹500 received from Ramesh' : 'Electricity bill due in 2 days'}
            body={isBiz ? 'Posted to the ledger and cleared from his khata.' : 'Tap to pay now via UPI.'}
            icon={isBiz ? '🔊' : '⚡'}
            tone={isBiz ? 'emerald' : 'amber'}
            onDismiss={() => setDismissed(true)}
          />
        )}
        <NudgeCard
          title="It learns you"
          body="After a week Aaria anticipates the follow-up you always make."
          icon="✨"
        />
      </div>

      <SectionTitle>Cards, empty & loading states</SectionTitle>
      <Grid min={230}>
        <GlassCard interactive tabIndex={0} hue="#8b5cf6">
          <strong>Interactive card</strong>
          <p className="qk-note">Lifts on hover, and shows a visible focus ring when tabbed to.</p>
          <Pill tone="success">Accessible</Pill>
        </GlassCard>
        <EmptyState
          icon="🌱"
          title="Nothing here yet"
          body="Empty states are part of the kit, so pages don't invent their own."
        />
        <SkeletonCard lines={3} />
      </Grid>

      <style jsx global>{`
        .qk-toggle { display: inline-flex; background: rgba(255,255,255,0.7);
          border: 1px solid rgba(255,255,255,0.9); border-radius: 999px; padding: 3px; }
        .qk-toggle button { border: 0; background: transparent; padding: 7px 15px;
          border-radius: 999px; font-size: 13px; font-weight: 700; color: #64748b; cursor: pointer; }
        .qk-toggle button.on { background: linear-gradient(92deg, var(--a1), var(--a2));
          color: #fff; box-shadow: 0 4px 12px rgba(99,102,241,0.32); }
        .qk-toggle button:focus-visible { outline: 2px solid var(--a2); outline-offset: 2px; }
        .qk-orb-row { display: flex; flex-wrap: wrap; gap: 20px; justify-content: center; padding: 6px 0 2px; }
        .qk-note { margin: 10px 0 0; font-size: 13px; color: var(--muted); line-height: 1.55; }
        .qk-note code { background: rgba(99,102,241,0.1); padding: 1px 5px; border-radius: 5px; font-size: 12px; }
        .qk-stack { display: flex; flex-direction: column; gap: 10px; }
      `}</style>
    </AuroraPage>
  );
}
