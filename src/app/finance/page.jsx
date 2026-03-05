'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import NavbarClient from '@/components/NavbarClient';

const CATEGORIES = ['food','transport','education','health','shopping','utilities','entertainment','other'];
const CAT_EMOJI = { food:'🍽️', transport:'🚗', education:'📚', health:'💊', shopping:'🛍️', utilities:'💡', entertainment:'🎬', other:'📦' };
const PAYMENT = ['cash','upi','card','netbanking','other'];

export default function Finance() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('expenses');
  const [expenses, setExpenses] = useState([]);
  const [budgets, setBudgets] = useState([]);
  const [subscriptions, setSubscriptions] = useState([]);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');

  // Expense form
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState('food');
  const [description, setDescription] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('upi');
  const [expenseDate, setExpenseDate] = useState(new Date().toISOString().split('T')[0]);

  // Budget form
  const [budgetCategory, setBudgetCategory] = useState('food');
  const [budgetLimit, setBudgetLimit] = useState('');

  // Subscription form
  const [subName, setSubName] = useState('');
  const [subAmount, setSubAmount] = useState('');
  const [subCycle, setSubCycle] = useState('monthly');
  const [subNextDate, setSubNextDate] = useState('');

  function showToast(msg) { setToast(msg); setTimeout(() => setToast(''), 2500); }

  const now = new Date();
  const monthYear = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  const startOfMonth = `${monthYear}-01`;

  const loadAll = useCallback(async (uid) => {
    const [expRes, budRes, subRes] = await Promise.all([
      supabase.from('expenses').select('*').eq('user_id', uid).gte('expense_date', startOfMonth).order('created_at', { ascending: false }),
      supabase.from('budgets').select('*').eq('user_id', uid).eq('month_year', monthYear),
      supabase.from('subscriptions').select('*').eq('user_id', uid).eq('is_active', true).order('next_billing_date'),
    ]);
    if (expRes.data) setExpenses(expRes.data);
    if (budRes.data) setBudgets(budRes.data);
    if (subRes.data) setSubscriptions(subRes.data);
  }, [monthYear, startOfMonth]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) { router.replace('/login'); return; }
      setUser(session.user);
      loadAll(session.user.id).finally(() => setLoading(false));
    });
  }, [router, loadAll]);

  async function addExpense() {
    if (!amount || !description) return;
    setSaving(true);
    const { error } = await supabase.from('expenses').insert([{
      user_id: user.id, amount: parseFloat(amount), category,
      description, payment_method: paymentMethod, expense_date: expenseDate,
    }]);
    if (!error) {
      await supabase.from('audit_log').insert([{ user_id: user.id, action: 'expense_added', service: 'finance', details: { amount, category } }]);
      setAmount(''); setDescription('');
      showToast('✅ Expense logged!');
      await loadAll(user.id);
    }
    setSaving(false);
  }

  async function addBudget() {
    if (!budgetLimit) return;
    setSaving(true);
    const { error } = await supabase.from('budgets').upsert([{
      user_id: user.id, category: budgetCategory, monthly_limit: parseFloat(budgetLimit), month_year: monthYear,
    }], { onConflict: 'user_id,category,month_year' });
    if (!error) { setBudgetLimit(''); showToast('✅ Budget set!'); await loadAll(user.id); }
    setSaving(false);
  }

  async function addSubscription() {
    if (!subName || !subAmount) return;
    setSaving(true);
    const { error } = await supabase.from('subscriptions').insert([{
      user_id: user.id, service_name: subName, amount: parseFloat(subAmount),
      billing_cycle: subCycle, next_billing_date: subNextDate || null,
    }]);
    if (!error) { setSubName(''); setSubAmount(''); setSubNextDate(''); showToast('✅ Subscription added!'); await loadAll(user.id); }
    setSaving(false);
  }

  async function deleteExpense(id) {
    await supabase.from('expenses').delete().eq('id', id);
    showToast('🗑️ Deleted'); await loadAll(user.id);
  }

  const totalSpent = expenses.reduce((s, e) => s + Number(e.amount), 0);
  const byCategory = CATEGORIES.reduce((acc, c) => {
    acc[c] = expenses.filter(e => e.category === c).reduce((s, e) => s + Number(e.amount), 0);
    return acc;
  }, {});

  const inputStyle = { width: '100%', backgroundColor: '#0a0a0f', border: '1px solid #1e293b', borderRadius: '8px', padding: '9px 12px', color: '#f1f5f9', fontSize: '13px', outline: 'none', boxSizing: 'border-box' };
  const labelStyle = { fontSize: '11px', color: '#475569', display: 'block', marginBottom: '5px' };

  if (loading) return (
    <div style={{ minHeight: '100vh', backgroundColor: '#0a0a0f', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: '36px', height: '36px', border: '3px solid #6366f1', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );

  return (
    <>
      <NavbarClient />
      <div style={{ minHeight: '100vh', backgroundColor: '#0a0a0f', color: '#f1f5f9' }}>
      {toast && <div style={{ position: 'fixed', top: '70px', left: '50%', transform: 'translateX(-50%)', backgroundColor: '#1e1e2e', border: '1px solid #6366f1', borderRadius: '10px', padding: '10px 20px', color: '#f1f5f9', fontSize: '14px', zIndex: 9999, boxShadow: '0 4px 24px rgba(99,102,241,0.3)', whiteSpace: 'nowrap' }}>{toast}</div>}

      <div style={{ borderBottom: '1px solid #1e1e2e', padding: '10px 16px', backgroundColor: 'rgba(10,10,15,0.98)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
        <span style={{ fontWeight: '700', fontSize: '14px', color: '#6366f1' }}>💰 Finance</span>
        <div style={{ display: 'flex', gap: '6px' }}>
          <a href="/dashboard" style={{ color: '#94a3b8', textDecoration: 'none', fontSize: '11px', padding: '5px 10px', border: '1px solid #1e293b', borderRadius: '6px' }}>📋 Keeps</a>
          <a href="/daily-brief" style={{ color: '#94a3b8', textDecoration: 'none', fontSize: '11px', padding: '5px 10px', border: '1px solid #1e293b', borderRadius: '6px' }}>🌅 Brief</a>
        </div>
      </div>

      <div style={{ maxWidth: '680px', margin: '0 auto', padding: '20px 16px' }}>

        {/* Summary */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '10px', marginBottom: '20px' }}>
          {[
            { label: 'Spent', value: `₹${totalSpent.toLocaleString('en-IN')}`, color: '#ef4444' },
            { label: 'Transactions', value: expenses.length, color: '#6366f1' },
            { label: 'Subscriptions', value: subscriptions.length, color: '#f59e0b' },
          ].map((s, i) => (
            <div key={i} style={{ backgroundColor: '#0f0f1a', border: '1px solid #1e1e2e', borderRadius: '12px', padding: '14px', textAlign: 'center' }}>
              <div style={{ fontSize: '20px', fontWeight: '800', color: s.color }}>{s.value}</div>
              <div style={{ fontSize: '11px', color: '#475569', marginTop: '2px' }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* Budget progress bars */}
        {budgets.length > 0 && (
          <div style={{ backgroundColor: '#0f0f1a', border: '1px solid #1e1e2e', borderRadius: '14px', padding: '16px', marginBottom: '16px' }}>
            <div style={{ fontSize: '11px', color: '#f59e0b', fontWeight: '700', textTransform: 'uppercase', marginBottom: '12px' }}>📊 Budget tracker</div>
            {budgets.map((b, i) => {
              const spent = byCategory[b.category] || 0;
              const pct = Math.min((spent / Number(b.monthly_limit)) * 100, 100);
              const color = pct >= 90 ? '#ef4444' : pct >= 75 ? '#f59e0b' : '#22c55e';
              return (
                <div key={i} style={{ marginBottom: i < budgets.length - 1 ? '14px' : 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}>
                    <span style={{ fontSize: '12px', color: '#94a3b8' }}>{CAT_EMOJI[b.category]} {b.category}</span>
                    <span style={{ fontSize: '12px', color }}>{pct.toFixed(0)}% · ₹{spent.toLocaleString('en-IN')} / ₹{Number(b.monthly_limit).toLocaleString('en-IN')}</span>
                  </div>
                  <div style={{ height: '6px', backgroundColor: '#1a1a2e', borderRadius: '3px', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${pct}%`, backgroundColor: color, borderRadius: '3px', transition: 'width 0.5s ease' }} />
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Category breakdown */}
        {expenses.length > 0 && (
          <div style={{ backgroundColor: '#0f0f1a', border: '1px solid #1e1e2e', borderRadius: '14px', padding: '16px', marginBottom: '16px' }}>
            <div style={{ fontSize: '11px', color: '#94a3b8', fontWeight: '700', textTransform: 'uppercase', marginBottom: '12px' }}>🗂️ By category</div>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {CATEGORIES.filter(c => byCategory[c] > 0).map(c => (
                <div key={c} style={{ backgroundColor: '#0a0a0f', border: '1px solid #1a1a2e', borderRadius: '8px', padding: '8px 12px', textAlign: 'center' }}>
                  <div style={{ fontSize: '16px' }}>{CAT_EMOJI[c]}</div>
                  <div style={{ fontSize: '11px', color: '#64748b' }}>{c}</div>
                  <div style={{ fontSize: '12px', fontWeight: '700', color: '#f1f5f9' }}>₹{byCategory[c].toLocaleString('en-IN')}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tabs */}
        <div style={{ display: 'flex', gap: '4px', marginBottom: '16px', backgroundColor: '#0f0f1a', padding: '4px', borderRadius: '10px', border: '1px solid #1e1e2e' }}>
          {['expenses','budgets','subscriptions'].map(t => (
            <button key={t} onClick={() => setTab(t)} style={{ flex: 1, padding: '9px', borderRadius: '7px', border: 'none', cursor: 'pointer', backgroundColor: tab === t ? '#6366f1' : 'transparent', color: tab === t ? '#fff' : '#64748b', fontSize: '12px', fontWeight: '600', textTransform: 'capitalize' }}>{t}</button>
          ))}
        </div>

        {/* Expenses tab */}
        {tab === 'expenses' && (
          <>
            <div style={{ backgroundColor: '#0f0f1a', border: '1px solid #1e1e2e', borderRadius: '14px', padding: '16px', marginBottom: '16px' }}>
              <div style={{ fontSize: '11px', color: '#6366f1', fontWeight: '700', textTransform: 'uppercase', marginBottom: '14px' }}>+ Log Expense</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '10px' }}>
                <div>
                  <label style={labelStyle}>₹ Amount</label>
                  <input type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>Category</label>
                  <select value={category} onChange={e => setCategory(e.target.value)} style={inputStyle}>
                    {CATEGORIES.map(c => <option key={c} value={c}>{CAT_EMOJI[c]} {c}</option>)}
                  </select>
                </div>
              </div>
              <div style={{ marginBottom: '10px' }}>
                <label style={labelStyle}>Description</label>
                <input type="text" value={description} onChange={e => setDescription(e.target.value)} placeholder="What did you spend on?" style={inputStyle} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '14px' }}>
                <div>
                  <label style={labelStyle}>Payment</label>
                  <select value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)} style={inputStyle}>
                    {PAYMENT.map(p => <option key={p} value={p}>{p.toUpperCase()}</option>)}
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Date</label>
                  <input type="date" value={expenseDate} onChange={e => setExpenseDate(e.target.value)} style={inputStyle} />
                </div>
              </div>
              <button onClick={addExpense} disabled={saving || !amount || !description} style={{ width: '100%', backgroundColor: saving ? '#1a1a2e' : '#6366f1', color: '#fff', border: 'none', padding: '10px', borderRadius: '8px', fontSize: '14px', fontWeight: '600', cursor: 'pointer' }}>
                {saving ? 'Saving...' : '+ Log Expense'}
              </button>
            </div>

            {expenses.map((e, i) => (
              <div key={i} style={{ backgroundColor: '#0f0f1a', border: '1px solid #1a1a2e', borderRadius: '12px', padding: '12px 14px', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                <span style={{ fontSize: '20px' }}>{CAT_EMOJI[e.category]}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '13px', color: '#e2e8f0', fontWeight: '600' }}>{e.description}</div>
                  <div style={{ fontSize: '11px', color: '#475569' }}>{e.category} · {e.payment_method} · {e.expense_date}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '15px', fontWeight: '800', color: '#ef4444' }}>₹{Number(e.amount).toLocaleString('en-IN')}</div>
                  <button onClick={() => deleteExpense(e.id)} style={{ background: 'none', border: 'none', color: '#334155', cursor: 'pointer', fontSize: '12px' }}>🗑️</button>
                </div>
              </div>
            ))}
          </>
        )}

        {/* Budgets tab */}
        {tab === 'budgets' && (
          <div style={{ backgroundColor: '#0f0f1a', border: '1px solid #1e1e2e', borderRadius: '14px', padding: '16px' }}>
            <div style={{ fontSize: '11px', color: '#6366f1', fontWeight: '700', textTransform: 'uppercase', marginBottom: '14px' }}>Set Monthly Budget</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '14px' }}>
              <div>
                <label style={labelStyle}>Category</label>
                <select value={budgetCategory} onChange={e => setBudgetCategory(e.target.value)} style={inputStyle}>
                  {CATEGORIES.map(c => <option key={c} value={c}>{CAT_EMOJI[c]} {c}</option>)}
                </select>
              </div>
              <div>
                <label style={labelStyle}>₹ Monthly limit</label>
                <input type="number" value={budgetLimit} onChange={e => setBudgetLimit(e.target.value)} placeholder="5000" style={inputStyle} />
              </div>
            </div>
            <button onClick={addBudget} disabled={saving || !budgetLimit} style={{ width: '100%', backgroundColor: '#6366f1', color: '#fff', border: 'none', padding: '10px', borderRadius: '8px', fontSize: '14px', fontWeight: '600', cursor: 'pointer' }}>
              Set Budget
            </button>
          </div>
        )}

        {/* Subscriptions tab */}
        {tab === 'subscriptions' && (
          <>
            <div style={{ backgroundColor: '#0f0f1a', border: '1px solid #1e1e2e', borderRadius: '14px', padding: '16px', marginBottom: '16px' }}>
              <div style={{ fontSize: '11px', color: '#6366f1', fontWeight: '700', textTransform: 'uppercase', marginBottom: '14px' }}>+ Add Subscription</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '10px' }}>
                <div>
                  <label style={labelStyle}>Service name</label>
                  <input type="text" value={subName} onChange={e => setSubName(e.target.value)} placeholder="Netflix, Spotify..." style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>₹ Amount</label>
                  <input type="number" value={subAmount} onChange={e => setSubAmount(e.target.value)} placeholder="199" style={inputStyle} />
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '14px' }}>
                <div>
                  <label style={labelStyle}>Billing cycle</label>
                  <select value={subCycle} onChange={e => setSubCycle(e.target.value)} style={inputStyle}>
                    <option value="monthly">Monthly</option>
                    <option value="quarterly">Quarterly</option>
                    <option value="yearly">Yearly</option>
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Next billing date</label>
                  <input type="date" value={subNextDate} onChange={e => setSubNextDate(e.target.value)} style={inputStyle} />
                </div>
              </div>
              <button onClick={addSubscription} disabled={saving || !subName || !subAmount} style={{ width: '100%', backgroundColor: '#6366f1', color: '#fff', border: 'none', padding: '10px', borderRadius: '8px', fontSize: '14px', fontWeight: '600', cursor: 'pointer' }}>
                Add Subscription
              </button>
            </div>
            {subscriptions.map((s, i) => (
              <div key={i} style={{ backgroundColor: '#0f0f1a', border: '1px solid #1a1a2e', borderRadius: '12px', padding: '12px 14px', marginBottom: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: '13px', fontWeight: '600', color: '#e2e8f0' }}>📺 {s.service_name}</div>
                  <div style={{ fontSize: '11px', color: '#475569' }}>{s.billing_cycle} · {s.next_billing_date ? `Next: ${s.next_billing_date}` : 'No date set'}</div>
                </div>
                <div style={{ fontSize: '15px', fontWeight: '800', color: '#f59e0b' }}>₹{Number(s.amount).toLocaleString('en-IN')}</div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
    </>
  );
}
