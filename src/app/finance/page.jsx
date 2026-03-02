'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import Link from 'next/link';

const CATEGORIES = [
  { value: 'food', label: '🍛 Food', color: '#f59e0b' },
  { value: 'transport', label: '🚗 Transport', color: '#3b82f6' },
  { value: 'education', label: '📚 Education', color: '#8b5cf6' },
  { value: 'health', label: '💊 Health', color: '#ef4444' },
  { value: 'shopping', label: '🛒 Shopping', color: '#ec4899' },
  { value: 'utilities', label: '💡 Utilities', color: '#14b8a6' },
  { value: 'entertainment', label: '🎬 Entertainment', color: '#f97316' },
  { value: 'other', label: '📦 Other', color: '#64748b' },
];

const PAYMENT_METHODS = ['cash', 'upi', 'card', 'netbanking', 'other'];

export default function Finance() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [expenses, setExpenses] = useState([]);
  const [subscriptions, setSubscriptions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('overview');
  const [showAddExpense, setShowAddExpense] = useState(false);
  const [showAddSub, setShowAddSub] = useState(false);
  const [saving, setSaving] = useState(false);

  const [newExpense, setNewExpense] = useState({
    amount: '', category: 'food', description: '', payment_method: 'upi',
  });
  const [newSub, setNewSub] = useState({
    service_name: '', amount: '', billing_cycle: 'monthly', next_billing_date: '', category: 'entertainment',
  });

  const loadData = useCallback(async (uid) => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];

    const [{ data: exp }, { data: subs }] = await Promise.all([
      supabase.from('expenses').select('*').eq('user_id', uid)
        .gte('expense_date', monthStart).order('created_at', { ascending: false }),
      supabase.from('subscriptions').select('*').eq('user_id', uid).eq('is_active', true).order('next_billing_date'),
    ]);
    if (exp) setExpenses(exp);
    if (subs) setSubscriptions(subs);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) { router.replace('/login'); return; }
      setUser(session.user);
      loadData(session.user.id).finally(() => setLoading(false));
    });
  }, [router, loadData]);

  async function addExpense() {
    if (!newExpense.amount || !newExpense.description) return;
    setSaving(true);
    await supabase.from('expenses').insert([{
      user_id: user.id, amount: parseFloat(newExpense.amount),
      category: newExpense.category, description: newExpense.description,
      payment_method: newExpense.payment_method, expense_date: new Date().toISOString().split('T')[0],
    }]);
    await supabase.from('audit_log').insert([{
      user_id: user.id, action: 'expense_added', service: 'finance',
      details: { amount: newExpense.amount, category: newExpense.category },
    }]);
    setNewExpense({ amount: '', category: 'food', description: '', payment_method: 'upi' });
    setShowAddExpense(false);
    await loadData(user.id);
    setSaving(false);
  }

  async function addSubscription() {
    if (!newSub.service_name || !newSub.amount) return;
    setSaving(true);
    await supabase.from('subscriptions').insert([{ user_id: user.id, ...newSub, amount: parseFloat(newSub.amount) }]);
    await supabase.from('audit_log').insert([{
      user_id: user.id, action: 'subscription_added', service: 'finance',
      details: { service: newSub.service_name, amount: newSub.amount },
    }]);
    setNewSub({ service_name: '', amount: '', billing_cycle: 'monthly', next_billing_date: '', category: 'entertainment' });
    setShowAddSub(false);
    await loadData(user.id);
    setSaving(false);
  }

  const totalThisMonth = expenses.reduce((s, e) => s + parseFloat(e.amount), 0);
  const totalSubs = subscriptions.reduce((s, sub) => s + parseFloat(sub.amount), 0);
  const byCategory = CATEGORIES.map(c => ({
    ...c,
    total: expenses.filter(e => e.category === c.value).reduce((s, e) => s + parseFloat(e.amount), 0),
  })).filter(c => c.total > 0);

  const input = { width: '100%', backgroundColor: '#0a0a0f', border: '1px solid #1e293b', borderRadius: '8px', padding: '9px 12px', color: '#f1f5f9', fontSize: '13px', outline: 'none', boxSizing: 'border-box' };
  const label = { fontSize: '11px', color: '#475569', display: 'block', marginBottom: '5px', fontWeight: '600' };

  if (loading) return (
    <div style={{ minHeight: '100vh', backgroundColor: '#0a0a0f', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6366f1' }}>Loading finance...</div>
  );

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#0a0a0f', color: '#f1f5f9' }}>
      <div style={{ borderBottom: '1px solid #1e1e2e', padding: '12px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <Link href="/dashboard" style={{ color: '#475569', textDecoration: 'none', fontSize: '13px' }}>← Dashboard</Link>
          <span style={{ color: '#1e293b' }}>|</span>
          <span style={{ fontWeight: '700' }}>💰 Finance</span>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button onClick={() => setShowAddExpense(true)} style={{ backgroundColor: '#6366f1', color: '#fff', border: 'none', padding: '7px 14px', borderRadius: '8px', fontSize: '12px', fontWeight: '600', cursor: 'pointer' }}>+ Expense</button>
          <button onClick={() => setShowAddSub(true)} style={{ backgroundColor: 'transparent', border: '1px solid #1e293b', color: '#94a3b8', padding: '7px 14px', borderRadius: '8px', fontSize: '12px', cursor: 'pointer' }}>+ Subscription</button>
        </div>
      </div>

      <div style={{ maxWidth: '680px', margin: '0 auto', padding: '20px 16px' }}>
        {/* Summary cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '10px', marginBottom: '20px' }}>
          {[
            { label: 'This Month', value: `₹${totalThisMonth.toLocaleString('en-IN')}`, color: '#6366f1' },
            { label: 'Subscriptions/mo', value: `₹${totalSubs.toLocaleString('en-IN')}`, color: '#f59e0b' },
            { label: 'Transactions', value: expenses.length, color: '#22c55e' },
          ].map((s, i) => (
            <div key={i} style={{ backgroundColor: '#0f0f1a', border: '1px solid #1e1e2e', borderRadius: '12px', padding: '14px', textAlign: 'center' }}>
              <div style={{ fontSize: '20px', fontWeight: '800', color: s.color }}>{s.value}</div>
              <div style={{ fontSize: '11px', color: '#475569', marginTop: '3px' }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: '4px', marginBottom: '16px', backgroundColor: '#0f0f1a', padding: '4px', borderRadius: '10px', border: '1px solid #1e1e2e' }}>
          {[{ key: 'overview', label: 'Overview' }, { key: 'expenses', label: `Expenses (${expenses.length})` }, { key: 'subscriptions', label: `Subscriptions (${subscriptions.length})` }].map(tab => (
            <button key={tab.key} onClick={() => setActiveTab(tab.key)} style={{
              flex: 1, padding: '8px', borderRadius: '7px', border: 'none', cursor: 'pointer',
              backgroundColor: activeTab === tab.key ? '#6366f1' : 'transparent',
              color: activeTab === tab.key ? '#fff' : '#64748b', fontSize: '12px', fontWeight: '600',
            }}>{tab.label}</button>
          ))}
        </div>

        {activeTab === 'overview' && (
          <div>
            {byCategory.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px', border: '1px dashed #1e293b', borderRadius: '14px', color: '#334155' }}>
                <div style={{ fontSize: '32px', marginBottom: '10px' }}>💰</div>
                <div>No expenses this month. Tap + Expense to start tracking.</div>
              </div>
            ) : (
              byCategory.map(cat => (
                <div key={cat.value} style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '10px', backgroundColor: '#0f0f1a', border: '1px solid #1e1e2e', borderRadius: '10px', padding: '12px' }}>
                  <span style={{ fontSize: '20px' }}>{cat.label.split(' ')[0]}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                      <span style={{ fontSize: '13px', color: '#f1f5f9', fontWeight: '500' }}>{cat.label.substring(3)}</span>
                      <span style={{ fontSize: '13px', fontWeight: '700', color: cat.color }}>₹{cat.total.toLocaleString('en-IN')}</span>
                    </div>
                    <div style={{ height: '4px', backgroundColor: '#1e293b', borderRadius: '2px' }}>
                      <div style={{ height: '100%', backgroundColor: cat.color, borderRadius: '2px', width: `${Math.min(100, (cat.total / totalThisMonth) * 100)}%` }} />
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {activeTab === 'expenses' && (
          <div>
            {expenses.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px', border: '1px dashed #1e293b', borderRadius: '14px', color: '#334155' }}>No expenses this month.</div>
            ) : (
              expenses.map(exp => {
                const cat = CATEGORIES.find(c => c.value === exp.category);
                return (
                  <div key={exp.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px', backgroundColor: '#0f0f1a', border: '1px solid #1e1e2e', borderRadius: '10px', padding: '12px' }}>
                    <span style={{ fontSize: '20px' }}>{cat?.label.split(' ')[0] || '💰'}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '14px', color: '#f1f5f9', fontWeight: '500' }}>{exp.description}</div>
                      <div style={{ fontSize: '11px', color: '#475569', marginTop: '2px' }}>{exp.payment_method.toUpperCase()} · {new Date(exp.expense_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</div>
                    </div>
                    <span style={{ fontSize: '15px', fontWeight: '700', color: cat?.color || '#f59e0b' }}>₹{parseFloat(exp.amount).toLocaleString('en-IN')}</span>
                  </div>
                );
              })
            )}
          </div>
        )}

        {activeTab === 'subscriptions' && (
          <div>
            {subscriptions.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px', border: '1px dashed #1e293b', borderRadius: '14px', color: '#334155' }}>
                <div style={{ fontSize: '32px', marginBottom: '10px' }}>📦</div>
                <div>No subscriptions tracked. Add them to get renewal alerts.</div>
              </div>
            ) : (
              subscriptions.map(sub => {
                const daysLeft = sub.next_billing_date ? Math.ceil((new Date(sub.next_billing_date) - new Date()) / 86400000) : null;
                return (
                  <div key={sub.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px', backgroundColor: '#0f0f1a', border: `1px solid ${daysLeft !== null && daysLeft <= 3 ? '#ef444440' : '#1e1e2e'}`, borderRadius: '10px', padding: '12px' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '14px', color: '#f1f5f9', fontWeight: '600' }}>{sub.service_name}</div>
                      <div style={{ fontSize: '11px', color: '#475569', marginTop: '2px' }}>
                        {sub.billing_cycle} · {daysLeft !== null ? (daysLeft <= 0 ? '🔴 Due today!' : daysLeft <= 3 ? `🟡 Due in ${daysLeft} days` : `Due ${new Date(sub.next_billing_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`) : 'No date set'}
                      </div>
                    </div>
                    <span style={{ fontSize: '15px', fontWeight: '700', color: '#f59e0b' }}>₹{parseFloat(sub.amount).toLocaleString('en-IN')}</span>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>

      {/* Add Expense Modal */}
      {showAddExpense && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'flex-end', zIndex: 1000 }}>
          <div style={{ width: '100%', backgroundColor: '#0f0f1a', borderTop: '1px solid #1e1e2e', borderRadius: '20px 20px 0 0', padding: '24px 20px 36px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '20px' }}>
              <span style={{ fontWeight: '700', fontSize: '16px' }}>💰 Log Expense</span>
              <button onClick={() => setShowAddExpense(false)} style={{ background: 'none', border: 'none', color: '#64748b', fontSize: '20px', cursor: 'pointer' }}>✕</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
              <div>
                <label style={label}>Amount (₹)</label>
                <input type="number" value={newExpense.amount} onChange={e => setNewExpense(p => ({ ...p, amount: e.target.value }))} placeholder="0" style={input} />
              </div>
              <div>
                <label style={label}>Payment</label>
                <select value={newExpense.payment_method} onChange={e => setNewExpense(p => ({ ...p, payment_method: e.target.value }))} style={input}>
                  {PAYMENT_METHODS.map(m => <option key={m} value={m}>{m.toUpperCase()}</option>)}
                </select>
              </div>
            </div>
            <div style={{ marginBottom: '12px' }}>
              <label style={label}>Description</label>
              <input value={newExpense.description} onChange={e => setNewExpense(p => ({ ...p, description: e.target.value }))} placeholder="What did you spend on?" style={input} />
            </div>
            <div style={{ marginBottom: '16px' }}>
              <label style={label}>Category</label>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                {CATEGORIES.map(c => (
                  <button key={c.value} onClick={() => setNewExpense(p => ({ ...p, category: c.value }))} style={{
                    padding: '5px 10px', borderRadius: '20px', border: 'none', fontSize: '12px', cursor: 'pointer',
                    backgroundColor: newExpense.category === c.value ? c.color : '#1e293b',
                    color: newExpense.category === c.value ? '#fff' : '#64748b', fontWeight: '500',
                  }}>{c.label}</button>
                ))}
              </div>
            </div>
            <button onClick={addExpense} disabled={saving} style={{ width: '100%', backgroundColor: '#6366f1', color: '#fff', border: 'none', padding: '13px', borderRadius: '10px', fontSize: '15px', fontWeight: '600', cursor: 'pointer' }}>
              {saving ? 'Saving...' : '+ Log Expense'}
            </button>
          </div>
        </div>
      )}

      {/* Add Subscription Modal */}
      {showAddSub && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'flex-end', zIndex: 1000 }}>
          <div style={{ width: '100%', backgroundColor: '#0f0f1a', borderTop: '1px solid #1e1e2e', borderRadius: '20px 20px 0 0', padding: '24px 20px 36px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '20px' }}>
              <span style={{ fontWeight: '700', fontSize: '16px' }}>📦 Add Subscription</span>
              <button onClick={() => setShowAddSub(false)} style={{ background: 'none', border: 'none', color: '#64748b', fontSize: '20px', cursor: 'pointer' }}>✕</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
              <div>
                <label style={label}>Service Name</label>
                <input value={newSub.service_name} onChange={e => setNewSub(p => ({ ...p, service_name: e.target.value }))} placeholder="Netflix, Spotify..." style={input} />
              </div>
              <div>
                <label style={label}>Amount (₹)</label>
                <input type="number" value={newSub.amount} onChange={e => setNewSub(p => ({ ...p, amount: e.target.value }))} placeholder="0" style={input} />
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
              <div>
                <label style={label}>Billing Cycle</label>
                <select value={newSub.billing_cycle} onChange={e => setNewSub(p => ({ ...p, billing_cycle: e.target.value }))} style={input}>
                  <option value="monthly">Monthly</option>
                  <option value="quarterly">Quarterly</option>
                  <option value="yearly">Yearly</option>
                </select>
              </div>
              <div>
                <label style={label}>Next Renewal Date</label>
                <input type="date" value={newSub.next_billing_date} onChange={e => setNewSub(p => ({ ...p, next_billing_date: e.target.value }))} style={input} />
              </div>
            </div>
            <button onClick={addSubscription} disabled={saving} style={{ width: '100%', backgroundColor: '#6366f1', color: '#fff', border: 'none', padding: '13px', borderRadius: '10px', fontSize: '15px', fontWeight: '600', cursor: 'pointer' }}>
              {saving ? 'Saving...' : '+ Add Subscription'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
                                          }
