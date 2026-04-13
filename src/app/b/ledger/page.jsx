'use client';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/context/auth';
import { apiPost, apiGet } from '@/lib/safeFetch';
// src/app/b/ledger/page.jsx — Voice-first business ledger with edit + delete

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import BizNavbar from '@/components/biz/BizNavbar';

const G = '#10b981';
const CATS = ['sales','purchase','expense','salary','rent','utilities','tax','loan','investment','other'];
const EMPTY = { entry_type: 'credit', party_name: '', amount: '', description: '', category: 'sales', payment_method: 'cash', payment_status: 'paid', transaction_date: new Date().toISOString().split('T')[0] };

export default function LedgerPage() {
  const router = useRouter();
  const { user, accessToken, loading: authLoading } = useAuth();
  const [workspace, setWorkspace]   = useState(null);
  const [permissions, setPermissions] = useState({});     // v2: RBAC
  const [entries, setEntries]       = useState([]);
  const [loading, setLoading]       = useState(true);
  const [showForm, setShowForm]     = useState(false);
  const [editEntry, setEditEntry]   = useState(null);
  const [filter, setFilter]         = useState('all');
  const [form, setForm]             = useState(EMPTY);
  const [saving, setSaving]         = useState(false);
  const [deleting, setDeleting]     = useState(null);
  const [listening, setListening]   = useState(false);
  const [voiceMsg, setVoiceMsg]     = useState('');       // v2: voice feedback
  const [summary, setSummary]       = useState({ totalCredit: 0, totalDebit: 0, pending: 0 });

  // v2: canDo — checks RBAC permissions fetched from /api/business/permissions
  // Falls back to allow-all if permissions not loaded (backward-compatible)
  function canDo(resource, action) {
    if (!permissions || Object.keys(permissions).length === 0) return true; // allow if not loaded
    return permissions?.[resource]?.[action] === true;
  }

  useEffect(() => {
    if (authLoading) return; // wait for auth context to resolve
    if (!user) { router.replace('/biz-login'); return; }
    (async () => {
            const { data: ws } = await supabase.from('business_workspaces').select('id').eq('owner_user_id', user?.id).maybeSingle();
            if (ws) {
              setWorkspace(ws);
              loadEntries(ws.id);
              // v2: load RBAC permissions (non-blocking, fail-safe)
              apiGet('/api/business/permissions', accessToken)
                .then(({ data: d }) => { if (d?.permissions) setPermissions(d.permissions); })
                .catch(() => {}); // permissions fail → canDo returns true (allow-all fallback)
            }
    })();
  }, [user]);

  const loadEntries = useCallback(async (wsId) => {
    setLoading(true);
    const { data } = await supabase.from('business_ledger').select('*').eq('workspace_id', wsId)
      .order('transaction_date', { ascending: false }).order('created_at', { ascending: false }).limit(100);
    const d = data || [];
    setEntries(d);
    setSummary({
      totalCredit: d.filter(e => e.entry_type === 'credit').reduce((s,e) => s + parseFloat(e.amount), 0),
      totalDebit:  d.filter(e => e.entry_type === 'debit').reduce((s,e)  => s + parseFloat(e.amount), 0),
      pending:     d.filter(e => e.payment_status === 'pending').reduce((s,e) => s + parseFloat(e.amount_pending||0), 0),
    });
    setLoading(false);
  }, []);

  function openAdd() { setEditEntry(null); setForm(EMPTY); setShowForm(true); }

  function openEdit(e) {
    setEditEntry(e);
    setForm({ entry_type: e.entry_type, party_name: e.party_name||'', amount: String(e.amount), description: e.description||'', category: e.category||'sales', payment_method: e.payment_method||'cash', payment_status: e.payment_status||'paid', transaction_date: e.transaction_date||new Date().toISOString().split('T')[0] });
    setShowForm(true);
  }

  async function saveEntry() {
    if (!form.amount || !workspace) return;
    setSaving(true);
    const payload = { ...form, amount: parseFloat(form.amount) };
    if (editEntry) {
      await supabase.from('business_ledger').update(payload).eq('id', editEntry.id);
    } else {
      await supabase.from('business_ledger').insert({ workspace_id: workspace.id, ...payload });
    }
    setSaving(false); setShowForm(false); setEditEntry(null); setForm(EMPTY);
    loadEntries(workspace.id);
  }

  async function deleteEntry(id) {
    if (!window.confirm('Delete this entry? This cannot be undone.')) return;
    setDeleting(id);
    await supabase.from('business_ledger').delete().eq('id', id);
    setEntries(prev => prev.filter(e => e.id !== id));
    setDeleting(null);
  }

  function startVoice() {
    // v2: Records transcript via browser STT, then routes through /api/voice/capture
    // with workspace_id → full intent pipeline (business-resolver + ledger INSERT).
    // On API success → refreshes entries. On any failure → falls back to form pre-fill.
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { alert('Voice not supported in this browser'); return; }
    const r = new SR(); r.lang = 'en-IN'; r.continuous = false;
    r.onresult = async e => {
      const t = e.results[0][0].transcript;
      setListening(false);
      if (!t.trim() || !workspace || !accessToken) {
        // Pre-fill form as fallback
        const entryType = /paid me|received|sale|collected/i.test(t.toLowerCase()) ? 'credit' : 'debit';
        const amt   = t.match(/[₹]?\s*(\d+[\d,]*)/);
        const party = t.match(/(?:from|to|by|for)\s+([A-Za-z]+)/i);
        setForm(f => ({ ...f, description: t, entry_type: entryType, amount: amt ? amt[1].replace(',','') : f.amount, party_name: party ? party[1] : f.party_name }));
        setShowForm(true);
        return;
      }
      // Route through voice/capture with workspace_id
      try {
        const { data: res, error: resErr } = await apiPost('/api/voice/capture', {
          transcript: t.trim(), source: 'voice', workspace_id: workspace.id, language: 'en-IN',
        }, accessToken);
        if (!resErr && res) {
          const data = res;
          const biz  = data.biz_entry;
          const msg  = biz?.amount
            ? `✓ ${biz.entry_type === 'credit' ? 'Income' : 'Expense'} \u20b9${biz.amount.toLocaleString('en-IN')} recorded`
            : (data.tts_response || '✓ Entry saved');
          setVoiceMsg(msg);
          setTimeout(() => setVoiceMsg(''), 3500);
          loadEntries(workspace.id);
        } else {
          // API error → pre-fill form so user can manually confirm
          const entryType = /paid me|received|sale|collected/i.test(t.toLowerCase()) ? 'credit' : 'debit';
          const amt   = t.match(/[₹]?\s*(\d+[\d,]*)/);
          const party = t.match(/(?:from|to|by|for)\s+([A-Za-z]+)/i);
          setForm(f => ({ ...f, description: t, entry_type: entryType, amount: amt ? amt[1].replace(',','') : f.amount, party_name: party ? party[1] : f.party_name }));
          setShowForm(true);
        }
      } catch {
        // Network error → pre-fill form (original behaviour preserved)
        const entryType = /paid me|received|sale|collected/i.test(t.toLowerCase()) ? 'credit' : 'debit';
        const amt   = t.match(/[₹]?\s*(\d+[\d,]*)/);
        const party = t.match(/(?:from|to|by|for)\s+([A-Za-z]+)/i);
        setForm(f => ({ ...f, description: t, entry_type: entryType, amount: amt ? amt[1].replace(',','') : f.amount, party_name: party ? party[1] : f.party_name }));
        setShowForm(true);
      }
    };
    r.onerror = () => setListening(false);
    r.onend   = () => setListening(false);
    r.start(); setListening(true);
  }

  const filtered = entries.filter(e => filter === 'all' || e.entry_type === filter);

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--bg)', paddingTop: 56, paddingBottom: 'calc(52px + env(safe-area-inset-bottom,0px) + 16px)' }}>
      <BizNavbar />
      <div style={{ maxWidth: 480, margin: '0 auto', padding: '20px 16px' }}>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
          <div><h1 className="qk-h1">Khata / Ledger</h1><p className="qk-desc">Voice-first income and expense tracking</p></div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={startVoice} className="qk-btn qk-btn-sm"
              style={{ background: listening ? G : 'var(--primary-dim)', border: '1px solid ' + (listening ? G : 'var(--primary-glow)'), color: listening ? '#fff' : 'var(--primary)' }}>
              {listening ? 'Listening...' : 'Voice'}
            </button>
            <button onClick={openAdd} className="qk-btn qk-btn-primary qk-btn-sm">+ Add</button>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginBottom: 16 }}>
          {[
            { label: 'Total Income',  value: 'Rs.' + summary.totalCredit.toLocaleString('en-IN'), color: G },
            { label: 'Total Expense', value: 'Rs.' + summary.totalDebit.toLocaleString('en-IN'),  color: '#ef4444' },
            { label: 'Net Profit',    value: 'Rs.' + (summary.totalCredit - summary.totalDebit).toLocaleString('en-IN'), color: summary.totalCredit >= summary.totalDebit ? G : '#ef4444' },
          ].map(s => (
            <div key={s.label} className="qk-card" style={{ padding: '12px', textAlign: 'center' }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: s.color }}>{s.value}</div>
              <div style={{ fontSize: 9, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{s.label}</div>
            </div>
          ))}
        </div>

        {showForm && (
          <div className="qk-card" style={{ padding: 16, marginBottom: 16, borderColor: G }}>
            <h3 style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 12 }}>
              {editEntry ? 'Edit Entry' : 'New Entry'}
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
              {[['credit','Income', G], ['debit','Expense','#ef4444']].map(([v,l,c]) => (
                <button key={v} onClick={() => setForm(f => ({...f, entry_type: v}))} className="qk-btn qk-btn-sm"
                  style={{ justifyContent: 'center', background: form.entry_type === v ? c + '20' : 'transparent', border: '1.5px solid ' + (form.entry_type === v ? c : 'var(--border)'), color: form.entry_type === v ? c : 'var(--text-muted)' }}>
                  {l}
                </button>
              ))}
            </div>
            {[
              { label: 'Amount (Rs.) *',   key: 'amount',           type: 'number', ph: '0' },
              { label: 'Party / Person',   key: 'party_name',       type: 'text',   ph: 'Customer or vendor name' },
              { label: 'Description',      key: 'description',      type: 'text',   ph: 'What is this for?' },
              { label: 'Date',             key: 'transaction_date', type: 'date',   ph: '' },
            ].map(f => (
              <div key={f.key} style={{ marginBottom: 8 }}>
                <label className="qk-lbl">{f.label}</label>
                <input type={f.type} value={form[f.key]} onChange={e => setForm(p => ({...p, [f.key]: e.target.value}))} placeholder={f.ph} className="qk-input" style={{ marginTop: 4 }} />
              </div>
            ))}
            <div style={{ marginBottom: 8 }}>
              <label className="qk-lbl">Category</label>
              <select value={form.category} onChange={e => setForm(p => ({...p, category: e.target.value}))} className="qk-input" style={{ marginTop: 4 }}>
                {CATS.map(c => <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>)}
              </select>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
              <div>
                <label className="qk-lbl">Payment</label>
                <select value={form.payment_method} onChange={e => setForm(p => ({...p, payment_method: e.target.value}))} className="qk-input" style={{ marginTop: 4 }}>
                  {['cash','upi','card','bank','cheque','credit'].map(m => <option key={m} value={m}>{m.toUpperCase()}</option>)}
                </select>
              </div>
              <div>
                <label className="qk-lbl">Status</label>
                <select value={form.payment_status} onChange={e => setForm(p => ({...p, payment_status: e.target.value}))} className="qk-input" style={{ marginTop: 4 }}>
                  {['paid','pending','partial','overdue'].map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase()+s.slice(1)}</option>)}
                </select>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={saveEntry} disabled={saving} className="qk-btn qk-btn-primary" style={{ flex: 1, justifyContent: 'center' }}>
                {saving ? 'Saving...' : editEntry ? 'Update' : 'Save'}
              </button>
              <button onClick={() => { setShowForm(false); setEditEntry(null); setForm(EMPTY); }} className="qk-btn qk-btn-ghost">Cancel</button>
            </div>
          </div>
        )}

        {voiceMsg && (
          <div style={{ color: '#10b981', fontWeight: 700, fontSize: 13, marginBottom: 10, padding: '8px 12px', background: 'rgba(16,185,129,0.1)', borderRadius: 8, border: '1px solid rgba(16,185,129,0.25)' }}>{voiceMsg}</div>
        )}
        <div className="qk-tabs" style={{ marginBottom: 12 }}>
          {[['all','All'],['credit','Income'],['debit','Expense']].map(([v,l]) => (
            <button key={v} onClick={() => setFilter(v)} className={'qk-tab' + (filter===v?' active':'')}>{l}</button>
          ))}
        </div>

        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}><div className="qk-spinner" /></div>
        ) : filtered.length === 0 ? (
          <div className="qk-empty">
            <div className="qk-empty-icon">📒</div>
            <div className="qk-empty-title">No entries yet</div>
            <div className="qk-empty-sub">Tap + Add or use Voice to record a transaction</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {filtered.map(e => (
              <div key={e.id} className="qk-card"
                style={{ padding: '13px 14px', display: 'flex', gap: 12, alignItems: 'center', borderLeft: '3px solid ' + (e.entry_type === 'credit' ? G : '#ef4444'), opacity: deleting === e.id ? 0.4 : 1 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 3 }}>
                    {e.party_name || e.description || 'Entry'}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-subtle)', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <span>{e.category}</span><span>·</span>
                    <span>{(e.payment_method||'').toUpperCase()}</span><span>·</span>
                    <span>{e.transaction_date}</span>
                    {e.payment_status !== 'paid' && <span style={{ color: '#f59e0b', fontWeight: 600 }}>⚠ {e.payment_status}</span>}
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 5, flexShrink: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 800, color: e.entry_type === 'credit' ? G : '#ef4444' }}>
                    {e.entry_type === 'credit' ? '+' : '-'}Rs.{parseFloat(e.amount).toLocaleString('en-IN')}
                  </div>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button onClick={() => openEdit(e)} className="qk-btn qk-btn-ghost qk-btn-sm" style={{ padding: '3px 8px', fontSize: 11 }}>Edit</button>
                    {canDo('ledger','delete') && (
                    <button onClick={() => deleteEntry(e.id)} disabled={deleting === e.id} className="qk-btn qk-btn-sm"
                      style={{ padding: '3px 8px', fontSize: 11, background: 'var(--red-dim)', border: '1px solid rgba(220,38,38,0.2)', color: 'var(--red)' }}>
                      Del
                    </button>)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
            }
