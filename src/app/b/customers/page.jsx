'use client';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/context/auth';
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import BizNavbar from '@/components/biz/BizNavbar';
const G = '#10b981';

const EMPTY = { name:'', phone:'', email:'', gstin:'', address:'', notes:'', credit_limit:'0' };

export default function CustomersPage() {
  const router = useRouter();
  const { user, accessToken, loading: authLoading } = useAuth();
  const [workspace, setWorkspace] = useState(null);
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editCustomer, setEditCustomer] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (authLoading) return; // wait for auth context to resolve
    if (!user) { router.replace('/biz-login'); return; }
    (async () => {
            const { data: ws } = await supabase.from('business_workspaces').select('id,name').eq('owner_user_id', user?.id).maybeSingle();
            if (ws) { setWorkspace(ws); loadCustomers(ws.id); }
    })();
  }, [user]);

  const loadCustomers = useCallback(async (wsId) => {
    setLoading(true);
    const { data } = await supabase.from('business_customers').select('*').eq('workspace_id', wsId).order('name');
    setCustomers(data || []);
    setLoading(false);
  }, []);

  function openAdd() {
    setEditCustomer(null);
    setForm(EMPTY);
    setShowForm(true);
  }

  function openEdit(c) {
    setEditCustomer(c);
    setForm({
      name: c.name || '',
      phone: c.phone || '',
      email: c.email || '',
      gstin: c.gstin || '',
      address: c.address || '',
      notes: c.notes || '',
      credit_limit: String(c.credit_limit || '0'),
    });
    setShowForm(true);
    setSelected(null);
  }

  async function saveCustomer() {
    if (!form.name || !workspace) return;
    setSaving(true);
    const payload = { ...form, credit_limit: parseFloat(form.credit_limit) || 0 };
    if (editCustomer) {
      await supabase.from('business_customers').update(payload).eq('id', editCustomer.id);
    } else {
      await supabase.from('business_customers').insert({ workspace_id: workspace.id, ...payload });
    }
    setSaving(false);
    setShowForm(false);
    setEditCustomer(null);
    setForm(EMPTY);
    loadCustomers(workspace.id);
  }

  async function deleteCustomer(id, name) {
    if (!window.confirm('Delete customer "' + name + '"? Their invoice history will be retained.')) return;
    await supabase.from('business_customers').delete().eq('id', id);
    setCustomers(prev => prev.filter(c => c.id !== id));
    setSelected(null);
  }

  const filtered = customers.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) || (c.phone || '').includes(search)
  );
  const totalOutstanding = customers.reduce((s, c) => s + (parseFloat(c.outstanding_balance) || 0), 0);

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--bg)', paddingTop: 56, paddingBottom: 'calc(52px + env(safe-area-inset-bottom,0px) + 16px)' }}>
      <BizNavbar />
      <div style={{ maxWidth: 480, margin: '0 auto', padding: '20px 16px' }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
          <div><h1 className="qk-h1">Customers</h1><p className="qk-desc">CRM with credit tracking and WhatsApp reminders</p></div>
          <button onClick={openAdd} className="qk-btn qk-btn-primary qk-btn-sm">+ Add</button>
        </div>

        {/* Outstanding banner */}
        {totalOutstanding > 0 && (
          <div className="qk-card" style={{ padding: '12px 14px', marginBottom: 12, background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)' }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#f59e0b' }}>
              Total Outstanding: Rs.{totalOutstanding.toLocaleString('en-IN')}
            </span>
          </div>
        )}

        {/* Search */}
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search customers..."
          className="qk-input"
          style={{ marginBottom: 12 }}
        />

        {/* Add / Edit form */}
        {showForm && (
          <div className="qk-card" style={{ padding: 16, marginBottom: 12, borderColor: G }}>
            <h3 style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 12 }}>
              {editCustomer ? 'Edit Customer' : 'New Customer'}
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {[
                { label: 'Name *',            key: 'name',         type: 'text',   ph: 'Customer name',    full: true },
                { label: 'Phone',             key: 'phone',        type: 'tel',    ph: '98765...' },
                { label: 'Email',             key: 'email',        type: 'email',  ph: 'email@example.com' },
                { label: 'GSTIN',             key: 'gstin',        type: 'text',   ph: '29AABCU...' },
                { label: 'Credit limit (Rs)', key: 'credit_limit', type: 'number', ph: '0' },
                { label: 'Address',           key: 'address',      type: 'text',   ph: 'Address',          full: true },
                { label: 'Notes',             key: 'notes',        type: 'text',   ph: 'Any notes',        full: true },
              ].map(f => (
                <div key={f.key} style={{ gridColumn: f.full ? '1/-1' : undefined }}>
                  <label className="qk-lbl">{f.label}</label>
                  <input
                    type={f.type}
                    value={form[f.key]}
                    onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))}
                    placeholder={f.ph}
                    className="qk-input"
                    style={{ marginTop: 4 }}
                  />
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <button onClick={saveCustomer} disabled={saving} className="qk-btn qk-btn-primary" style={{ flex: 1, justifyContent: 'center' }}>
                {saving ? 'Saving...' : editCustomer ? 'Update Customer' : '+ Add Customer'}
              </button>
              <button onClick={() => { setShowForm(false); setEditCustomer(null); setForm(EMPTY); }} className="qk-btn qk-btn-ghost">
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* List */}
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}><div className="qk-spinner" /></div>
        ) : filtered.length === 0 ? (
          <div className="qk-empty">
            <div className="qk-empty-icon">🤝</div>
            <div className="qk-empty-title">No customers yet</div>
            <div className="qk-empty-sub">Add customers to track credit and send WhatsApp reminders</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {filtered.map(c => {
              const outstanding = parseFloat(c.outstanding_balance) || 0;
              const isSelected = selected === c.id;
              return (
                <div key={c.id} className="qk-card" style={{ overflow: 'hidden' }}>

                  {/* Row summary */}
                  <div
                    style={{ padding: '13px 14px', display: 'flex', gap: 12, alignItems: 'center', cursor: 'pointer' }}
                    onClick={() => setSelected(isSelected ? null : c.id)}
                  >
                    <div style={{ width: 38, height: 38, borderRadius: '50%', background: outstanding > 0 ? 'rgba(245,158,11,0.15)' : G + '15', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700, color: outstanding > 0 ? '#f59e0b' : G, flexShrink: 0 }}>
                      {c.name[0].toUpperCase()}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{c.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-subtle)' }}>{c.phone || c.email || 'No contact'}</div>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      {outstanding > 0 ? (
                        <>
                          <div style={{ fontSize: 13, fontWeight: 800, color: '#f59e0b' }}>Rs.{outstanding.toLocaleString('en-IN')}</div>
                          <div style={{ fontSize: 9, color: '#f59e0b' }}>OUTSTANDING</div>
                        </>
                      ) : (
                        <span className="qk-badge qk-badge-accent" style={{ fontSize: 9 }}>Clear</span>
                      )}
                    </div>
                  </div>

                  {/* Expanded detail */}
                  {isSelected && (
                    <div style={{ padding: '0 14px 14px', borderTop: '1px solid var(--border)' }}>

                      {/* Stats grid */}
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, margin: '10px 0', fontSize: 12 }}>
                        {[
                          ['Total business', 'Rs.' + parseFloat(c.total_business || 0).toLocaleString('en-IN')],
                          ['Credit limit',   'Rs.' + parseFloat(c.credit_limit || 0).toLocaleString('en-IN')],
                          ['GSTIN',          c.gstin || '-'],
                          ['Last txn',       c.last_transaction_date ? new Date(c.last_transaction_date).toLocaleDateString('en-IN') : '-'],
                        ].map(([k, v]) => (
                          <div key={k} style={{ background: 'var(--surface-hover)', padding: '6px 10px', borderRadius: 6 }}>
                            <div style={{ color: 'var(--text-subtle)', fontSize: 10 }}>{k}</div>
                            <div style={{ color: 'var(--text)', fontWeight: 600 }}>{v}</div>
                          </div>
                        ))}
                      </div>

                      {/* Notes */}
                      {c.notes && (
                        <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '8px 10px', background: 'var(--surface-hover)', borderRadius: 8, marginBottom: 10 }}>
                          {c.notes}
                        </div>
                      )}

                      {/* Action buttons */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>

                        {/* WhatsApp reminder — only when phone + outstanding */}
                        {c.phone && outstanding > 0 && (
                          <a
                            href={'https://wa.me/' + c.phone.replace(/[^0-9]/g, '') + '?text=' + encodeURIComponent('Dear ' + c.name + ',\n\nThis is a friendly reminder that your outstanding balance is Rs.' + outstanding.toLocaleString('en-IN') + '.\n\nPlease settle at your earliest convenience.\n\nThank you!\n' + (workspace ? workspace.name : ''))}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ display: 'block', textAlign: 'center', padding: '10px', borderRadius: 10, background: 'rgba(37,211,102,0.1)', border: '1px solid rgba(37,211,102,0.3)', color: '#25D366', fontSize: 13, fontWeight: 700, textDecoration: 'none' }}
                          >
                            WhatsApp payment reminder
                          </a>
                        )}

                        {/* Edit + Delete row */}
                        <div style={{ display: 'flex', gap: 8 }}>
                          <button
                            onClick={() => openEdit(c)}
                            className="qk-btn qk-btn-ghost qk-btn-sm"
                            style={{ flex: 1, justifyContent: 'center' }}
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => deleteCustomer(c.id, c.name)}
                            className="qk-btn qk-btn-sm"
                            style={{ flex: 1, justifyContent: 'center', background: 'var(--red-dim)', border: '1px solid rgba(220,38,38,0.2)', color: 'var(--red)' }}
                          >
                            Delete
                          </button>
                        </div>

                      </div>
                    </div>
                  )}

                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
                      }
