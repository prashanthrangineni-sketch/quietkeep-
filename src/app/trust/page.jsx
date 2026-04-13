// src/app/trust/page.jsx
// Phase 7 — Trust Dashboard
// Shows: trust score per intent type, automation activity, system limits, reset controls.
// Mobile-first, matches QuietKeep dark UI style.
// Auth: useAuth() from context — no raw getUser() calls.

'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/lib/context/auth';
import { useRouter } from 'next/navigation';
import { safeFetch } from '@/lib/safeFetch';

const RISK_COLORS = {
  safe:      { bg: 'rgba(16,185,129,0.1)',  border: 'rgba(16,185,129,0.3)',  text: '#6ee7b7', label: 'SAFE'      },
  moderate:  { bg: 'rgba(245,158,11,0.1)',  border: 'rgba(245,158,11,0.3)',  text: '#fbbf24', label: 'MODERATE'  },
  sensitive: { bg: 'rgba(239,68,68,0.1)',   border: 'rgba(239,68,68,0.3)',   text: '#f87171', label: 'SENSITIVE' },
};

const INTENT_RISK = {
  note: 'safe', reminder: 'safe', task: 'safe',
  contact: 'moderate', meeting: 'moderate', trip: 'moderate',
  expense: 'sensitive', invoice: 'sensitive', purchase: 'sensitive',
  ledger_credit: 'sensitive', ledger_debit: 'sensitive',
};

