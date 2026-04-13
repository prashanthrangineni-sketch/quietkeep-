'use client';
// SuggestionChips — contextual suggestion pills for the dashboard
// Place below the voice capture button:
//   <SuggestionChips supabase={supabase} userId={user?.id} onChipTap={(action, prefill) => …} />

import { useState, useEffect, useCallback, useRef } from 'react';
import { getSuggestionChips } from '@/lib/tau-learning';

const DISMISSED_KEY = 'qk_dismissed_chips';
const REFRESH_MS = 2 * 60 * 60 * 1000; // 2 hours
const DISMISS_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function getDismissed() {
  try {
    const raw = localStorage.getItem(DISMISSED_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    const now = Date.now();
    // Prune expired entries
    const cleaned = {};
    for (const [id, ts] of Object.entries(parsed)) {
      if (now - ts < DISMISS_TTL_MS) cleaned[id] = ts;
    }
    return cleaned;
  } catch {
    return {};
  }
}

function setDismissed(dismissedMap) {
  try {
    localStorage.setItem(DISMISSED_KEY, JSON.stringify(dismissedMap));
  } catch {}
}

export default function SuggestionChips({ supabase, userId, onChipTap }) {
  const [chips, setChips] = useState([]);
  const [dismissed, setDismissedState] = useState({});
  const [loading, setLoading] = useState(true);
  const intervalRef = useRef(null);

  const load = useCallback(async () => {
    if (!userId) return;
    try {
      const result = await getSuggestionChips({ supabase, userId });
      setChips(result || []);
    } catch {
      setChips([]);
    }
    setLoading(false);
  }, [supabase, userId]);

  // Initial load + refresh interval
  useEffect(() => {
    setDismissedState(getDismissed());
    load();
    intervalRef.current = setInterval(() => {
      load();
    }, REFRESH_MS);
    return () => clearInterval(intervalRef.current);
  }, [load]);

  function handleDismiss(chipId) {
    const updated = { ...dismissed, [chipId]: Date.now() };
    setDismissedState(updated);
    setDismissed(updated);
  }

  const visible = chips.filter(c => c.id && !dismissed[c.id]).slice(0, 3);

  // New user / no chips — render nothing
  if (!loading && visible.length === 0) return null;

  // Loading skeleton
  if (loading) {
    return (
      <div style={{
        display: 'flex',
        gap: '8px',
        overflowX: 'auto',
        padding: '4px 0',
        WebkitOverflowScrolling: 'touch',
        scrollbarWidth: 'none',
      }}>
        {[1, 2].map(i => (
          <div key={i} style={{
            height: '32px',
            width: '120px',
            borderRadius: '9999px',
            background: 'var(--surface, rgba(255,255,255,0.06))',
            flexShrink: 0,
            animation: 'qk-chip-pulse 1.5s ease-in-out infinite',
          }} />
        ))}
        <style>{`
          @keyframes qk-chip-pulse {
            0%, 100% { opacity: 0.4; }
            50% { opacity: 0.15; }
          }
        `}</style>
      </div>
    );
  }

  return (
    <div style={{
      display: 'flex',
      gap: '8px',
      overflowX: visible.length > 3 ? 'auto' : 'visible',
      padding: '4px 0',
      WebkitOverflowScrolling: 'touch',
      scrollbarWidth: 'none',
    }}>
      {visible.map((chip, i) => (
        <button
          key={chip.id}
          onClick={() => onChipTap?.(chip.action, chip.prefill)}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '5px',
            padding: '5px 12px',
            borderRadius: '9999px',
            border: '1px solid rgba(255,255,255,0.1)',
            background: 'var(--surface, rgba(255,255,255,0.06))',
            color: 'var(--text-muted, rgba(255,255,255,0.6))',
            fontSize: '12px',
            fontWeight: 500,
            fontFamily: 'inherit',
            cursor: 'pointer',
            whiteSpace: 'nowrap',
            flexShrink: 0,
            transition: 'opacity 0.2s, background 0.2s',
            animation: `qk-chip-in 0.3s ease-out ${i * 0.06}s both`,
          }}
        >
          <span style={{ fontSize: '13px', lineHeight: 1 }}>{chip.icon}</span>
          <span>{chip.text}</span>
          <span
            role="button"
            tabIndex={0}
            onClick={e => { e.stopPropagation(); handleDismiss(chip.id); }}
            onKeyDown={e => { if (e.key === 'Enter') { e.stopPropagation(); handleDismiss(chip.id); } }}
            style={{
              marginLeft: '2px',
              fontSize: '14px',
              lineHeight: 1,
              opacity: 0.4,
              cursor: 'pointer',
              padding: '0 1px',
            }}
            title="Dismiss"
          >
            &times;
          </span>
        </button>
      ))}
      <style>{`
        @keyframes qk-chip-in {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
