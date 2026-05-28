'use client';
// src/app/login/page.tsx
// P0.3 FIX: Password login for ALL users.
//
// BEFORE: Non-beta users got magic link (signInWithOtp) — forces email check every login.
//         Founder explicitly rejected this behavior.
// AFTER:  All users get email + password login. Magic link still available as fallback.
//         Beta accounts retain their fast-path server-side password verification.
//         New user signup via email + password with optional email confirmation.
//
// AUTH FLOW:
//   1. User enters email → Continue
//   2. IF beta email: beta OTP box (unchanged)
//   3. ELSE: password field + Sign In button
//             "Forgot password?" → reset email
//             "No account?" → signup path
//             "Use magic link instead" → secondary fallback
//
// SESSION PERSISTENCE:
//   Supabase default: 60-day refresh token in localStorage (qk-auth-token).
//   Sessions survive APK restarts, browser close, token expiry.
//   No explicit "remember me" needed — already the default.

import { useState, useRef } from 'react';
import { supabase as _supabaseSingleton } from '@/lib/supabase';
import Link from 'next/link';

const APP_TYPE = process.env.NEXT_PUBLIC_APP_TYPE || 'personal';
const POST_AUTH_PATH = APP_TYPE === 'business' ? '/b/dashboard' : '/dashboard';

const OTP_LEN = 8; // Beta accounts only

function getClient() {
  return _supabaseSingleton;
}

function setPersonalMode() {
  document.cookie = 'qk_app_mode=personal; path=/; max-age=2592000; SameSite=Lax';
}

type Step = 'email' | 'password' | 'signup' | 'forgot' | 'otp' | 'sent' | 'reset_sent';

