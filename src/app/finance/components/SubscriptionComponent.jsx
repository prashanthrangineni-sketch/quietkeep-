'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';

export default function SubscriptionComponent() {
  const [user, setUser] = useState(null);
  const [subscriptions, setSubscriptions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    amount: '',
    cycle: 'monthly',
  });
  const [saving, setSaving] = useState(false);

  const CYCLES = [
    { value: 'monthly', label: 'Monthly', months: 1 },
    { value: 'quarterly', label: 'Quarterly', months: 3 },
    { value: 'yearly', label: 'Yearly', months: 12 },
  ];

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session) {
        setUser(session.user);
        const { data } = await supabase
          .from('subscriptions')
          .select('*')
          .eq('user_id', session.user.id)
          .order('name');
        setSubscriptions(data || []);
      }
      setLoading(false);
    });
  }, []);

  const handleAddSubscription = async () => {
    if (!formData.name.trim() || !formData.amount) {
      alert('Name and amount required');
      return;
    }

    setSaving(true);
    
    // Calculate next due date
    const cycleConfig = CYCLES.find(c => c.value === formData.cycle);
    const nextDue = new Date();
    nextDue.setMonth(nextDue.getMonth() + cycleConfig.months);

    const { data, error } = await supabase
      .from('subscriptions')
      .insert({
        user_id: user.id,
        name: formData.name,
        amount: parseFloat(formData.amount),
        cycle: formData.cycle,
        next_due: nextDue.toISOString().split('T')[0],
      })
      .select()
      .single();

    if (!error) {
      setSubscriptions([...subscriptions, data]);
      setFormData({ name: '', amount: '', cycle: 'monthly' });
      setShowForm(false);
    } else {
      alert('Error: ' + error.message);
    }
    setSaving(false);
  };

  const handleDeleteSubscription = async (id) => {
    await supabase.from('subscriptions').delete().eq('id', id);
    setSubscriptions(subscriptions.filter(s => s.id !== id));
  };

  const calculateMonthlyRecurring = () => {
    return subscriptions.reduce((total, sub) => {
      const cycleConfig = CYCLES.find(c => c.value === sub.cycle);
      const monthlyAmount = sub.amount / cycleConfig.months;
      return total + monthlyAmount;
    }, 0);
  };

  const calculateAnnualRecurring = () => {
    return subscriptions.reduce((total, sub) => {
      const cycleConfig = CYCLES.find(c => c.value === sub.cycle);
      const annualAmount = (sub.amount / cycleConfig.months) * 12;
      return total + annualAmount;
    }, 0);
  };

  const monthlyTotal = calculateMonthlyRecurring();
  const annualTotal = calculateAnnualRecurring();

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', backgroundColor: '#0a0a0f', color: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        Loading...
      </div>
    );
  }

  return (
    <div style={{ marginTop: '32px' }}>
      <h2 style={{ fontSize: '16px', fontWeight: '700', margin: '0 0 12px' }}>📺 Subscriptions</h2>

      {/* Summary Cards */}
      {subscriptions.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '24px' }}>
          <div style={{ backgroundColor: '#0f0f1a', border: '1px solid #1e293b', borderRadius: '12px', padding: '14px' }}>
            <div style={{ fontSize: '11px', color: '#94a3b8', marginBottom: '4px' }}>Monthly Recurring</div>
            <div style={{ fontSize: '18px', fontWeight: '700', color: '#6366f1' }}>₹{monthlyTotal.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</div>
          </div>
          <div style={{ backgroundColor: '#0f0f1a', border: '1px solid #1e293b', borderRadius: '12px', padding: '14px' }}>
            <div style={{ fontSize: '11px', color: '#94a3b8', marginBottom: '4px' }}>Annual Recurring</div>
            <div style={{ fontSize: '18px', fontWeight: '700', color: '#8b5cf6' }}>₹{annualTotal.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</div>
          </div>
        </div>
      )}

      {/* Subscriptions List */}
      {subscriptions.length > 0 && (
        <div style={{ display: 'grid', gap: '12px', marginBottom: '24px' }}>
          {subscriptions.map((sub) => {
            const cycleConfig = CYCLES.find(c => c.value === sub.cycle);
            const monthlyAmount = sub.amount / cycleConfig.months;
            const daysUntilDue = sub.next_due ? Math.ceil((new Date(sub.next_due) - new Date()) / (1000 * 60 * 60 * 24)) : 0;
            const isDueSoon = daysUntilDue > 0 && daysUntilDue <= 7;
            const isOverdue = daysUntilDue <= 0;

            return (
              <div key={sub.id} style={{ backgroundColor: '#0f0f1a', border: isOverdue ? '1px solid #ef4444' : isDueSoon ? '1px solid #f59e0b' : '1px solid #1e293b', borderRadius: '12px', padding: '14px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                  <div>
                    <div style={{ fontSize: '13px', fontWeight: '600', color: '#e2e8f0' }}>{sub.name}</div>
                    <div style={{ fontSize: '11px', color: '#475569', marginTop: '2px' }}>{cycleConfig.label}</div>
                  </div>
                  <button
                    onClick={() => handleDeleteSubscription(sub.id)}
                    style={{ backgroundColor: 'transparent', border: 'none', color: '#64748b', fontSize: '11px', cursor: 'pointer' }}
                  >
                    Delete
                  </button>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '6px' }}>
                  <div style={{ color: '#94a3b8' }}>₹{sub.amount.toLocaleString('en-IN')}/{cycleConfig.value}</div>
                  <div style={{ color: '#6366f1', fontWeight: '600' }}>~₹{monthlyAmount.toLocaleString('en-IN', { maximumFractionDigits: 0 })}/mo</div>
                </div>

                {sub.next_due && (
                  <div style={{ fontSize: '10px', color: isOverdue ? '#ef4444' : isDueSoon ? '#f59e0b' : '#10b981' }}>
                    {isOverdue 
                      ? `⚠️ Overdue since ${new Date(sub.next_due).toLocaleDateString('en-IN')}`
                      : isDueSoon
                      ? `📅 Due in ${daysUntilDue} days`
                      : `✓ Next due: ${new Date(sub.next_due).toLocaleDateString('en-IN')}`
                    }
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {subscriptions.length === 0 && (
        <div style={{ backgroundColor: '#0f0f1a', border: '1px solid #1e293b', borderRadius: '12px', padding: '20px', textAlign: 'center', marginBottom: '24px' }}>
          <div style={{ fontSize: '24px', marginBottom: '12px' }}>📺</div>
          <div style={{ fontSize: '13px', color: '#94a3b8' }}>No subscriptions yet</div>
          <div style={{ fontSize: '11px', color: '#64748b', marginTop: '4px' }}>Netflix, Spotify, gym, etc.</div>
        </div>
      )}

      {/* Add Subscription Button */}
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
        + Add Subscription
      </button>

      {/* Add Subscription Form */}
      {showForm && (
        <div style={{ backgroundColor: '#0f0f1a', border: '1px solid #1e293b', borderRadius: '14px', padding: '20px' }}>
          <h3 style={{ fontSize: '16px', fontWeight: '700', color: '#f1f5f9', margin: '0 0 16px' }}>New Subscription</h3>

          <input
            type="text"
            placeholder="Name (Netflix, Spotify, etc)"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
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

          <select
            value={formData.cycle}
            onChange={(e) => setFormData({ ...formData, cycle: e.target.value })}
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
          >
            {CYCLES.map(cycle => (
              <option key={cycle.value} value={cycle.value}>{cycle.label}</option>
            ))}
          </select>

          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={handleAddSubscription}
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
              {saving ? 'Saving...' : 'Save Subscription'}
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
