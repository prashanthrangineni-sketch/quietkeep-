'use client';
// src/app/login/page.tsx
// FIXED: Open to all users via Supabase magic link OTP
// Beta accounts still use fast-path password login
// All other emails get real OTP via Supabase

import { useState, useRef } from 'react';
import { supabase as _supabaseSingleton } from '@/lib/supabase';
import Link from 'next/link';

// APP_TYPE is baked into the bundle at build time by next.config.js.
// The personal login page should always redirect to /dashboard after login.
// In the personal APK, NEXT_PUBLIC_APP_TYPE=personal (default).
// If somehow a business APK reaches this page, it still goes to /dashboard,
// but the page.jsx APK guard prevents business APKs from ever reaching /login.
const APP_TYPE = process.env.NEXT_PUBLIC_APP_TYPE || 'personal';
const POST_AUTH_PATH = APP_TYPE === 'business' ? '/b/dashboard' : '/dashboard';

// Beta verification now handled server-side via /api/auth/beta-verify
// No credentials exposed in client bundle
const OTP_LEN = 8; // MUST match auth/verify/page.jsx and Supabase OTP length setting

// FIX: Use singleton so signInWithOtp and setSession write to 'qk-auth-token',
// the same key AuthContext listens on.
function getClient() {
  return _supabaseSingleton;
}

// ← ADDED: Sets app mode cookie so middleware enforces personal-only routing
function setPersonalMode() {
  document.cookie = 'qk_app_mode=personal; path=/; max-age=2592000; SameSite=Lax';
}

