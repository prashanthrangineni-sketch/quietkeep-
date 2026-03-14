'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import NavbarClient from '@/components/NavbarClient';

const RECURRENCE = ['none', 'daily', 'weekly', 'monthly'];

function fmt(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function isOverdue(ts) { return ts && new Date(ts) < new Date(); }
function isSoon(ts) {
  if (!ts) return false;
  const diff = new Date(ts) - new Date();
  return diff > 0 && diff < 24 * 60 * 60 * 1000;
}

const EMPTY_FORM = { reminder_text: '', scheduled_for: '', recurrence: 'none', is_active: true, reminder_type: 'app' };

function parseNaturalDate(text) {
  const now = new Date(); const t = text.toLowerCase();
  let d = new Date(now);
  if (/\btomorrow\b/.test(t)) d.setDate(d.getDate() + 1);
  const t12 = t.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/);
  const t24 = t.match(/\bat\s+(\d{1,2}):(\d{2})\b/);
  if (t12) { let h=parseInt(t12[1]),m2=parseInt(t12[2]||'0'); if(t12[3]==='pm'&&h!==12)h+=12; if(t12[3]==='am'&&h===12)h=0; d.setHours(h,m2,0,0); }
  else if (t24) { d.setHours(parseInt(t24[1]),parseInt(t24[2]),0,0); }
  else d.setHours(9,0,0,0);
  if (!/\b(today|tomorrow|\d{1,2}\s*(am|pm)|at\s+\d)/i.test(t)) return null;
  const pad=n=>String(n).padStart(2,'0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function RemindersPage() {
  const [user, setUser] = useState(null);
  const [reminders, setReminders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('active');

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) { setUser(user); loadReminders(user.id); }
    });
  }, []);

  async function loadReminders(uid) {
    setLoading(true);
    const { data } = await supabase.from('reminders').select('*').eq('user_id', uid).order('scheduled_for', { ascending: true });
    setReminders(data || []);
    setLoading(false);
  }

  function openAdd() {
    setEditItem(null);
    const d = new Date(Date.now() + 60 * 60 * 1000);
    const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    setForm({ ...EMPTY_FORM, scheduled_for: local });
    setError(''); setShowForm(true);
  }

  function openEdit(r) {
    setEditItem(r);
    const d = new Date(r.scheduled_for);
    const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    setForm({ reminder_text: r.reminder_text || '', scheduled_for: local, recurrence: r.recurrence || 'none', is_active: r.is_active !== false });
    setError(''); setShowForm(true);
  }

  async function saveReminder() {
    if (!form.reminder_text.trim()) return setError('Reminder text is required');
    if (!form.scheduled_for) return setError('Please set a date and time');
    setSaving(true); setError('');
    const payload = { user_id: user.id, reminder_text: form.reminder_text.trim(), scheduled_for: new Date(form.scheduled_for).toISOString(), recurrence: form.recurrence === 'none' ? null : form.recurrence, is_active: form.is_active, space_type: form.reminder_type || 'app' };
    if (!user) { setSaving(false); return setError('Not logged in. Please refresh.'); }
    let err;
    if (editItem) {
      ({ error: err } = await supabase.from('reminders').update(payload).eq('id', editItem.id));
    } else {
      ({ error: err } = await supabase.from('reminders').insert(payload));
    }
    setSaving(false);
    if (err) { setError(err.message); return; }
    setShowForm(false); loadReminders(user.id);
  }

  async function toggleActive(r) {
    await supabase.from('reminders').update({ is_active: !r.is_active }).eq('id', r.id);
    setReminders(reminders.map(x => x.id === r.id ? { ...x, is_active: !x.is_active } : x));
  }

  async function deleteReminder(id) {
    if (!confirm('Delete this reminder?')) return;
    await supabase.from('reminders').delete().eq('id', id);
    setReminders(reminders.filter(x => x.id !== id));
  }

  const filtered = reminders.filter(r => {
    if (filter === 'active') return r.is_active;
    if (filter === 'done') return !r.is_active;
    return true;
  });

  const overdueCount = reminders.filter(r => r.is_active && isOverdue(r.scheduled_for)).length;

  return (
    <div className="qk-page">
      <NavbarClient />
      <div className="qk-container">

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
              <span style={{ fontSize: 22 }}>⏰</span>
              <h1 style={{ fontSize: 20, fontWeight: 800, color: '#e2e8f0', letterSpacing: '-0.02em' }}>Reminders</h1>
              {overdueCount > 0 && (
                <span className="qk-badge qk-badge-red">{overdueCount} overdue</span>
              )}
            </div>
            <p style={{ fontSize: 13, color: '#475569' }}>
              {reminders.filter(r => r.is_active).length} active
            </p>
          </div>
          <button onClick={openAdd} className="qk-btn qk-btn-primary qk-btn-sm">+ Add</button>
        </div>

        {/* Filter tabs */}
        <div className="qk-tabs">
          {[['active', 'Active'], ['all', 'All'], ['done', 'Inactive']].map(([val, lbl]) => (
            <button key={val} onClick={() => setFilter(val)} className={`qk-tab${filter === val ? ' active' : ''}`}>{lbl}</button>
          ))}
        </div>

        {/* List */}
        {loading && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
            <div className="qk-spinner" />
          </div>
        )}

        {!loading && filtered.length === 0 && (
          <div className="qk-empty">
            <div className="qk-empty-icon">⏰</div>
            <div className="qk-empty-title">No reminders here</div>
            <div className="qk-empty-sub">Add a reminder to stay on track</div>
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {filtered.map(r => {
            const overdue = r.is_active && isOverdue(r.scheduled_for);
            const soon = r.is_active && isSoon(r.scheduled_for);
            return (
              <div key={r.id} className="qk-card" style={{
                padding: '13px 14px',
                opacity: r.is_active ? 1 : 0.55,
                borderLeft: `3px solid ${overdue ? '#ef4444' : soon ? '#f59e0b' : r.is_active ? '#f59e0b' : 'rgba(255,255,255,0.1)'}`,
                background: overdue ? 'rgba(239,68,68,0.06)' : undefined,
                animation: 'qk-fade-in 0.2s ease forwards',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ flex: 1, marginRight: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 5 }}>
                      {overdue && <span className="qk-badge qk-badge-red">Overdue</span>}
                      {soon && !overdue && <span className="qk-badge qk-badge-amber">Soon</span>}
                      {r.recurrence && r.recurrence !== 'none' && (
                        <span className="qk-badge" style={{ background: 'rgba(59,130,246,0.12)', color: '#93c5fd', border: '1px solid rgba(59,130,246,0.2)' }}>
                          🔁 {r.recurrence}
                        </span>
                      )}
                    </div>
                    <p style={{ fontSize: 14, fontWeight: 500, color: '#e2e8f0', lineHeight: 1.4, marginBottom: 5 }}>{r.reminder_text}</p>
                    <p style={{ fontSize: 12, color: overdue ? '#f87171' : '#475569' }}>📅 {fmt(r.scheduled_for)}</p>
                  </div>
                  <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                    <button onClick={() => toggleActive(r)} className="qk-btn qk-btn-sm" style={{
                      background: r.is_active ? 'rgba(245,158,11,0.15)' : 'rgba(255,255,255,0.05)',
                      border: `1px solid ${r.is_active ? 'rgba(245,158,11,0.3)' : 'rgba(255,255,255,0.08)'}`,
                      color: r.is_active ? '#f59e0b' : '#475569',
                      padding: '6px 9px',
                    }}>{r.is_active ? '✓' : '○'}</button>
                    <button onClick={() => openEdit(r)} className="qk-btn qk-btn-ghost qk-btn-sm" style={{ padding: '6px 9px' }}>✏️</button>
                    <button onClick={() => deleteReminder(r.id)} className="qk-btn qk-btn-danger qk-btn-sm" style={{ padding: '6px 9px' }}>🗑️</button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Form modal */}
        {showForm && (
          <div
            className="qk-modal-overlay"
            onClick={e => { if (e.target === e.currentTarget) setShowForm(false); }}
          >
            <div className="qk-modal-sheet">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                <h3 style={{ fontSize: 17, fontWeight: 700, color: '#e2e8f0' }}>{editItem ? 'Edit Reminder' : 'New Reminder'}</h3>
                <button onClick={() => setShowForm(false)} style={{ background: 'none', border: 'none', color: '#475569', fontSize: 20, cursor: 'pointer' }}>✕</button>
              </div>

              <label style={{ display: 'block', marginBottom: 14 }}>
                <span style={{ fontSize: 11, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.06em' }}>What to remind</span>
                <textarea
                  value={form.reminder_text}
                  onChange={e => {
                    const txt = e.target.value;
                    const parsed = parseNaturalDate(txt);
                    setForm(f => ({ ...f, reminder_text: txt, ...(parsed ? { scheduled_for: parsed } : {}) }));
                  }}
                  placeholder="e.g. Wake me at 2pm today, Call doctor tomorrow 9am…"
                  rows={2}
                  className="qk-input"
                  style={{ marginTop: 8, resize: 'vertical' }}
                />
              </label>

              <label style={{ display: 'block', marginBottom: 14 }}>
                <span style={{ fontSize: 11, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Reminder Type</span>
                <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                  {[['app','📱 App'],['alarm','⏰ Alarm'],['whatsapp','💬 WhatsApp']].map(([v,l]) => (
                    <button key={v} type="button" onClick={() => setForm(f => ({ ...f, reminder_type: v }))}
                      className="qk-btn qk-btn-sm"
                      style={{ background: form.reminder_type===v ? 'rgba(99,102,241,0.15)' : 'rgba(255,255,255,0.04)', border: `1px solid ${form.reminder_type===v ? 'rgba(99,102,241,0.4)' : 'rgba(255,255,255,0.08)'}`, color: form.reminder_type===v ? '#a5b4fc' : '#475569' }}
                    >{l}</button>
                  ))}
                </div>
              </label>

              <label style={{ display: 'block', marginBottom: 14 }}>
                <span style={{ fontSize: 11, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Date & Time</span>
                <input
                  type="datetime-local"
                  value={form.scheduled_for}
                  onChange={e => setForm(f => ({ ...f, scheduled_for: e.target.value }))}
                  className="qk-input"
                  style={{ marginTop: 8 }}
                />
              </label>

              <label style={{ display: 'block', marginBottom: 16 }}>
                <span style={{ fontSize: 11, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Repeat</span>
                <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                  {RECURRENCE.map(r => (
                    <button key={r} type="button" onClick={() => setForm(f => ({ ...f, recurrence: r }))}
                      className="qk-btn qk-btn-sm"
                      style={{
                        background: form.recurrence === r ? 'rgba(59,130,246,0.15)' : 'rgba(255,255,255,0.04)',
                        border: `1px solid ${form.recurrence === r ? 'rgba(59,130,246,0.4)' : 'rgba(255,255,255,0.08)'}`,
                        color: form.recurrence === r ? '#93c5fd' : '#475569',
                      }}
                    >
                      {r === 'none' ? 'No repeat' : r.charAt(0).toUpperCase() + r.slice(1)}
                    </button>
                  ))}
                </div>
              </label>

              {/* Active toggle */}
              <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20, cursor: 'pointer' }}>
                <div
                  onClick={() => setForm(f => ({ ...f, is_active: !f.is_active }))}
                  style={{
                    width: 42, height: 24, borderRadius: 12,
                    background: form.is_active ? '#f59e0b' : 'rgba(255,255,255,0.1)',
                    position: 'relative', transition: 'background 0.2s', flexShrink: 0,
                  }}
                >
                  <div style={{
                    position: 'absolute', top: 3,
                    left: form.is_active ? 21 : 3,
                    width: 18, height: 18, borderRadius: '50%', background: '#fff',
                    transition: 'left 0.2s', boxShadow: '0 1px 4px rgba(0,0,0,0.3)',
                  }} />
                </div>
                <span style={{ fontSize: 13, color: '#64748b' }}>Active (send notification)</span>
              </label>

              {error && <p style={{ margin: '0 0 12px', fontSize: 12, color: '#f87171', background: 'rgba(239,68,68,0.08)', padding: '8px 12px', borderRadius: 8, border: '1px solid rgba(239,68,68,0.2)' }}>{error}</p>}

              <button
                onClick={saveReminder}
                disabled={saving}
                className="qk-btn qk-btn-primary"
                style={{ width: '100%', justifyContent: 'center', padding: 14 }}
              >
                {saving ? 'Saving…' : editItem ? 'Save Changes' : 'Add Reminder'}
              </button>
            </div>
          </div>
        )}

        <style>{`textarea::placeholder,input::placeholder{color:#475569}`}</style>
      </div>
    </div>
  );
}
