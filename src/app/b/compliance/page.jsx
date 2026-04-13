'use client';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/context/auth';
// src/app/b/compliance/page.jsx — GST, IT, licences, renewals compliance tracker

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import BizNavbar from '@/components/biz/BizNavbar';
const G = '#10b981';

const COMPLIANCE_TYPES = {
  gst_return:      { label: 'GST Return', icon: '🧾', color: '#6366f1', freq: 'monthly' },
  tds:             { label: 'TDS Payment', icon: '💸', color: '#f59e0b', freq: 'monthly' },
  pf_payment:      { label: 'PF Payment', icon: '👥', color: '#3b82f6', freq: 'monthly' },
  esic:            { label: 'ESIC Payment', icon: '🏥', color: '#3b82f6', freq: 'monthly' },
  it_return:       { label: 'IT Return', icon: '📊', color: '#8b5cf6', freq: 'annual' },
  advance_tax:     { label: 'Advance Tax', icon: '💰', color: '#f59e0b', freq: 'quarterly' },
  gst_annual:      { label: 'GST Annual Return', icon: '📋', color: '#6366f1', freq: 'annual' },
  mca_filing:      { label: 'MCA/ROC Filing', icon: '🏛️', color: '#64748b', freq: 'annual' },
  trade_licence:   { label: 'Trade Licence', icon: '📜', color: '#22c55e', freq: 'annual' },
  fssai:           { label: 'FSSAI Licence', icon: '🍽️', color: '#f97316', freq: 'annual' },
  fire_noc:        { label: 'Fire NOC', icon: '🔥', color: '#ef4444', freq: 'annual' },
  drug_licence:    { label: 'Drug Licence', icon: '💊', color: '#3b82f6', freq: 'annual' },
  iso_renewal:     { label: 'ISO Renewal', icon: '🏅', color: '#f59e0b', freq: 'annual' },
  insurance:       { label: 'Insurance Renewal', icon: '🛡️', color: '#22c55e', freq: 'annual' },
  rent_agreement:  { label: 'Rent Agreement', icon: '🏠', color: '#64748b', freq: 'annual' },
};

function daysLeft(due) {
  return Math.ceil((new Date(due) - Date.now()) / 86400000);
}
function urgencyColor(days) {
  if (days < 0) return '#ef4444';
  if (days <= 7) return '#ef4444';
  if (days <= 30) return '#f59e0b';
  return G;
}