export default function LoginPage() {
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [confirm,  setConfirm]  = useState('');
  const [step,     setStep]     = useState<Step>('email');
  const [otp,      setOtp]      = useState(Array(OTP_LEN).fill(''));
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');
  const [isBeta,   setIsBeta]   = useState(false);
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  // ── Step 1: email → determine flow ──────────────────────────────────────────
  async function handleContinue() {
    if (!email.trim()) return;
    const norm = email.trim().toLowerCase();
    setError('');

    // Check if beta via server-side API
    try {
      const betaRes = await fetch('/api/auth/beta-verify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: norm }),
      });
      const betaData = await betaRes.json();
      if (betaData.isBeta) {
        setIsBeta(true);
        setStep('otp');
        setTimeout(() => refs.current[0]?.focus(), 120);
        return;
      }
    } catch {} // Non-beta — fall through to password flow

    // All general users: password login
    setStep('password');
    setTimeout(() => document.getElementById('qk-password-input')?.focus(), 100);
  }

  // ── Password sign-in (general users) ────────────────────────────────────────
  async function verifyPassword() {
    if (!password) { setError('Enter your password.'); return; }
    setLoading(true);
    setError('');

    const { data, error: authErr } = await getClient().auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });

    setLoading(false);

    if (authErr) {
      const msg = authErr.message || '';
      if (msg.includes('Invalid login credentials') || msg.includes('invalid_credentials')) {
        setError('Incorrect password. Use "Forgot password?" if you need to reset it.');
      } else if (msg.includes('Email not confirmed')) {
        setError('Please confirm your email first — check your inbox for a verification link.');
      } else if (msg.includes('Too many requests')) {
        setError('Too many attempts. Wait a few minutes and try again.');
      } else {
        setError(msg || 'Sign-in failed. Try again.');
      }
      return;
    }

    setPersonalMode();
    window.location.href = POST_AUTH_PATH;
  }

  // ── Sign up (new accounts) ────────────────────────────────────────────────
  async function signUp() {
    if (!password || password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setLoading(true);
    setError('');

    const { data, error: signUpErr } = await getClient().auth.signUp({
      email: email.trim().toLowerCase(),
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?next=${POST_AUTH_PATH}`,
      },
    });

    setLoading(false);

    if (signUpErr) {
      setError(signUpErr.message || 'Sign-up failed.');
      return;
    }

    if (data.session) {
      // Email confirmation disabled — user is immediately signed in
      setPersonalMode();
      window.location.href = POST_AUTH_PATH;
    } else {
      // Email confirmation required
      setStep('sent');
    }
  }

  // ── Forgot password ───────────────────────────────────────────────────────
  async function sendReset() {
    setLoading(true);
    setError('');

    const { error: resetErr } = await getClient().auth.resetPasswordForEmail(
      email.trim().toLowerCase(),
      {
        redirectTo: `${window.location.origin}/auth/confirm?next=${POST_AUTH_PATH}`,
      }
    );

    setLoading(false);

    if (resetErr) {
      setError(resetErr.message || 'Could not send reset email.');
      return;
    }

    setStep('reset_sent');
  }

  // ── Magic link fallback (secondary) ──────────────────────────────────────
  async function sendMagicLink() {
    setLoading(true);
    setError('');
    const { error: otpErr } = await getClient().auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?next=${POST_AUTH_PATH}`,
        shouldCreateUser: true,
      },
    });
    setLoading(false);
    if (otpErr) {
      setError(otpErr.message || 'Could not send login link.');
      return;
    }
    setStep('sent');
  }

  // ── Beta OTP (server-side password) ──────────────────────────────────────
  async function verifyBeta() {
    const norm = email.trim().toLowerCase();
    const pwd = otp.join('');
    if (!pwd || pwd.length < OTP_LEN) { setError('Enter your full password.'); return; }

    setLoading(true);
    setError('');
    try {
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
    setPersonalMode();
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
  const logo = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 24 }}>
      <div style={{ width: 36, height: 36, borderRadius: 9, background: 'linear-gradient(135deg,#5b5ef4,#8b5cf6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ fontSize: 14, fontWeight: 900, color: '#fff' }}>QK</span>
      </div>
      <div>
        <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text)', letterSpacing: '-0.5px', lineHeight: 1.1 }}>QuietKeep</div>
        <div style={{ fontSize: 11, color: 'var(--text-subtle)' }}>Your Personal Life OS</div>
      </div>
    </div>
  );
  const errorBox = error ? (
    <div style={{ background: 'var(--red-dim)', border: '1px solid rgba(220,38,38,0.2)', borderRadius: 8, padding: '10px 12px', fontSize: 12, color: 'var(--red)', marginBottom: 12 }}>
      ⚠️ {error}
    </div>
  ) : null;

  // ── Sent / Reset sent state ──────────────────────────────────────────────
  if (step === 'sent' || step === 'reset_sent') return (
    <div style={wrap}>
      <div style={{ ...card, textAlign: 'center' }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>{step === 'reset_sent' ? '🔑' : '📬'}</div>
        <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--text)', marginBottom: 8 }}>
          {step === 'reset_sent' ? 'Reset link sent' : 'Check your email'}
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.7, marginBottom: 20 }}>
          {step === 'reset_sent'
            ? <>We sent a password reset link to <strong style={{ color: 'var(--primary)' }}>{email}</strong>. Click the link to set a new password.</>
            : <>We sent a sign-in link to <strong style={{ color: 'var(--primary)' }}>{email}</strong>. Click the link or enter the 8-digit code.</>
          }
        </div>
        {step === 'sent' && (
          <button onClick={() => { window.location.href = `/auth/verify?email=${encodeURIComponent(email)}`; }}
            style={{ width: '100%', padding: '12px', marginBottom: 10, background: 'linear-gradient(135deg,#5b5ef4,#818cf8)', border: 'none', color: '#fff', borderRadius: 12, fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
            🔢 Enter 8-digit code →
          </button>
        )}
        <button onClick={() => { setStep('email'); setError(''); }}
          style={{ background: 'none', border: 'none', color: 'var(--text-subtle)', cursor: 'pointer', fontSize: 13, fontFamily: 'inherit', textDecoration: 'underline' }}>
          ← Back to sign in
        </button>
      </div>
    </div>
  );

  // ── Email step ────────────────────────────────────────────────────────────
  if (step === 'email') return (
    <div style={wrap}>
      <div style={card}>
        {logo}
        <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text)', margin: '0 0 6px', letterSpacing: '-0.5px' }}>Sign in</h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 22px', lineHeight: 1.6 }}>Enter your email to continue.</p>
        {errorBox}
        <label style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600, marginBottom: 6, display: 'block' }}>Email address</label>
        <input type="email" value={email} onChange={e => { setEmail(e.target.value); setError(''); }}
          onKeyDown={e => e.key === 'Enter' && !loading && email.trim() && handleContinue()}
          placeholder="you@example.com" autoFocus className="qk-input" style={{ marginBottom: 12, fontSize: 15 }} />
        <button onClick={handleContinue} disabled={!email.trim() || loading}
          style={{ width: '100%', padding: '14px', marginTop: 4, background: !email.trim() || loading ? 'var(--surface-hover)' : 'linear-gradient(135deg,#5b5ef4,#818cf8)', border: 'none', color: !email.trim() || loading ? 'var(--text-subtle)' : '#fff', borderRadius: 12, fontSize: 15, fontWeight: 700, cursor: !email.trim() || loading ? 'not-allowed' : 'pointer', fontFamily: 'inherit', transition: 'all 0.2s' }}>
          {loading ? 'Checking…' : 'Continue →'}
        </button>
        <p style={{ marginTop: 16, fontSize: 11, color: 'var(--text-subtle)', textAlign: 'center', lineHeight: 1.6 }}>
          No account? You can create one on the next step.
        </p>
      </div>
    </div>
  );

  // ── Password step (general users) ─────────────────────────────────────────
  if (step === 'password') return (
    <div style={wrap}>
      <div style={card}>
        {logo}
        <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text)', margin: '0 0 4px', letterSpacing: '-0.5px' }}>Welcome back</h1>
        <p style={{ fontSize: 13, color: 'var(--text-subtle)', margin: '0 0 20px' }}>{email}</p>
        {errorBox}
        <label style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600, marginBottom: 6, display: 'block' }}>Password</label>
        <input id="qk-password-input" type="password" value={password}
          onChange={e => { setPassword(e.target.value); setError(''); }}
          onKeyDown={e => e.key === 'Enter' && !loading && verifyPassword()}
          placeholder="Your password" className="qk-input" style={{ marginBottom: 8, fontSize: 15 }} />
        <button onClick={() => { setStep('forgot'); setPassword(''); setError(''); }}
          style={{ background: 'none', border: 'none', color: 'var(--text-subtle)', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit', textDecoration: 'underline', marginBottom: 16, display: 'block' }}>
          Forgot password?
        </button>
        <button onClick={verifyPassword} disabled={!password || loading}
          style={{ width: '100%', padding: '14px', background: !password || loading ? 'var(--surface-hover)' : 'linear-gradient(135deg,#5b5ef4,#818cf8)', border: 'none', color: !password || loading ? 'var(--text-subtle)' : '#fff', borderRadius: 12, fontSize: 15, fontWeight: 700, cursor: !password || loading ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}>
          {loading ? 'Signing in…' : 'Sign In'}
        </button>
        <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center' }}>
          <button onClick={() => { setStep('signup'); setPassword(''); setConfirm(''); setError(''); }}
            style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 13, fontFamily: 'inherit', borderRadius: 8, padding: '8px 16px' }}>
            No account? Create one →
          </button>
          <button onClick={() => { sendMagicLink(); }}
            style={{ background: 'none', border: 'none', color: 'var(--text-subtle)', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit', textDecoration: 'underline' }}>
            Use magic link instead
          </button>
        </div>
        <button onClick={() => { setStep('email'); setPassword(''); setError(''); }}
          style={{ background: 'none', border: 'none', color: 'var(--text-subtle)', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit', marginTop: 8, display: 'block', width: '100%', textAlign: 'center' }}>
          ← Change email
        </button>
      </div>
    </div>
  );

  // ── Sign up step ──────────────────────────────────────────────────────────
  if (step === 'signup') return (
    <div style={wrap}>
      <div style={card}>
        {logo}
        <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text)', margin: '0 0 4px', letterSpacing: '-0.5px' }}>Create account</h1>
        <p style={{ fontSize: 13, color: 'var(--text-subtle)', margin: '0 0 20px' }}>{email}</p>
        {errorBox}
        <label style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600, marginBottom: 6, display: 'block' }}>Choose a password</label>
        <input type="password" value={password} onChange={e => { setPassword(e.target.value); setError(''); }}
          placeholder="At least 8 characters" className="qk-input" style={{ marginBottom: 12, fontSize: 15 }} autoFocus />
        <label style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600, marginBottom: 6, display: 'block' }}>Confirm password</label>
        <input type="password" value={confirm} onChange={e => { setConfirm(e.target.value); setError(''); }}
          onKeyDown={e => e.key === 'Enter' && !loading && signUp()}
          placeholder="Same password again" className="qk-input" style={{ marginBottom: 16, fontSize: 15 }} />
        <button onClick={signUp} disabled={!password || !confirm || loading}
          style={{ width: '100%', padding: '14px', background: !password || !confirm || loading ? 'var(--surface-hover)' : 'linear-gradient(135deg,#5b5ef4,#818cf8)', border: 'none', color: !password || !confirm || loading ? 'var(--text-subtle)' : '#fff', borderRadius: 12, fontSize: 15, fontWeight: 700, cursor: !password || !confirm || loading ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}>
          {loading ? 'Creating account…' : 'Create Account'}
        </button>
        <button onClick={() => { setStep('password'); setPassword(''); setConfirm(''); setError(''); }}
          style={{ background: 'none', border: 'none', color: 'var(--text-subtle)', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit', marginTop: 12, display: 'block', width: '100%', textAlign: 'center', textDecoration: 'underline' }}>
          ← Back to sign in
        </button>
      </div>
    </div>
  );

  // ── Forgot password step ──────────────────────────────────────────────────
  if (step === 'forgot') return (
    <div style={wrap}>
      <div style={card}>
        {logo}
        <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text)', margin: '0 0 6px', letterSpacing: '-0.5px' }}>Reset password</h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 20px', lineHeight: 1.6 }}>
          We'll send a reset link to <strong>{email}</strong>.
        </p>
        {errorBox}
        <button onClick={sendReset} disabled={loading}
          style={{ width: '100%', padding: '14px', background: loading ? 'var(--surface-hover)' : 'linear-gradient(135deg,#5b5ef4,#818cf8)', border: 'none', color: loading ? 'var(--text-subtle)' : '#fff', borderRadius: 12, fontSize: 15, fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer', fontFamily: 'inherit', marginBottom: 12 }}>
          {loading ? 'Sending…' : 'Send Reset Link'}
        </button>
        <button onClick={() => { setStep('password'); setError(''); }}
          style={{ background: 'none', border: 'none', color: 'var(--text-subtle)', cursor: 'pointer', fontSize: 13, fontFamily: 'inherit', display: 'block', width: '100%', textAlign: 'center', textDecoration: 'underline' }}>
          ← Back
        </button>
      </div>
    </div>
  );

  // ── Beta OTP step ─────────────────────────────────────────────────────────
  return (
    <div style={wrap}>
      <div style={{ ...card, textAlign: 'center' }}>
        <div style={{ fontSize: 40, marginBottom: 10 }}>🔑</div>
        <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>Beta Access</div>
        <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 6, lineHeight: 1.6 }}>{email}</div>
        <div style={{ fontSize: 12, color: 'var(--text-subtle)', marginBottom: 20, lineHeight: 1.6, background: 'var(--primary-dim)', borderRadius: 8, padding: '8px 12px' }}>
          Enter each character of your beta password in the boxes.
        </div>
        {errorBox}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center', marginBottom: 20 }}>
          {otp.map((d, i) => (
            <input key={i} ref={el => { refs.current[i] = el; }}
              type="password" maxLength={1} value={d}
              onChange={e => handleDigit(i, e.target.value)}
              onKeyDown={e => handleKey(i, e)}
              style={{ width: 44, height: 54, textAlign: 'center', background: d ? 'var(--primary-dim)' : 'var(--surface-hover)', border: d ? '2px solid var(--primary)' : '1px solid var(--border)', borderRadius: 10, color: 'var(--text)', fontSize: 20, fontWeight: 700, outline: 'none', fontFamily: 'inherit' }} />
          ))}
        </div>
        <button onClick={verifyBeta} disabled={loading || otp.some(d => !d)}
          style={{ width: '100%', padding: '14px', background: loading || otp.some(d => !d) ? 'var(--surface-hover)' : 'linear-gradient(135deg,#5b5ef4,#818cf8)', border: 'none', color: loading || otp.some(d => !d) ? 'var(--text-subtle)' : '#fff', borderRadius: 12, fontSize: 15, fontWeight: 700, cursor: loading || otp.some(d => !d) ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}>
          {loading ? 'Signing in…' : 'Sign In'}
        </button>
        <div style={{ marginTop: 12 }}>
          <button onClick={() => { setStep('email'); setOtp(Array(OTP_LEN).fill('')); setError(''); setIsBeta(false); }}
            style={{ background: 'none', border: 'none', color: 'var(--text-subtle)', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit' }}>
            ← Back
          </button>
        </div>
      </div>
    </div>
  );
}
