// src/app/subscription/page.jsx
'use client';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import NavbarClient from '@/components/NavbarClient';

const PLANS = [
  {
    id: 'free',
    name: 'Free',
    price: 0,
    label: '₹0 / month',
    color: '#64748b',
    features: ['Core keeps & calendar', 'AI assist (5/day)', 'Documents & kids upload', 'Family (2 members)', 'Daily Brief'],
    cta: 'Current Plan',
  },
  {
    id: 'plus',
    name: 'Plus',
    price: 99,
    label: '₹99 / month',
    color: '#6366f1',
    features: ['Everything in Free', 'Unlimited AI Assist', 'Voice input (Sarvam)', 'Memory Vault (2GB)', 'WhatsApp reminders', 'Family (5 members)', 'Priority support'],
    cta: 'Upgrade to Plus',
    badge: 'POPULAR',
  },
  {
    id: 'family',
    name: 'Family',
    price: 199,
    label: '₹199 / month',
    color: '#22c55e',
    features: ['Everything in Plus', 'Unlimited family members', 'Kids Space with PIN lock', 'All Cloud Spaces', 'Memory Vault (10GB)', 'Admin dashboard', '14-day free trial'],
    cta: 'Get Family Plan',
  },
];

export default function SubscriptionPage() {
  const [user, setUser] = useState(null);
  const [accessToken, setAccessToken] = useState(null);
  const [currentPlan, setCurrentPlan] = useState('free');
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(null);
  const [toast, setToast] = useState('');

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session?.user) return;
      setUser(session.user);
      setAccessToken(session.access_token); // FIX 1: capture token for Bearer auth
      supabase
        .from('subscriptions')
        .select('plan_id, is_active')
        .eq('user_id', session.user.id)
        .eq('is_active', true)
        .order('created_at', { ascending: false })
        .limit(1)
        .then(({ data }) => {
          if (data?.[0]?.plan_id) setCurrentPlan(data[0].plan_id);
          setLoading(false);
        });
    });
  }, []);

  function showToast(msg) { setToast(msg); setTimeout(() => setToast(''), 4000); }

  async function handleUpgrade(plan) {
    if (plan.id === 'free' || plan.id === currentPlan) return;
    setPaying(plan.id);

    // Load Razorpay checkout.js once
    if (!window.Razorpay) {
      await new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = 'https://checkout.razorpay.com/v1/checkout.js';
        s.onload = res; s.onerror = rej;
        document.body.appendChild(s);
      });
    }

    try {
      // FIX 2: pass plan (not plan_id/user_id), use Bearer token
      const res = await fetch('/api/razorpay/create-order', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ plan: plan.id }),
      });
      const order = await res.json();
      if (order.error) { showToast('Error: ' + order.error); setPaying(null); return; }

      const rzp = new window.Razorpay({
        key: order.key_id,            // FIX 3: key comes from API response, not env
        order_id: order.order_id,     // FIX 3: order-based flow, not subscription_id
        amount: order.amount,
        currency: order.currency,
        name: 'QuietKeep',
        description: `${plan.name} Plan — ₹${plan.price}/month`,
        image: '/qk-logo.svg',
        prefill: { email: user.email },
        theme: { color: plan.color },
        handler: async (response) => {
          const verifyRes = await fetch('/api/razorpay/verify', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${accessToken}`,
            },
            body: JSON.stringify({
              razorpay_order_id: response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature: response.razorpay_signature,
              plan: plan.id,
            }),
          });
          const result = await verifyRes.json();
          if (result.success) {
            setCurrentPlan(plan.id);
            showToast(`🎉 Upgraded to ${plan.name}!`);
          } else {
            showToast('Payment verification failed. Contact support.');
          }
          setPaying(null);
        },
        modal: { ondismiss: () => setPaying(null) },
      });
      rzp.open();
    } catch (e) {
      console.error(e);
      showToast('Payment setup failed. Please try again.');
      setPaying(null);
    }
  }

  if (loading) return (
    <div style={{ minHeight: '100vh', background: '#0d1117', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6366f1' }}>
      Loading...
    </div>
  );

  return (
    <>
      <NavbarClient />
      <div style={{ minHeight: '100vh', background: '#0d1117', color: '#f1f5f9', paddingBottom: '80px', paddingTop: '96px' }}>
        {toast && (
          <div style={{ position: 'fixed', top: '70px', left: '50%', transform: 'translateX(-50%)', background: '#1e1e2e', border: '1px solid #6366f1', borderRadius: '10px', padding: '10px 20px', color: '#f1f5f9', fontSize: '14px', zIndex: 9999 }}>
            {toast}
          </div>
        )}
        <div style={{ maxWidth: '600px', margin: '0 auto', padding: '24px 16px' }}>
          <div style={{ textAlign: 'center', marginBottom: '28px' }}>
            <h1 style={{ margin: 0, fontSize: '22px', fontWeight: 700 }}>QuietKeep Plans</h1>
            <p style={{ color: '#64748b', fontSize: '14px', marginTop: '6px' }}>Upgrade anytime. Cancel anytime. No hidden fees.</p>
          </div>

          {PLANS.map(plan => {
            const isCurrent = currentPlan === plan.id;
            return (
              <div key={plan.id} style={{ background: isCurrent ? 'rgba(99,102,241,0.06)' : '#0f0f1a', border: `1px solid ${isCurrent ? plan.color + '60' : '#1e1e2e'}`, borderRadius: '16px', padding: '22px', marginBottom: '14px', position: 'relative' }}>
                {plan.badge && (
                  <div style={{ position: 'absolute', top: '-10px', right: '18px', background: plan.color, color: '#fff', fontSize: '10px', fontWeight: 700, padding: '3px 10px', borderRadius: '20px', letterSpacing: '0.08em' }}>
                    {plan.badge}
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '14px' }}>
                  <div>
                    <div style={{ fontSize: '18px', fontWeight: 700, color: plan.color }}>{plan.name}</div>
                    <div style={{ fontSize: '22px', fontWeight: 800, marginTop: '2px' }}>{plan.label}</div>
                  </div>
                  {isCurrent && (
                    <div style={{ background: 'rgba(99,102,241,0.15)', color: '#a5b4fc', padding: '4px 12px', borderRadius: '20px', fontSize: '11px', fontWeight: 600 }}>
                      CURRENT
                    </div>
                  )}
                </div>
                <ul style={{ margin: '0 0 16px', padding: '0 0 0 4px', listStyle: 'none' }}>
                  {plan.features.map(f => (
                    <li key={f} style={{ fontSize: '13px', color: '#94a3b8', marginBottom: '5px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ color: plan.color }}>✓</span> {f}
                    </li>
                  ))}
                </ul>
                <button
                  onClick={() => handleUpgrade(plan)}
                  disabled={isCurrent || paying === plan.id}
                  style={{ width: '100%', padding: '13px', borderRadius: '10px', border: 'none', background: isCurrent ? 'rgba(99,102,241,0.1)' : plan.color, color: isCurrent ? '#475569' : '#fff', fontSize: '14px', fontWeight: 600, cursor: isCurrent ? 'default' : 'pointer', opacity: paying && paying !== plan.id ? 0.5 : 1 }}
                >
                  {paying === plan.id ? 'Opening payment...' : isCurrent ? 'Current Plan' : plan.cta}
                </button>
              </div>
            );
          })}

          <div style={{ textAlign: 'center', fontSize: '12px', color: '#334155', marginTop: '16px' }}>
            Payments powered by Razorpay · UPI, Cards, Net Banking accepted<br />
            <a href="mailto:hello@quietkeep.com" style={{ color: '#475569' }}>Contact support</a>
          </div>
        </div>
      </div>
    </>
  );
            }