export default function CompliancePage() {
  const router = useRouter();
  const { user, accessToken, loading: authLoading } = useAuth();
  const [workspace, setWorkspace] = useState(null);
  const [reminders, setReminders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ type: 'gst_return', title: '', due_date: '', amount_estimate: '', assigned_to: '', notes: '', priority: 'high' });
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState('all'); // all, overdue, upcoming

  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.replace('/biz-login'); return; }
    initPage();
  }, [user]);

  async function initPage() {
    setLoadError('');
    try {
      const { data: ws } = await supabase.from('business_workspaces').select('id,business_type,gstin').eq('owner_user_id', user?.id).maybeSingle();
      if (ws) { setWorkspace(ws); await loadData(ws.id); } else { setLoading(false); }
    } catch { setLoadError('Could not load data. Check your connection.'); setLoading(false); }
  }

  const loadData = useCallback(async (wsId) => {
    setLoading(true);
    try {
      const { data } = await supabase.from('compliance_reminders').select('*').eq('workspace_id', wsId).order('due_date', { ascending: true });
      setReminders(data || []);
    } catch { setLoadError('Could not load compliance data.'); }
    setLoading(false);
  }, []);

  async function seedDefaultCompliance(wsId, bizType) {
    const now = new Date();
    const defaults = [];
    // GST monthly returns (GSTR-3B due on 20th)
    for (let i = 0; i < 3; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 20);
      defaults.push({ workspace_id: wsId, type: 'gst_return', title: `GSTR-3B — ${d.toLocaleString('en-IN', {month:'long', year:'numeric'})}`, due_date: d.toISOString().split('T')[0], frequency: 'monthly', priority: 'high', auto_generated: true });
    }
    // PF payment (15th of each month)
    for (let i = 0; i < 3; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 15);
      defaults.push({ workspace_id: wsId, type: 'pf_payment', title: `PF Payment — ${d.toLocaleString('en-IN', {month:'long'})}`, due_date: d.toISOString().split('T')[0], frequency: 'monthly', priority: 'medium', auto_generated: true });
    }
    // IT return (July 31)
    const itYear = now.getMonth() >= 7 ? now.getFullYear() + 1 : now.getFullYear();
    defaults.push({ workspace_id: wsId, type: 'it_return', title: `Income Tax Return FY ${itYear - 1}-${String(itYear).slice(2)}`, due_date: `${itYear}-07-31`, frequency: 'annual', priority: 'critical', auto_generated: true });

    await supabase.from('compliance_reminders').upsert(defaults, { onConflict: 'workspace_id,type,due_date', ignoreDuplicates: true });
    loadData(wsId);
  }

  async function saveReminder() {
    if (!form.due_date || !workspace) return;
    setSaving(true);
    const ct = COMPLIANCE_TYPES[form.type];
    await supabase.from('compliance_reminders').insert({
      workspace_id: workspace.id,
      type: form.type,
      title: form.title || ct?.label || form.type,
      due_date: form.due_date,
      amount_estimate: form.amount_estimate ? parseFloat(form.amount_estimate) : null,
      assigned_to: form.assigned_to || null,
      notes: form.notes || null,
      priority: form.priority,
      frequency: ct?.freq || 'once',
    });
    setSaving(false); setShowAdd(false);
    setForm({ type: 'gst_return', title: '', due_date: '', amount_estimate: '', assigned_to: '', notes: '', priority: 'high' });
    loadData(workspace.id);
  }

  async function markFiled(id) {
    await supabase.from('compliance_reminders').update({ status: 'filed' }).eq('id', id);
    setReminders(prev => prev.map(r => r.id === id ? { ...r, status: 'filed' } : r));
  }

  const filtered = reminders.filter(r => {
    const d = daysLeft(r.due_date);
    if (filter === 'overdue') return d < 0 && r.status === 'pending';
    if (filter === 'upcoming') return d >= 0 && d <= 30 && r.status === 'pending';
    return true;
  });


  async function deleteReminder(id) {
    if (!window.confirm('Delete this compliance reminder?')) return;
    await supabase.from('compliance_reminders').delete().eq('id', id);
    setReminders(prev => prev.filter(r => r.id !== id));
  }

  const overdueCount = reminders.filter(r => daysLeft(r.due_date) < 0 && r.status === 'pending').length;
  const dueSoonCount = reminders.filter(r => { const d = daysLeft(r.due_date); return d >= 0 && d <= 30 && r.status === 'pending'; }).length;

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--bg)', paddingTop: 56, paddingBottom: 'calc(52px + env(safe-area-inset-bottom,0px) + 16px)' }}>
      <BizNavbar />
      <div style={{ maxWidth: 480, margin: '0 auto', padding: '20px 16px' }}>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
          <div><h1 className="qk-h1">⚖️ Compliance</h1><p className="qk-desc">GST, IT, licences, renewals — all in one place</p></div>
          <button onClick={() => setShowAdd(!showAdd)} className="qk-btn qk-btn-primary qk-btn-sm">+ Add</button>
        </div>

        {/* Summary */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginBottom: 12 }}>
          {[
            { label: 'Overdue', value: overdueCount, color: '#ef4444', f: 'overdue' },
            { label: 'Due in 30d', value: dueSoonCount, color: '#f59e0b', f: 'upcoming' },
            { label: 'Total', value: reminders.length, color: 'var(--text-muted)', f: 'all' },
          ].map(s => (
            <div key={s.label} className="qk-card" style={{ padding: '12px', textAlign: 'center', cursor: 'pointer', borderColor: filter === s.f ? s.color : 'var(--border)' }} onClick={() => setFilter(s.f)}>
              <div style={{ fontSize: 20, fontWeight: 800, color: s.color }}>{s.value}</div>
              <div style={{ fontSize: 10, color: 'var(--text-subtle)', textTransform: 'uppercase' }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* Seed defaults */}
        {reminders.length === 0 && !loading && (
          <button onClick={() => seedDefaultCompliance(workspace.id, workspace.business_type)}
            className="qk-btn qk-btn-ghost" style={{ width: '100%', justifyContent: 'center', marginBottom: 14 }}>
            ⚡ Auto-generate GST, PF, IT reminders
          </button>
        )}

        {/* Add form */}
        {showAdd && (
          <div className="qk-card" style={{ padding: 16, marginBottom: 16, borderColor: '#6366f1' }}>
            <div style={{ marginBottom: 8 }}>
              <label className="qk-lbl">Compliance type</label>
              <select value={form.type} onChange={e => setForm(p => ({...p, type: e.target.value, title: COMPLIANCE_TYPES[e.target.value]?.label || ''}))} className="qk-input" style={{ marginTop: 4 }}>
                {Object.entries(COMPLIANCE_TYPES).map(([k,v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
              </select>
            </div>
            {[
              { label: 'Custom title (optional)', key: 'title', type: 'text', ph: COMPLIANCE_TYPES[form.type]?.label || '' },
              { label: 'Due date *', key: 'due_date', type: 'date', ph: '' },
              { label: 'Amount estimate (₹)', key: 'amount_estimate', type: 'number', ph: '0' },
              { label: 'Assigned to (CA/person)', key: 'assigned_to', type: 'text', ph: 'CA Suresh' },
            ].map(f => (
              <div key={f.key} style={{ marginBottom: 8 }}>
                <label className="qk-lbl">{f.label}</label>
                <input type={f.type} value={form[f.key]} onChange={e => setForm(p => ({...p, [f.key]: e.target.value}))} placeholder={f.ph} className="qk-input" style={{ marginTop: 4 }} />
              </div>
            ))}
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <button onClick={saveReminder} disabled={saving} className="qk-btn qk-btn-primary" style={{ flex: 1, justifyContent: 'center' }}>{saving ? 'Saving...' : '+ Add Reminder'}</button>
              <button onClick={() => setShowAdd(false)} className="qk-btn qk-btn-ghost">Cancel</button>
            </div>
          </div>
        )}

        {loadError ? <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:12, padding:40 }}><div style={{ color:'#ef4444', fontSize:13 }}>{loadError}</div><button onClick={initPage} style={{ padding:'8px 16px', borderRadius:8, border:'none', background:G, color:'#fff', fontSize:13, fontWeight:600, cursor:'pointer' }}>Retry</button></div>
        : loading ? <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}><div className="qk-spinner" /></div>
        : filtered.length === 0 ? (
          <div className="qk-empty"><div className="qk-empty-icon">⚖️</div><div className="qk-empty-title">No compliance reminders</div><div className="qk-empty-sub">Add GST, IT, licence reminders to stay compliant</div></div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {filtered.map(r => {
              const ct = COMPLIANCE_TYPES[r.type] || { icon: '⚖️', color: '#64748b', label: r.type };
              const days = daysLeft(r.due_date);
              const uc = urgencyColor(days);
              const filed = r.status === 'filed';
              return (
                <div key={r.id} className="qk-card" style={{ padding: '13px 14px', opacity: filed ? 0.6 : 1, borderLeft: `3px solid ${filed ? 'var(--border)' : uc}` }}>
                  <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                    <span style={{ fontSize: 20, flexShrink: 0 }}>{ct.icon}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: filed ? 'var(--text-subtle)' : 'var(--text)', textDecoration: filed ? 'line-through' : 'none' }}>{r.title}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 3, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <span>Due: {new Date(r.due_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                        {r.amount_estimate && <span>≈ ₹{parseFloat(r.amount_estimate).toLocaleString('en-IN')}</span>}
                        {r.assigned_to && <span>👤 {r.assigned_to}</span>}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      {filed ? (
                        <span className="qk-badge qk-badge-accent">✓ Filed</span>
                      ) : (
                        <>
                          <div style={{ fontSize: 13, fontWeight: 800, color: uc }}>{days < 0 ? `${Math.abs(days)}d overdue` : days === 0 ? 'Due today' : `${days}d left`}</div>
                          <div style={{ display: 'flex', gap: 5, marginTop: 6 }}>
                          <button onClick={() => markFiled(r.id)} className="qk-btn qk-btn-sm" style={{ background: `${G}15`, border: `1px solid ${G}40`, color: G, fontSize: 11, padding: '4px 10px' }}>
                            ✓ Mark filed
                          </button>
                          <button onClick={() => deleteReminder(r.id)} className="qk-btn qk-btn-sm" style={{ background: 'var(--red-dim)', border: '1px solid rgba(220,38,38,0.2)', color: 'var(--red)', fontSize: 11, padding: '4px 10px' }}>
                            🗑️ Delete
                          </button>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
                                                       }
