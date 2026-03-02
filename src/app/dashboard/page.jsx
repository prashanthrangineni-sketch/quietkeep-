'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

const TYPE_EMOJI = { note: '📝', reminder: '⏰', contact: '📞' };
const STATE_COLOR = {
  open: '#22c55e', active: '#3b82f6', blocked: '#ef4444',
  deferred: '#f59e0b', closed: '#64748b',
};

export default function Dashboard() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [intents, setIntents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [content, setContent] = useState('');
  const [remindAt, setRemindAt] = useState('');
  const [contactInfo, setContactInfo] = useState('');
  const [assistMode, setAssistMode] = useState('note');
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState('open');

  const loadIntents = useCallback(async (uid) => {
    const { data, error } = await supabase
      .from('intents')
      .select('*')
      .eq('user_id', uid)
      .order('created_at', { ascending: false });
    if (!error && data) setIntents(data);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) { router.replace('/login'); return; }
      setUser(session.user);
      loadIntents(session.user.id).finally(() => setLoading(false));
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') router.replace('/');
    });
    return () => subscription.unsubscribe();
  }, [router, loadIntents]);

  async function handleSave() {
    if (!content.trim() || !user) return;
    setSaving(true);
    const { error } = await supabase.from('intents').insert([{
      user_id: user.id,
      content: content.trim(),
      state: 'open',
      assist_mode: assistMode,
      contact_info: contactInfo || null,
      remind_at: remindAt || null,
      intent_type: assistMode,
      intent_status: 'captured',
      parsing_method: 'manual',
    }]);
    if (!error) { setContent(''); setRemindAt(''); setContactInfo(''); await loadIntents(user.id); }
    setSaving(false);
  }

  async function updateState(id, state) {
    await supabase.from('intents').update({
      state,
      ...(state === 'closed' ? { completed_at: new Date().toISOString() } : {}),
    }).eq('id', id);
    await loadIntents(user.id);
  }

  async function handleDelete(id) {
    await supabase.from('intents').delete().eq('id', id);
    await loadIntents(user.id);
  }

  const openIntents = intents.filter(i => i.state !== 'closed');
  const closedIntents = intents.filter(i => i.state === 'closed');
  const displayIntents = activeTab === 'open' ? openIntents : closedIntents;

  if (loading) return (
    <div style={{ minHeight: '100vh', backgroundColor: '#0a0a0f', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ color: '#6366f1' }}>Loading your keeps...</div>
    </div>
  );

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#0a0a0f', color: '#f1f5f9', fontFamily: 'inherit' }}>

      {/* Header */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 50,
        borderBottom: '1px solid #1e1e2e', padding: '14px 24px',
        backgroundColor: 'rgba(10,10,15,0.95)', backdropFilter: 'blur(12px)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{
            width: '34px', height: '34px',
            background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
            borderRadius: '8px', display: 'flex', alignItems: 'center',
            justifyContent: 'center', fontWeight: '800', fontSize: '13px', color: '#fff',
          }}>QK</div>
          <span style={{ fontWeight: '700', fontSize: '16px' }}>Dashboard</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ fontSize: '12px', color: '#475569', maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {user?.email}
          </span>
          <button onClick={() => supabase.auth.signOut()} style={{
            backgroundColor: 'transparent', border: '1px solid #1e293b',
            color: '#64748b', padding: '6px 14px', borderRadius: '6px',
            fontSize: '12px', cursor: 'pointer',
          }}>Sign Out</button>
        </div>
      </div>

      <div style={{ maxWidth: '740px', margin: '0 auto', padding: '28px 20px' }}>

        {/* Stats bar */}
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', marginBottom: '24px',
        }}>
          {[
            { label: 'Open', value: openIntents.length, color: '#6366f1' },
            { label: 'Done', value: closedIntents.length, color: '#22c55e' },
            { label: 'Total', value: intents.length, color: '#94a3b8' },
          ].map((s, i) => (
            <div key={i} style={{
              backgroundColor: '#0f0f1a', border: '1px solid #1e1e2e',
              borderRadius: '12px', padding: '16px', textAlign: 'center',
            }}>
              <div style={{ fontSize: '24px', fontWeight: '800', color: s.color }}>{s.value}</div>
              <div style={{ fontSize: '12px', color: '#475569', marginTop: '4px' }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* New Keep form */}
        <div style={{
          backgroundColor: '#0f0f1a', border: '1px solid #1e1e2e',
          borderRadius: '16px', padding: '22px', marginBottom: '28px',
        }}>
          <h2 style={{ fontSize: '12px', fontWeight: '700', color: '#6366f1', margin: '0 0 14px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            + NEW KEEP
          </h2>
          <textarea
            value={content}
            onChange={e => setContent(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && e.ctrlKey) handleSave(); }}
            placeholder="What do you want to keep..."
            rows={3}
            style={{
              width: '100%', backgroundColor: '#0a0a0f', border: '1px solid #1e293b',
              borderRadius: '10px', padding: '12px', color: '#f1f5f9',
              fontSize: '15px', resize: 'vertical', outline: 'none',
              fontFamily: 'inherit', boxSizing: 'border-box', lineHeight: '1.5',
            }}
          />

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginTop: '10px' }}>
            <div>
              <label style={{ fontSize: '11px', color: '#475569', display: 'block', marginBottom: '5px' }}>⏰ Remind at</label>
              <input type="datetime-local" value={remindAt} onChange={e => setRemindAt(e.target.value)}
                style={{ width: '100%', backgroundColor: '#0a0a0f', border: '1px solid #1e293b', borderRadius: '8px', padding: '8px 10px', color: '#f1f5f9', fontSize: '13px', outline: 'none', boxSizing: 'border-box' }}
              />
            </div>
            <div>
              <label style={{ fontSize: '11px', color: '#475569', display: 'block', marginBottom: '5px' }}>📋 Type</label>
              <select value={assistMode} onChange={e => setAssistMode(e.target.value)}
                style={{ width: '100%', backgroundColor: '#0a0a0f', border: '1px solid #1e293b', borderRadius: '8px', padding: '8px 10px', color: '#f1f5f9', fontSize: '13px', outline: 'none', boxSizing: 'border-box' }}>
                <option value="note">📝 Note</option>
                <option value="reminder">⏰ Reminder</option>
                <option value="contact">📞 Contact</option>
              </select>
            </div>
          </div>

          {assistMode === 'contact' && (
            <input type="text" value={contactInfo} onChange={e => setContactInfo(e.target.value)}
              placeholder="Phone / Email / Notes..."
              style={{ width: '100%', marginTop: '10px', backgroundColor: '#0a0a0f', border: '1px solid #1e293b', borderRadius: '8px', padding: '9px 12px', color: '#f1f5f9', fontSize: '13px', outline: 'none', boxSizing: 'border-box' }}
            />
          )}

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '14px' }}>
            <span style={{ fontSize: '11px', color: '#334155' }}>Ctrl+Enter to save</span>
            <button onClick={handleSave} disabled={saving || !content.trim()} style={{
              backgroundColor: saving || !content.trim() ? '#1a1a2e' : '#6366f1',
              color: saving || !content.trim() ? '#475569' : '#fff',
              border: 'none', padding: '9px 22px', borderRadius: '8px',
              fontSize: '13px', fontWeight: '600', cursor: saving || !content.trim() ? 'not-allowed' : 'pointer',
            }}>
              {saving ? 'Saving...' : '+ Keep this'}
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: '4px', marginBottom: '16px', backgroundColor: '#0f0f1a', padding: '4px', borderRadius: '10px', border: '1px solid #1e1e2e' }}>
          {[
            { key: 'open', label: `Open (${openIntents.length})` },
            { key: 'closed', label: `Done (${closedIntents.length})` },
          ].map(tab => (
            <button key={tab.key} onClick={() => setActiveTab(tab.key)} style={{
              flex: 1, padding: '8px', borderRadius: '7px', border: 'none', cursor: 'pointer',
              backgroundColor: activeTab === tab.key ? '#6366f1' : 'transparent',
              color: activeTab === tab.key ? '#fff' : '#64748b',
              fontSize: '13px', fontWeight: '600',
            }}>{tab.label}</button>
          ))}
        </div>

        {/* Intent list */}
        {displayIntents.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '48px 24px', border: '1px dashed #1e293b', borderRadius: '14px', color: '#334155' }}>
            {activeTab === 'open' ? '📭 Nothing open. Add your first keep above.' : '✅ No completed keeps yet.'}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {displayIntents.map(intent => (
              <IntentCard key={intent.id} intent={intent} onUpdateState={updateState} onDelete={handleDelete} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function IntentCard({ intent, onUpdateState, onDelete }) {
  const [expanded, setExpanded] = useState(false);
  const emoji = TYPE_EMOJI[intent.assist_mode] || TYPE_EMOJI[intent.intent_type] || '📝';
  const color = STATE_COLOR[intent.state] || '#22c55e';
  const isClosed = intent.state === 'closed';

  return (
    <div style={{
      backgroundColor: '#0f0f1a', border: '1px solid #1e1e2e',
      borderRadius: '12px', padding: '16px',
      opacity: isClosed ? 0.55 : 1,
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
        <span style={{ fontSize: '20px', flexShrink: 0, lineHeight: 1.3 }}>{emoji}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{
            margin: '0 0 10px', fontSize: '15px', color: '#e2e8f0',
            lineHeight: 1.5, textDecoration: isClosed ? 'line-through' : 'none',
          }}>
            {intent.content}
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <span style={{
              fontSize: '10px', padding: '2px 8px', borderRadius: '100px', fontWeight: '700',
              backgroundColor: `${color}18`, color: color, textTransform: 'uppercase', letterSpacing: '0.05em',
            }}>{intent.state}</span>
            {intent.remind_at && (
              <span style={{ fontSize: '11px', color: '#64748b' }}>
                ⏰ {new Date(intent.remind_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
            {intent.contact_info && (
              <span style={{ fontSize: '11px', color: '#64748b' }}>📞 {intent.contact_info}</span>
            )}
            {intent.category && (
              <span style={{ fontSize: '11px', color: '#8b5cf6' }}>#{intent.category}</span>
            )}
            <span style={{ fontSize: '11px', color: '#1e293b', marginLeft: 'auto' }}>
              {new Date(intent.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
            </span>
          </div>
        </div>
      </div>

      {!isClosed && (
        <div style={{ display: 'flex', gap: '7px', marginTop: '12px', borderTop: '1px solid #1a1a2e', paddingTop: '12px', flexWrap: 'wrap' }}>
          <button onClick={() => onUpdateState(intent.id, 'closed')} style={{
            backgroundColor: '#052010', border: '1px solid #166534', color: '#22c55e',
            padding: '5px 12px', borderRadius: '6px', fontSize: '12px', cursor: 'pointer', fontWeight: '500',
          }}>✓ Done</button>
          <button onClick={() => setExpanded(e => !e)} style={{
            backgroundColor: 'transparent', border: '1px solid #1e293b', color: '#64748b',
            padding: '5px 12px', borderRadius: '6px', fontSize: '12px', cursor: 'pointer',
          }}>{expanded ? 'Less ▲' : 'More ▼'}</button>
          <button onClick={() => onDelete(intent.id)} style={{
            backgroundColor: 'transparent', border: '1px solid #2d1515', color: '#ef4444',
            padding: '5px 12px', borderRadius: '6px', fontSize: '12px', cursor: 'pointer', marginLeft: 'auto',
          }}>Delete</button>
        </div>
      )}

      {expanded && (
        <div style={{ marginTop: '12px', borderTop: '1px solid #1a1a2e', paddingTop: '12px', display: 'flex', gap: '7px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '11px', color: '#475569', marginRight: '8px', alignSelf: 'center' }}>Change state:</span>
          {['open', 'active', 'deferred', 'blocked'].map(s => (
            intent.state !== s && (
              <button key={s} onClick={() => onUpdateState(intent.id, s)} style={{
                backgroundColor: `${STATE_COLOR[s]}15`, border: `1px solid ${STATE_COLOR[s]}40`,
                color: STATE_COLOR[s], padding: '4px 10px', borderRadius: '6px',
                fontSize: '11px', cursor: 'pointer', fontWeight: '600',
              }}>{s}</button>
            )
          ))}
        </div>
      )}
    </div>
  );
}
