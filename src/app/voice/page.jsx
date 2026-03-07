'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

function fmt(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function fmtDuration(secs) {
  if (!secs) return null;
  if (secs < 60) return `${secs}s`;
  return `${Math.floor(secs / 60)}m ${secs % 60}s`;
}

function dayLabel(ts) {
  const d = new Date(ts);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
  const dd = new Date(d); dd.setHours(0, 0, 0, 0);
  if (dd.getTime() === today.getTime()) return 'Today';
  if (dd.getTime() === yesterday.getTime()) return 'Yesterday';
  return d.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' });
}

export default function VoicePage() {
  const [user, setUser] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) { setUser(user); loadSessions(user.id); }
    });
  }, []);

  async function loadSessions(uid) {
    setLoading(true);
    const { data } = await supabase
      .from('voice_sessions')
      .select('*')
      .eq('user_id', uid)
      .order('created_at', { ascending: false })
      .limit(50);
    setSessions(data || []);
    setLoading(false);
  }

  // Group by day
  const grouped = sessions.reduce((acc, s) => {
    const key = new Date(s.created_at).toDateString();
    if (!acc[key]) acc[key] = { label: dayLabel(s.created_at), items: [] };
    acc[key].items.push(s);
    return acc;
  }, {});

  const totalDuration = sessions.reduce((sum, s) => sum + (s.duration_seconds || 0), 0);
  const capturedCount = sessions.filter(s => s.intent_captured).length;

  return (
    <div style={{ minHeight: '100vh', background: '#0a0a0f', color: '#f0f0f5', fontFamily: "'DM Sans', -apple-system, sans-serif", paddingBottom: '80px' }}>

      {/* Header */}
      <div style={{ background: 'linear-gradient(135deg, #0a0a14, #0d0a18)', borderBottom: '1px solid rgba(139,92,246,0.2)', padding: '20px 16px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
          <span style={{ fontSize: '22px' }}>🎙️</span>
          <h1 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: '#fff', letterSpacing: '-0.3px' }}>Voice History</h1>
        </div>
        <p style={{ margin: 0, fontSize: '13px', color: 'rgba(255,255,255,0.4)' }}>
          {sessions.length} session{sessions.length !== 1 ? 's' : ''}
          {totalDuration > 0 ? ` · ${fmtDuration(totalDuration)} total` : ''}
        </p>
      </div>

      {/* Stats strip */}
      {sessions.length > 0 && (
        <div style={{ display: 'flex', gap: '10px', padding: '14px 16px' }}>
          {[
            { label: 'Sessions', value: sessions.length, icon: '🎙️', color: '#a78bfa' },
            { label: 'Intents captured', value: capturedCount, icon: '✅', color: '#4ade80' },
            { label: 'Total time', value: fmtDuration(totalDuration) || '—', icon: '⏱️', color: '#60a5fa' },
          ].map(s => (
            <div key={s.label} style={{ flex: 1, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', padding: '10px', textAlign: 'center' }}>
              <div style={{ fontSize: '16px', marginBottom: '4px' }}>{s.icon}</div>
              <div style={{ fontSize: '15px', fontWeight: 700, color: s.color }}>{s.value}</div>
              <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.35)', marginTop: '2px' }}>{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Sessions list */}
      <div style={{ padding: '0 16px' }}>
        {loading && <div style={{ textAlign: 'center', padding: '40px', color: 'rgba(255,255,255,0.3)', fontSize: '13px' }}>Loading...</div>}

        {!loading && sessions.length === 0 && (
          <div style={{ textAlign: 'center', padding: '56px 20px', background: 'rgba(255,255,255,0.03)', border: '1px dashed rgba(255,255,255,0.1)', borderRadius: '16px' }}>
            <div style={{ fontSize: '48px', marginBottom: '14px' }}>🎙️</div>
            <p style={{ margin: '0 0 8px', fontSize: '15px', color: 'rgba(255,255,255,0.6)', fontWeight: 500 }}>No voice sessions yet</p>
            <p style={{ margin: 0, fontSize: '12px', color: 'rgba(255,255,255,0.35)' }}>Use the microphone on the dashboard to capture voice keeps</p>
          </div>
        )}

        {Object.values(grouped).map((group, gi) => (
          <div key={gi} style={{ marginBottom: '20px' }}>
            <p style={{ margin: '0 0 8px', fontSize: '11px', color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.8px' }}>
              {group.label}
            </p>
            {group.items.map(s => {
              const isExpanded = expanded === s.id;
              return (
                <div key={s.id} style={{
                  background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)',
                  borderLeft: `3px solid ${s.intent_captured ? '#4ade80' : '#a78bfa'}`,
                  borderRadius: '12px', padding: '12px 14px', marginBottom: '8px',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div style={{ flex: 1, marginRight: '8px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '5px' }}>
                        {s.language_used && (
                          <span style={{ fontSize: '10px', color: '#a78bfa', background: 'rgba(167,139,250,0.12)', padding: '2px 7px', borderRadius: '8px' }}>
                            {s.language_used}
                          </span>
                        )}
                        {s.intent_captured && (
                          <span style={{ fontSize: '10px', color: '#4ade80', background: 'rgba(74,222,128,0.1)', padding: '2px 7px', borderRadius: '8px' }}>
                            ✅ Intent saved
                          </span>
                        )}
                        {s.sarvam_used && (
                          <span style={{ fontSize: '10px', color: '#60a5fa', background: 'rgba(96,165,250,0.1)', padding: '2px 7px', borderRadius: '8px' }}>
                            Sarvam
                          </span>
                        )}
                        {s.duration_seconds && (
                          <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.35)' }}>
                            ⏱️ {fmtDuration(s.duration_seconds)}
                          </span>
                        )}
                      </div>

                      {s.transcript ? (
                        <div>
                          <p style={{ margin: '0 0 3px', fontSize: '13px', color: 'rgba(255,255,255,0.6)', lineHeight: '1.4', overflow: isExpanded ? 'visible' : 'hidden', display: isExpanded ? 'block' : '-webkit-box', WebkitLineClamp: isExpanded ? 'unset' : 2, WebkitBoxOrient: 'vertical' }}>
                            "{s.transcript}"
                          </p>
                          {s.transcript.length > 80 && (
                            <button onClick={() => setExpanded(isExpanded ? null : s.id)}
                              style={{ background: 'none', border: 'none', color: '#a78bfa', fontSize: '11px', cursor: 'pointer', padding: '2px 0', fontFamily: 'inherit' }}>
                              {isExpanded ? 'Show less ▲' : 'Show more ▼'}
                            </button>
                          )}
                        </div>
                      ) : (
                        <p style={{ margin: 0, fontSize: '13px', color: 'rgba(255,255,255,0.3)', fontStyle: 'italic' }}>No transcript saved</p>
                      )}
                    </div>
                    <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.3)', textAlign: 'right', flexShrink: 0 }}>
                      {new Date(s.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
             }