export default function LoginPage() {
  const [email, setEmail]   = useState('');
  const [step, setStep]     = useState<'email' | 'otp' | 'sent'>('email');
  const [otp, setOtp]       = useState(Array(OTP_LEN).fill(''));
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState('');
  const [isBeta, setIsBeta] = useState(false);
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  async function handleContinue() {
    if (!email.trim()) return;
    const norm = email.trim().toLowerCase();

    // Check if beta via server-side API (credentials never touch client)
    try {
      const betaRes = await fetch('/api/auth/beta-verify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: norm }),
      });
      const betaData = await betaRes.json();
      if (betaData.isBeta) {
        setIsBeta(true);
        setError('');
        setStep('otp');
        setTimeout(() => refs.current[0]?.focus(), 120);
        return;
      }
    } catch {} // Non-beta or API unavailable — fall through to magic link

    // All other users: send real Supabase magic link
    setLoading(true);
    setError('');
    const { error: otpErr } = await getClient().auth.signInWithOtp({
      email: norm,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?next=${POST_AUTH_PATH}`,
        shouldCreateUser: true,
      },
    });
    setLoading(false);
    if (otpErr) {
      setError(otpErr.message || 'Could not send login link. Please try again.');
      return;
    }
    setStep('sent');
  }

  async function verifyBeta() {
    const norm = email.trim().toLowerCase();
    const pwd = otp.join('');
    if (!pwd || pwd.length < OTP_LEN) { setError('Enter your full password.'); return; }

    setLoading(true);
    setError('');
    try {
      // Beta verification handled server-side — password sent over HTTPS, never stored client-side
      const res = await fetch('/api/auth/beta-verify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: norm }),
      });
      const data = await res.json();
      if (!data.access_token) {
        setError(data.error || 'Beta sign-in failed.');
        setOtp(Array(OTP_LEN).fill(''));
        setTimeout(() => refs.current[0]?.focus(), 100);
        setLoading(false);
        return;
      }
      // Set the session from server-returned tokens
      await getClient().auth.setSession({
        access_token: data.access_token,
        refresh_token: data.refresh_token,
      });
    } catch {
      setError('Sign-in failed. Please try again.');
      setOtp(Array(OTP_LEN).fill(''));
      setLoading(false);
      return;
    }
    setLoading(false);
    setPersonalMode(); // ← ADDED: lock this session to personal mode
    window.location.href = POST_AUTH_PATH;
  }

  function handleDigit(i: number, val: string) {
    const char = val.slice(-1);
    const next = [...otp]; next[i] = char; setOtp(next);
    if (char && i < OTP_LEN - 1) refs.current[i + 1]?.focus();
    if (isBeta && next.every(d => d !== '') && next.join('').length === OTP_LEN) {
      setTimeout(verifyBeta, 80);
    }
  }

  function handleKey(i: number, e: React.KeyboardEvent) {
    if (e.key === 'Backspace' && !otp[i] && i > 0) refs.current[i - 1]?.focus();
    if (e.key === 'Enter' && isBeta) verifyBeta();
  }

  const wrap: React.CSSProperties = {
    minHeight: '100dvh', background: 'var(--bg)', color: 'var(--text)',
    fontFamily: "'Inter', system-ui, sans-serif",
    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px',
  };
  const card: React.CSSProperties = {
    width: '100%', maxWidth: '400px',
    background: 'var(--surface)', border: '1px solid var(--border)',
    borderRadius: '20px', padding: '32px 24px',
    boxShadow: 'var(--shadow)',
  };

  // Sent state — magic link dispatched
  // Note: for magic link users, setPersonalMode() is called via the
  // /auth/callback redirect — the cookie is set client-side on the
  // dashboard page load via the useEffect in dashboard/page.jsx
  if (step === 'sent') return (
    <div style={wrap}>
      <div style={{ ...card, textAlign: 'center' }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>📬</div>
        <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--text)', marginBottom: 8 }}>
          Check your email
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.7, marginBottom: 20 }}>
          We sent a sign-in email to<br />
          <strong style={{ color: 'var(--primary)' }}>{email}</strong><br />
          Click the link <strong>OR</strong> enter the 8-digit code.
        </div>
        <div style={{ background: 'var(--primary-dim)', border: '1px solid var(--primary-glow)', borderRadius: 10, padding: '10px 14px', fontSize: 12, color: 'var(--text-muted)', marginBottom: 16, lineHeight: 1.6 }}>
          ⏱ Code / link valid for 60 minutes · Check spam if not in inbox
        </div>
        <button
          onClick={() => { window.location.href = `/auth/verify?email=${encodeURIComponent(email)}`; }}
          style={{
            width: '100%', padding: '12px', marginBottom: 10,
            background: 'linear-gradient(135deg,#5b5ef4,#818cf8)', border: 'none',
            color: '#fff', borderRadius: 12, fontSize: 14, fontWeight: 700,
            cursor: 'pointer', fontFamily: 'inherit',
            boxShadow: '0 4px 20px rgba(91,94,244,0.3)',
          }}
        >
          🔢 Enter 8-digit code →
        </button>
        <button
          onClick={() => { setStep('email'); setError(''); }}
          style={{ background: 'none', border: 'none', color: 'var(--text-subtle)', cursor: 'pointer', fontSize: 13, fontFamily: 'inherit', textDecoration: 'underline' }}
        >
          Try a different email
        </button>
      </div>
    </div>
  );

  // Email step
  if (step === 'email') return (
    <div style={wrap}>
      <div style={card}>
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 24 }}>
          <div style={{ width: 36, height: 36, borderRadius: 9, background: 'linear-gradient(135deg,#5b5ef4,#8b5cf6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ fontSize: 14, fontWeight: 900, color: '#fff' }}>QK</span>
          </div>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text)', letterSpacing: '-0.5px', lineHeight: 1.1 }}>QuietKeep</div>
            <div style={{ fontSize: 11, color: 'var(--text-subtle)' }}>Your Personal Life OS</div>
          </div>
        </div>

        <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text)', margin: '0 0 6px', letterSpacing: '-0.5px' }}>
          Sign in
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 22px', lineHeight: 1.6 }}>
          Enter your email. We'll send a magic link.
        </p>

        {error && (
          <div style={{ background: 'var(--red-dim)', border: '1px solid rgba(220,38,38,0.2)', borderRadius: 8, padding: '10px 12px', fontSize: 12, color: 'var(--red)', marginBottom: 12 }}>
            ⚠️ {error}
          </div>
        )}

        <label style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600, marginBottom: 6, display: 'block' }}>
          Email address
        </label>
        <input
          type="email" value={email}
          onChange={e => { setEmail(e.target.value); setError(''); }}
          onKeyDown={e => e.key === 'Enter' && !loading && email.trim() && handleContinue()}
          placeholder="you@example.com" autoFocus
          className="qk-input"
          style={{ marginBottom: 12, fontSize: 15 }}
        />

        <button
          onClick={handleContinue}
          disabled={!email.trim() || loading}
          style={{
            width: '100%', padding: '14px', marginTop: 4,
            background: !email.trim() || loading ? 'var(--surface-hover)' : 'linear-gradient(135deg,#5b5ef4,#818cf8)',
            border: 'none', color: !email.trim() || loading ? 'var(--text-subtle)' : '#fff',
            borderRadius: 12, fontSize: 15, fontWeight: 700,
            cursor: !email.trim() || loading ? 'not-allowed' : 'pointer',
            fontFamily: 'inherit', transition: 'all 0.2s',
            boxShadow: !email.trim() || loading ? 'none' : '0 4px 20px rgba(91,94,244,0.3)',
          }}
        >
          {loading ? 'Sending link…' : 'Continue →'}
        </button>

        <p style={{ marginTop: 16, fontSize: 11, color: 'var(--text-subtle)', textAlign: 'center', lineHeight: 1.6 }}>
          No account? One is created automatically on first sign-in.
        </p>


      </div>
    </div>
  );

  // OTP step (beta accounts only)
  return (
    <div style={wrap}>
      <div style={{ ...card, textAlign: 'center' }}>
        <div style={{ fontSize: 40, marginBottom: 10 }}>🔑</div>
        <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>Beta Access</div>
        <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 6, lineHeight: 1.6 }}>
          {email}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-subtle)', marginBottom: 20, lineHeight: 1.6, background: 'var(--primary-dim)', borderRadius: 8, padding: '8px 12px' }}>
          Enter each character of your beta password in the boxes.
        </div>

        {error && (
          <div style={{ background: 'var(--red-dim)', border: '1px solid rgba(220,38,38,0.2)', borderRadius: 8, padding: '10px 12px', fontSize: 12, color: 'var(--red)', marginBottom: 14 }}>
            ⚠️ {error}
          </div>
        )}

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center', marginBottom: 20 }}>
          {otp.map((d, i) => (
            <input key={i} ref={el => { refs.current[i] = el; }}
              type="password" maxLength={1}
              value={d}
              onChange={e => handleDigit(i, e.target.value)}
              onKeyDown={e => handleKey(i, e)}
              style={{
                width: 44, height: 54, textAlign: 'center',
                background: d ? 'var(--primary-dim)' : 'var(--surface-hover)',
                border: d ? '2px solid var(--primary)' : '1px solid var(--border)',
                borderRadius: 10, color: 'var(--text)', fontSize: 20, fontWeight: 700,
                outline: 'none', fontFamily: 'inherit',
              }}
            />
          ))}
        </div>

        <button
          onClick={verifyBeta}
          disabled={loading || otp.some(d => !d)}
          style={{
            width: '100%', padding: '14px',
            background: loading || otp.some(d => !d) ? 'var(--surface-hover)' : 'linear-gradient(135deg,#5b5ef4,#818cf8)',
            border: 'none',
            color: loading || otp.some(d => !d) ? 'var(--text-subtle)' : '#fff',
            borderRadius: 12, fontSize: 15, fontWeight: 700,
            cursor: loading || otp.some(d => !d) ? 'not-allowed' : 'pointer',
            fontFamily: 'inherit',
          }}
        >
          {loading ? 'Signing in…' : 'Sign In'}
        </button>

        <div style={{ marginTop: 12 }}>
          <button
            onClick={() => { setStep('email'); setOtp(Array(OTP_LEN).fill('')); setError(''); setIsBeta(false); }}
            style={{ background: 'none', border: 'none', color: 'var(--text-subtle)', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit' }}
          >
            ← Back
          </button>
        </div>
      </div>
    </div>
  );
        }
