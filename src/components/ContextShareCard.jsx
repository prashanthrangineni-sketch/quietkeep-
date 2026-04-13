'use client';
/**
 * src/components/ContextShareCard.jsx
 *
 * Rich card for context shares within QK messages.
 * Renders keep/reminder/health/finance data as styled cards.
 *
 * Props:
 *   type    — 'keep' | 'reminder' | 'health' | 'finance'
 *   payload — object with type-specific fields
 */
import { useState } from 'react';

const G = '#6366f1';

const BADGE = {
  keep:     { emoji: '📌', label: 'Keep',     bg: 'rgba(99,102,241,0.15)', color: '#a5b4fc' },
  reminder: { emoji: '⏰', label: 'Reminder', bg: 'rgba(251,191,36,0.15)',  color: '#fbbf24' },
  health:   { emoji: '❤️', label: 'Health',   bg: 'rgba(16,185,129,0.15)',  color: '#6ee7b7' },
  finance:  { emoji: '💰', label: 'Finance',  bg: 'rgba(244,63,94,0.15)',   color: '#fb7185' },
};

function Badge({ type }) {
  const b = BADGE[type] || BADGE.keep;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '2px 8px', borderRadius: 8, fontSize: 11, fontWeight: 700,
      background: b.bg, color: b.color,
    }}>
      {b.emoji} {b.label}
    </span>
  );
}

function fmtTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) + ' '
       + d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

export default function ContextShareCard({ type, payload }) {
  const [revealed, setRevealed] = useState(false);

  if (!payload) return null;

  const card = {
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 12, padding: '10px 12px',
    borderLeft: `3px solid ${(BADGE[type] || BADGE.keep).color}`,
  };

  // ── Keep ──
  if (type === 'keep') {
    return (
      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
          <Badge type="keep" />
          {payload.domain_type && (
            <span style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase' }}>{payload.domain_type}</span>
          )}
        </div>
        <div style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--text)' }}>
          {payload.content || 'Shared keep'}
        </div>
      </div>
    );
  }

  // ── Reminder ──
  if (type === 'reminder') {
    return (
      <div style={card}>
        <div style={{ marginBottom: 6 }}><Badge type="reminder" /></div>
        <div style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--text)', marginBottom: 4 }}>
          {payload.text || payload.content || 'Shared reminder'}
        </div>
        {payload.scheduled_at && (
          <div style={{ fontSize: 11, color: '#fbbf24' }}>
            Scheduled: {fmtTime(payload.scheduled_at)}
          </div>
        )}
      </div>
    );
  }

  // ── Health ──
  if (type === 'health') {
    return (
      <div style={card}>
        <div style={{ marginBottom: 8 }}><Badge type="health" /></div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {payload.water_glasses != null && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              <span style={{ fontSize: 16 }}>💧</span> {payload.water_glasses} glasses
            </div>
          )}
          {payload.sleep_hours != null && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              <span style={{ fontSize: 16 }}>😴</span> {payload.sleep_hours}h sleep
            </div>
          )}
          {payload.exercise_minutes != null && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              <span style={{ fontSize: 16 }}>🏃</span> {payload.exercise_minutes}min
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Finance ──
  if (type === 'finance') {
    return (
      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <Badge type="finance" />
          <button
            onClick={() => setRevealed(!revealed)}
            style={{
              background: 'none', border: 'none', color: '#fb7185',
              fontSize: 11, cursor: 'pointer', fontFamily: 'inherit', padding: 0,
            }}
          >
            {revealed ? 'Hide' : 'Tap to reveal'}
          </button>
        </div>
        <div style={{
          fontSize: 13, lineHeight: 1.5, color: 'var(--text)',
          filter: revealed ? 'none' : 'blur(6px)',
          transition: 'filter 0.2s',
          userSelect: revealed ? 'auto' : 'none',
        }}>
          {payload.amount != null && (
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 2 }}>
              {typeof payload.amount === 'number' ? '₹' + payload.amount.toLocaleString('en-IN') : payload.amount}
            </div>
          )}
          {payload.category && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{payload.category}</div>
          )}
          {payload.note && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{payload.note}</div>
          )}
        </div>
      </div>
    );
  }

  // Fallback
  return (
    <div style={card}>
      <Badge type={type} />
      <div style={{ fontSize: 13, marginTop: 6, color: 'var(--text)' }}>
        {JSON.stringify(payload).substring(0, 120)}
      </div>
    </div>
  );
}
