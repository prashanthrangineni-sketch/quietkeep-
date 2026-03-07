'use client';
import { useEffect, useState } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import NavbarClient from '@/components/NavbarClient';

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

const EXPENSE_CATEGORIES = ['Food', 'Groceries', 'Transport', 'Shopping', 'Health', 'Entertainment', 'Bills', 'Education', 'Travel', 'Other'];
const PAYMENT_METHODS = ['UPI', 'Cash', 'Card', 'Net Banking', 'Wallet', 'Other'];
const SUB_CYCLES = ['monthly', 'yearly', 'weekly', 'quarterly'];

export default function FinancePage() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('expenses'); // expenses | budgets | subscriptions

  // Expenses
  const [expenses, setExpenses] = useState([]);
  const [showAddExpense, setShowAddExpense] = useState(false);
  const [expAmount, setExpAmount] = useState('');
  const [expCategory, setExpCategory] = useState('Food');
  const [expDesc, setExpDesc] = useState('');
  const [expPayment, setExpPayment] = useState('UPI');
  const [expDate, setExpDate] = useState(new Date().toISOString().split('T')[0]);
  const [savingExp, setSavingExp] = useState(false);

  // Budgets
  const [budgets, setBudgets] = useState([]);
  const [showAddBudget, setShowAddBudget] = useState(false);
  const [budCategory, setBudCategory] = useState('Food');
  const [budLimit, setBudLimit] = useState('');
  const [budThreshold, setBudThreshold] = useState(80);
  const [savingBud, setSavingBud] = useState(false);

  // Subscriptions
  const [subscriptions, setSubscriptions] = useState([]);
  const [showAddSub, setShowAddSub] = useState(false);
  const [subName, setSubName] = useState('');
  const [subAmount, setSubAmount] = useState('');
  const [subCycle, setSubCycle] = useState('monthly');
  const [subDue, setSubDue] = useState('');
  const [subCategory, setSubCategory] = useState('Entertainment');
  const [savingSub, setSavingSub] = useState(false);

  useEffect(() => { init(); }, []);

  async function init() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { window.location.href = '/login'; return; }
    setUser(user);
    await loadAll(user.id);
    setLoading(false);
  }

  async function loadAll(uid) {
    const now = new Date();
    const monthYear = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    const [expRes, budRes, subRes] = await Promise.all([
      supabase.from('expenses').select('*').eq('user_id', uid).order('expense_date', { ascending: false }).limit(50),
      supabase.from('budgets').select('*').eq('user_id', uid).eq('month_year', monthYear),
      supabase.from('subscriptions').select('*').eq('user_id', uid).eq('is_active', true).order('next_due', { ascending: true }),
    ]);
    setExpenses(expRes.data || []);
    setBudgets(budRes.data || []);
    setSubscriptions(subRes.data || []);
  }

  async function addExpense() {
    if (!expAmount || isNaN(parseFloat(expAmount))) return;
    setSavingExp(true);
    const { data } = await supabase.from('expenses').insert({
      user_id: user.id,
      amount: parseFloat(expAmount),
      currency: 'INR',
      category: expCategory,
      description: expDesc,
      payment_method: expPayment,
      expense_date: expDate,
    }).select().single();

    if (data) {
      setExpenses(prev => [data, ...prev]);
      await supabase.from('audit_log').insert({
        user_id: user.id,
        action: 'expense_added',
        service: 'finance',
        details: { amount: parseFloat(expAmount), category: expCategory },
      });
    }
    setExpAmount(''); setExpDesc(''); setSavingExp(false); setShowAddExpense(false);
  }

  async function deleteExpense(id) {
    await supabase.from('expenses').delete().eq('id', id);
    setExpenses(prev => prev.filter(e => e.id !== id));
    await supabase.from('audit_log').insert({ user_id: user.id, action: 'expense_deleted', service: 'finance', details: { expense_id: id } });
  }

  async function addBudget() {
    if (!budLimit || isNaN(parseFloat(budLimit))) return;
    setSavingBud(true);
    const now = new Date();
    const monthYear = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const { data } = await supabase.from('budgets').upsert({
      user_id: user.id,
      category: budCategory,
      limit_amount: parseFloat(budLimit),
      alert_threshold: budThreshold,
      month_year: monthYear,
    }, { onConflict: 'user_id,category,month_year' }).select().single();
    if (data) setBudgets(prev => { const f = prev.filter(b => b.category !== budCategory); return [...f, data]; });
    setBudLimit(''); setSavingBud(false); setShowAddBudget(false);
  }

  async function addSubscription() {
    if (!subName || !subAmount) return;
    setSavingSub(true);
    const { data } = await supabase.from('subscriptions').insert({
      user_id: user.id,
      name: subName,
      amount: parseFloat(subAmount),
      currency: 'INR',
      cycle: subCycle,
      next_due: subDue || null,
      category: subCategory,
      is_active: true,
    }).select().single();
    if (data) setSubscriptions(prev => [...prev, data]);
    await supabase.from('audit_log').insert({ user_id: user.id, action: 'subscription_added', service: 'finance', details: { name: subName, amount: parseFloat(subAmount) } });
    setSubName(''); setSubAmount(''); setSavingSub(false); setShowAddSub(false);
  }

  async function toggleSub(id, isActive) {
    await supabase.from('subscriptions').update({ is_active: !isActive }).eq('id', id);
    setSubscriptions(prev => prev.map(s => s.id === id ? { ...s, is_active: !isActive } : s));
  }

  if (loading) return (
    <div style={{ minHeight: '100vh', background: '#0f0f0f', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ color: '#6366f1' }}>Loading Finance…</div>
    </div>
  );

  const totalThisMonth = expenses
    .filter(e => e.expense_date?.startsWith(new Date().toISOString().slice(0, 7)))
    .reduce((s, e) => s + parseFloat(e.amount || 0), 0);

  const totalSubs = subscriptions.reduce((s, sub) => s + parseFloat(sub.amount || 0), 0);

  const inputStyle = { width: '100%', background: '#111', border: '1px solid #333', borderRadius: 8, color: '#fff', padding: '0.6rem 0.75rem', fontSize: '0.88rem', outline: 'none', boxSizing: 'border-box' };
  const selectStyle = { ...inputStyle };
  const btnPrimary = { padding: '0.6rem 1.2rem', borderRadius: 8, border: 'none', background: '#6366f1', color: '#fff', fontSize: '0.88rem', fontWeight: 600, cursor: 'pointer' };
  const btnGhost = { ...btnPrimary, background: 'transparent', border: '1px solid #333', color: '#aaa' };

  return (
    <div style={{ minHeight: '100vh', background: '#0f0f0f', color: '#fff' }}>
      <NavbarClient />
      <div style={{ maxWidth: 700, margin: '0 auto', padding: '1.5rem 1rem 4rem' }}>

        {/* Summary cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.75rem', marginBottom: '1.5rem' }}>
          <div style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 12, padding: '1.2rem' }}>
            <div style={{ color: '#666', fontSize: '0.78rem', marginBottom: 4 }}>Spent This Month</div>
            <div style={{ color: '#ef4444', fontSize: '1.6rem', fontWeight: 700 }}>₹{totalThisMonth.toLocaleString('en-IN')}</div>
          </div>
          <div style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 12, padding: '1.2rem' }}>
            <div style={{ color: '#666', fontSize: '0.78rem', marginBottom: 4 }}>Monthly Subscriptions</div>
            <div style={{ color: '#f59e0b', fontSize: '1.6rem', fontWeight: 700 }}>₹{totalSubs.toLocaleString('en-IN')}</div>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem', background: '#1a1a1a', borderRadius: 10, padding: 4 }}>
          {['expenses', 'budgets', 'subscriptions'].map(t => (
            <button key={t} onClick={() => setTab(t)} style={{ flex: 1, padding: '0.55rem', borderRadius: 8, border: 'none', background: tab === t ? '#6366f1' : 'transparent', color: tab === t ? '#fff' : '#666', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer', textTransform: 'capitalize' }}>
              {t}
            </button>
          ))}
        </div>

        {/* EXPENSES TAB */}
        {tab === 'expenses' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h2 style={{ fontSize: '1rem', fontWeight: 600 }}>Expenses</h2>
              <button onClick={() => setShowAddExpense(!showAddExpense)} style={btnPrimary}>+ Add</button>
            </div>

            {showAddExpense && (
              <div style={{ background: '#1a1a1a', border: '1px solid #333', borderRadius: 12, padding: '1.2rem', marginBottom: '1rem' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
                  <div>
                    <label style={{ color: '#aaa', fontSize: '0.78rem', display: 'block', marginBottom: 4 }}>Amount (₹) *</label>
                    <input style={inputStyle} type="number" placeholder="0" value={expAmount} onChange={e => setExpAmount(e.target.value)} />
                  </div>
                  <div>
                    <label style={{ color: '#aaa', fontSize: '0.78rem', display: 'block', marginBottom: 4 }}>Date</label>
                    <input style={inputStyle} type="date" value={expDate} onChange={e => setExpDate(e.target.value)} />
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
                  <div>
                    <label style={{ color: '#aaa', fontSize: '0.78rem', display: 'block', marginBottom: 4 }}>Category</label>
                    <select style={selectStyle} value={expCategory} onChange={e => setExpCategory(e.target.value)}>
                      {EXPENSE_CATEGORIES.map(c => <option key={c}>{c}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={{ color: '#aaa', fontSize: '0.78rem', display: 'block', marginBottom: 4 }}>Payment</label>
                    <select style={selectStyle} value={expPayment} onChange={e => setExpPayment(e.target.value)}>
                      {PAYMENT_METHODS.map(p => <option key={p}>{p}</option>)}
                    </select>
                  </div>
                </div>
                <div style={{ marginBottom: '0.75rem' }}>
                  <label style={{ color: '#aaa', fontSize: '0.78rem', display: 'block', marginBottom: 4 }}>Description</label>
                  <input style={inputStyle} placeholder="What was this for?" value={expDesc} onChange={e => setExpDesc(e.target.value)} />
                </div>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button onClick={addExpense} disabled={savingExp} style={btnPrimary}>{savingExp ? 'Saving…' : 'Save Expense'}</button>
                  <button onClick={() => setShowAddExpense(false)} style={btnGhost}>Cancel</button>
                </div>
              </div>
            )}

            {expenses.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '3rem', color: '#444' }}>No expenses yet. Add your first one.</div>
            ) : (
              expenses.map(e => (
                <div key={e.id} style={{ background: '#1a1a1a', border: '1px solid #222', borderRadius: 10, padding: '0.9rem 1rem', marginBottom: '0.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ color: '#fff', fontSize: '0.9rem', fontWeight: 500 }}>{e.description || e.category}</div>
                    <div style={{ color: '#555', fontSize: '0.78rem', marginTop: 2 }}>{e.category} · {e.payment_method} · {e.expense_date}</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <div style={{ color: '#ef4444', fontWeight: 700, fontSize: '1rem' }}>₹{parseFloat(e.amount).toLocaleString('en-IN')}</div>
                    <button onClick={() => deleteExpense(e.id)} style={{ background: 'none', border: 'none', color: '#444', cursor: 'pointer', fontSize: '0.9rem' }}>✕</button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* BUDGETS TAB */}
        {tab === 'budgets' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h2 style={{ fontSize: '1rem', fontWeight: 600 }}>Monthly Budgets</h2>
              <button onClick={() => setShowAddBudget(!showAddBudget)} style={btnPrimary}>+ Set Budget</button>
            </div>

            {showAddBudget && (
              <div style={{ background: '#1a1a1a', border: '1px solid #333', borderRadius: 12, padding: '1.2rem', marginBottom: '1rem' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
                  <div>
                    <label style={{ color: '#aaa', fontSize: '0.78rem', display: 'block', marginBottom: 4 }}>Category</label>
                    <select style={selectStyle} value={budCategory} onChange={e => setBudCategory(e.target.value)}>
                      {EXPENSE_CATEGORIES.map(c => <option key={c}>{c}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={{ color: '#aaa', fontSize: '0.78rem', display: 'block', marginBottom: 4 }}>Monthly Limit (₹)</label>
                    <input style={inputStyle} type="number" placeholder="5000" value={budLimit} onChange={e => setBudLimit(e.target.value)} />
                  </div>
                </div>
                <div style={{ marginBottom: '0.75rem' }}>
                  <label style={{ color: '#aaa', fontSize: '0.78rem', display: 'block', marginBottom: 4 }}>Alert at {budThreshold}%</label>
                  <input type="range" min={50} max={100} value={budThreshold} onChange={e => setBudThreshold(parseInt(e.target.value))} style={{ width: '100%', accentColor: '#6366f1' }} />
                </div>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button onClick={addBudget} disabled={savingBud} style={btnPrimary}>{savingBud ? 'Saving…' : 'Save Budget'}</button>
                  <button onClick={() => setShowAddBudget(false)} style={btnGhost}>Cancel</button>
                </div>
              </div>
            )}

            {budgets.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '3rem', color: '#444' }}>No budgets set. Set limits by category.</div>
            ) : (
              budgets.map(b => {
                const spent = expenses.filter(e => e.category === b.category && e.expense_date?.startsWith(new Date().toISOString().slice(0, 7))).reduce((s, e) => s + parseFloat(e.amount || 0), 0);
                const pct = Math.min(100, Math.round((spent / b.limit_amount) * 100));
                const color = pct >= b.alert_threshold ? '#ef4444' : pct >= 60 ? '#f59e0b' : '#22c55e';
                return (
                  <div key={b.id} style={{ background: '#1a1a1a', border: '1px solid #222', borderRadius: 10, padding: '1rem', marginBottom: '0.5rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                      <span style={{ color: '#fff', fontWeight: 500 }}>{b.category}</span>
                      <span style={{ color, fontSize: '0.85rem' }}>₹{spent.toLocaleString('en-IN')} / ₹{parseFloat(b.limit_amount).toLocaleString('en-IN')}</span>
                    </div>
                    <div style={{ background: '#111', borderRadius: 4, height: 6 }}>
                      <div style={{ width: `${pct}%`, background: color, height: '100%', borderRadius: 4, transition: 'width 0.3s' }} />
                    </div>
                    <div style={{ color: '#555', fontSize: '0.75rem', marginTop: 4 }}>{pct}% used · Alert at {b.alert_threshold}%</div>
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* SUBSCRIPTIONS TAB */}
        {tab === 'subscriptions' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h2 style={{ fontSize: '1rem', fontWeight: 600 }}>Subscriptions</h2>
              <button onClick={() => setShowAddSub(!showAddSub)} style={btnPrimary}>+ Add</button>
            </div>

            {showAddSub && (
              <div style={{ background: '#1a1a1a', border: '1px solid #333', borderRadius: 12, padding: '1.2rem', marginBottom: '1rem' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
                  <div>
                    <label style={{ color: '#aaa', fontSize: '0.78rem', display: 'block', marginBottom: 4 }}>Service Name *</label>
                    <input style={inputStyle} placeholder="Netflix, Hotstar…" value={subName} onChange={e => setSubName(e.target.value)} />
                  </div>
                  <div>
                    <label style={{ color: '#aaa', fontSize: '0.78rem', display: 'block', marginBottom: 4 }}>Amount (₹) *</label>
                    <input style={inputStyle} type="number" placeholder="499" value={subAmount} onChange={e => setSubAmount(e.target.value)} />
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
                  <div>
                    <label style={{ color: '#aaa', fontSize: '0.78rem', display: 'block', marginBottom: 4 }}>Billing Cycle</label>
                    <select style={selectStyle} value={subCycle} onChange={e => setSubCycle(e.target.value)}>
                      {SUB_CYCLES.map(c => <option key={c}>{c}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={{ color: '#aaa', fontSize: '0.78rem', display: 'block', marginBottom: 4 }}>Next Due Date</label>
                    <input style={inputStyle} type="date" value={subDue} onChange={e => setSubDue(e.target.value)} />
                  </div>
                </div>
                <div style={{ marginBottom: '0.75rem' }}>
                  <label style={{ color: '#aaa', fontSize: '0.78rem', display: 'block', marginBottom: 4 }}>Category</label>
                  <select style={selectStyle} value={subCategory} onChange={e => setSubCategory(e.target.value)}>
                    {EXPENSE_CATEGORIES.map(c => <option key={c}>{c}</option>)}
                  </select>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button onClick={addSubscription} disabled={savingSub} style={btnPrimary}>{savingSub ? 'Saving…' : 'Save'}</button>
                  <button onClick={() => setShowAddSub(false)} style={btnGhost}>Cancel</button>
                </div>
              </div>
            )}

            {subscriptions.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '3rem', color: '#444' }}>No subscriptions tracked yet.</div>
            ) : (
              subscriptions.map(s => {
                const daysLeft = s.next_due ? Math.ceil((new Date(s.next_due) - new Date()) / 86400000) : null;
                const urgent = daysLe
