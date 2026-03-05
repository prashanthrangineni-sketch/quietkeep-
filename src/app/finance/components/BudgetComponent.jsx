'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';

export default function BudgetComponent() {
  const [user, setUser] = useState(null);
  const [budgets, setBudgets] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({
    category: 'Food',
    limit_amount: '',
  });
  const [saving, setSaving] = useState(false);

  const CATEGORIES = ['Food', 'Travel', 'Shopping', 'Entertainment', 'Bills', 'Health', 'Other'];

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session) {
        setUser(session.user);
        const uid = session.user.id;

        // Get budgets
        const { data: bud } = await supabase
          .from('budgets')
          .select('*')
          .eq('user_id', uid)
          .order('category');
        setBudgets(bud || []);

        // Get expenses
        const { data: exp } = await supabase
          .from('expenses')
          .select('*')
          .eq('user_id', uid);
        setExpenses(exp || []);
      }
      setLoading(false);
    });
  }, []);

  const handleAddBudget = async () => {
    if (!formData.limit_amount) {
      alert('Budget amount required');
      return;
    }

    setSaving(true);
    const month = new Date().toISOString().slice(0, 7); // YYYY-MM

    // Check if budget exists for this category
    const existing = budgets.find(b => b.category === formData.category);

    if (existing) {
      // Update
      const { error } = await supabase
        .from('budgets')
        .update({ limit_amount: parseFloat(formData.limit_amount) })
        .eq('id', existing.id);

      if (!error) {
        setBudgets(budgets.map(b => 
          b.id === existing.id 
            ? { ...b, limit_amount: parseFloat(formData.limit_amount) }
            : b
        ));
      }
    } else {
      // Create new
      const { data, error } = await supabase
        .from('budgets')
        .insert({
          user_id: user.id,
          category: formData.category,
          limit_amount: parseFloat(formData.limit_amount),
          month,
        })
        .select()
        .single();

      if (!error) {
        setBudgets([...budgets, data]);
      }
    }

    setFormData({ category: 'Food', limit_amount: '' });
    setShowForm(false);
    setSaving(false);
  };

  const calculateBudgetStatus = (category) => {
    const budget = budgets.find(b => b.category === category);
    if (!budget) return null;

    const spent = expenses
      .filter(e => e.category === category)
      .reduce((sum, e) => sum + (e.amount || 0), 0);

    const percent = Math.round((spent / budget.limit_amount) * 100);
    const remaining = budget.limit_amount - spent;

    return {
      budget: budget.limit_amount,
      spent,
      remaining,
      percent,
      over: spent > budget.limit_amount,
    };
  };

  const handleDeleteBudget = async (id) => {
    await supabase.from('budgets').delete().eq('id', id);
    setBudgets(budgets.filter(b => b.id !== id));
  };

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', backgroundColor: '#0a0a0f', color: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        Loading...
      </div>
    );
  }

  return (
    <div style={{ marginTop: '32px' }}>
      <h2 style={{ fontSize: '16px', fontWeight: '700', margin: '0 0 12px' }}>💰 Budgets</h2>

      {/* Budget List */}
      {budgets.length > 0 && (
        <div style={{ display: 'grid', gap: '12px', marginBottom: '24px' }}>
          {budgets.map((budget) => {
            const status = calculateBudgetStatus(budget.category);
            const barColor = status.over ? '#ef4444' : status.percent > 80 ? '#f59e0b' : '#10b981';

            return (
              <div key={budget.id} style={{ backgroundColor: '#0f0f1a', border: '1px solid #1e293b', borderRadius: '12px', padding: '14px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <div style={{ fontWeight: '600', fontSize: '13px' }}>{budget.category}</div>
                  <button
                    onClick={() => handleDeleteBudget(budget.id)}
                    style={{ backgroundColor: 'transparent', border: 'none', color: '#64748b', fontSize: '11px', cursor: 'pointer' }}
                  >
                    Delete
                  </button>
                </div>

                {/* Progress Bar */}
                <div style={{ width: '100%', height: '8px', backgroundColor: '#1a1a2e', borderRadius: '4px', marginBottom: '8px', overflow: 'hidden' }}>
                  <div
                    style={{
                      height: '100%',
                      width: `${Math.min(status.percent, 100)}%`,
                      backgroundColor: barColor,
                      transition: 'width 0.3s',
                    }}
                  />
                </div>

                {/* Stats */}
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#94a3b8' }}>
                  <div>₹{status.spent.toLocaleString('en-IN')} / ₹{status.budget.toLocaleString('en-IN')}</div>
                  <div style={{ color: status.over ? '#ef4444' : '#10b981', fontWeight: '600' }}>
                    {status.percent}%
                  </div>
                </div>

                {status.over && (
                  <div style={{ color: '#ef4444', fontSize: '10px', marginTop: '4px' }}>
                    ⚠️ Over budget by ₹{Math.abs(status.remaining).toLocaleString('en-IN')}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Add Budget Button */}
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
        + Add Budget
      </button>

      {/* Add Budget Form */}
      {showForm && (
        <div style={{ backgroundColor: '#0f0f1a', border: '1px solid #1e293b', borderRadius: '14px', padding: '20px', marginBottom: '24px' }}>
          <h3 style={{ fontSize: '16px', fontWeight: '700', color: '#f1f5f9', margin: '0 0 16px' }}>Set Budget</h3>

          <select
            value={formData.category}
            onChange={(e) => setFormData({ ...formData, category: e.target.value })}
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
          >
            {CATEGORIES.map(cat => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>

          <input
            type="number"
            placeholder="Budget limit (₹)"
            value={formData.limit_amount}
            onChange={(e) => setFormData({ ...formData, limit_amount: e.target.value })}
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
              onClick={handleAddBudget}
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
              {saving ? 'Saving...' : 'Save Budget'}
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
    </div>
  );
}
