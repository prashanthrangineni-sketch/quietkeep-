'use client';
import { apiGet } from '@/lib/safeFetch';
// src/components/AgentSuggestionCard.jsx
// Phase 3 (original) + Phase 4 upgrade — Decision Engine integration
// Phase 7 (v3) additions:
//   - "Why this?" expandable section with time/distance/intent signals
//   - Sort by final_score (v3 blend) or score (v2 fallback)
//   - All existing props, behaviour and styling preserved
//
// Props (unchanged):
//   accessToken {string}  — Bearer token
//   lat         {number}  — optional current latitude
//   lng         {number}  — optional current longitude
//   onAction    {fn}      — callback when user taps Go

import { useState, useEffect, useCallback } from 'react';

export default function AgentSuggestionCard({ accessToken, lat, lng, onAction }) {
  const [suggestions, setSuggestions] = useState([]);
  const [dismissed, setDismissed]     = useState(new Set());
  const [expanded, setExpanded]       = useState(new Set());  // v3: "Why this?" toggle
  const [loaded, setLoaded]           = useState(false);

  const load = useCallback(async () => {
    if (!accessToken) return;
    try {
      const params = new URLSearchParams();
      if (typeof lat === 'number') params.set('lat', lat);
      if (typeof lng === 'number') params.set('lng', lng);
      const { data: res, error: resErr } = await apiGet(`/api/agent/predict?${params}`, accessToken);
      if (resErr || !res) return;
      const j = res;
      // Phase 4: sort by score DESC (decideSuggestions already does this server-side,
      // but we sort again client-side as a safety net for any legacy responses)
      // v3: sort by final_score if present, fall back to base score
      const sorted = (j.suggestions || []).sort((a, b) => (b.final_score ?? b.score ?? 0) - (a.final_score ?? a.score ?? 0));
      setSuggestions(sorted);
    } catch {}
    setLoaded(true);
  }, [accessToken, lat, lng]);

  useEffect(() => { load(); }, [load]);

  // Preserve original filter + cap
  const visible = suggestions.filter((_, i) => !dismissed.has(i)).slice(0, 2);
  if (!loaded || visible.length === 0) return null;

  return (
    <div style={{ marginBottom: 16 }}>
      {visible.map((s, i) => {
        const pct = Math.round(((s.final_score ?? s.score ?? s.confidence) ?? 0) * 100);
        // Confidence bar colour: ≥70% green, ≥50% amber, else muted
        const barColor = pct >= 70 ? '#22c55e' : pct >= 50 ? '#f59e0b' : '#94a3b8';

        return (
          <div key={i} style={{
            display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
            gap: 8, padding: '10px 14px', marginBottom: 8,
            background: 'rgba(99,102,241,0.08)',
            border: '1px solid rgba(99,102,241,0.2)',
            borderRadius: 10, fontSize: 13,
          }}>
            <div style={{ flex: 1 }}>
              {/* Icon + message (unchanged) */}
              <div>
                <span style={{ marginRight: 6 }}>
                  {s.type === 'geo' ? '📍' : s.type === 'routine' ? '🔁' : '💡'}
                </span>
                <span style={{ color: 'var(--text)', lineHeight: 1.5 }}>{s.message}</span>
              </div>

              {/* v3: confidence bar (unchanged from Phase 5) */}
              {(s.final_score ?? s.score) != null && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 5, marginLeft: 20 }}>
                  <div style={{ flex: 1, height: 3, background: 'rgba(255,255,255,0.08)', borderRadius: 2, overflow: 'hidden' }}>
                    <div style={{ width: `${pct}%`, height: '100%', background: barColor, borderRadius: 2, transition: 'width 0.3s' }} />
                  </div>
                  <span style={{ fontSize: 10, color: 'var(--text-subtle)', whiteSpace: 'nowrap' }}>
                    {pct}%
                  </span>
                  {/* v3: "Why this?" toggle */}
                  <button
                    onClick={() => setExpanded(ex => {
                      const n = new Set(ex);
                      n.has(i) ? n.delete(i) : n.add(i);
                      return n;
                    })}
                    style={{ background: 'none', border: 'none', color: 'var(--text-subtle)',
                      fontSize: 10, cursor: 'pointer', padding: 0, fontFamily: 'inherit',
                      textDecoration: 'underline', whiteSpace: 'nowrap' }}
                  >
                    {expanded.has(i) ? 'Less' : 'Why?'}
                  </button>
                </div>
              )}

              {/* v3: "Why this?" expandable panel */}
              {expanded.has(i) && (
                <div style={{ marginTop: 6, marginLeft: 20, padding: '6px 8px',
                  background: 'rgba(255,255,255,0.03)', borderRadius: 6, fontSize: 11,
                  color: 'var(--text-subtle)', lineHeight: 1.6 }}>
                  {/* Reason string */}
                  {s.reason && <div>{s.reason}</div>}
                  {/* Time match signal */}
                  {s.breakdown?.time != null && (
                    <div>⏰ Time match: {Math.round(s.breakdown.time * 100)}%</div>
                  )}
                  {/* Distance signal */}
                  {s.distance_meters != null && (
                    <div>📍 Distance: {s.distance_meters}m away</div>
                  )}
                  {/* Intent strength */}
                  {s.intent_score != null && (
                    <div>🎯 Intent strength: {Math.round(s.intent_score * 100)}%
                      {s.intent_score >= 0.75 ? ' · high urgency' : s.intent_score <= 0.35 ? ' · low urgency' : ''}
                    </div>
                  )}
                  {/* Context score */}
                  {s.context_score != null && (
                    <div>📱 Context score: {Math.round(s.context_score * 100)}%</div>
                  )}
                  {/* v3 final score */}
                  {s.final_score != null && (
                    <div style={{ marginTop: 3, fontWeight: 600, color: 'var(--text-muted)' }}>
                      Final relevance: {Math.round(s.final_score * 100)}%
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Actions (unchanged) */}
            <div style={{ display: 'flex', gap: 6, flexShrink: 0, alignItems: 'center' }}>
              {s.action_hint && onAction && (
                <button
                  onClick={() => { onAction(s.action_hint); setDismissed(d => new Set([...d, i])); }}
                  style={{ padding: '3px 10px', borderRadius: 6, background: '#6366f1', border: 'none',
                    color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
                >
                  Go
                </button>
              )}
              <button
                onClick={() => setDismissed(d => new Set([...d, i]))}
                style={{ background: 'none', border: 'none', color: 'var(--text-subtle)',
                  cursor: 'pointer', fontSize: 16, padding: '0 2px', lineHeight: 1 }}
                title="Dismiss"
              >×</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
