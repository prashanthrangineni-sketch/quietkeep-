'use client';
import { useAuth } from '@/lib/context/auth';
// src/app/page.jsx — QuietKeep Marketing Homepage (Pomelli-style)
// ZERO personal/business logic touched — this is ONLY the landing page
// Pomelli-style: bold hero, product proof strip, features, pricing embed, dual CTA

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createBrowserClient } from '@supabase/ssr';

// Guard: only create Supabase client if env vars are present at build time.
// Without this guard, missing env vars render the literal string "undefined"
// into the SSR HTML, which triggers smoke test forbidden_strings failures.
const _sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const _sbKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = (_sbUrl && _sbKey && _sbUrl !== 'undefined' && _sbKey !== 'undefined')
  ? createBrowserClient(_sbUrl, _sbKey)
  : null;

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
    const isNative = typeof window !== 'undefined'
      && window.Capacitor
      && typeof window.Capacitor.isNativePlatform === 'function'
      && window.Capacitor.isNativePlatform();

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
      return;
    }

    if (!authLoading && user && supabase) {
      supabase.from('profiles').select('workspace_type').eq('user_id', user.id).single()
        .then(async ({ data }) => {
          if (data?.workspace_type === 'business') {
            router.replace('/b/dashboard');
          } else {
            const { data: ws } = await supabase
              .from('business_workspaces').select('id')
              .eq('owner_user_id', user.id).maybeSingle();
            router.replace(ws ? '/b/dashboard' : '/dashboard');
          }
        })
        .catch(() => router.replace('/dashboard'));
    }
    setTimeout(() => setHeroVisible(true), 80);
  }, [user, authLoading, router]);

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--text)', fontFamily: "'Inter',-apple-system,sans-serif", overflowX: 'hidden' }}>

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
          <Link href="/biz-login" style={{ fontSize: 13, color: 'var(--text-muted)', textDecoration: 'none', fontWeight: 500 }}>Business</Link>
          <Link href="/login" style={{ fontSize: 13, fontWeight: 700, color: '#fff', background: 'var(--primary)', padding: '8px 18px', borderRadius: 8, textDecoration: 'none', lineHeight: 1 }}>Sign In</Link>
        </div>
      </nav>

      <section style={{
        paddingTop: 'clamp(100px,14vw,140px)', paddingBottom: 'clamp(60px,8vw,100px)',
        paddingLeft: 'max(16px,calc(50vw - 540px))', paddingRight: 'max(16px,calc(50vw - 540px))',
        display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 48, alignItems: 'center',
      }}>
        <div style={{ opacity: heroVisible ? 1 : 0, transform: heroVisible ? 'none' : 'translateY(20px)', transition: 'all 0.6s cubic-bezier(0.4,0,0.2,1)' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'var(--primary-dim)', border: '1px solid var(--primary-glow)', borderRadius: 999, padding: '4px 14px', marginBottom: 20 }}>
            <span style={{ width: 7, height: 7, background: '#22c55e', borderRadius: '50%', display: 'inline-block', animation: 'pulse 2s infinite' }} />
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--primary)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Now live in India</span>
          </div>
          <h1 style={{ fontSize: 'clamp(36px,4.5vw,64px)', fontWeight: 900, letterSpacing: '-2.5px', lineHeight: 1.05, margin: '0 0 20px', color: 'var(--text)' }}>
            Keep everything.<br />
            <span style={{ background: 'linear-gradient(135deg,#5b5ef4,#8b5cf6,#22c55e)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
              Say it once.
            </span>
          </h1>
          <p style={{ fontSize: 18, color: 'var(--text-muted)', lineHeight: 1.7, margin: '0 0 32px', maxWidth: 440 }}>
            Voice-first life OS for individuals, families, and businesses. Private. Offline-ready. Built for India.
          </p>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <Link href={activeMode === 'business' ? '/biz-login' : '/login'}
              style={{ display: 'inline-block', padding: '14px 28px', borderRadius: 12, background: activeMode === 'business' ? '#10b981' : 'var(--primary)', color: '#fff', fontSize: 15, fontWeight: 700, textDecoration: 'none' }}>
              {activeMode === 'business' ? 'Start Free for Business →' : 'Get started free →'}
            </Link>
            <Link href="/pricing" style={{ display: 'inline-block', padding: '14px 20px', borderRadius: 12, border: '1.5px solid var(--border)', color: 'var(--text-muted)', fontSize: 14, fontWeight: 600, textDecoration: 'none' }}>
              See plans
            </Link>
          </div>
          <p style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 14 }}>Free forever · No credit card · Installs as PWA on any device</p>
        </div>
        <div style={{ opacity: heroVisible ? 1 : 0, transition: 'all 0.7s 0.1s' }}>
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 24, overflow: 'hidden', maxWidth: 340, margin: '0 auto' }}>
            <div style={{ background: 'var(--primary)', padding: '12px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: '#fff' }}>QuietKeep</span>
              <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)' }}>☀️ Brief ready</span>
            </div>
            <div style={{ padding: 16, background: 'var(--bg)' }}>
              {[
                { type: '⏰', text: 'Call CA about GST return', time: '10:00 AM', color: '#f59e0b' },
                { type: '💰', text: 'Paid electricity bill ₹2,400', time: 'Just now', color: '#22c55e' },
                { type: '🛡️', text: 'Samsung TV warranty expires in 3 months', time: 'AI alert', color: '#6366f1' },
                { type: '📝', text: 'Book train tickets for Diwali', time: 'Added via voice', color: '#64748b' },
              ].map((k, i) => (
                <div key={i} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px', marginBottom: 8, display: 'flex', gap: 10 }}>
                  <span style={{ fontSize: 16 }}>{k.type}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>{k.text}</div>
                    <div style={{ fontSize: 10, color: 'var(--text-subtle)' }}>{k.time}</div>
                  </div>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: k.color, marginTop: 4 }} />
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <footer style={{ borderTop: '1px solid var(--border)', padding: '28px max(16px,calc(50vw - 540px))', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
        <span style={{ fontSize: 13, color: 'var(--text-subtle)' }}>© 2026 QuietKeep · Pranix AI Labs · 🇮🇳 Made in India</span>
        <div style={{ display: 'flex', gap: 20 }}>
          {[['Pricing', '/pricing'], ['Brand', '/brand'], ['Business', '/biz-login'], ['Privacy', '/privacy']].map(([l, h]) => (
            <Link key={l} href={h} style={{ fontSize: 13, color: 'var(--text-subtle)', textDecoration: 'none' }}>{l}</Link>
          ))}
        </div>
      </footer>

      <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }`}</style>
    </div>
  );
}
