'use client';
import { useAuth } from '@/lib/context/auth';
// src/app/page.jsx — QuietKeep Marketing Homepage (Pomelli-style)
// ZERO personal/business logic touched — this is ONLY the landing page
// Pomelli-style: bold hero, product proof strip, features, pricing embed, dual CTA

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createBrowserClient } from '@supabase/ssr';

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

// ── Animated counter ───────────────────────────────────────────────────────
function Counter({ target, suffix = '' }) {
  const [count, setCount] = useState(target);
  const [animated, setAnimated] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    setCount(0);
    setAnimated(true);
    const obs = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      obs.disconnect();
      let start = 0;
      const step = target / 60;
      const t = setInterval(() => {
        start = Math.min(start + step, target);
        setCount(Math.floor(start));
        if (start >= target) clearInterval(t);
      }, 16);
    }, { threshold: 0.1 });
    if (ref.current) obs.observe(ref.current);
    return () => obs.disconnect();
  }, [target]);
  return <span ref={ref}>{count.toLocaleString('en-IN')}{suffix}</span>;
}

const PERSONAL_FEATURES = [
  { icon: '🎙️', title: 'Voice-First Keeps', desc: 'Say it once — transcribed, tagged, and stored instantly. Works in Hindi, Telugu, Tamil, English.', tag: 'Core' },
  { icon: '☀️', title: 'Daily Brief', desc: 'Morning AI summary: your reminders, calendar, weather, Panchangam, and nudges — all in one voice-read card.', tag: 'Unique' },
  { icon: '⏰', title: 'Smart Reminders', desc: 'Natural language: "Call dad Sunday morning" → reminder set. WhatsApp alerts, alarms, and app notifications.', tag: 'Core' },
  { icon: '🛡️', title: 'Warranty Wallet', desc: 'Send invoice photo on WhatsApp → product auto-added. Track warranties, costs, and best time to replace.', tag: 'AI' },
  { icon: '📅', title: 'Indian Calendar', desc: 'Panchangam, Tithi, Nakshatra, Telugu/Hindi/Tamil/Islamic — all overlaid on your personal calendar.', tag: 'India' },
  { icon: '👨‍👩‍👧', title: 'Family Space', desc: 'Shared keeps, kids profiles with PIN lock, emergency contacts, family location sharing.', tag: 'Family' },
  { icon: '💰', title: 'Finance Tracker', desc: 'Expenses, budgets, subscriptions, asset tracking — all voice-captured. No spreadsheet required.', tag: 'Finance' },
  { icon: '🚗', title: 'Drive Mode', desc: 'Hands-free keeps while driving. Voice commands: Maps, Music, SOS, read keeps. Safety-first UI.', tag: 'Safety' },
];

const BUSINESS_FEATURES = [
  { icon: '📒', title: 'Voice Ledger', desc: '"Raju paid ₹500" → auto-recorded in your khata. Credit/debit, party-wise, date-wise. Replaces Khatabook.', tag: 'Core' },
  { icon: '👥', title: 'Staff Attendance', desc: 'Mark attendance by voice, face, or QR. Geo-verified check-in for field teams. WhatsApp payslips.', tag: 'HR' },
  { icon: '🧾', title: 'GST Invoicing', desc: 'Create and send GST invoices in 30 seconds. WhatsApp delivery. Auto-calculate CGST/SGST/IGST.', tag: 'GST' },
  { icon: '📦', title: 'Inventory Alerts', desc: '"We ran out of Parle-G" → adds to reorder list. Low stock alerts. Supplier due dates.', tag: 'Stock' },
  { icon: '⚖️', title: 'Compliance Reminders', desc: 'GST returns, TDS, PF/ESIC, IT returns, FSSAI, trade licence — all reminded before due date.', tag: 'Compliance' },
  { icon: '🗺️', title: 'Field Team Geo', desc: 'Sales reps, delivery agents, field workers — live geo check-in. Visit log with photo proof.', tag: 'Field' },
  { icon: '💳', title: 'Payroll Engine', desc: 'Auto-calculate salary from attendance. PF/ESIC deductions. Send payslips on WhatsApp.', tag: 'Payroll' },
  { icon: '📊', title: 'Daily Business Brief', desc: 'Morning summary: cash position, dues, absent staff, low stock, compliance due. Spoken aloud.', tag: 'AI' },
];

