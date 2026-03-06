'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

export default function ChartsComponent() {
  const [user, setUser] = useState(null);
  const [expenses, setExpenses] = useState([]);
  const [budgets, setBudgets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('category');

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session) {
        setUser(session.user);
        const uid = session.user.id;

        const { data: exp } = await supabase
          .from('expenses')
          .select('*')
          .eq('user_id', uid);
        setExpenses(exp || []);

        const { data: bud } = await supabase
          .from('budgets')
          .select('*')
          .eq('user_id', uid);
        setBudgets(bud || []);
      }
      setLoading(false);
    });
  }, []);

  const getCategoryData = () => {
    const categoryMap = {};
    expenses.forEach(exp => {
      if (!categoryMap[exp.category]) {
        categoryMap[exp.category] = 0;
      }
      categoryMap[exp.category] += exp.amount || 0;
    });

    return Object.entries(categoryMap).map(([category, amount]) => ({
      category,
      amount: parseFloat(amount.toFixed(0)),
    })).sort((a, b) => b.amount - a.amount);
  };

  const getBudgetVsActualData = () => {
    const data = budgets.map(budget => {
      const spent = expenses
        .filter(e => e.category === budget.category)
        .reduce((sum, e) => sum + (e.amount || 0), 0);

      return {
        name: budget.category,
        spent: parseFloat(spent.toFixed(0)),
        limit: budget.limit_amount,
      };
    });

    return data;
  };

  const getTrendData = () => {
    const monthData = {};
    const today = new Date();

    for (let i = 5; i >= 0; i--) {
      const date = new Date(today.getFullYear(), today.getMonth() - i, 1);
      const key = date.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
      monthData[key] = 0;
    }

    expenses.forEach(exp => {
      if (exp.date) {
        const expDate = new Date(exp.date);
        const key = expDate.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
        if (monthData.hasOwnProperty(key)) {
          monthData[key] += exp.amount || 0;
        }
      }
    });

    return Object.entries(monthData).map(([month, amount]) => ({
      month,
      amount: parseFloat(amount.toFixed(0)),
    }));
  };

  const categoryData = getCategoryData();
  const budgetData = getBudgetVsActualData();
  const trendData = getTrendData();

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '20px', color: '#94a3b8' }}>
        Loading charts...
      </div>
    );
  }

  if (expenses.length === 0) {
    return (
      <div style={{ marginTop: '32px', backgroundColor: '#0f0f1a', border: '1px solid #1e293b', borderRadius: '12px', padding: '20px', textAlign: 'center' }}>
        <div style={{ fontSize: '14px', color: '#94a3b8' }}>📊 Add expenses to see charts</div>
      </div>
    );
  }

  return (
    <div style={{ marginTop: '32px' }}>
      <h2 style={{ fontSize: '16px', fontWeight: '700', margin: '0 0 12px' }}>📊 Analytics</h2>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', marginBottom: '24px' }}>
        <button
          onClick={() => setActiveTab('category')}
          style={{
            backgroundColor: activeTab === 'category' ? '#6366f1' : '#1e1e2e',
            border: '1px solid #334155',
            color: '#f1f5f9',
            padding: '10px',
            borderRadius: '8px',
            fontSize: '12px',
            fontWeight: '600',
            cursor: 'pointer',
          }}
        >
          By Category
        </button>
        <button
          onClick={() => setActiveTab('budget')}
          style={{
            backgroundColor: activeTab === 'budget' ? '#6366f1' : '#1e1e2e',
            border: '1px solid #334155',
            color: '#f1f5f9',
            padding: '10px',
            borderRadius: '8px',
            fontSize: '12px',
            fontWeight: '600',
            cursor: 'pointer',
          }}
        >
          Budget vs Actual
        </button>
        <button
          onClick={() => setActiveTab('trend')}
          style={{
            backgroundColor: activeTab === 'trend' ? '#6366f1' : '#1e1e2e',
            border: '1px solid #334155',
            color: '#f1f5f9',
            padding: '10px',
            borderRadius: '8px',
            fontSize: '12px',
            fontWeight: '600',
            cursor: 'pointer',
          }}
        >
          Trend
        </button>
      </div>

      <div style={{ backgroundColor: '#0f0f1a', border: '1px solid #1e293b', borderRadius: '12px', padding: '20px', minHeight: '350px' }}>
        {activeTab === 'category' && categoryData.length > 0 && (
          <div>
            <h3 style={{ fontSize: '14px', fontWeight: '600', margin: '0 0 16px', color: '#e2e8f0' }}>Expenses by Category</h3>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={categoryData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="category" stroke="#94a3b8" fontSize={12} />
                <YAxis stroke="#94a3b8" fontSize={12} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#1a1a2e', border: '1px solid #334155', borderRadius: '8px', color: '#f1f5f9' }}
                  formatter={(value) => `₹${value.toLocaleString('en-IN')}`}
                />
                <Bar dataKey="amount" fill="#6366f1" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {activeTab === 'budget' && budgetData.length > 0 && (
          <div>
            <h3 style={{ fontSize: '14px', fontWeight: '600', margin: '0 0 16px', color: '#e2e8f0' }}>Budget Status</h3>
            <div style={{ display: 'grid', gap: '12px' }}>
              {budgetData.map((budget, idx) => (
                <div key={idx} style={{ backgroundColor: '#1a1a2e', borderRadius: '8px', padding: '12px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                    <div style={{ fontSize: '12px', fontWeight: '600', color: '#e2e8f0' }}>{budget.name}</div>
                    <div style={{ fontSize: '12px', color: budget.spent > budget.limit ? '#ef4444' : '#10b981' }}>
                      ₹{budget.spent.toLocaleString('en-IN')} / ₹{budget.limit.toLocaleString('en-IN')}
                    </div>
                  </div>
                  <div style={{ width: '100%', height: '6px', backgroundColor: '#0f0f1a', borderRadius: '3px', overflow: 'hidden' }}>
                    <div
                      style={{
                        height: '100%',
                        width: `${Math.min((budget.spent / budget.limit) * 100, 100)}%`,
                        backgroundColor: budget.spent > budget.limit ? '#ef4444' : budget.spent > budget.limit * 0.8 ? '#f59e0b' : '#10b981',
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'trend' && trendData.length > 0 && (
          <div>
            <h3 style={{ fontSize: '14px', fontWeight: '600', margin: '0 0 16px', color: '#e2e8f0' }}>Last 6 Months Trend</h3>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={trendData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="month" stroke="#94a3b8" fontSize={12} />
                <YAxis stroke="#94a3b8" fontSize={12} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#1a1a2e', border: '1px solid #334155', borderRadius: '8px', color: '#f1f5f9' }}
                  formatter={(value) => `₹${value.toLocaleString('en-IN')}`}
                />
                <Line 
                  type="monotone" 
                  dataKey="amount" 
                  stroke="#6366f1" 
                  strokeWidth={2} 
                  dot={{ fill: '#6366f1', r: 4 }}
                  activeDot={{ r: 6 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        {activeTab === 'category' && categoryData.length === 0 && (
          <div style={{ textAlign: 'center', color: '#94a3b8' }}>No expense data</div>
        )}

        {activeTab === 'budget' && budgetData.length === 0 && (
          <div style={{ textAlign: 'center', color: '#94a3b8' }}>No budget data</div>
        )}
      </div>
    </div>
  );
}
