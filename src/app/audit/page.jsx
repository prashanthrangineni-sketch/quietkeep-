// src/app/audit/page.jsx
// Phase 8 — Compliance + Audit Layer + User Data Control
// Replaces any existing stub at this path.
// Shows: full decision log, export, replay, data control (delete/reset intelligence).

'use client';
import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/lib/context/auth';
import { useRouter } from 'next/navigation';
import { safeFetch } from '@/lib/safeFetch';

const MODE_COLORS = {
  autonomous: '#a5b4fc',
  personal:   '#6ee7b7',
  business:   '#fbbf24',
  system:     '#94a3b8',
};

export default function AuditPage() {
  const { user, accessToken, authLoading } = useAuth();
  const router = useRouter();

  const [logs,     setLogs]     = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [tab,      setTab]      = useState('decisions'); // 'decisions' | 'data'
  const [exporting, setExport]  = useState(false);
  const [resetting, setReset]   = useState(false);
  const [msg,       setMsg]     = useState('');
  const [filter,    setFilter]  = useState('all'); // 'all'|'autonomous'|'personal'

  const load = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const { data, error } = await safeFetch('/api/audit-log', { token: accessToken });
      if (!error) setLogs(data?.logs || data || []);
    } catch {}
    setLoading(false);
  }, [accessToken]);

  useEffect(() => {
    if (!authLoading && !user) { router.push('/login'); return; }
    if (user && accessToken) load();
  }, [user, authLoading, accessToken, load, router]);

  async function exportData() {
    setExport(true);
    try {
      const { data } = await safeFetch('/api/audit-log?format=export', { token: accessToken });
      if (data) {
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href     = url;
        a.download = `quietkeep-audit-${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);
        setMsg('Exported successfully');
      }
    } catch { setMsg('Export failed'); }
    setExport(false);
    setTimeout(() => setMsg(''), 3000);
  }

  async function resetIntelligence() {
    if (!confirm('This will reset ALL learned patterns, trust scores, and automation history. This cannot be undone. Continue?')) return;
    setReset(true);
    try {
      const { error } = await safeFetch('/api/trust/reset-all', {
        method: 'POST', body: JSON.stringify({}), token: accessToken,
      });
      setMsg(error ? 'Reset failed' : 'Intelligence reset complete');
      if (!error) await load();
    } catch { setMsg('Reset failed'); }
    setReset(false);
    setTimeout(() => setMsg(''), 3000);
  }

  const filtered = filter === 'all' ? logs : logs.filter(l => l.mode === filter);

  if (authLoading || loading) {
    return (
      <div style={{ minHeight: '100vh', background: '#0a0f1e', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: '#6366f1', fontSize: 13, fontWeight: 600 }}>Loading audit log…</div>
      </div>
    );
  }

  return (
    <div style={{
      minHeight: '100vh', background: '#0a0f1e', color: '#e2e8f0',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      paddingBottom: 80,
    }}>
      {/* Header */}
      <div style={{ padding: '16px 18px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
          <button onClick={() => router.back()}
            style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 20 }}>
            ←
          </button>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 700 }}>📋 Audit & Data Control</div>
            <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>Phase 8 — Protocol-grade decision log</div>
          </div>
          {msg && (
            <div style={{ fontSize: 11, fontWeight: 700, color: '#6ee7b7',
              background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.25)',
              borderRadius: 8, padding: '4px 10px' }}>{msg}</div>
          )}
        </div>
        {/* Tabs */}
        <div style={{ display: 'flex', gap: 2 }}>
          {[['decisions','Decision Log'],['data','Data Control']].map(([key, label]) => (
            <button key={key} onClick={() => setTab(key)}
              style={{
                padding: '8px 16px', borderRadius: '8px 8px 0 0', border: 'none', cursor: 'pointer',
                fontFamily: 'inherit', fontSize: 12, fontWeight: tab === key ? 700 : 400,
                background: tab === key ? 'rgba(99,102,241,0.15)' : 'transparent',
                color: tab === key ? '#a5b4fc' : '#64748b',
                borderBottom: tab === key ? '2px solid #6366f1' : '2px solid transparent',
              }}>{label}</button>
          ))}
        </div>
      </div>

      <div style={{ padding: '16px 18px' }}>
        {tab === 'decisions' && (
          <>
            {/* Filter + Export */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
              {['all','autonomous','personal'].map(f => (
                <button key={f} onClick={() => setFilter(f)}
                  style={{
                    padding: '6px 12px', borderRadius: 8, border: 'none', cursor: 'pointer',
                    fontFamily: 'inherit', fontSize: 11, fontWeight: filter === f ? 700 : 400,
                    background: filter === f ? 'rgba(99,102,241,0.2)' : 'rgba(255,255,255,0.04)',
                    color: filter === f ? '#a5b4fc' : '#64748b',
                    border: `1px solid ${filter === f ? 'rgba(99,102,241,0.4)' : 'rgba(255,255,255,0.07)'}`,
                  }}>
                  {f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1)}
                </button>
              ))}
              <button onClick={exportData} disabled={exporting}
                style={{
                  marginLeft: 'auto', padding: '6px 12px', borderRadius: 8, border: 'none',
                  background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.25)',
                  color: '#6ee7b7', fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                }}>
                {exporting ? 'Exporting…' : '⬇ Export'}
              </button>
            </div>

            {/* Decision log */}
            {filtered.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '30px 0', color: '#475569', fontSize: 13 }}>
                No decisions logged yet
              </div>
            ) : filtered.slice(0, 50).map((log, i) => {
              const modeColor = MODE_COLORS[log.mode] || '#94a3b8';
              const isReversible = log.reversal_possible === true;
              const isProto = log.protocol_version >= 8;
              return (
                <div key={i} style={{
                  padding: '12px 14px', marginBottom: 7,
                  background: 'rgba(255,255,255,0.02)', borderRadius: 11,
                  border: '1px solid rgba(255,255,255,0.06)',
                  borderLeft: `3px solid ${modeColor}40`,
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 5 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 12, fontWeight: 700, color: '#e2e8f0' }}>
                          {log.decision}
                        </span>
                        <span style={{
                          fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 5,
                          background: `${modeColor}20`, color: modeColor,
                        }}>{log.mode?.toUpperCase()}</span>
                        {isProto && (
                          <span style={{
                            fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 5,
                            background: 'rgba(99,102,241,0.15)', color: '#a5b4fc',
                          }}>P8</span>
                        )}
                        {isReversible && (
                          <span style={{
                            fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 5,
                            background: 'rgba(16,185,129,0.1)', color: '#6ee7b7',
                          }}>↩ reversible</span>
                        )}
                        {log.user_override && (
                          <span style={{
                            fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 5,
                            background: 'rgba(245,158,11,0.1)', color: '#fbbf24',
                          }}>USER OVERRIDE</span>
                        )}
                      </div>
                      {log.reason && (
                        <div style={{ fontSize: 11, color: '#64748b', marginTop: 3, lineHeight: 1.4 }}>
                          {log.reason}
                        </div>
                      )}
                    </div>
                    <div style={{ fontSize: 10, color: '#475569', flexShrink: 0, marginLeft: 8 }}>
                      {log.created_at ? new Date(log.created_at).toLocaleDateString('en-IN', {
                        day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                      }) : ''}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                    {typeof log.priority_score === 'number' && (
                      <span style={{ fontSize: 10, color: '#4f46e5' }}>
                        conf: {Math.round(log.priority_score * 100)}%
                      </span>
                    )}
                    {typeof log.risk_score === 'number' && (
                      <span style={{ fontSize: 10, color: log.risk_score > 0.6 ? '#f87171' : '#fbbf24' }}>
                        risk: {Math.round(log.risk_score * 100)}%
                      </span>
                    )}
                    {log.agent_id && (
                      <span style={{ fontSize: 10, color: '#475569' }}>
                        agent: {log.agent_id}
                      </span>
                    )}
                    {log.execution_status && (
                      <span style={{
                        fontSize: 10, fontWeight: 600,
                        color: log.execution_status === 'success' ? '#6ee7b7' : '#f87171',
                      }}>
                        {log.execution_status}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
            {filtered.length > 50 && (
              <div style={{ textAlign: 'center', fontSize: 12, color: '#475569', padding: '10px 0' }}>
                Showing 50 of {filtered.length} entries. Export for full log.
              </div>
            )}
          </>
        )}

        {tab === 'data' && (
          <>
            <div style={{
              padding: '14px 16px', marginBottom: 16,
              background: 'rgba(99,102,241,0.05)', border: '1px solid rgba(99,102,241,0.15)',
              borderRadius: 12,
            }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#a5b4fc', marginBottom: 6 }}>
                Your data, your control
              </div>
              <div style={{ fontSize: 12, color: '#64748b', lineHeight: 1.6 }}>
                QuietKeep only uses your data to improve your own experience.
                Nothing is sold or shared. You can export or reset at any time.
              </div>
            </div>

            {[
              {
                icon: '⬇',
                title: 'Export My Data',
                desc: 'Download all your decisions, patterns, and keeps as JSON.',
                action: exportData,
                label: exporting ? 'Exporting…' : 'Export',
                color: '#6ee7b7',
                bg: 'rgba(16,185,129,0.1)',
                border: 'rgba(16,185,129,0.25)',
              },
              {
                icon: '🧠',
                title: 'Reset Intelligence',
                desc: 'Clear all learned patterns, trust scores, and automation history. Your keeps are preserved.',
                action: resetIntelligence,
                label: resetting ? 'Resetting…' : 'Reset Intelligence',
                color: '#f87171',
                bg: 'rgba(239,68,68,0.07)',
                border: 'rgba(239,68,68,0.2)',
              },
            ].map((item, i) => (
              <div key={i} style={{
                padding: '16px', marginBottom: 12,
                background: item.bg, border: `1px solid ${item.border}`,
                borderRadius: 12,
              }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                  <div style={{ fontSize: 22, flexShrink: 0 }}>{item.icon}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: '#e2e8f0', marginBottom: 4 }}>
                      {item.title}
                    </div>
                    <div style={{ fontSize: 12, color: '#64748b', lineHeight: 1.5, marginBottom: 12 }}>
                      {item.desc}
                    </div>
                    <button onClick={item.action}
                      style={{
                        padding: '8px 16px', borderRadius: 9, border: 'none',
                        background: item.bg, border: `1px solid ${item.border}`,
                        color: item.color, fontSize: 12, fontWeight: 700,
                        cursor: 'pointer', fontFamily: 'inherit',
                      }}>
                      {item.label}
                    </button>
                  </div>
                </div>
              </div>
            ))}

            <div style={{
              padding: '14px 16px', marginTop: 8,
              background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)',
              borderRadius: 12,
            }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#e2e8f0', marginBottom: 8 }}>
                📜 Consent-based learning
              </div>
              <div style={{ fontSize: 11, color: '#64748b', lineHeight: 1.7 }}>
                ✅ Patterns are only learned from your own voice inputs<br/>
                ✅ Feedback (👍/👎) directly adjusts what gets suggested<br/>
                ✅ You can reset any pattern individually from Trust Dashboard<br/>
                ✅ Automation requires explicit opt-in per action type<br/>
                ✅ All decisions are logged and auditable (Section 65B ready)
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
