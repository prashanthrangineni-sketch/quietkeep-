'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createBrowserClient } from '@supabase/ssr';
import Link from 'next/link';

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export default function Home() {
  const router = useRouter();
  const [mode, setMode] = useState(null); // null = not chosen yet

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) router.replace('/dashboard');
    });
    // Restore last chosen mode
    const saved = localStorage.getItem('qk_home_mode');
    if (saved) setMode(saved);
  }, [router]);

  function choose(m) {
    setMode(m);
    localStorage.setItem('qk_home_mode', m);
  }

  const PERSONAL_FEATURES = [
    { icon: '🎙️', title: 'Voice Capture', desc: 'Say it once — transcribed and stored instantly.' },
    { icon: '⏰', title: 'Smart Reminders', desc: 'Natural language reminders. Tax, FASTag, bills — never miss a deadline.' },
    { icon: '🧒', title: 'Family & Kids', desc: 'Family profiles, kids zone, shared keeps and emergency contacts.' },
    { icon: '💳', title: 'Finance Tracker', desc: 'Expenses, budgets, subscriptions and asset tracking.' },
    { icon: '📄', title: 'Document Vault', desc: 'Passport, Aadhaar, PAN — stored with expiry alerts.' },
    { icon: '🧭', title: 'Offline Compass', desc: 'GPS location and compass. Works without internet.' },
  ];

  const BUSINESS_FEATURES = [
    { icon: '👥', title: 'Team Accounts', desc: 'Invite team members with role-based access.' },
    { icon: '📋', title: 'Shared Keeps', desc: 'Assign and track tasks across your team.' },
    { icon: '📊', title: 'Audit Log', desc: 'Full history of all team actions and changes.' },
    { icon: '📤', title: 'Data Export', desc: 'Export keeps, reports in CSV or JSON.' },
    { icon: '🔗', title: 'API Access', desc: 'Connect QuietKeep with your existing tools.' },
    { icon: '🤖', title: 'AI Assistant', desc: 'AI-powered summaries, suggestions, and insights.' },
  ];

  return (
    <main style={{ minHeight: '100vh', backgroundColor: '#0d1117', color: '#f1f5f9', fontFamily: 'system-ui, sans-serif' }}>

      {/* Hero */}
      <section style={{ maxWidth: 560, margin: '0 auto', padding: '80px 24px 60px', textAlign: 'center' }}>
        <div style={{ width: 72, height: 72, background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', borderRadius: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 28px', boxShadow: '0 0 40px rgba(99,102,241,0.3)' }}>
          <span style={{ fontSize: 28, fontWeight: 800, color: '#fff' }}>QK</span>
        </div>

        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.3)', borderRadius: 100, padding: '5px 14px', fontSize: 12, color: '#a5b4fc', marginBottom: 24 }}>
          <span style={{ width: 6, height: 6, background: '#22c55e', borderRadius: '50%', display: 'inline-block' }} />
          Now live · Voice-First Life OS
        </div>

        <h1 style={{ fontSize: 'clamp(32px,6vw,56px)', fontWeight: 800, lineHeight: 1.1, letterSpacing: '-1.5px', margin: '0 0 20px', background: 'linear-gradient(135deg, #f1f5f9 0%, #a5b4fc 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
          Keep Everything.<br />Say It Once.
        </h1>
        <p style={{ fontSize: 16, color: '#64748b', lineHeight: 1.6, maxWidth: 400, margin: '0 auto 40px' }}>
          Your voice-first vault for notes, tasks, reminders, family, finance and more.
        </p>

        {/* Mode selector */}
        {!mode ? (
          <div>
            <div style={{ fontSize: 14, color: '#475569', marginBottom: 16 }}>How will you use QuietKeep?</div>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
              <button onClick={() => choose('personal')}
                style={{ padding: '16px 28px', borderRadius: 14, border: '2px solid rgba(99,102,241,0.4)', background: 'rgba(99,102,241,0.1)', color: '#a5b4fc', fontSize: 15, fontWeight: 700, cursor: 'pointer', minWidth: 160 }}>
                👤 Personal Use<br /><span style={{ fontSize: 11, fontWeight: 400, color: '#64748b' }}>For individuals & families</span>
              </button>
              <button onClick={() => choose('business')}
                style={{ padding: '16px 28px', borderRadius: 14, border: '2px solid rgba(16,185,129,0.4)', background: 'rgba(16,185,129,0.08)', color: '#6ee7b7', fontSize: 15, fontWeight: 700, cursor: 'pointer', minWidth: 160 }}>
                🏢 Business Use<br /><span style={{ fontSize: 11, fontWeight: 400, color: '#64748b' }}>For teams & organisations</span>
              </button>
            </div>
          </div>
        ) : (
          <div>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap', marginBottom: 16 }}>
              <Link href="/login" style={{ backgroundColor: '#6366f1', color: '#fff', textDecoration: 'none', padding: '13px 28px', borderRadius: 10, fontSize: 15, fontWeight: 700, boxShadow: '0 4px 20px rgba(99,102,241,0.4)', display: 'inline-block' }}>
                Get Started Free →
              </Link>
              <Link href="/login" style={{ backgroundColor: 'transparent', color: '#94a3b8', textDecoration: 'none', padding: '13px 28px', borderRadius: 10, fontSize: 15, fontWeight: 700, border: '1px solid #1e293b', display: 'inline-block' }}>
                Sign In
              </Link>
            </div>
            <button onClick={() => { setMode(null); localStorage.removeItem('qk_home_mode'); }}
              style={{ background: 'none', border: 'none', color: '#475569', fontSize: 12, cursor: 'pointer', textDecoration: 'underline' }}>
              Switch to {mode === 'personal' ? 'Business' : 'Personal'}
            </button>
          </div>
        )}
      </section>

      {/* Features grid */}
      {mode && (
        <section style={{ maxWidth: 860, margin: '0 auto', padding: '0 24px 80px' }}>
          <div style={{ textAlign: 'center', marginBottom: 32 }}>
            <div style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: mode === 'personal' ? '#6366f1' : '#10b981', marginBottom: 8 }}>
              {mode === 'personal' ? '👤 Personal Features' : '🏢 Business Features'}
            </div>
            <div style={{ fontSize: 13, color: '#475569' }}>
              {mode === 'personal' ? 'Everything you need to organise your life.' : 'Tools built for teams and small businesses.'}
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 14 }}>
            {(mode === 'personal' ? PERSONAL_FEATURES : BUSINESS_FEATURES).map((f, i) => (
              <div key={i} style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14, padding: 22 }}>
                <div style={{ fontSize: 28, marginBottom: 10 }}>{f.icon}</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#e2e8f0', marginBottom: 6 }}>{f.title}</div>
                <div style={{ fontSize: 12, color: '#475569', lineHeight: 1.6 }}>{f.desc}</div>
              </div>
            ))}
          </div>
          {mode === 'business' && (
            <div style={{ marginTop: 24, background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 12, padding: '14px 18px', textAlign: 'center', fontSize: 13, color: '#fcd34d' }}>
              🚧 Business mode is in development. Sign up now and your account carries over automatically.
            </div>
          )}
        </section>
      )}

      {/* No mode chosen — show combined overview */}
      {!mode && (
        <section style={{ maxWidth: 860, margin: '0 auto', padding: '0 24px 80px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 14 }}>
            {[
              { icon: '🎙️', title: 'Voice First', desc: 'Say it once — stored and organised instantly.' },
              { icon: '🔒', title: 'Private & Secure', desc: 'Your data belongs only to you.' },
              { icon: '⚡', title: 'AI-Powered', desc: 'Smart suggestions, summaries and reminders.' },
              { icon: '📱', title: 'PWA — Works Offline', desc: 'Install on any device. No app store needed.' },
            ].map((f, i) => (
              <div key={i} style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14, padding: 22 }}>
                <div style={{ fontSize: 28, marginBottom: 10 }}>{f.icon}</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#e2e8f0', marginBottom: 6 }}>{f.title}</div>
                <div style={{ fontSize: 12, color: '#475569', lineHeight: 1.6 }}>{f.desc}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      <footer style={{ borderTop: '1px solid #1e293b', padding: '24px', textAlign: 'center', color: '#334155', fontSize: 12 }}>
        © {new Date().getFullYear()} QuietKeep · Pranix AI Labs Private Limited
      </footer>
    </main>
  );
}
