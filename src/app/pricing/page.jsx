'use client';
// src/app/pricing/page.jsx — Full pricing page with all 4 plans + monthly/yearly toggle
import { useState } from 'react';
import Link from 'next/link';

const PLANS = [
  {
    id: 'free',
    name: 'Free',
    monthlyPrice: 0,
    yearlyPrice: 0,
    monthlyPlanKey: null,
    yearlyPlanKey: null,
    color: '#64748b',
    highlight: false,
    cta: 'Get Started Free',
    ctaHref: '/login',
    badge: null,
    features: [
      'Unlimited keeps & notes',
      'Smart reminders (5/day)',
      'Indian Calendar + Panchangam',
      'Daily Brief (basic)',
      'Drive Mode',
      'Emergency SOS',
      'Family Space (2 members)',
      'Voice input (browser)',
    ],
  },
  {
    id: 'plus',
    name: 'Plus',
    monthlyPrice: 99,
    yearlyPrice: 83,  // 990/yr = ₹83/mo
    monthlyPlanKey: 'plus',
    yearlyPlanKey: 'plus_yearly',
    color: '#6366f1',
    highlight: true,
    badge: 'MOST POPULAR',
    cta: 'Start Free Trial',
    ctaHref: '/subscription',
    features: [
      'Everything in Free',
      'Unlimited Warranty Wallet',
      'WhatsApp invoice OCR',
      'Unlimited AI Assist',
      'Voice input (Sarvam AI — Hindi/Telugu)',
      'WhatsApp reminders',
      'Family Space (10 members)',
      'Memory Vault (5 GB)',
      'Daily Brief with AI summary',
      'Priority support',
    ],
  },
  {
    id: 'family',
    name: 'Family',
    monthlyPrice: 199,
    yearlyPrice: 166, // 1990/yr = ₹166/mo
    monthlyPlanKey: 'family',
    yearlyPlanKey: 'family_yearly',
    color: '#22c55e',
    highlight: false,
    badge: null,
    cta: 'Get Family Plan',
    ctaHref: '/subscription',
    features: [
      'Everything in Plus',
      'Unlimited family members',
      'Kids Space with PIN lock',
      'Memory Vault (20 GB)',
      'Admin dashboard',
      'Shared keeps & calendars',
      'Sub-accounts for family',
    ],
  },
  {
    id: 'business',
    name: 'Business',
    monthlyPrice: 299,
    yearlyPrice: 249, // 2990/yr = ₹249/mo
    monthlyPlanKey: 'business',
    yearlyPlanKey: 'business_yearly',
    color: '#10b981',
    highlight: false,
    badge: 'FOR SMBs',
    cta: 'Start Business Trial',
    ctaHref: '/biz-login',
    features: [
      'All Personal features',
      'GST invoicing (CGST/SGST)',
      'Voice business ledger',
      'Payroll + PF/ESIC auto-calc',
      'Attendance + GPS check-in',
      'Compliance reminders',
      'Inventory management',
      'Customer CRM',
      'Team task board',
      'WhatsApp payslips',
    ],
  },
];

const FAQS = [
  { q: 'Is the Free plan really free?', a: 'Yes — no credit card, no trial expiry. Free plan is yours forever with genuinely useful features.' },
  { q: 'What happens after the free trial?', a: 'After 14 days you automatically move to the Free plan. No charge. Upgrade whenever you want.' },
  { q: 'How does the referral reward work?', a: 'Share your unique link from the Dashboard. When a friend activates, both get 30 days of Plus free.' },
  { q: 'Can I cancel anytime?', a: 'Yes. Cancel from Settings → Subscription. You keep the paid plan until end of billing period, then revert to Free. Data is never deleted.' },
  { q: 'What payment methods are accepted?', a: 'UPI, credit/debit cards, net banking, Razorpay wallets. All payments in ₹ INR.' },
  { q: 'Is my data private?', a: 'All data is stored with row-level security. Even the QuietKeep team cannot read your keeps or personal data.' },
  { q: 'Do you offer refunds?', a: 'Yes — if unsatisfied within 7 days of any charge, email support@quietkeep.com for a full refund.' },
  { q: 'What is the Business plan for?', a: 'For Indian SMBs — kirana shops, restaurants, retail, service businesses with a team. Includes GST invoicing, payroll, attendance, compliance.' },
];

