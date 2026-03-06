'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import BudgetComponent from './components/BudgetComponent';
import SubscriptionComponent from './components/SubscriptionComponent';
import ChartsComponent from './components/ChartsComponent';

const CATEGORIES = [
  { name: 'Food', emoji: '🍔', color: '#ef4444' },
  { name: 'Travel', emoji: '🚗', color: '#3b82f6' },
  { name: 'Shopping', emoji: '🛍️', color: '#ec4899' },
  { name: 'Entertainment', emoji: '🎬', color: '#f59e0b' },
  { name: 'Bills', emoji: '📄', color: '#8b5cf6' },
  { name: 'Health', emoji: '⚕️', color: '#10b981' },
  { name: 'Other', emoji: '📌', color: '#64748b' },
];

export default function ExpenseComponent() {
  const [user, setUser] = useState(null);
  const [expenses, setExpenses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({
    description: '',
    amount: '',
    category: 'Food',
    date: new Date().toISOString().split('T')[0],
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session) {
        setUser(session.user);
        const { data } = await supabase
          .from('expenses')
          .select('*')
          .eq('user_id', session.user.id)
          .order('date', { ascending: false })
          .limit(10);
        setExpenses(data || []);
      }
      setLoading(false);
    });
  }, []);

  const handleAddExpense = async () => {
    if (!formData.description.trim() || !formData.amount) {
      alert('Description and amount required');
      return;
    }

    setSaving(true);
    const { data, error } = await supabase
      .from('expenses')
      .insert({
        user_id: user.id,
        description: formData.description,
        amount: parseFloat(formData.amount),
        category: formData.category,
        date: formData.date,
      })
      .select()
      .single();

    if (!error) {
      setExpenses([data, ...expenses]);
      setFormData({
        description: '',
        amount: '',
        category: 'Food',
        date: new Date().toISOString().split('T')[0],
      });
      setShowForm(false);
    } else {
      alert('Error adding expense: ' + error.message);
    }
    setSaving(false);
  };

  const handleDelete = async (id) => {
    await supabase.from('expenses').delete().eq('id', id);
    setExpenses(expenses.filter(e => e.id !== id));
  };

  const totalExpenses = expenses.reduce((sum, e) => sum + (e.amount || 0), 0);

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', backgroundColor: '#0a0a0f', color: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        Loading...
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#0a0a0f', color: '#f1f5f9', padding: '24px 16px' }}>
      <div style={{ maxWidth: '600px', margin: '0 auto' }}>
        <div style={{ marginBottom: '32px' }}>
          <h1 style={{ fontSize: '32px', fontWeight: '800', margin: '0 0 8px' }}>💰 Finance</h1>
          <div style={{ fontSize: '14px', color: '#94a3b8' }}>Track spending & budgets</div>
        </div>

        {/* Summary Card */}
        <div style={{ backgroundColor: '#0f0f1a', border: '1px solid #1e293b', borderRadius: '14px', padding: '20px', marginBottom: '24px' }}>
          <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '8px' }}>Total Expenses</div>
          <div style={{ fontSize: '32px', fontWeight: '800', color: '#6366f1' }}>₹{totalExpenses.toLocaleString('en-IN')}</div>
        </div>

        {/* Recent Expenses */}
        {expenses.length > 0 && (
          <div style={{ marginBottom: '24px' }}>
            <h2 style={{ fontSize: '16px', fontWeight: '700', margin: '0 0 12px' }}>Recent Expenses</h2>
            <div style={{ display: 'grid', gap: '10px' }}>
              {expenses.map((exp) => {
                const cat = CATEGORIES.find(c => c.name === exp.category) || CATEGORIES[6];
                return (
                  <div key={exp.id} style={{ backgroundColor: '#0f0f1a', border: '1px solid #1e293b', borderRadius: '12px', padding: '14px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div style={{ fontSize: '24px' }}>{cat.emoji}</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '13px', fontWeight: '600', color: '#e2e8f0' }}>{exp.description}</div>
                      <div style={{ fontSize: '11px', color: '#475569', marginTop: '2px' }}>{new Date(exp.date).toLocaleDateString('en-IN')}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: '13px', fontWeight: '700', color: '#ef4444' }}>₹{Number(exp.amount).toLocaleString('en-IN')}</div>
                      <button onClick={() => handleDelete(exp.id)} style={{ backgroundColor: 'transparent', border: 'none', color: '#64748b', fontSize: '11px', cursor: 'pointer', marginTop: '2px' }}>
                        Delete
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Category Buttons */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(80px, 1fr))', gap: '8px', marginBottom: '24px' }}>
          {CATEGORIES.map((cat) => (
            <button
              key={cat.name}
              onClick={() => setFormData({ ...formData, category: cat.name })}
              style={{
                backgroundColor: formData.category === cat.name ? cat.color : '#1e1e2e',
                border: '1px solid #334155',
                color: '#f1f5f9',
                padding: '12px',
                borderRadius: '8px',
                cursor: 'pointer',
                fontSize: '12px',
                fontWeight: '600',
              }}
            >
              {cat.emoji} {cat.name}
            </button>
          ))}
        </div>

        {/* Add Expense Button */}
        <button
          onClick={() => setShowForm(!showForm)}
          style={{
            width: '100%',
            backgroundColor: '#6366f1',
            color: '#fff',
            border: 'none',
            padding: '12px',
            borderRadius: '8px',
            fontSize: '14px',
            fontWeight: '600',
            cursor: 'pointer',
            marginBottom: '24px',
          }}
        >
          + Add Expense
        </button>

        {/* Add Expense Form */}
        {showForm && (
          <div style={{ backgroundColor: '#0f0f1a', border: '1px solid #1e293b', borderRadius: '14px', padding: '20px', marginBottom: '24px' }}>
            <h3 style={{ fontSize: '16px', fontWeight: '700', color: '#f1f5f9', margin: '0 0 16px' }}>New Expense</h3>
            
            <input
              type="text"
              placeholder="What did you spend on?"
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              style={{
                width: '100%',
                backgroundColor: '#1a1a2e',
                border: '1px solid #334155',
                color: '#f1f5f9',
                padding: '10px 12px',
                borderRadius: '8px',
                fontSize: '13px',
                marginBottom: '12px',
                boxSizing: 'border-box',
              }}
            />

            <input
              type="number"
              placeholder="Amount (₹)"
              value={formData.amount}
              onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
              style={{
                width: '100%',
                backgroundColor: '#1a1a2e',
                border: '1px solid #334155',
                color: '#f1f5f9',
                padding: '10px 12px',
                borderRadius: '8px',
                fontSize: '13px',
                marginBottom: '12px',
                boxSizing: 'border-box',
              }}
            />

            <input
              type="date"
              value={formData.date}
              onChange={(e) => setFormData({ ...formData, date: e.target.value })}
              style={{
                width: '100%',
                backgroundColor: '#1a1a2e',
                border: '1px solid #334155',
                color: '#f1f5f9',
                padding: '10px 12px',
                borderRadius: '8px',
                fontSize: '13px',
                marginBottom: '16px',
                boxSizing: 'border-box',
              }}
            />

            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={handleAddExpense}
                disabled={saving}
                style={{
                  flex: 1,
                  backgroundColor: '#6366f1',
                  color: '#fff',
                  border: 'none',
                  padding: '10px',
                  borderRadius: '8px',
                  fontSize: '13px',
                  fontWeight: '600',
                  cursor: 'pointer',
                }}
              >
                {saving ? 'Saving...' : 'Save Expense'}
              </button>
              <button
                onClick={() => setShowForm(false)}
                style={{
                  flex: 1,
                  backgroundColor: '#1a1a2e',
                  color: '#94a3b8',
                  border: '1px solid #334155',
                  padding: '10px',
                  borderRadius: '8px',
                  fontSize: '13px',
                  fontWeight: '600',
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Budget Component */}
        <BudgetComponent />

        {/* Subscription Component */}
        <SubscriptionComponent />

        {/* Charts Component */}
        <ChartsComponent />
      </div>
    </div>
  );
}