const SECTORS = [
  { icon: '🏪', name: 'Retail & Kirana' },
  { icon: '🍽️', name: 'Restaurant & Food' },
  { icon: '✂️', name: 'Salon & Services' },
  { icon: '🏗️', name: 'Construction' },
  { icon: '📚', name: 'Education & Coaching' },
  { icon: '🏥', name: 'Clinic & Pharmacy' },
  { icon: '🚚', name: 'Logistics & Transport' },
  { icon: '🧵', name: 'Manufacturing' },
];

const TESTIMONIALS = [
  { name: 'Prasad K', role: 'Kirana Owner, Hyderabad', text: 'I used to write everything in a diary. Now I just say it and QuietKeep stores it. The daily brief in the morning is like having a secretary.', avatar: 'PK' },
  { name: 'Sunita R', role: 'Working Professional, Bangalore', text: 'The family space and kids PIN lock is exactly what I needed. My reminders speak to me — I never miss anything now.', avatar: 'SR' },
  { name: 'Mohammed A', role: 'Restaurant Owner, Pune', text: 'Staff attendance and payslips on WhatsApp every month. GST invoices in 30 seconds. This is the tool I was looking for.', avatar: 'MA' },
];

export default function HomePage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [activeMode, setActiveMode] = useState('personal');
  const [heroVisible, setHeroVisible] = useState(true);

  useEffect(() => {
    // ── APK ENTRY ROUTING ─────────────────────────────────────────────────
    // When running inside the Capacitor native app, skip the marketing landing
    // page entirely and route the user directly to the correct login or dashboard.
    //
    // APP TYPE RESOLUTION ORDER (most to least authoritative):
    //
    //   1. window.__QK_APP_TYPE__ — injected by MainActivity.java v5 at runtime
    //      from getPackageName(). This is the GROUND TRUTH for the APK variant.
    //      com.pranix.quietkeep          → 'personal'
    //      com.pranix.quietkeep.business → 'business'
    //
    //   2. process.env.NEXT_PUBLIC_APP_TYPE — baked into the JS bundle at build time
    //      by the CI workflow. Correct when local bundle is loaded (after server.url
    //      removal). Fallback if window.__QK_APP_TYPE__ is not yet set.
    //
    //   3. 'personal' — safe default.
    //
    // WHY THE RUNTIME INJECTION IS NEEDED:
    //   evaluateJavascript() in MainActivity fires after onPageFinished(). React's
    //   useEffect fires after the first render, which may be before evaluateJavascript
    //   completes on slow devices. The process.env fallback handles that race.
    //   On subsequent renders, window.__QK_APP_TYPE__ is available.
    // ─────────────────────────────────────────────────────────────────────
    const isNative = typeof window !== 'undefined'
      && window.Capacitor
      && typeof window.Capacitor.isNativePlatform === 'function'
      && window.Capacitor.isNativePlatform();

    // FIX v2: Check runtime injection FIRST, then build-time env, then default.
    const appType = (typeof window !== 'undefined' && window.__QK_APP_TYPE__)
      || process.env.NEXT_PUBLIC_APP_TYPE
      || 'personal';

    if (isNative) {
      if (!authLoading) {
        if (user) {
          if (appType === 'business') router.replace('/b/dashboard');
          else router.replace('/dashboard');
        } else {
          if (appType === 'business') router.replace('/biz-login');
          else router.replace('/login');
        }
      }
      return; // Do not render marketing page inside native app
    }

    // ── WEB ENTRY ROUTING (browser only) ──────────────────────────────────
    if (!authLoading && user) {
      // FIX: Two-signal routing for business users.
      // Signal 1: profiles.workspace_type = 'business' (primary, set during onboarding)
      // Signal 2: business_workspaces row exists (fallback for users who onboarded before the fix)
      // If either signal fires, route to /b/dashboard.
      supabase.from('profiles').select('workspace_type').eq('user_id', user.id).single()
        .then(async ({ data }) => {
          if (data?.workspace_type === 'business') {
            router.replace('/b/dashboard');
          } else {
            // Fallback: check if user has a business workspace (catches old accounts)
            const { data: ws } = await supabase
              .from('business_workspaces')
              .select('id')
              .eq('owner_user_id', user.id)
              .maybeSingle();
            if (ws) router.replace('/b/dashboard');
            else router.replace('/dashboard');
          }
        })
        .catch(() => router.replace('/dashboard'));
    }
    setTimeout(() => setHeroVisible(true), 80);
  }, [user, authLoading, router]);

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--text)', fontFamily: "'Inter',-apple-system,sans-serif", overflowX: 'hidden' }}>

      {/* ── STICKY NAV ──────────────────────────────────────────────────────── */}
      <nav style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 1000,
        background: 'var(--nav-bg)', backdropFilter: 'blur(24px)',
        borderBottom: '1px solid var(--nav-border)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 max(24px, calc(50vw - 540px))', height: 60,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 30, height: 30, borderRadius: 8, background: 'linear-gradient(135deg,#5b5ef4,#8b5cf6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ fontSize: 12, fontWeight: 900, color: '#fff' }}>QK</span>
          </div>
          <span style={{ fontWeight: 800, fontSize: 17, letterSpacing: '-0.5px', color: 'var(--text)' }}>QuietKeep</span>
        </div>
        <div style={{ display: 'flex', gap: 24, alignItems: 'center' }}>
          <Link href="/pricing" style={{ fontSize: 13, color: 'var(--text-muted)', textDecoration: 'none', fontWeight: 500 }}>Pricing</Link>
          <Link href="/brand" style={{ fontSize: 13, color: 'var(--text-muted)', textDecoration: 'none', fontWeight: 500 }}>Brand</Link>
          {(typeof window === 'undefined' || !(window && window.Capacitor && window.Capacitor.getPlatform && window.Capacitor.getPlatform())) && (
            <Link href="/biz-login" style={{ fontSize: 13, color: 'var(--text-muted)', textDecoration: 'none', fontWeight: 500 }}>Business</Link>
          )}
          <Link href="/login" style={{ fontSize: 13, fontWeight: 700, color: '#fff', background: 'var(--primary)', padding: '8px 18px', borderRadius: 8, textDecoration: 'none', lineHeight: 1 }}>Sign In</Link>
        </div>
      </nav>

      {/* ── HERO ────────────────────────────────────────────────────────────── */}
      <section style={{
        paddingTop: 'clamp(100px,14vw,140px)', paddingBottom: 'clamp(60px,8vw,100px)',
        paddingLeft: 'max(16px,calc(50vw - 540px))', paddingRight: 'max(16px,calc(50vw - 540px))',
        display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 48, alignItems: 'center',
        maxWidth: '100%',
      }}>
        <div style={{ opacity: heroVisible ? 1 : 0, transform: heroVisible ? 'none' : 'translateY(20px)', transition: 'all 0.6s cubic-bezier(0.4,0,0.2,1)' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'var(--primary-dim)', border: '1px solid var(--primary-glow)', borderRadius: 999, padding: '4px 14px', marginBottom: 20 }}>
            <span style={{ width: 7, height: 7, background: '#22c55e', borderRadius: '50%', display: 'inline-block', animation: 'pulse 2s infinite' }} />
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--primary)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Now live in India</span>
          </div>
          <h1 style={{
            fontSize: 'clamp(36px,4.5vw,64px)', fontWeight: 900,
            letterSpacing: '-2.5px', lineHeight: 1.05, margin: '0 0 20px',
            color: 'var(--text)',
          }}>
            Keep everything.<br />
            <span style={{ background: 'linear-gradient(135deg,#5b5ef4,#8b5cf6,#22c55e)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
              Say it once.
            </span>
          </h1>
          <p style={{ fontSize: 18, color: 'var(--text-muted)', lineHeight: 1.7, margin: '0 0 32px', maxWidth: 440 }}>
            Voice-first life OS for individuals, families, and businesses. Private. Offline-ready. Built for India.
          </p>

          <div style={{ display: 'flex', gap: 8, marginBottom: 24, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 5, width: 'fit-content' }}>
            {[['personal', '👤 Personal'], ['business', '🏢 Business']].map(([v, l]) => (
              <button key={v} onClick={() => setActiveMode(v)}
                style={{
                  padding: '10px 22px', borderRadius: 10, border: 'none', cursor: 'pointer',
                  fontFamily: 'inherit', fontSize: 14, fontWeight: 700,
                  background: activeMode === v ? (v === 'business' ? '#10b981' : 'var(--primary)') : 'transparent',
                  color: activeMode === v ? '#fff' : 'var(--text-muted)',
                  transition: 'all 0.2s',
                }}>{l}</button>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <Link href={activeMode === 'business' ? '/biz-login' : '/login'}
              style={{
                display: 'inline-block', padding: '14px 28px', borderRadius: 12,
                background: activeMode === 'business' ? '#10b981' : 'var(--primary)',
                color: '#fff', fontSize: 15, fontWeight: 700, textDecoration: 'none',
                boxShadow: activeMode === 'business' ? '0 4px 20px rgba(16,185,129,0.4)' : '0 4px 20px rgba(91,94,244,0.35)',
              }}>
              {activeMode === 'business' ? 'Start Free for Business →' : 'Get started free →'}
            </Link>
            <Link href="/pricing"
              style={{ display: 'inline-block', padding: '14px 20px', borderRadius: 12, border: '1.5px solid var(--border)', color: 'var(--text-muted)', fontSize: 14, fontWeight: 600, textDecoration: 'none' }}>
              See plans
            </Link>
          </div>

          <p style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 14 }}>
            Free forever · No credit card · Installs as PWA on any device
          </p>
        </div>

        <div style={{ opacity: heroVisible ? 1 : 0, transform: heroVisible ? 'none' : 'translateY(24px) scale(0.97)', transition: 'all 0.7s cubic-bezier(0.4,0,0.2,1) 0.1s' }}>
          <div style={{
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 24, overflow: 'hidden',
            boxShadow: '0 24px 80px rgba(0,0,0,0.12), 0 8px 24px rgba(91,94,244,0.1)',
            maxWidth: 340, margin: '0 auto',
          }}>
            <div style={{ background: 'var(--primary)', padding: '12px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ width: 28, height: 28, borderRadius: 7, background: 'rgba(255,255,255,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <span style={{ fontSize: 12, fontWeight: 900, color: '#fff' }}>QK</span>
                </div>
                <span style={{ fontSize: 14, fontWeight: 700, color: '#fff' }}>QuietKeep</span>
              </div>
              <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)' }}>☀️ Brief ready</span>
            </div>
            <div style={{ padding: '16px', background: 'var(--bg)' }}>
              {[
                { type: '⏰', text: 'Call CA about GST return', time: '10:00 AM', color: '#f59e0b' },
                { type: '💰', text: 'Paid electricity bill ₹2,400', time: 'Just now', color: '#22c55e' },
                { type: '🛡️', text: 'Samsung TV warranty expires in 3 months', time: 'AI alert', color: '#6366f1' },
                { type: '📝', text: 'Book train tickets for Diwali', time: 'Added via voice', color: '#64748b' },
              ].map((k, i) => (
                <div key={i} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px', marginBottom: 8, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <span style={{ fontSize: 16, flexShrink: 0 }}>{k.type}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', marginBottom: 3, lineHeight: 1.4 }}>{k.text}</div>
                    <div style={{ fontSize: 10, color: 'var(--text-subtle)' }}>{k.time}</div>
                  </div>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: k.color, flexShrink: 0, marginTop: 4 }} />
                </div>
              ))}
              <div style={{ background: 'linear-gradient(135deg,var(--primary-dim),rgba(139,92,246,0.1))', border: '1px solid var(--primary-glow)', borderRadius: 10, padding: '10px 14px', display: 'flex', gap: 10, alignItems: 'center', marginTop: 12 }}>
                <span style={{ fontSize: 18 }}>🎙️</span>
                <span style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' }}>Say something to keep...</span>
                <div style={{ marginLeft: 'auto', width: 28, height: 28, borderRadius: '50%', background: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <span style={{ fontSize: 12, color: '#fff' }}>▶</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── STATS STRIP ─────────────────────────────────────────────────────── */}
      <div style={{ borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)', background: 'var(--surface)', padding: '24px max(16px,calc(50vw - 540px))' }}>
        <div style={{ display: 'flex', gap: 40, justifyContent: 'center', flexWrap: 'wrap' }}>
          {[
            { value: 24, suffix: '+', label: 'Features built' },
            { value: 3497, suffix: '', label: 'Indian festivals loaded' },
            { value: 63, suffix: 'M', label: 'Indian SMBs targeted' },
            { value: 100, suffix: '%', label: 'Private by default' },
          ].map(s => (
            <div key={s.label} style={{ textAlign: 'center', minWidth: 100 }}>
              <div style={{ fontSize: 28, fontWeight: 900, color: 'var(--primary)', letterSpacing: '-1px' }}>
                <Counter target={s.value} suffix={s.suffix} />
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 2 }}>{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── FEATURES ────────────────────────────────────────────────────────── */}
      <section style={{ padding: 'clamp(60px,8vw,100px) max(16px,calc(50vw - 540px))' }}>
        <div style={{ textAlign: 'center', marginBottom: 48 }}>
          <div style={{ display: 'inline-flex', gap: 8, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 999, padding: 5 }}>
            {[['personal','👤 Personal'],['business','🏢 Business']].map(([v,l]) => (
              <button key={v} onClick={() => setActiveMode(v)}
                style={{
                  padding: '9px 24px', borderRadius: 999, border: 'none', cursor: 'pointer',
                  fontFamily: 'inherit', fontSize: 13, fontWeight: 700,
                  background: activeMode === v ? (v === 'business' ? '#10b981' : 'var(--primary)') : 'transparent',
                  color: activeMode === v ? '#fff' : 'var(--text-muted)',
                  transition: 'all 0.2s',
                }}>{l}</button>
            ))}
          </div>
          <h2 style={{ fontSize: 'clamp(26px,4vw,42px)', fontWeight: 900, letterSpacing: '-1.5px', margin: '20px 0 10px', color: 'var(--text)' }}>
            {activeMode === 'personal' ? 'Your entire life, organised' : 'Run your business by voice'}
          </h2>
          <p style={{ fontSize: 16, color: 'var(--text-muted)', maxWidth: 500, margin: '0 auto' }}>
            {activeMode === 'personal'
              ? 'Everything you need to manage your daily life — voice-first, private, offline-ready.'
              : 'Attendance, ledger, GST invoices, payroll, compliance — all via WhatsApp and voice.'}
          </p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(260px,1fr))', gap: 14 }}>
          {(activeMode === 'personal' ? PERSONAL_FEATURES : BUSINESS_FEATURES).map((f, i) => (
            <div key={f.title} style={{
              background: 'var(--surface)', border: '1px solid var(--border)',
              borderRadius: 16, padding: '20px',
              transition: 'all 0.2s', cursor: 'default',
            }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = activeMode === 'business' ? 'rgba(16,185,129,0.4)' : 'var(--primary-glow)'; e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 8px 24px rgba(0,0,0,0.08)'; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = 'none'; }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                <span style={{ fontSize: 28 }}>{f.icon}</span>
                <span style={{
                  fontSize: 9, fontWeight: 800, padding: '2px 8px', borderRadius: 999,
                  background: f.tag === 'AI' ? 'rgba(99,102,241,0.12)' : f.tag === 'India' ? 'rgba(245,158,11,0.12)' : f.tag === 'Unique' ? 'rgba(16,185,129,0.12)' : 'var(--primary-dim)',
                  color: f.tag === 'AI' ? '#6366f1' : f.tag === 'India' ? '#f59e0b' : f.tag === 'Unique' ? '#10b981' : 'var(--primary)',
                  textTransform: 'uppercase', letterSpacing: '0.06em',
                }}>{f.tag}</span>
              </div>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>{f.title}</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6 }}>{f.desc}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── BUSINESS SECTORS ────────────────────────────────────────────────── */}
      {activeMode === 'business' && (
        <section style={{ padding: '0 max(16px,calc(50vw - 540px)) clamp(60px,8vw,100px)', textAlign: 'center' }}>
          <div style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--primary)', marginBottom: 12 }}>Built for every sector</div>
          <h2 style={{ fontSize: 'clamp(22px,3vw,36px)', fontWeight: 900, letterSpacing: '-1px', margin: '0 0 32px', color: 'var(--text)' }}>From kirana to construction</h2>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, justifyContent: 'center' }}>
            {SECTORS.map(s => (
              <div key={s.name} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 999, padding: '10px 18px', display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
                <span>{s.icon}</span>{s.name}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── TESTIMONIALS ────────────────────────────────────────────────────── */}
      <section style={{ padding: 'clamp(60px,8vw,100px) max(16px,calc(50vw - 540px))', background: 'var(--surface)', borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)' }}>
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <h2 style={{ fontSize: 'clamp(24px,3.5vw,38px)', fontWeight: 900, letterSpacing: '-1px', color: 'var(--text)' }}>Loved by early users</h2>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: 16 }}>
          {TESTIMONIALS.map(t => (
            <div key={t.name} style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 18, padding: 24 }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 16 }}>
                <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'linear-gradient(135deg,var(--primary),#8b5cf6)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 800, color: '#fff', flexShrink: 0 }}>
                  {t.avatar}
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{t.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-subtle)' }}>{t.role}</div>
                </div>
                <div style={{ marginLeft: 'auto', color: '#f59e0b', fontSize: 14 }}>★★★★★</div>
              </div>
              <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.7, margin: 0, fontStyle: 'italic' }}>"{t.text}"</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── DUAL CTA ────────────────────────────────────────────────────────── */}
      <section style={{ padding: 'clamp(60px,8vw,100px) max(16px,calc(50vw - 540px))', textAlign: 'center' }}>
        <h2 style={{ fontSize: 'clamp(26px,4vw,48px)', fontWeight: 900, letterSpacing: '-2px', margin: '0 0 16px', color: 'var(--text)', lineHeight: 1.1 }}>
          Ready to get organised?
        </h2>
        <p style={{ fontSize: 16, color: 'var(--text-muted)', margin: '0 auto 36px', maxWidth: 480, lineHeight: 1.7 }}>
          Free forever plan. No credit card. Install as a PWA on your phone in 10 seconds.
        </p>
        <div style={{ display: 'flex', gap: 14, justifyContent: 'center', flexWrap: 'wrap' }}>
          <Link href="/login" style={{
            display: 'inline-block', padding: '16px 36px', borderRadius: 14,
            background: 'var(--primary)', color: '#fff', fontSize: 16, fontWeight: 700,
            textDecoration: 'none', boxShadow: '0 6px 24px rgba(91,94,244,0.35)',
          }}>
            Personal — Start Free →
          </Link>
          <Link href="/biz-login" style={{
            display: 'inline-block', padding: '16px 36px', borderRadius: 14,
            background: '#10b981', color: '#fff', fontSize: 16, fontWeight: 700,
            textDecoration: 'none', boxShadow: '0 6px 24px rgba(16,185,129,0.35)',
          }}>
            Business — Start Free →
          </Link>
        </div>
        <p style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 20 }}>
          Paid via Razorpay · UPI, Cards, Net Banking · Prices in ₹ INR
        </p>
      </section>

      {/* ── FOOTER ──────────────────────────────────────────────────────────── */}
      <footer style={{ borderTop: '1px solid var(--border)', padding: '28px max(16px,calc(50vw - 540px))', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 24, height: 24, borderRadius: 6, background: 'linear-gradient(135deg,#5b5ef4,#8b5cf6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ fontSize: 10, fontWeight: 900, color: '#fff' }}>QK</span>
          </div>
          <span style={{ fontSize: 13, color: 'var(--text-subtle)' }}>© 2026 QuietKeep · <a href="https://pranix.in" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--text-subtle)', textDecoration: 'none' }}>Pranix AI Labs</a> · 🇮🇳 Made in India</span>
        </div>
        <div style={{ display: 'flex', gap: 20 }}>
          {[['Pricing', '/pricing'], ['Brand', '/brand'], ['Business', '/biz-login'], ['Privacy', '/privacy']].map(([l, h]) => (
            <Link key={l} href={h} style={{ fontSize: 13, color: 'var(--text-subtle)', textDecoration: 'none' }}>{l}</Link>
          ))}
        </div>
      </footer>

      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
        @media (max-width: 768px) {
          section:first-of-type { grid-template-columns: 1fr !important; }
          section:first-of-type > div:last-child { display: none !important; }
        }
      `}</style>
    </div>
  );
}