export default function PricingPage() {
  const [annual, setAnnual] = useState(false);

  return (
    <>
      {/* JSON-LD structured data */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'SoftwareApplication',
            name: 'QuietKeep',
            applicationCategory: 'LifestyleApplication',
            operatingSystem: 'Web, iOS, Android (PWA)',
            offers: [
              { '@type': 'Offer', name: 'Free', price: '0', priceCurrency: 'INR' },
              { '@type': 'Offer', name: 'Plus', price: '99', priceCurrency: 'INR', billingIncrement: 'P1M' },
              { '@type': 'Offer', name: 'Family', price: '199', priceCurrency: 'INR', billingIncrement: 'P1M' },
              { '@type': 'Offer', name: 'Business', price: '299', priceCurrency: 'INR', billingIncrement: 'P1M' },
            ],
          }),
        }}
      />

      <main style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--text)', fontFamily: "'Inter',-apple-system,sans-serif" }}>

        {/* Nav */}
        <nav style={{ position: 'sticky', top: 0, zIndex: 100, background: 'var(--nav-bg)', backdropFilter: 'blur(20px)', borderBottom: '1px solid var(--nav-border)', padding: '0 24px', height: 58, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Link href="/" style={{ fontWeight: 800, fontSize: 18, color: 'var(--primary)', textDecoration: 'none', letterSpacing: '-0.5px' }}>QuietKeep</Link>
          <div style={{ display: 'flex', gap: 20, alignItems: 'center' }}>
            <Link href="/brand" style={{ fontSize: 14, color: 'var(--text-muted)', textDecoration: 'none' }}>Brand</Link>
            <Link href="/login" style={{ fontSize: 14, fontWeight: 700, color: '#fff', background: 'var(--primary)', padding: '8px 18px', borderRadius: 8, textDecoration: 'none' }}>Sign In</Link>
          </div>
        </nav>

        {/* Hero */}
        <section style={{ textAlign: 'center', padding: '72px 24px 40px', maxWidth: 640, margin: '0 auto' }}>
          <div style={{ display: 'inline-block', background: 'var(--primary-dim)', border: '1px solid var(--primary-glow)', borderRadius: 999, padding: '4px 16px', fontSize: 12, color: 'var(--primary)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 20 }}>
            Simple, transparent pricing
          </div>
          <h1 style={{ fontSize: 'clamp(28px,5vw,48px)', fontWeight: 900, letterSpacing: '-1.5px', margin: '0 0 16px', color: 'var(--text)', lineHeight: 1.1 }}>
            Pay only for what you need
          </h1>
          <p style={{ fontSize: 16, color: 'var(--text-muted)', margin: '0 0 32px', lineHeight: 1.7 }}>
            All prices in ₹ INR. No hidden fees. Cancel anytime.
          </p>

          {/* Monthly / Yearly toggle */}
          <div style={{ display: 'inline-flex', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 4, gap: 4, marginBottom: 8 }}>
            <button
              onClick={() => setAnnual(false)}
              style={{ padding: '8px 20px', borderRadius: 9, border: 'none', background: !annual ? 'var(--primary)' : 'transparent', color: !annual ? '#fff' : 'var(--text-muted)', fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.15s' }}
            >
              Monthly
            </button>
            <button
              onClick={() => setAnnual(true)}
              style={{ padding: '8px 20px', borderRadius: 9, border: 'none', background: annual ? 'var(--primary)' : 'transparent', color: annual ? '#fff' : 'var(--text-muted)', fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.15s', display: 'flex', alignItems: 'center', gap: 6 }}
            >
              Yearly
              <span style={{ background: '#22c55e', color: '#fff', fontSize: 10, fontWeight: 800, padding: '1px 6px', borderRadius: 999 }}>2 MONTHS FREE</span>
            </button>
          </div>
        </section>

        {/* Plan cards */}
        <section style={{ maxWidth: 1100, margin: '0 auto', padding: '0 16px 80px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 16 }}>
          {PLANS.map((plan) => {
            const price = annual ? plan.yearlyPrice : plan.monthlyPrice;
            const planKey = annual ? plan.yearlyPlanKey : plan.monthlyPlanKey;

            return (
              <div
                key={plan.id}
                style={{
                  background: plan.highlight ? plan.color : 'var(--surface)',
                  border: `2px solid ${plan.highlight ? plan.color : 'var(--border)'}`,
                  borderRadius: 20,
                  padding: 28,
                  position: 'relative',
                  display: 'flex',
                  flexDirection: 'column',
                  boxShadow: plan.highlight ? `0 8px 32px ${plan.color}33` : 'var(--shadow-card)',
                  transform: plan.highlight ? 'scale(1.02)' : 'none',
                }}
              >
                {plan.badge && (
                  <div style={{ position: 'absolute', top: -12, left: '50%', transform: 'translateX(-50%)', background: plan.highlight ? '#fff' : plan.color, color: plan.highlight ? plan.color : '#fff', fontSize: 10, fontWeight: 800, padding: '3px 12px', borderRadius: 999, letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>
                    {plan.badge}
                  </div>
                )}

                <h2 style={{ fontSize: 20, fontWeight: 800, color: plan.highlight ? '#fff' : 'var(--text)', margin: '0 0 4px' }}>
                  {plan.name}
                </h2>

                <div style={{ margin: '12px 0 20px' }}>
                  {plan.monthlyPrice === 0 ? (
                    <div style={{ fontSize: 36, fontWeight: 900, color: plan.highlight ? '#fff' : 'var(--text)', lineHeight: 1 }}>Free</div>
                  ) : (
                    <>
                      <div style={{ fontSize: 36, fontWeight: 900, color: plan.highlight ? '#fff' : 'var(--text)', lineHeight: 1 }}>
                        ₹{price}
                        <span style={{ fontSize: 15, fontWeight: 500, opacity: 0.75 }}>/mo</span>
                      </div>
                      {annual && (
                        <div style={{ fontSize: 12, color: plan.highlight ? 'rgba(255,255,255,0.8)' : 'var(--text-muted)', marginTop: 4 }}>
                          ₹{price * 12}/year · <span style={{ textDecoration: 'line-through', opacity: 0.6 }}>₹{plan.monthlyPrice * 12}</span>
                        </div>
                      )}
                    </>
                  )}
                </div>

                <ul style={{ listStyle: 'none', margin: '0 0 24px', padding: 0, flex: 1 }}>
                  {plan.features.map((f) => (
                    <li key={f} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 8, fontSize: 13, color: plan.highlight ? 'rgba(255,255,255,0.9)' : 'var(--text-muted)', lineHeight: 1.5 }}>
                      <span style={{ color: plan.highlight ? '#fff' : plan.color, flexShrink: 0, marginTop: 1, fontWeight: 700 }}>✓</span>
                      {f}
                    </li>
                  ))}
                </ul>

                <Link
                  href={planKey ? `${plan.ctaHref}${plan.ctaHref.includes('?') ? '&' : '?'}plan=${planKey}` : plan.ctaHref}
                  style={{
                    display: 'block',
                    textAlign: 'center',
                    padding: '12px',
                    borderRadius: 12,
                    border: plan.highlight ? '2px solid rgba(255,255,255,0.4)' : `2px solid ${plan.color}`,
                    background: plan.highlight ? 'rgba(255,255,255,0.15)' : 'transparent',
                    color: plan.highlight ? '#fff' : plan.color,
                    fontSize: 14,
                    fontWeight: 700,
                    textDecoration: 'none',
                    transition: 'all 0.2s',
                  }}
                >
                  {plan.cta}
                </Link>
              </div>
            );
          })}
        </section>

        {/* FAQ */}
        <section style={{ maxWidth: 680, margin: '0 auto', padding: '0 16px 100px' }}>
          <h2 style={{ fontSize: 28, fontWeight: 800, textAlign: 'center', marginBottom: 40, color: 'var(--text)', letterSpacing: '-0.5px' }}>
            Frequently Asked Questions
          </h2>
          {FAQS.map(({ q, a }) => (
            <div key={q} style={{ borderBottom: '1px solid var(--border)', padding: '20px 0' }}>
              <p style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', margin: '0 0 8px' }}>{q}</p>
              <p style={{ fontSize: 14, color: 'var(--text-muted)', margin: 0, lineHeight: 1.7 }}>{a}</p>
            </div>
          ))}
        </section>

        {/* CTA footer */}
        <section style={{ textAlign: 'center', background: 'var(--primary)', padding: '60px 24px', color: '#fff' }}>
          <h2 style={{ fontSize: 28, fontWeight: 900, margin: '0 0 12px' }}>Ready to get organised?</h2>
          <p style={{ fontSize: 15, opacity: 0.85, margin: '0 0 28px' }}>Free forever · No credit card · Install as PWA in 10 seconds</p>
          <Link href="/login" style={{ display: 'inline-block', padding: '14px 36px', borderRadius: 12, background: '#fff', color: 'var(--primary)', fontSize: 15, fontWeight: 800, textDecoration: 'none' }}>
            Get started free →
          </Link>
        </section>

      </main>
    </>
  );
}
