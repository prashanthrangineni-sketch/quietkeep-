'use client';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/context/auth';
import { apiPost } from '@/lib/safeFetch';
// src/app/subscription/page.jsx — In-app subscription upgrade page
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { getAppType } from '@/lib/app-type';
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
  {
    id: 'business',
    tier: 'business',
    group: 'business',
    name: 'Business',
    label: '₹299 / month',
    yearlyLabel: '₹249 / month (₹2990/yr)',
    price: 299,
    yearlyPrice: 2990,
    color: '#10b981',
    monthlyKey: 'business',
    yearlyKey: 'business_yearly',
    badge: 'SMALL SHOP',
    features: ['For one shop or a solo business', 'GST invoicing', 'Voice business ledger', 'Stock and inventory', 'Customer list and reminders'],
    cta: 'Get Business',
  },
  {
    id: 'business_team',
    tier: 'growth',
    group: 'business',
    name: 'Business Team',
    label: '₹999 / month',
    yearlyLabel: '₹833 / month (₹9990/yr)',
    price: 999,
    yearlyPrice: 9990,
    color: '#0ea5e9',
    monthlyKey: 'business_team',
    yearlyKey: 'business_team_yearly',
    badge: 'STAFF OR FLEET',
    features: ['Everything in Business', 'For a business with staff or a fleet', 'Attendance and GPS check-in', 'Payroll and payslips', 'Team task board'],
    cta: 'Get Business Team',
  },
];

// Which card is "active" for the plan stored on the account.
const TIER_TO_CARD = { premium: 'plus', pro: 'plus', growth: 'business_team' };

export default function SubscriptionPage() {
  const router = useRouter();
  const { user, accessToken, loading: authLoading } = useAuth();
  const [currentPlan, setCurrentPlan] = useState('free');
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(null);
  const [annual, setAnnual] = useState(false);
  const [toast, setToast] = useState('');
  const [planEnds, setPlanEnds] = useState(null);
  const [codeText, setCodeText] = useState('');
  const [codeBusy, setCodeBusy] = useState(false);
  const [codeMsg, setCodeMsg] = useState('');

  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.replace('/login'); return; }
    loadPlan();
  }, [user, authLoading]);

  // The plan is read from the account itself, so a plan given by a free-period
  // code shows here the same way a paid one does.
  async function loadPlan() {
    const { data } = await supabase
      .from('profiles')
      .select('subscription_tier, subscription_expires_at')
      .eq('user_id', user?.id)
      .maybeSingle();
    const tier = data?.subscription_tier || 'free';
    setCurrentPlan(TIER_TO_CARD[tier] || tier);
    setPlanEnds(data?.subscription_expires_at || null);
    setLoading(false);
  }

  async function handleCode() {
    const code = codeText.trim().toUpperCase();
    if (!code || !accessToken || codeBusy) return;
    setCodeBusy(true);
    setCodeMsg('');
    const { data: res, error: resErr } = await apiPost('/api/referral', { code, app: getAppType() === 'business' ? 'business' : 'personal' }, accessToken);
    if (res?.success) {
      setCodeMsg(`✅ Code accepted: ${res.days} days free.`);
      setCodeText('');
      await loadPlan();
    } else {
      setCodeMsg(`❌ ${res?.error || resErr?.message || resErr || 'Could not apply the code. Try again.'}`);
    }
    setCodeBusy(false);
  }

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
            loadPlan();
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
          Current plan: <strong style={{ color: 'var(--primary)', textTransform: 'capitalize' }}>{currentPlan.replace('_', ' ')}</strong>
          {planEnds && currentPlan !== 'free' ? ` · until ${new Date(planEnds).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}
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
          {PLANS.filter((p) => {
            // Inside the Android apps each app shows its own plans; on the website all are shown.
            const isNative = typeof window !== 'undefined' && window.Capacitor
              && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform();
            if (!isNative) return true;
            return getAppType() === 'business' ? p.group === 'business' : p.group !== 'business';
          }).map((plan) => {
            const isCurrent = currentPlan === plan.id;
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

        {/* Free-period code */}
        <div style={{ maxWidth: 420, margin: '32px auto 0', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 18 }}>
          <label htmlFor="qk-free-code" style={{ display: 'block', fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>Have a code?</label>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 10px' }}>Enter a QuietKeep code or a friend's code to use a plan free for a period. No payment is taken.</p>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              id="qk-free-code"
              value={codeText}
              onChange={(e) => setCodeText(e.target.value.toUpperCase())}
              onKeyDown={(e) => { if (e.key === 'Enter') handleCode(); }}
              placeholder="e.g. QKAB12CD34"
              maxLength={32}
              autoCapitalize="characters"
              style={{ flex: 1, minWidth: 0, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px', color: 'var(--text)', fontSize: 14, outline: 'none', fontFamily: 'monospace', letterSpacing: '0.06em' }}
            />
            <button
              onClick={handleCode}
              disabled={codeBusy || !codeText.trim()}
              style={{ padding: '10px 16px', borderRadius: 10, border: 'none', background: 'var(--primary)', color: '#fff', fontSize: 13, fontWeight: 700, cursor: codeBusy || !codeText.trim() ? 'default' : 'pointer', opacity: codeBusy || !codeText.trim() ? 0.6 : 1, fontFamily: 'inherit' }}
            >
              {codeBusy ? 'Checking…' : 'Apply'}
            </button>
          </div>
          {codeMsg && <p role="status" style={{ fontSize: 13, color: 'var(--text)', margin: '10px 0 0' }}>{codeMsg}</p>}
        </div>

        <p style={{ textAlign: 'center', fontSize: 12, color: 'var(--text-subtle)', marginTop: 28 }}>
          Payments via Razorpay · UPI, cards, net banking · Prices in ₹ INR · 7-day refund policy
        </p>
      </main>
    </div>
  );
}
