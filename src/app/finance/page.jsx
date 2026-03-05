'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import NavbarClient from '@/components/NavbarClient';

export default function Finance() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [expenses, setExpenses] = useState([]);
  const [budgets, setBudgets] = useState([]);
  const [subscriptions, setSubscriptions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('expenses');
  const [expenseData, setExpenseData] = useState({ description: '', amount: '', category: 'Other' });
  const [budgetData, setBudgetData] = useState({ category: 'Food', limit: '' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) { router.replace('/login'); return; }
      setUser(session.user);
      const uid = session.user.id;

      const [{ data: exp }, { data: bud }, { data: sub }] = await Promise.all([
        supabase.from('expenses').select('*').eq('user_id', uid).order('created_at', { ascending: false }),
        supabase.from('budgets').select('*').eq('user_id', uid),
        supabase.from('subscriptions').select('*').eq('user_id', uid),
      ]);

      setExpenses(exp || []);
      setBudgets(bud || []);
      setSubscriptions(sub || []);
      setLoading(false);
    });
  }, [router]);

  const handleAddExpense = async () => {
    if (!expenseData.amount) { alert('Amount required'); return; }
    setSaving(true);
    const { data, error } = await supabase.from('expenses').insert({
      user_id: user.id,
      description: expenseData.description,
      amount: parseFloat(expenseData.amount),
      category: expenseData.category,
    }).select().single();
    if (!error) {
      setExpenses([data, ...expenses]);
      setExpenseData({ description: '', amount: '', category: 'Other' });
    }
    setSaving(false);
  };

  const totalExpenses = expenses.reduce((sum, e) => sum + (e.amount || 0), 0);
  const totalBudget = budgets.reduce((sum, b) => sum + (b.limit || 0), 0);

  if (loading) {
    return (
      <>
        <NavbarClient />
        <div style={{ minHeight: '100vh', backgroundColor: '#0a0a0f', color: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div>Loading...</div>
        </div>
      </>
    );
  }

  return (
    <>
      <NavbarClient />
      <div style={{ minHeight: '100vh', backgroundColor: '#0a0a0f', color: '#f1f5f9', padding: '24px 16px' }}>
        <div style={{ maxWidth: '600px', margin: '0 auto' }}>
          <div style={{ marginBottom: '32px' }}>
            <h1 style={{ fontSize: '32px', fontWeight: '800', margin: '0 0 8px' }}>💰 Finance</h1>
            <div style={{ fontSize: '14px', color: '#94a3b8' }}>Track expenses & budgets</div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '24px' }}>
            <div style={{ backgroundColor: '#0f0f1a', border: '1px solid #1e293b', borderRadius: '12px', padding: '16px' }}>
              <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '8px' }}>Total Expenses</div>
              <div style={{ fontSize: '20px', fontWeight: '700', color: '#ef4444' }}>₹{totalExpenses.toLocaleString('en-IN')}</div>
            </div>
            <div style={{ backgroundColor: '#0f0f1a', border: '1px solid #1e293b', borderRadius: '12px', padding: '16px' }}>
              <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '8px' }}>Total Budget</div>
              <div style={{ fontSize: '20px', fontWeight: '700', color: '#10b981' }}>₹{totalBudget.toLocaleString('en-IN')}</div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '8px', marginBottom: '24px', borderBottom: '1px solid #1e293b' }}>
            {['expenses', 'budgets', 'subscriptions'].map(tab => (
              <button key={tab} onClick={() => setActiveTab(tab)} style={{ padding: '12px 16px', backgroundColor: 'transparent', border: 'none', color: activeTab === tab ? '#6366f1' : '#64748b', fontWeight: activeTab === tab ? '700' : '500', borderBottom: activeTab === tab ? '2px solid #6366f1' : 'none', cursor: 'pointer', fontSize: '13px' }}>
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>

          {activeTab === 'expenses' && (
            <>
              {expenses.length > 0 && (
                <div style={{ display: 'grid', gap: '10px', marginBottom: '20px' }}>
                  {expenses.slice(0, 5).map((exp) => (
                    <div key={exp.id} style={{ backgroundColor: '#0f0f1a', border: '1px solid #1e293b', borderRadius: '10px', padding: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ fontSize: '13px', fontWeight: '600', color: '#e2e8f0' }}>{exp.description}</div>
                        <div style={{ fontSize: '11px', color: '#475569', marginTop: '2px' }}>{exp.category}</div>
                      </div>
                      <div style={{ fontSize: '13px', fontWeight: '700', color: '#ef4444' }}>₹{Number(exp.amount).toLocaleString('en-IN')}</div>
                    </div>
                  ))}
                </div>
              )}

              <div style={{ backgroundColor: '#0f0f1a', border: '1px solid #1e293b', borderRadius: '14px', padding: '20px', marginBottom: '24px' }}>
                <h3 style={{ fontSize: '16px', fontWeight: '700', color: '#f1f5f9', margin: '0 0 16px' }}>Add Expense</h3>
                <input type="text" placeholder="What did you spend on?" value={expenseData.description} onChange={(e) => setExpenseData({ ...expenseData, description: e.target.value })} style={{ width: '100%', backgroundColor: '#1a1a2e', border: '1px solid #334155', color: '#f1f5f9', padding: '10px 12px', borderRadius: '8px', fontSize: '13px', marginBottom: '12px', boxSizing: 'border-box' }} />
                <input type="number" placeholder="Amount" value={expenseData.amount} onChange={(e) => setExpenseData({ ...expenseData, amount: e.target.value })} style={{ width: '100%', backgroundColor: '#1a1a2e', border: '1px solid #334155', color: '#f1f5f9', padding: '10px 12px', borderRadius: '8px', fontSize: '13px', marginBottom: '12px', boxSizing: 'border-box' }} />
                <select value={expenseData.category} onChange={(e) => setExpenseData({ ...expenseData, category: e.target.value })} style={{ width: '100%', backgroundColor: '#1a1a2e', border: '1px solid #334155', color: '#f1f5f9', padding: '10px 12px', borderRadius: '8px', fontSize: '13px', marginBottom: '16px', boxSizing: 'border-box' }}>
                  <option>Food</option>
                  <option>Travel</option>
                  <option>Shopping</option>
                  <option>Entertainment</option>
                  <option>Bills</option>
                  <option>Other</option>
                </select>
                <button onClick={handleAddExpense} disabled={saving} style={{ width: '100%', backgroundColor: '#6366f1', color: '#fff', border: 'none', padding: '10px', borderRadius: '8px', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}>
                  {saving ? 'Saving...' : 'Add Expense'}
                </button>
              </div>
            </>
          )}

          {activeTab === 'budgets' && (
            <div style={{ backgroundColor: '#0f0f1a', border: '1px solid #1e293b', borderRadius: '14px', padding: '20px', textAlign: 'center' }}>
              <div style={{ fontSize: '24px', marginBottom: '12px' }}>📊</div>
              <div style={{ fontSize: '14px', color: '#94a3b8' }}>Budget management coming soon</div>
            </div>
          )}

          {activeTab === 'subscriptions' && (
            <div style={{ backgroundColor: '#0f0f1a', border: '1px solid #1e293b', borderRadius: '14px', padding: '20px', textAlign: 'center' }}>
              <div style={{ fontSize: '24px', marginBottom: '12px' }}>📺</div>
              <div style={{ fontSize: '14px', color: '#94a3b8' }}>Subscription tracking coming soon</div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
