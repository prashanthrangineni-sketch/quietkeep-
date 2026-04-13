'use client';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/context/auth';
import { apiPost } from '@/lib/safeFetch';
// src/app/subscription/page.jsx — In-app subscription upgrade page
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import NavbarClient from '@/components/NavbarClient';

const PLANS = [
  {
    id: 'free',
    name: 'Free',
    label: '₹0 / month',
    price: 0,
    color: '#64748b',
    monthlyKey: null,
    yearlyKey: null,
    features: ['Unlimited keeps', 'Smart reminders (5/day)', 'Indian Calendar', 'Drive Mode', 'Family (2 members)'],
    cta: 'Current Plan',
  },
  {
    id: 'plus',
    name: 'Plus',
    label: '₹99 / month',
    yearlyLabel: '₹83 / month (₹990/yr)',
    price: 99,
    yearlyPrice: 990,
    color: '#6366f1',
    monthlyKey: 'plus',
    yearlyKey: 'plus_yearly',
    badge: 'POPULAR',
    features: ['Unlimited Warranty Wallet', 'WhatsApp invoice OCR', 'Unlimited AI Assist', 'Voice (Hindi/Telugu)', 'WhatsApp reminders', 'Family (10 members)', 'Memory Vault 5GB'],
    cta: 'Upgrade to Plus',
  },
  {
    id: 'family',
    name: 'Family',
    label: '₹199 / month',
    yearlyLabel: '₹166 / month (₹1990/yr)',
    price: 199,
    yearlyPrice: 1990,
    color: '#22c55e',
    monthlyKey: 'family',
    yearlyKey: 'family_yearly',
    features: ['Everything in Plus', 'Unlimited family members', 'Kids Space + PIN lock', 'Memory Vault 20GB', 'Admin dashboard'],
    cta: 'Get Family Plan',
  },
];