export default function TrustDashboard() {
  const { user, accessToken, authLoading } = useAuth();
  const router = useRouter();

  const [patterns, setPatterns]   = useState([]);
  const [history,  setHistory]    = useState([]);
  const [settings, setSettings]   = useState(null);
  const [loading,  setLoading]    = useState(true);
  const [resetting, setResetting] = useState(false);
  const [saved, setSaved]         = useState('');

  const load = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const [patsRes, histRes, settRes] = await Promise.all([
        safeFetch('/api/trust/patterns',   { token: accessToken }),
        safeFetch('/api/autonomous/history', { token: accessToken }),
        safeFetch('/api/settings',           { token: accessToken }),
      ]);
      if (!patsRes.error)  setPatterns(patsRes.data?.patterns || []);
      if (!histRes.error)  setHistory(histRes.data?.history   || []);
      if (!settRes.error)  setSettings(settRes.data?.settings || {});
    } catch { /* fail-safe */ }
    setLoading(false);
  }, [accessToken]);

  useEffect(() => {
    if (!authLoading && !user) { router.replace('/login'); return; }
    if (user && accessToken) load();
  }, [user, authLoading, accessToken, load, router]);

  async function resetPattern(intentType) {
    if (!accessToken) return;
    setResetting(true);
    await safeFetch('/api/trust/reset', {
      method: 'POST',
      body: JSON.stringify({ intent_type: intentType }),
      token: accessToken,
    }).catch(() => {});
    setSaved(`Reset ${intentType}`);
    setTimeout(() => setSaved(''), 2000);
    await load();
    setResetting(false);
  }

  async function pauseAutomation(paused) {
    await safeFetch('/api/settings', {
      method: 'POST',
      body: JSON.stringify({ settings: { automation: { paused } } }),
      token: accessToken,
    }).catch(() => {});
    setSettings(prev => ({ ...prev, automation: { ...(prev?.automation || {}), paused } }));
    setSaved(paused ? 'Automation paused' : 'Automation resumed');
    setTimeout(() => setSaved(''), 2000);
  }

  if (authLoading || loading) {
    return (
      <div style={{ minHeight: '100vh', background: '#0a0f1e', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: '#6366f1', fontSize: 13, fontWeight: 600 }}>Loading trust data…</div>
      </div>
    );
  }

  const isPaused = settings?.automation?.paused === true;
  const autoEnabled = settings?.automation?.enabled === true;

  return (
    <div style={{
      minHeight: '100vh', background: '#0a0f1e', color: '#e2e8f0',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      padding: '0 0 80px',
    }}>
      {/* Header */}
      <div style={{
        padding: '16px 18px 12px',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <button onClick={() => router.back()}
          style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 20, lineHeight: 1 }}>
          ←
        </button>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700 }}>🛡️ Trust Dashboard</div>
          <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>System governance + pattern control</div>
        </div>
        {saved && (
          <div style={{
            marginLeft: 'auto', fontSize: 11, fontWeight: 700,
            color: '#6ee7b7', background: 'rgba(16,185,129,0.1)',
            border: '1px solid rgba(16,185,129,0.25)', borderRadius: 8, padding: '4px 10px',
          }}>{saved}</div>
        )}
      </div>

      <div style={{ padding: '16px 18px' }}>

        {/* Automation Status */}
        <div style={{
          padding: '14px 16px', marginBottom: 16,
          background: isPaused ? 'rgba(239,68,68,0.07)' : autoEnabled ? 'rgba(16,185,129,0.07)' : 'rgba(255,255,255,0.03)',
          border: `1px solid ${isPaused ? 'rgba(239,68,68,0.25)' : autoEnabled ? 'rgba(16,185,129,0.25)' : 'rgba(255,255,255,0.08)'}`,
          borderRadius: 12,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: isPaused ? '#f87171' : autoEnabled ? '#6ee7b7' : '#94a3b8' }}>
                {isPaused ? '⏸ Automation paused' : autoEnabled ? '✅ Automation active' : '⭕ Automation off'}
              </div>
              <div style={{ fontSize: 11, color: '#64748b', marginTop: 3 }}>
                {isPaused ? 'No auto-actions will fire until resumed'
                  : autoEnabled ? 'System is learning and acting on your behalf'
                  : 'Enable in Settings → Automation'}
              </div>
            </div>
            {autoEnabled && (
              <button onClick={() => pauseAutomation(!isPaused)}
                style={{
                  padding: '7px 13px', borderRadius: 8, border: 'none',
                  background: isPaused ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.12)',
                  color: isPaused ? '#6ee7b7' : '#f87171',
                  fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                }}>
                {isPaused ? '▶ Resume' : '⏸ Pause'}
              </button>
            )}
          </div>
        </div>

        {/* Hard Limits */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', color: '#475569',
            textTransform: 'uppercase', marginBottom: 10 }}>🔒 Hard Limits</div>
          <div style={{
            background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)',
            borderRadius: 12, overflow: 'hidden',
          }}>
            {[
              { label: 'Max auto-actions / day',    value: '3',           desc: 'Resets at midnight' },
              { label: 'Max auto-actions / hour',   value: '1 per type',  desc: '4-hour per-type cooldown' },
              { label: 'Max suggestions / hour',    value: '3',           desc: 'Adjustable via Aggressiveness' },
              { label: 'Sandbox threshold',         value: '3 uses + 2 accepts', desc: 'Required before automation eligible' },
              { label: 'Circuit breaker',           value: '3 ignores/hr', desc: 'Pauses automation for 2h' },
              { label: 'Sensitive actions',         value: 'Never auto',  desc: 'Expense, invoice, purchase: suggest only' },
            ].map((row, i) => (
              <div key={i} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
                padding: '11px 14px',
                borderBottom: i < 5 ? '1px solid rgba(255,255,255,0.04)' : 'none',
              }}>
                <div>
                  <div style={{ fontSize: 12, color: '#e2e8f0' }}>{row.label}</div>
                  <div style={{ fontSize: 10, color: '#475569', marginTop: 2 }}>{row.desc}</div>
                </div>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#a5b4fc', flexShrink: 0, marginLeft: 12 }}>
                  {row.value}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Pattern Trust Scores */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', color: '#475569',
            textTransform: 'uppercase', marginBottom: 10 }}>📊 Pattern Trust Scores</div>
          {patterns.length === 0 ? (
            <div style={{ padding: '20px', textAlign: 'center', color: '#475569', fontSize: 13,
              background: 'rgba(255,255,255,0.02)', borderRadius: 12, border: '1px solid rgba(255,255,255,0.06)' }}>
              No patterns learned yet. Keep using voice input to build your profile.
            </div>
          ) : patterns.map((p, i) => {
            const risk = INTENT_RISK[p.intent_type] || 'moderate';
            const rc   = RISK_COLORS[risk];
            const trustPct = Math.round((p.trust_score ?? 0.5) * 100);
            const accepts  = p.accepts || 0;
            const ignores  = p.ignores || 0;
            return (
              <div key={i} style={{
                padding: '13px 14px', marginBottom: 8,
                background: 'rgba(255,255,255,0.02)',
                border: '1px solid rgba(255,255,255,0.07)',
                borderRadius: 12,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 3 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0', textTransform: 'capitalize' }}>
                        {p.intent_type}
                      </div>
                      <div style={{
                        fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 6,
                        background: rc.bg, border: `1px solid ${rc.border}`, color: rc.text,
                        letterSpacing: '0.06em',
                      }}>{rc.label}</div>
                      {p.never_show && (
                        <div style={{
                          fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 6,
                          background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)',
                          color: '#f87171',
                        }}>BLOCKED</div>
                      )}
                    </div>
                    <div style={{ fontSize: 11, color: '#64748b' }}>
                      {p.frequency} uses · {accepts} accepted · {ignores} ignored
                      {p.time_bucket && p.time_bucket !== 'any' ? ` · ${p.time_bucket}` : ''}
                    </div>
                  </div>
                  <button
                    onClick={() => resetPattern(p.intent_type)}
                    disabled={resetting}
                    style={{
                      padding: '5px 10px', borderRadius: 8,
                      background: 'transparent', border: '1px solid rgba(255,255,255,0.1)',
                      color: '#64748b', fontSize: 10, cursor: 'pointer', fontFamily: 'inherit',
                      flexShrink: 0, marginLeft: 10,
                    }}>
                    Reset
                  </button>
                </div>
                {/* Trust bar */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ flex: 1, height: 5, borderRadius: 3, background: 'rgba(255,255,255,0.07)', overflow: 'hidden' }}>
                    <div style={{
                      height: '100%', borderRadius: 3,
                      width: `${trustPct}%`,
                      background: trustPct >= 70 ? '#6ee7b7' : trustPct >= 40 ? '#fbbf24' : '#f87171',
                      transition: 'width 0.4s ease',
                    }} />
                  </div>
                  <div style={{ fontSize: 11, fontWeight: 700, width: 34, textAlign: 'right',
                    color: trustPct >= 70 ? '#6ee7b7' : trustPct >= 40 ? '#fbbf24' : '#f87171' }}>
                    {trustPct}%
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Activity Log */}
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', color: '#475569',
            textTransform: 'uppercase', marginBottom: 10 }}>📋 Recent Activity</div>
          {history.length === 0 ? (
            <div style={{ padding: '20px', textAlign: 'center', color: '#475569', fontSize: 13,
              background: 'rgba(255,255,255,0.02)', borderRadius: 12, border: '1px solid rgba(255,255,255,0.06)' }}>
              No automated activity yet
            </div>
          ) : history.map((h, i) => (
            <div key={i} style={{
              padding: '11px 13px', marginBottom: 7,
              background: 'rgba(255,255,255,0.02)',
              border: '1px solid rgba(255,255,255,0.06)', borderRadius: 10,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#e2e8f0' }}>
                  {h.decision === 'auto_trigger'   ? '⚡ Auto-triggered' :
                   h.decision === 'strong_suggest' ? '💡 Suggested' :
                   h.decision === 'governed_suggest'? '🛡️ Governed→Suggest' :
                   h.decision === 'governed_auto'  ? '✅ Governed→Auto' : '📝 ' + h.decision}
                  {h.inputs?.intentType ? ` · ${h.inputs.intentType}` : ''}
                </div>
                <div style={{ fontSize: 10, color: '#475569' }}>
                  {h.created_at ? new Date(h.created_at).toLocaleDateString('en-IN', {
                    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                  }) : ''}
                </div>
              </div>
              <div style={{ fontSize: 11, color: '#64748b', lineHeight: 1.4 }}>{h.reason}</div>
              {typeof h.priority_score === 'number' && (
                <div style={{ fontSize: 10, color: '#4f46e5', marginTop: 4 }}>
                  Confidence: {Math.round(h.priority_score * 100)}%
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
