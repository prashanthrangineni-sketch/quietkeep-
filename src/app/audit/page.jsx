'use client';
// NEW FILE: src/app/audit/page.jsx
// Sprint 2B — Activity Audit Log
// Reads from audit_log table (14 rows live, RLS by user_id)
// No new API, no schema change needed

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import NavbarClient from '@/components/NavbarClient';

const ACTION_META = {
  settings_updated:    { icon: '⚙️',  color: '#6366f1' },
  keep_created:        { icon: '📝',  color: '#22c55e' },
  keep_updated:        { icon: '✏️',  color: '#60a5fa' },
  keep_deleted:        { icon: '🗑️',  color: '#f87171' },
  document_added:      { icon: '📄',  color: '#fbbf24' },
  document_deleted:    { icon: '📄',  color: '#f87171' },
  sos_triggered:       { icon: '🆘',  color: '#ef4444' },
  family_invite_sent:  { icon: '👨‍👩‍👧', color: '#a78bfa' },
  reminder_created:    { icon: '⏰',  color: '#34d399' },
  expense_logged:      { icon: '💰',  color: '#f59e0b' },
  voice_captured:      { icon: '🎙️', color: '#818cf8' },
  mood_logged:         { icon: '🌊',  color: '#7dd3fc' },
  health_logged:       { icon: '🏃',  color: '#4ade80' },
  trip_created:        { icon: '✈️',  color: '#38bdf8' },
  login:               { icon: '🔑',  color: '#a3e635' },
};

function fmt(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleString('en-IN', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

function humanize(action) {
  return action?.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) || action;
}

export default function AuditPage() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [expanded, setExpanded] = useState(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) { window.location.href = '/login'; return; }
      loadLogs(user.id);
    });
  }, []);

  async function loadLogs(uid) {
    const { data } = await supabase
      .from('audit_log')
      .select('*')
      .eq('user_id', uid)
      .order('created_at', { ascending: false })
      .limit(100);
    setLogs(data || []);
    setLoading(false);
  }

  const actions = [...new Set(logs.map(l => l.action))].filter(Boolean);

  const filtered = filter === 'all' ? logs : logs.filter(l => l.action === filter);

  return (
    <div style={{ minHeight: '100vh', background: '#0a0a0f', color: '#f1f5f9', fontFamily: 'system-ui,sans-serif', paddingBottom: 80, paddingTop: '96px' }}>
      <NavbarClient />
      <div style={{ maxWidth: 600, margin: '0 auto', padding: '24px 16px' }}>

        {/* Header */}
        <div style={{ marginBottom: 20 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>📊 Activity Log</h1>
          <p style={{ color: '#475569', fontSize: 13, marginTop: 4 }}>
            Your complete action history — {logs.length} events recorded
          </p>
        </div>

        {/* Filter chips */}
        <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 8, marginBottom: 16, scrollbarWidth: 'none' }}>
          {['all', ...actions].map(a => (
            <button
              key={a}
              onClick={() => setFilter(a)}
              style={{
                whiteSpace: 'nowrap', padding: '5px 14px', borderRadius: 20,
                border: `1px solid ${filter === a ? '#6366f1' : '#1e293b'}`,
                background: filter === a ? '#6366f122' : '#1e293b',
                color: filter === a ? '#818cf8' : '#64748b',
                fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              {a === 'all' ? `All (${logs.length})` : humanize(a)}
            </button>
          ))}
        </div>

        {loading && (
          <div style={{ textAlign: 'center', padding: 40, color: '#475569' }}>Loading…</div>
        )}

        {!loading && filtered.length === 0 && (
          <div style={{ textAlign: 'center', padding: '48px 20px', background: '#0f172a', borderRadius: 14, border: '1px dashed #1e293b' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>📭</div>
            <div style={{ color: '#475569', fontSize: 14 }}>No activity yet</div>
          </div>
        )}

        {/* Log entries */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {filtered.map((log, i) => {
            const meta = ACTION_META[log.action] || { icon: '📌', color: '#64748b' };
            const isOpen = expanded === log.id;
            const hasDetails = log.details && Object.keys(log.details).length > 0;
            return (
              <div
                key={log.id || i}
                onClick={() => hasDetails && setExpanded(isOpen ? null : log.id)}
                style={{
                  background: '#0f172a', border: `1px solid #1e293b`,
                  borderLeft: `3px solid ${meta.color}`,
                  borderRadius: 12, padding: '12px 14px',
                  cursor: hasDetails ? 'pointer' : 'default',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 18, flexShrink: 0 }}>{meta.icon}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0' }}>
                      {humanize(log.action)}
                    </div>
                    <div style={{ fontSize: 11, color: '#475569', marginTop: 2 }}>
                      {log.service && <span style={{ marginRight: 8, color: '#334155' }}>{log.service}</span>}
                      {fmt(log.created_at)}
                    </div>
                  </div>
                  {hasDetails && (
                    <span style={{ color: '#334155', fontSize: 14, flexShrink: 0, transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
                      ⌄
                    </span>
                  )}
                </div>
                {isOpen && hasDetails && (
                  <div style={{ marginTop: 10, background: '#070e1a', borderRadius: 8, padding: '8px 12px' }}>
                    {Object.entries(log.details).map(([k, v]) => (
                      <div key={k} style={{ display: 'flex', gap: 8, padding: '3px 0', borderBottom: '1px solid #0f172a' }}>
                        <span style={{ color: '#475569', fontSize: 11, minWidth: 100, flexShrink: 0 }}>{k}</span>
                        <span style={{ color: '#94a3b8', fontSize: 11, wordBreak: 'break-all' }}>
                          {typeof v === 'object' ? JSON.stringify(v) : String(v)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

      </div>
    </div>
  );
}
