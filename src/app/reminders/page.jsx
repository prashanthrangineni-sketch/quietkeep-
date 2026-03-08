'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import NavbarClient from '@/components/NavbarClient';

const RECURRENCE = ['none', 'daily', 'weekly', 'monthly'];

function fmt(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function isOverdue(ts) {
  return ts && new Date(ts) < new Date();
}

function isSoon(ts) {
  if (!ts) return false;
  const diff = new Date(ts) - new Date();
  return diff > 0 && diff < 24 * 60 * 60 * 1000;
}

const EMPTY_FORM = { reminder_text: '', scheduled_for: '', recurrence: 'none', is_active: true };

export default function RemindersPage() {
  const [user, setUser] = useState(null);
  const [reminders, setReminders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('active'); // active | all | done

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) { setUser(user); loadReminders(user.id); }
    });
  }, []);

  async function loadReminders(uid) {
    setLoading(true);
    const { data } = await supabase
      .from('reminders')
      .select('*')
      .eq('user_id', uid)
      .order('scheduled_for', { ascending: true });
    setReminders(data || []);
    setLoading(false);
  }

  function openAdd() {
    setEditItem(null);
    // Default to 1 hour from now
    const d = new Date(Date.now() + 60 * 60 * 1000);
    const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000)
      .toISOString().slice(0, 16);
    setForm({ ...EMPTY_FORM, scheduled_for: local });
    setError('');
    setShowForm(true);
  }

  function openEdit(r) {
    setEditItem(r);
    const d = new Date(r.scheduled_for);
    const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000)
      .toISOString().slice(0, 16);
    setForm({
      reminder_text: r.reminder_text || '',
      scheduled_for: local,
      recurrence: r.recurrence || 'none',
      is_active: r.is_active !== false,
    });
    setError('');
    setShowForm(true);
  }

  async function saveReminder() {
    if (!form.reminder_text.trim()) return setError('Reminder text is required');
    if (!form.scheduled_for) return setError('Please set a date and time');
    setSaving(true);
    setError('');

    const payload = {
      user_id: user.id,
      reminder_text: form.reminder_text.trim(),
      scheduled_for: new Date(form.scheduled_for).toISOString(),
      recurrence: form.recurrence === 'none' ? null : form.recurrence,
      is_active: form.is_active,
    };

    let err;
    if (editItem) {
      ({ error: err } = await supabase.from('reminders').update(payload).eq('id', editItem.id));
    } else {
      ({ error: err } = await supabase.from('reminders').insert(payload));
    }
    setSaving(false);
    if (err) return setError(err.message);
    setShowForm(false);
    loadReminders(user.id);
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
    <div style={{ minHeight: '100vh', background: '#0d0a14', color: '#f0f0f5', fontFamily: "'DM Sans', -apple-system, sans-serif", paddingBottom: '80px' }}>
      <NavbarClient />

      {/* Header */}
      <div style={{ background: 'linear-gradient(135deg, #0d0a18, #100d1a)', borderBottom: '1px solid rgba(251,191,36,0.15)', padding: '20px 16px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
              <span style={{ fontSize: '22px' }}>⏰</span>
              <h1 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: '#fff', letterSpacing: '-0.3px' }}>Reminders</h1>
              {overdueCount > 0 && (
                <span style={{ fontSize: '11px', background: 'rgba(248,113,113,0.25)', color: '#f87171', padding: '2px 8px', borderRadius: '10px', fontWeight: 600 }}>
                  {overdueCount} overdue
                </span>
              )}
            </div>
            <p style={{ margin: 0, fontSize: '13px', color: 'rgba(255,255,255,0.4)' }}>
              {reminders.filter(r => r.is_active).length} active reminder{reminders.filter(r => r.is_active).length !== 1 ? 's' : ''}
            </p>
          </div>
          <button
            onClick={openAdd}
            style={{ padding: '9px 16px', background: 'rgba(251,191,36,0.2)', border: '1px solid rgba(251,191,36,0.4)', borderRadius: '10px', color: '#fbbf24', fontSize: '13px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
          >
            + Add
          </button>
        </div>
      </div>

      {/* Filter tabs */}
      <div style={{ display: 'flex', gap: '6px', padding: '12px 16px' }}>
        {[['active', 'Active'], ['all', 'All'], ['done', 'Inactive']].map(([val, lbl]) => (
          <button key={val} onClick={() => setFilter(val)}
            style={{
              padding: '6px 16px', borderRadius: '20px', fontSize: '12px', fontWeight: 500,
              background: filter === val ? 'rgba(251,191,36,0.2)' : 'rgba(255,255,255,0.05)',
              border: filter === val ? '1px solid rgba(251,191,36,0.4)' : '1px solid rgba(255,255,255,0.1)',
              color: filter === val ? '#fbbf24' : 'rgba(255,255,255,0.5)',
              cursor: 'pointer', fontFamily: 'inherit',
            }}
          >{lbl}</button>
        ))}
      </div>
      {/* Reminders list */}
      <div style={{ padding: '0 16px' }}>
        {loading && <div style={{ textAlign: 'center', padding: '40px', color: 'rgba(255,255,255,0.3)', fontSize: '13px' }}>Loading...</div>}

        {!loading && filtered.length === 0 && (
          <div style={{ textAlign: 'center', padding: '48px 20px', background: 'rgba(255,255,255,0.03)', border: '1px dashed rgba(255,255,255,0.1)', borderRadius: '16px' }}>
            <div style={{ fontSize: '40px', marginBottom: '12px' }}>⏰</div>
            <p style={{ margin: '0 0 6px', fontSize: '15px', color: 'rgba(255,255,255,0.6)', fontWeight: 500 }}>No reminders here</p>
            <p style={{ margin: 0, fontSize: '12px', color: 'rgba(255,255,255,0.3)' }}>Add a reminder to stay on track</p>
          </div>
        )}

        {filtered.map(r => {
          const overdue = r.is_active && isOverdue(r.scheduled_for);
          const soon = r.is_active && isSoon(r.scheduled_for);
          const borderColor = overdue ? '#f87171' : soon ? '#fbbf24' : r.is_active ? 'rgba(251,191,36,0.3)' : 'rgba(255,255,255,0.06)';

          return (
            <div key={r.id} style={{
              background: overdue ? 'rgba(248,113,113,0.07)' : 'rgba(255,255,255,0.04)',
              border: `1px solid ${borderColor}`,
              borderLeft: `3px solid ${overdue ? '#f87171' : soon ? '#fbbf24' : r.is_active ? '#fbbf24' : 'rgba(255,255,255,0.15)'}`,
              borderRadius: '12px', padding: '13px 14px', marginBottom: '8px',
              opacity: r.is_active ? 1 : 0.55,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ flex: 1, marginRight: '10px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '5px' }}>
                    {overdue && <span style={{ fontSize: '10px', color: '#f87171', background: 'rgba(248,113,113,0.15)', padding: '2px 7px', borderRadius: '8px', fontWeight: 600 }}>OVERDUE</span>}
                    {soon && !overdue && <span style={{ fontSize: '10px', color: '#fbbf24', background: 'rgba(251,191,36,0.15)', padding: '2px 7px', borderRadius: '8px', fontWeight: 600 }}>SOON</span>}
                    {r.recurrence && r.recurrence !== 'none' && (
                      <span style={{ fontSize: '10px', color: '#60a5fa', background: 'rgba(96,165,250,0.12)', padding: '2px 7px', borderRadius: '8px' }}>🔁 {r.recurrence}</span>
                    )}
                  </div>
                  <p style={{ margin: '0 0 5px', fontSize: '14px', fontWeight: 500, color: '#fff', lineHeight: '1.4' }}>
                    {r.reminder_text}
                  </p>
                  <p style={{ margin: 0, fontSize: '12px', color: overdue ? '#f87171' : 'rgba(255,255,255,0.4)' }}>
                    📅 {fmt(r.scheduled_for)}
                  </p>
                </div>
                <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
                  {/* Toggle */}
                  <button
                    onClick={() => toggleActive(r)}
                    style={{
                      background: r.is_active ? 'rgba(251,191,36,0.15)' : 'rgba(255,255,255,0.06)',
                      border: r.is_active ? '1px solid rgba(251,191,36,0.3)' : '1px solid rgba(255,255,255,0.1)',
                      borderRadius: '8px', padding: '6px 9px',
                      color: r.is_active ? '#fbbf24' : 'rgba(255,255,255,0.35)',
                      cursor: 'pointer', fontSize: '13px',
                    }}
                  >{r.is_active ? '✓' : '○'}</button>
                  <button onClick={() => openEdit(r)}
                    style={{ background: 'rgba(255,255,255,0.06)', border: 'none', borderRadius: '8px', padding: '6px 9px', color: 'rgba(255,255,255,0.4)', cursor: 'pointer', fontSize: '12px' }}>
                    ✏️
                  </button>
                  <button onClick={() => deleteReminder(r.id)}
                    style={{ background: 'rgba(255,60,60,0.08)', border: 'none', borderRadius: '8px', padding: '6px 9px', color: 'rgba(255,80,80,0.6)', cursor: 'pointer', fontSize: '12px' }}>
                    🗑️
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Form modal */}
      {showForm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.78)', display: 'flex', alignItems: 'flex-end', zIndex: 100 }}
          onClick={e => { if (e.target === e.currentTarget) setShowForm(false); }}>
          <div style={{ background: '#141018', borderRadius: '20px 20px 0 0', padding: '20px 20px 36px', width: '100%', maxWidth: '480px', margin: '0 auto', border: '1px solid rgba(255,255,255,0.08)', maxHeight: '85vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px' }}>
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: '#fff' }}>{editItem ? 'Edit Reminder' : 'New Reminder'}</h3>
              <button onClick={() => setShowForm(false)} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', fontSize: '20px', cursor: 'pointer' }}>✕</button>
            </div>

            <label style={{ display: 'block', marginBottom: '14px' }}>
              <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>What to remind</span>
              <textarea
                value={form.reminder_text}
                onChange={e => setForm(f => ({ ...f, reminder_text: e.target.value }))}
                placeholder="e.g. Call the doctor, Pay electricity bill..."
                rows={2}
                style={{ display: 'block', width: '100%', marginTop: '6px', padding: '10px 12px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '10px', color: '#fff', fontSize: '14px', fontFamily: 'inherit', outline: 'none', resize: 'vertical', boxSizing: 'border-box' }}
              />
            </label>

            <label style={{ display: 'block', marginBottom: '14px' }}>
              <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Date & Time</span>
              <input
                type="datetime-local"
                value={form.scheduled_for}
                onChange={e => setForm(f => ({ ...f, scheduled_for: e.target.value }))}
                style={{ display: 'block', width: '100%', marginTop: '6px', padding: '10px 12px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '10px', color: '#fff', fontSize: '14px', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box', colorScheme: 'dark' }}
              />
            </label>

            <label style={{ display: 'block', marginBottom: '16px' }}>
              <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Repeat</span>
              <div style={{ display: 'flex', gap: '6px', marginTop: '8px', flexWrap: 'wrap' }}>
                {RECURRENCE.map(r => (
                  <button key={r} type="button" onClick={() => setForm(f => ({ ...f, recurrence: r }))}
                    style={{
                      padding: '6px 14px', borderRadius: '20px', fontSize: '12px', cursor: 'pointer', fontFamily: 'inherit',
                      background: form.recurrence === r ? 'rgba(96,165,250,0.2)' : 'rgba(255,255,255,0.05)',
                      border: form.recurrence === r ? '1px solid rgba(96,165,250,0.5)' : '1px solid rgba(255,255,255,0.1)',
                      color: form.recurrence === r ? '#60a5fa' : 'rgba(255,255,255,0.45)',
                    }}
                  >{r === 'none' ? 'No repeat' : r.charAt(0).toUpperCase() + r.slice(1)}</button>
                ))}
              </div>
            </label>

            {/* Active toggle */}
            <label style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px', cursor: 'pointer' }}>
              <div onClick={() => setForm(f => ({ ...f, is_active: !f.is_active }))}
                style={{ width: '42px', height: '24px', borderRadius: '12px', background: form.is_active ? 'rgba(251,191,36,0.6)' : 'rgba(255,255,255,0.1)', position: 'relative', transition: 'background 0.2s', flexShrink: 0 }}>
                <div style={{ position: 'absolute', top: '3px', left: form.is_active ? '21px' : '3px', width: '18px', height: '18px', borderRadius: '50%', background: '#fff', transition: 'left 0.2s', boxShadow: '0 1px 4px rgba(0,0,0,0.3)' }} />
              </div>
              <span style={{ fontSize: '13px', color: 'rgba(255,255,255,0.6)' }}>Active (send notification)</span>
            </label>

            {error && <p style={{ margin: '0 0 12px', fontSize: '12px', color: '#f87171', background: 'rgba(248,113,113,0.1)', padding: '8px 12px', borderRadius: '8px' }}>{error}</p>}

            <button onClick={saveReminder} disabled={saving}
              style={{ width: '100%', padding: '13px', background: saving ? 'rgba(251,191,36,0.2)' : 'linear-gradient(135deg,rgba(251,191,36,0.4),rgba(217,119,6,0.4))', border: '1px solid rgba(251,191,36,0.4)', borderRadius: '12px', color: '#fff', fontSize: '14px', fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}>
              {saving ? 'Saving...' : editItem ? 'Save Changes' : 'Add Reminder'}
            </button>
          </div>
        </div>
      )}

      <style>{`
        textarea::placeholder, input::placeholder { color: rgba(255,255,255,0.25); }
        input[type="datetime-local"]::-webkit-calendar-picker-indicator { filter: invert(0.7); }
      `}</style>
    </div>
  );
}
