'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

const CATEGORIES = [
  { name: 'Food', emoji: '🍔', color: '#ef4444' },
  { name: 'Travel', emoji: '🚗', color: '#3b82f6' },
  { name: 'Shopping', emoji: '🛍️', color: '#ec4899' },
  { name: 'Entertainment', emoji: '🎬', color: '#f59e0b' },
  { name: 'Bills', emoji: '📄', color: '#8b5cf6' },
  { name: 'Health', emoji: '⚕️', color: '#10b981' },
  { name: 'Other', emoji: '📌', color: '#64748b' },
];

export default function FinancePage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [expenses, setExpenses] = useState([]);
  const [budgets, setBudgets] = useState([]);
  const [subscriptions, setSubscriptions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('expenses');
  const [showExpenseForm, setShowExpenseForm] = useState(false);
  const [showBudgetForm, setShowBudgetForm] = useState(false);
  const [showSubscriptionForm, setShowSubscriptionForm] = useState(false);
  const [expenseForm, setExpenseForm] = useState({
    description: '',
    amount: '',
    category: 'Food',
    expense_date: new Date().toISOString().split('T')[0],
  });
  const [budgetForm, setBudgetForm] = useState({
    category: 'Food',
    limit_amount: '',
  });
  const [subscriptionForm, setSubscriptionForm] = useState({
    name: '',
    amount: '',
    cycle: 'monthly',
  });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        setUser(session.user);
        const uid = session.user.id;

        const [expResult, budResult, subResult] = await Promise.all([
          supabase.from('expenses').select('*').eq('user_id', uid).order('expense_date', { ascending: false }),
          supabase.from('budgets').select('*').eq('user_id', uid).order('category'),
          supabase.from('subscriptions').select('*').eq('user_id', uid).order('name'),
        ]);

        setExpenses(expResult.data || []);
        setBudgets(budResult.data || []);
        setSubscriptions(subResult.data || []);
      }
    } catch (error) {
      console.error('Error loading data:', error);
      alert('Error loading finance data');
    } finally {
      setLoading(false);
    }
  };

  const handleAddExpense = async () => {
    if (!expenseForm.description.trim() || !expenseForm.amount) {
      alert('Please fill all fields');
      return;
    }

    try {
      const { data, error } = await supabase.from('expenses').insert({
        user_id: user.id,
        description: expenseForm.description,
        amount: parseFloat(expenseForm.amount),
        category: expenseForm.category,
        expense_date: expenseForm.expense_date,
      }).select().single();

      if (error) throw error;

      setExpenses([data, ...expenses]);
      setExpenseForm({ description: '', amount: '', category: 'Food', expense_date: new Date().toISOString().split('T')[0] });
      setShowExpenseForm(false);
      alert('Expense added successfully!');
    } catch (error) {
      console.error('Error:', error);
      alert('Error adding expense: ' + error.message);
    }
  };

  const handleAddBudget = async () => {
    if (!budgetForm.limit_amount) {
      alert('Please enter budget amount');
      return;
    }

    try {
      const existingBudget = budgets.find(b => b.category === budgetForm.category);

      if (existingBudget) {
        const { error } = await supabase.from('budgets').update({ limit_amount: parseFloat(budgetForm.limit_amount) }).eq('id', existingBudget.id);
        if (error) throw error;
        setBudgets(budgets.map(b => b.id === existingBudget.id ? { ...b, limit_amount: parseFloat(budgetForm.limit_amount) } : b));
      } else {
        const { data, error } = await supabase.from('budgets').insert({
          user_id: user.id,
          category: budgetForm.category,
          limit_amount: parseFloat(budgetForm.limit_amount),
          month_year: new Date().toISOString().slice(0, 7),
        }).select().single();
        if (error) throw error;
        setBudgets([...budgets, data]);
      }

      setBudgetForm({ category: 'Food', limit_amount: '' });
      setShowBudgetForm(false);
      alert('Budget saved successfully!');
    } catch (error) {
      console.error('Error:', error);
      alert('Error saving budget: ' + error.message);
    }
  };

  const handleAddSubscription = async () => {
    if (!subscriptionForm.name.trim() || !subscriptionForm.amount) {
      alert('Please fill all fields');
      return;
    }

    try {
      const nextDue = new Date();
      if (subscriptionForm.cycle === 'monthly') nextDue.setMonth(nextDue.getMonth() + 1);
      else if (subscriptionForm.cycle === 'quarterly') nextDue.setMonth(nextDue.getMonth() + 3);
      else if (subscriptionForm.cycle === 'yearly') nextDue.setFullYear(nextDue.getFullYear() + 1);

      const { data, error } = await supabase.from('subscriptions').insert({
        user_id: user.id,
        name: subscriptionForm.name,
        amount: parseFloat(subscriptionForm.amount),
        cycle: subscriptionForm.cycle,
        next_due: nextDue.toISOString().split('T')[0],
      }).select().single();

      if (error) throw error;

      setSubscriptions([...subscriptions, data]);
      setSubscriptionForm({ name: '', amount: '', cycle: 'monthly' });
      setShowSubscriptionForm(false);
      alert('Subscription added successfully!');
    } catch (error) {
      console.error('Error:', error);
      alert('Error adding subscription: ' + error.message);
    }
  };

  const handleDeleteExpense = async (id) => {
    if (!confirm('Delete this expense?')) return;
    try {
      await supabase.from('expenses').delete().eq('id', id);
      setExpenses(expenses.filter(e => e.id !== id));
    } catch (error) {
      alert('Error deleting expense');
    }
  };

  const handleDeleteBudget = async (id) => {
    if (!confirm('Delete this budget?')) return;
    try {
      await supabase.from('budgets').delete().eq('id', id);
      setBudgets(budgets.filter(b => b.id !== id));
    } catch (error) {
      alert('Error deleting budget');
    }
  };

  const handleDeleteSubscription = async (id) => {
    if (!confirm('Delete this subscription?')) return;
    try {
      await supabase.from('subscriptions').delete().eq('id', id);
      setSubscriptions(subscriptions.filter(s => s.id !== id));
    } catch (error) {
      alert('Error deleting subscription');
    }
  };

  const totalExpenses = expenses.reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0);

  const monthlyRecurring = subscriptions.reduce((sum, s) => {
    const cycles = { monthly: 1, quarterly: 3, yearly: 12 };
    return sum + (parseFloat(s.amount) / cycles[s.cycle]);
  }, 0);

  const annualRecurring = subscriptions.reduce((sum, s) => {
    const cycles = { monthly: 12, quarterly: 4, yearly: 1 };
    return sum + (parseFloat(s.amount) * cycles[s.cycle]);
  }, 0);

  if (loading) return <div style={{ padding: '20px', textAlign: 'center', color: '#94a3b8' }}>Loading...</div>;

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#0a0a0f', color: '#f1f5f9', padding: '20px' }}>
      <div style={{ maxWidth: '600px', margin: '0 auto' }}>
        <div style={{ marginBottom: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h1 style={{ fontSize: '28px', fontWeight: '800', margin: 0 }}>💰 Finance</h1>
          <button onClick={() => router.push('/dashboard')} style={{ backgroundColor: '#6366f1', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: '6px', cursor: 'pointer', fontSize: '12px' }}>
            ← Back to Dashboard
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '24px' }}>
          <div style={{ backgroundColor: '#0f0f1a', border: '1px solid #1e293b', borderRadius: '12px', padding: '16px' }}>
            <div style={{ fontSize: '11px', color: '#94a3b8', marginBottom: '4px' }}>Total Expenses</div>
            <div style={{ fontSize: '24px', fontWeight: '700', color: '#6366f1' }}>₹{totalExpenses.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</div>
          </div>
          <div style={{ backgroundColor: '#0f0f1a', border: '1px solid #1e293b', borderRadius: '12px', padding: '16px' }}>
            <div style={{ fontSize: '11px', color: '#94a3b8', marginBottom: '4px' }}>Monthly Recurring</div>
            <div style={{ fontSize: '24px', fontWeight: '700', color: '#8b5cf6' }}>₹{monthlyRecurring.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</div>
          </div>
        </div>

        {/* TABS */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', marginBottom: '20px' }}>
          {['expenses', 'budgets', 'subscriptions'].map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)} style={{ backgroundColor: activeTab === tab ? '#6366f1' : '#1e1e2e', border: '1px solid #334155', color: '#f1f5f9', padding: '10px', borderRadius: '8px', cursor: 'pointer', fontSize: '12px', fontWeight: '600' }}>
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>

        {/* EXPENSES TAB */}
        {activeTab === 'expenses' && (
          <div>
            {expenses.length > 0 && (
              <div style={{ marginBottom: '20px' }}>
                <h3 style={{ fontSize: '14px', fontWeight: '600', marginBottom: '12px' }}>Recent Expenses</h3>
                {expenses.map(exp => {
                  const cat = CATEGORIES.find(c => c.name === exp.category) || CATEGORIES[6];
                  return (
                    <div key={exp.id} style={{ backgroundColor: '#0f0f1a', border: '1px solid #1e293b', borderRadius: '10px', padding: '12px', marginBottom: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1 }}>
                        <span style={{ fontSize: '20px' }}>{cat.emoji}</span>
                        <div>
                          <div style={{ fontSize: '12px', fontWeight: '600' }}>{exp.description}</div>
                          <div style={{ fontSize: '10px', color: '#64748b' }}>{new Date(exp.expense_date).toLocaleDateString('en-IN')}</div>
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: '12px', fontWeight: '700', color: '#ef4444' }}>₹{parseFloat(exp.amount).toLocaleString('en-IN')}</div>
                        <button onClick={() => handleDeleteExpense(exp.id)} style={{ backgroundColor: 'transparent', border: 'none', color: '#64748b', fontSize: '10px', cursor: 'pointer' }}>Delete</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <button onClick={() => setShowExpenseForm(!showExpenseForm)} style={{ width: '100%', backgroundColor: '#6366f1', color: '#fff', border: 'none', padding: '12px', borderRadius: '8px', cursor: 'pointer', marginBottom: '16px' }}>
              + Add Expense
            </button>

            {showExpenseForm && (
              <div style={{ backgroundColor: '#0f0f1a', border: '1px solid #1e293b', borderRadius: '12px', padding: '16px', marginBottom: '20px' }}>
                <input type="text" placeholder="Description" value={expenseForm.description} onChange={(e) => setExpenseForm({ ...expenseForm, description: e.target.value })} style={{ width: '100%', padding: '10px', marginBottom: '10px', backgroundColor: '#1a1a2e', border: '1px solid #334155', color: '#f1f5f9', borderRadius: '6px', fontSize: '12px', boxSizing: 'border-box' }} />
                <input type="number" placeholder="Amount" value={expenseForm.amount} onChange={(e) => setExpenseForm({ ...expenseForm, amount: e.target.value })} style={{ width: '100%', padding: '10px', marginBottom: '10px', backgroundColor: '#1a1a2e', border: '1px solid #334155', color: '#f1f5f9', borderRadius: '6px', fontSize: '12px', boxSizing: 'border-box' }} />
                <select value={expenseForm.category} onChange={(e) => setExpenseForm({ ...expenseForm, category: e.target.value })} style={{ width: '100%', padding: '10px', marginBottom: '10px', backgroundColor: '#1a1a2e', border: '1px solid #334155', color: '#f1f5f9', borderRadius: '6px', fontSize: '12px', boxSizing: 'border-box' }}>
                  {CATEGORIES.map(cat => (<option key={cat.name} value={cat.name}>{cat.name}</option>))}
                </select>
                <input type="date" value={expenseForm.expense_date} onChange={(e) => setExpenseForm({ ...expenseForm, expense_date: e.target.value })} style={{ width: '100%', padding: '10px', marginBottom: '10px', backgroundColor: '#1a1a2e', border: '1px solid #334155', color: '#f1f5f9', borderRadius: '6px', fontSize: '12px', boxSizing: 'border-box' }} />
                <div style={{ display: 'flex', gap: '10px' }}>
                  <button onClick={handleAddExpense} style={{ flex: 1, backgroundColor: '#6366f1', color: '#fff', border: 'none', padding: '10px', borderRadius: '6px', cursor: 'pointer', fontSize: '12px' }}>Save</button>
                  <button onClick={() => setShowExpenseForm(false)} style={{ flex: 1, backgroundColor: '#1a1a2e', color: '#94a3b8', border: '1px solid #334155', padding: '10px', borderRadius: '6px', cursor: 'pointer', fontSize: '12px' }}>Cancel</button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* BUDGETS TAB */}
        {activeTab === 'budgets' && (
          <div>
            {budgets.length > 0 && (
              <div style={{ marginBottom: '20px' }}>
                <h3 style={{ fontSize: '14px', fontWeight: '600', marginBottom: '12px' }}>Budgets</h3>
                {budgets.map(budget => {
                  const spent = expenses.filter(e => e.category === budget.category).reduce((sum, e) => sum + parseFloat(e.amount), 0);
                  const percent = Math.round((spent / budget.limit_amount) * 100);
                  const barColor = spent > budget.limit_amount ? '#ef4444' : percent > 80 ? '#f59e0b' : '#10b981';

                  return (
                    <div key={budget.id} style={{ backgroundColor: '#0f0f1a', border: '1px solid #1e293b', borderRadius: '10px', padding: '12px', marginBottom: '8px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                        <div style={{ fontSize: '12px', fontWeight: '600' }}>{budget.category}</div>
                        <button onClick={() => handleDeleteBudget(budget.id)} style={{ backgroundColor: 'transparent', border: 'none', color: '#64748b', fontSize: '10px', cursor: 'pointer' }}>Delete</button>
                      </div>
                      <div style={{ width: '100%', height: '6px', backgroundColor: '#1a1a2e', borderRadius: '3px', overflow: 'hidden', marginBottom: '4px' }}>
                        <div style={{ height: '100%', width: `${Math.min(percent, 100)}%`, backgroundColor: barColor }} />
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#94a3b8' }}>
                        <div>₹{spent.toLocaleString('en-IN')} / ₹{budget.limit_amount.toLocaleString('en-IN')}</div>
                        <div>{percent}%</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <button onClick={() => setShowBudgetForm(!showBudgetForm)} style={{ width: '100%', backgroundColor: '#6366f1', color: '#fff', border: 'none', padding: '12px', borderRadius: '8px', cursor: 'pointer', marginBottom: '16px' }}>
              + Add Budget
            </button>

            {showBudgetForm && (
              <div style={{ backgroundColor: '#0f0f1a', border: '1px solid #1e293b', borderRadius: '12px', padding: '16px' }}>
                <select value={budgetForm.category} onChange={(e) => setBudgetForm({ ...budgetForm, category: e.target.value })} style={{ width: '100%', padding: '10px', marginBottom: '10px', backgroundColor: '#1a1a2e', border: '1px solid #334155', color: '#f1f5f9', borderRadius: '6px', fontSize: '12px', boxSizing: 'border-box' }}>
                  {CATEGORIES.map(cat => (<option key={cat.name} value={cat.name}>{cat.name}</option>))}
                </select>
                <input type="number" placeholder="Budget limit" value={budgetForm.limit_amount} onChange={(e) => setBudgetForm({ ...budgetForm, limit_amount: e.target.value })} style={{ width: '100%', padding: '10px', marginBottom: '10px', backgroundColor: '#1a1a2e', border: '1px solid #334155', color: '#f1f5f9', borderRadius: '6px', fontSize: '12px', boxSizing: 'border-box' }} />
                <div style={{ display: 'flex', gap: '10px' }}>
                  <button onClick={handleAddBudget} style={{ flex: 1, backgroundColor: '#6366f1', color: '#fff', border: 'none', padding: '10px', borderRadius: '6px', cursor: 'pointer', fontSize: '12px' }}>Save</button>
                  <button onClick={() => setShowBudgetForm(false)} style={{ flex: 1, backgroundColor: '#1a1a2e', color: '#94a3b8', border: '1px solid #334155', padding: '10px', borderRadius: '6px', cursor: 'pointer', fontSize: '12px' }}>Cancel</button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* SUBSCRIPTIONS TAB */}
        {activeTab === 'subscriptions' && (
          <div>
            {subscriptions.length > 0 && (
              <div style={{ marginBottom: '20px' }}>
                <h3 style={{ fontSize: '14px', fontWeight: '600', marginBottom: '12px' }}>Subscriptions</h3>
                {subscriptions.map(sub => {
                  const cycles = { monthly: 1, quarterly: 3, yearly: 12 };
                  const monthlyAmount = parseFloat(sub.amount) / cycles[sub.cycle];

                  return (
                    <div key={sub.id} style={{ backgroundColor: '#0f0f1a', border: '1px solid #1e293b', borderRadius: '10px', padding: '12px', marginBottom: '8px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                        <div>
                          <div style={{ fontSize: '12px', fontWeight: '600' }}>{sub.name}</div>
                          <div style={{ fontSize: '10px', color: '#64748b' }}>{sub.cycle}</div>
                        </div>
                        <button onClick={() => handleDeleteSubscription(sub.id)} style={{ backgroundColor: 'transparent', border: 'none', color: '#64748b', fontSize: '10px', cursor: 'pointer' }}>Delete</button>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#94a3b8' }}>
                        <div>₹{parseFloat(sub.amount).toLocaleString('en-IN')}</div>
                        <div>~₹{monthlyAmount.toLocaleString('en-IN', { maximumFractionDigits: 0 })}/mo</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <button onClick={() => setShowSubscriptionForm(!showSubscriptionForm)} style={{ width: '100%', backgroundColor: '#6366f1', color: '#fff', border: 'none', padding: '12px', borderRadius: '8px', cursor: 'pointer', marginBottom: '16px' }}>
              + Add Subscription
            </button>

            {showSubscriptionForm && (
              <div style={{ backgroundColor: '#0f0f1a', border: '1px solid #1e293b', borderRadius: '1px solid #1e293b', borderRadius: '12px', padding: '16px' }}>
                <input type="text" placeholder="Netflix, Spotify, etc" value={subscriptionForm.name} onChange={(e) => setSubscriptionForm({ ...subscriptionForm, name: e.target.value })} style={{ width: '100%', padding: '10px', marginBottom: '10px', backgroundColor: '#1a1a2e', border: '1px solid #334155', color: '#f1f5f9', borderRadius: '6px', fontSize: '12px', boxSizing: 'border-box' }} />
                <input type="number" placeholder="Amount" value={subscriptionForm.amount} onChange={(e) => setSubscriptionForm({ ...subscriptionForm, amount: e.target.value })} style={{ width: '100%', padding: '10px', marginBottom: '10px', backgroundColor: '#1a1a2e', border: '1px solid #334155', color: '#f1f5f9', borderRadius: '6px', fontSize: '12px', boxSizing: 'border-box' }} />
                <select value={subscriptionForm.cycle} onChange={(e) => setSubscriptionForm({ ...subscriptionForm, cycle: e.target.value })} style={{ width: '100%', padding: '10px', marginBottom: '10px', backgroundColor: '#1a1a2e', border: '1px solid #334155', color: '#f1f5f9', borderRadius: '6px', fontSize: '12px', boxSizing: 'border-box' }}>
                  <option value="monthly">Monthly</option>
                  <option value="quarterly">Quarterly</option>
                  <option value="yearly">Yearly</option>
                </select>
                <div style={{ display: 'flex', gap: '10px' }}>
                  <button onClick={handleAddSubscription} style={{ flex: 1, backgroundColor: '#6366f1', color: '#fff', border: 'none', padding: '10px', borderRadius: '6px', cursor: 'pointer', fontSize: '12px' }}>Save</button>
                  <button onClick={() => setShowSubscriptionForm(false)} style={{ flex: 1, backgroundColor: '#1a1a2e', color: '#94a3b8', border: '1px solid #334155', padding: '10px', borderRadius: '6px', cursor: 'pointer', fontSize: '12px' }}>Cancel</button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