export default function SubscriptionPage() {
  const router = useRouter();
  const { user, accessToken, loading: authLoading } = useAuth();
  const [currentPlan, setCurrentPlan] = useState('free');
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(null);
  const [annual, setAnnual] = useState(false);
  const [toast, setToast] = useState('');

  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.replace('/login'); return; }
    supabase
            .from('subscriptions')
            .select('plan_id, is_active')
            .eq('user_id', user?.id)
            .eq('is_active', true)
            .single()
            .then(({ data }) => {
              if (data?.plan_id) setCurrentPlan(data.plan_id.replace('_yearly', ''));
              setLoading(false);
            });
  }, [user]);

  async function handleUpgrade(plan) {
    if (!user || !accessToken) return;
    const planKey = annual ? plan.yearlyKey : plan.monthlyKey;
    if (!planKey) return;

    setPaying(plan.id);
    try {
      const { data: res, error: resErr } = await apiPost('/api/razorpay/create-order', { plan: planKey }, accessToken);
      const order = res;
      if (resErr || !res) throw new Error(order.error || 'Failed to create order');

      const rzp = new window.Razorpay({
        key: order.key_id,
        amount: order.amount,
        currency: order.currency,
        name: 'QuietKeep',
        description: order.plan_name,
        order_id: order.order_id,
        prefill: { email: user.email },
        theme: { color: '#6366f1' },
        handler: async function (response) {
          const { data: verifyRes, error: verifyResErr } = await apiPost('/api/razorpay/verify', { ...response, plan: planKey }, accessToken);
          const result = verifyRes;
          if (result.success) {
            setCurrentPlan(plan.id);
            setToast(`✅ ${order.plan_name} activated! Enjoy your upgrade.`);
            setTimeout(() => setToast(''), 5000);
          } else {
            setToast('❌ Payment verification failed. Contact support.');
          }
          setPaying(null);
        },
        modal: { ondismiss: () => setPaying(null) },
      });
      rzp.open();
    } catch (err) {
      console.error('[upgrade] error:', err);
      setToast(`❌ ${err.message || 'Payment failed. Try again.'}`);
      setPaying(null);
    }
  }

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="qk-spinner" />
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--text)', fontFamily: "'Inter',-apple-system,sans-serif" }}>
      <script src="https://checkout.razorpay.com/v1/checkout.js" async />
      <NavbarClient user={user} />

      {/* Toast */}
      {toast && (
        <div style={{ position: 'fixed', top: 80, left: '50%', transform: 'translateX(-50%)', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '12px 20px', fontSize: 14, fontWeight: 600, color: 'var(--text)', zIndex: 9999, boxShadow: 'var(--shadow)', whiteSpace: 'nowrap' }}>
          {toast}
        </div>
      )}

      <main style={{ maxWidth: 860, margin: '0 auto', padding: '80px 16px 60px' }}>
        <h1 style={{ fontSize: 28, fontWeight: 900, textAlign: 'center', margin: '0 0 8px', letterSpacing: '-0.5px' }}>Choose your plan</h1>
        <p style={{ fontSize: 14, color: 'var(--text-muted)', textAlign: 'center', margin: '0 0 32px' }}>
          Current plan: <strong style={{ color: 'var(--primary)', textTransform: 'capitalize' }}>{currentPlan}</strong>
        </p>

        {/* Monthly / Yearly toggle */}
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 32 }}>
          <div style={{ display: 'inline-flex', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 4, gap: 4 }}>
            <button onClick={() => setAnnual(false)} style={{ padding: '8px 18px', borderRadius: 9, border: 'none', background: !annual ? 'var(--primary)' : 'transparent', color: !annual ? '#fff' : 'var(--text-muted)', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
              Monthly
            </button>
            <button onClick={() => setAnnual(true)} style={{ padding: '8px 18px', borderRadius: 9, border: 'none', background: annual ? 'var(--primary)' : 'transparent', color: annual ? '#fff' : 'var(--text-muted)', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 6 }}>
              Yearly
              <span style={{ background: '#22c55e', color: '#fff', fontSize: 9, fontWeight: 800, padding: '1px 5px', borderRadius: 999 }}>2 FREE</span>
            </button>
          </div>
        </div>

        {/* Plan cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 16 }}>
          {PLANS.map((plan) => {
            const isCurrent = currentPlan === plan.id || (currentPlan === 'premium' && plan.id === 'plus');
            const price = annual && plan.yearlyPrice ? Math.round(plan.yearlyPrice / 12) : plan.price;
            const label = annual && plan.yearlyLabel ? plan.yearlyLabel : plan.label;

            return (
              <div key={plan.id} style={{ background: 'var(--surface)', border: `2px solid ${isCurrent ? plan.color : 'var(--border)'}`, borderRadius: 18, padding: 24, display: 'flex', flexDirection: 'column', boxShadow: isCurrent ? `0 4px 24px ${plan.color}22` : 'var(--shadow-card)', position: 'relative' }}>
                {plan.badge && (
                  <div style={{ position: 'absolute', top: -11, right: 16, background: plan.color, color: '#fff', fontSize: 9, fontWeight: 800, padding: '2px 10px', borderRadius: 999 }}>
                    {plan.badge}
                  </div>
                )}
                {isCurrent && (
                  <div style={{ position: 'absolute', top: -11, left: 16, background: '#22c55e', color: '#fff', fontSize: 9, fontWeight: 800, padding: '2px 10px', borderRadius: 999 }}>
                    ACTIVE
                  </div>
                )}

                <h3 style={{ fontSize: 18, fontWeight: 800, color: 'var(--text)', margin: '0 0 4px' }}>{plan.name}</h3>
                <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 16px' }}>{label}</p>

                <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 20px', flex: 1 }}>
                  {plan.features.map((f) => (
                    <li key={f} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 7, fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                      <span style={{ color: plan.color, flexShrink: 0, fontWeight: 700 }}>✓</span> {f}
                    </li>
                  ))}
                </ul>

                <button
                  onClick={() => !isCurrent && plan.monthlyKey && handleUpgrade(plan)}
                  disabled={isCurrent || paying === plan.id || !plan.monthlyKey}
                  style={{
                    padding: '11px',
                    borderRadius: 10,
                    border: `2px solid ${plan.color}`,
                    background: isCurrent ? plan.color : 'transparent',
                    color: isCurrent ? '#fff' : plan.color,
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: isCurrent || !plan.monthlyKey ? 'default' : 'pointer',
                    fontFamily: 'inherit',
                    opacity: paying && paying !== plan.id ? 0.5 : 1,
                  }}
                >
                  {paying === plan.id ? 'Processing…' : isCurrent ? '✓ Active' : plan.cta}
                </button>
              </div>
            );
          })}
        </div>

        <p style={{ textAlign: 'center', fontSize: 12, color: 'var(--text-subtle)', marginTop: 28 }}>
          Payments via Razorpay · UPI, cards, net banking · Prices in ₹ INR · 7-day refund policy
        </p>
      </main>
    </div>
  );
}
