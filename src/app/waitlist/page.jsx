'use client';
import { useAuth } from '@/lib/context/auth';
import { apiPost } from '@/lib/safeFetch';
// src/app/waitlist/page.jsx — Waitlist + email capture
// Shows after email verification for users not yet granted access
// Also used as standalone /waitlist marketing page

import { useState, useEffect } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

function WaitlistContent() {
  const searchParams = useSearchParams();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [useCase, setUseCase] = useState('personal');
  const [submitted, setSubmitted] = useState(false);
  const [position, setPosition] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const ref = searchParams?.get('ref') || '';

  useEffect(() => {
    // Sign out if they landed here from email verification
    if (user) supabase.auth.signOut().catch(() => {});
  }, []);

  async function handleSubmit(e) {
    e?.preventDefault();
    if (!email.includes('@')) { setError('Please enter a valid email'); return; }
    setLoading(true); setError('');

    try {
      const utm_source = searchParams?.get('utm_source');
      const utm_medium = searchParams?.get('utm_medium');
      const utm_campaign = searchParams?.get('utm_campaign');

      const { data: res, error: resErr } = await apiPost('/api/waitlist', { email, name, use_case: useCase, referral_code: ref || null, source: utm_source || 'direct', utm_source, utm_medium, utm_campaign });
      const data = res;
      if (data.error && !data.already_applied) {
        setError(data.error);
      } else {
        setPosition(data.position);
        setSubmitted(true);
      }
    } catch {
      setError('Something went wrong. Please try again.');
    }
    setLoading(false);
  }

  return (
    <div style={{
      minHeight: '100dvh',
      background: 'var(--bg)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 16, fontFamily: "'Inter',-apple-system,sans-serif",
    }}>
      <div style={{ width: '100%', maxWidth: 440 }}>

        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 32, justifyContent: 'center' }}>
          <div style={{ width: 36, height: 36, borderRadius: 9, background: 'linear-gradient(135deg,#5b5ef4,#8b5cf6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ fontSize: 16, fontWeight: 800, color: '#fff' }}>QK</span>
          </div>
          <span style={{ fontWeight: 800, fontSize: 18, color: 'var(--text)' }}>QuietKeep</span>
        </div>

        {!submitted ? (
          <div className="qk-card" style={{ padding: '36px 28px' }}>
            <div style={{ textAlign: 'center', marginBottom: 28 }}>
              <div style={{ fontSize: 44, marginBottom: 12 }}>🎉</div>
              <h1 style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-0.5px', margin: '0 0 10px', color: 'var(--text)' }}>
                You're nearly in!
              </h1>
              <p style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.6, margin: 0 }}>
                QuietKeep is in private beta. Join the waitlist and we'll notify you the moment your access is ready.
              </p>
              {ref && (
                <div style={{ marginTop: 12, padding: '8px 14px', background: 'var(--accent-dim)', border: '1px solid rgba(5,150,105,0.3)', borderRadius: 8, fontSize: 13, color: 'var(--accent)', fontWeight: 600 }}>
                  🎁 Referred by a friend — you'll get 30 days Premium free on activation
                </div>
              )}
            </div>

            <div style={{ marginBottom: 14 }}>
              <label className="qk-lbl">Your name</label>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="What should we call you?" className="qk-input" style={{ marginTop: 4 }} />
            </div>

            <div style={{ marginBottom: 14 }}>
              <label className="qk-lbl">Email address *</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" className="qk-input" style={{ marginTop: 4 }} />
            </div>

            <div style={{ marginBottom: 20 }}>
              <label className="qk-lbl">How will you use QuietKeep?</label>
              <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                {[['personal','👤 Personal'],['business','🏢 Business']].map(([v,l]) => (
                  <button key={v} onClick={() => setUseCase(v)} type="button"
                    className="qk-btn qk-btn-sm"
                    style={{ flex: 1, justifyContent: 'center', background: useCase === v ? 'var(--primary-dim)' : 'var(--surface-hover)', border: `1px solid ${useCase === v ? 'var(--primary)' : 'var(--border)'}`, color: useCase === v ? 'var(--primary)' : 'var(--text-muted)' }}>
                    {l}
                  </button>
                ))}
              </div>
            </div>

            {error && <div style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12, fontWeight: 600 }}>⚠️ {error}</div>}

            <button onClick={handleSubmit} disabled={loading} className="qk-btn qk-btn-primary" style={{ width: '100%', justifyContent: 'center', padding: 14, fontSize: 15 }}>
              {loading ? 'Joining…' : 'Join the waitlist →'}
            </button>

            <p style={{ textAlign: 'center', fontSize: 12, color: 'var(--text-subtle)', marginTop: 16 }}>
              No spam. Unsubscribe anytime. <a href="/" style={{ color: 'var(--text-subtle)' }}>← Back</a>
            </p>
          </div>
        ) : (
          <div className="qk-card" style={{ padding: '40px 28px', textAlign: 'center' }}>
            <div style={{ fontSize: 52, marginBottom: 16 }}>✅</div>
            <h2 style={{ fontSize: 24, fontWeight: 800, margin: '0 0 10px', color: 'var(--text)' }}>You're on the list!</h2>
            {position && (
              <div style={{ display: 'inline-block', background: 'var(--primary-dim)', border: '1px solid var(--primary-glow)', borderRadius: 999, padding: '4px 16px', fontSize: 13, color: 'var(--primary)', fontWeight: 700, marginBottom: 16 }}>
                Position #{position} in queue
              </div>
            )}
            <p style={{ color: 'var(--text-muted)', fontSize: 14, lineHeight: 1.7, marginBottom: 24 }}>
              We'll email you at <strong style={{ color: 'var(--text)' }}>{email}</strong> the moment your access is ready.
              {ref && <> You'll get 30 days Premium free when you activate.</>}
            </p>

            <div style={{ background: 'var(--surface-hover)', borderRadius: 12, padding: '16px 20px', marginBottom: 20, textAlign: 'left' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>What's coming for you</div>
              {['AI-powered daily brief','Voice-first keeps & reminders','Finance, family & documents','Warranty wallet & lifecycle tracker','Driving mode & emergency contacts'].map(f => (
                <div key={f} style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 4 }}>✦ {f}</div>
              ))}
            </div>

            <a href="https://www.cart2save.com" target="_blank" rel="noopener noreferrer"
              className="qk-btn qk-btn-primary" style={{ width: '100%', justifyContent: 'center', textDecoration: 'none', marginBottom: 12 }}>
              Explore Cart2Save while you wait →
            </a>
            <a href="/" style={{ fontSize: 13, color: 'var(--text-subtle)', textDecoration: 'none' }}>← Back to home</a>
          </div>
        )}
      </div>
    </div>
  );
}

export default function WaitlistPage() {
  const { user, accessToken, loading: authLoading } = useAuth();
  return (
    <Suspense fallback={<div style={{ minHeight: '100vh', background: 'var(--bg)' }} />}>
      <WaitlistContent />
    </Suspense>
  );
}
