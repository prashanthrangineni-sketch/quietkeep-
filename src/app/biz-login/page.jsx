'use client';
// src/app/biz-login/page.jsx — Business Login (pure JS, no TypeScript)
// Same beta password system as personal login

import { useState, useRef } from 'react';
import Link from 'next/link';
import { createBrowserClient } from '@supabase/ssr';

// Beta accounts: credentials stored in NEXT_PUBLIC_BETA_CREDS env var.
// Format: "email1:password1,email2:password2" (comma-separated pairs).
// Falls back to empty object if not set — beta fast-path simply won't trigger.
// NEVER hardcode credentials here. Set NEXT_PUBLIC_BETA_CREDS in Vercel env vars.
function parseBetaCreds() {
  const raw = process.env.NEXT_PUBLIC_BETA_CREDS || '';
  if (!raw) return {};
  return Object.fromEntries(
    raw.split(',').map(pair => {
      const idx = pair.indexOf(':');
      if (idx === -1) return ['', ''];
      return [pair.slice(0, idx).trim().toLowerCase(), pair.slice(idx + 1).trim()];
    }).filter(([k]) => k && k.includes('@'))
  );
}

const BETA_EMAILS = parseBetaCreds();
const OTP_LEN = 8;
const G = '#10b981';

function getClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

// ← ADDED: Sets app mode cookie so middleware enforces business-only routing
function setBusinessMode() {
  document.cookie = 'qk_app_mode=business; path=/; max-age=86400; SameSite=Lax';
}

export default function BizLoginPage() {
  const [email, setEmail] = useState('');
  const [step, setStep] = useState('email'); // 'email' | 'otp' | 'sent'
  const [otp, setOtp] = useState(Array(OTP_LEN).fill(''));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const refs = useRef([]);

  function handleContinue() {
    if (!email.trim()) return;
    const norm = email.trim().toLowerCase();
    if (BETA_EMAILS[norm]) {
      setError('');
      setStep('otp');
      setTimeout(() => refs.current[0]?.focus(), 120);
    } else {
      sendMagicLink(norm);
    }
  }

  async function sendMagicLink(emailAddr) {
    setLoading(true); setError('');
    const sb = getClient();
    const { error: err } = await sb.auth.signInWithOtp({
      email: emailAddr,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=/b/dashboard` },
    });
    setLoading(false);
    if (err) { setError(err.message || 'Failed to send link.'); return; }
    setStep('sent');
  }

  function handleOtpInput(idx, val) {
    const next = [...otp];
    next[idx] = val.slice(-1);
    setOtp(next);
    if (val && idx < OTP_LEN - 1) refs.current[idx + 1]?.focus();
  }

  function handleOtpKey(idx, e) {
    if (e.key === 'Backspace' && !otp[idx] && idx > 0) refs.current[idx - 1]?.focus();
    if (e.key === 'Enter' && otp.join('').length === OTP_LEN) verifyBeta();
  }

  async function verifyBeta() {
    const norm = email.trim().toLowerCase();
    const expected = BETA_EMAILS[norm];
    if (!expected) { setError('Email not in beta list.'); return; }
    setLoading(true); setError('');
    const sb = getClient();
    const { data, error: signInErr } = await sb.auth.signInWithPassword({
      email: norm,
      password: expected,
    });
    setLoading(false);
    if (signInErr || !data.session) {
      setError('Invalid password. Please check your beta access credentials.');
      return;
    }
    setBusinessMode(); // ← ADDED: lock this session to business mode
    window.location.href = '/b/dashboard';
  }

  const inp = {
    width: '100%', background: 'rgba(255,255,255,0.06)',
    border: '1.5px solid rgba(255,255,255,0.1)',
    borderRadius: 12, padding: '14px 16px',
    color: '#f1f5f9', fontSize: 15, outline: 'none',
    boxSizing: 'border-box', fontFamily: 'inherit',
  };

  return (
    <div style={{ minHeight: '100dvh', background: 'linear-gradient(135deg,#0a1628 0%,#0d2a1e 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, fontFamily: "'Inter',-apple-system,sans-serif", position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', top: -200, right: -200, width: 600, height: 600, background: 'radial-gradient(circle,rgba(16,185,129,0.08) 0%,transparent 70%)', pointerEvents: 'none' }} />

      <div style={{ width: '100%', maxWidth: 420, position: 'relative', zIndex: 1 }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 32 }}>
          <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: 8, textDecoration: 'none' }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: `linear-gradient(135deg,${G},#059669)`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ fontSize: 12, fontWeight: 900, color: '#fff' }}>QB</span>
            </div>
            <span style={{ fontWeight: 800, fontSize: 16, color: '#e2e8f0' }}>
              QuietKeep <span style={{ color: G }}>Business</span>
            </span>
          </Link>
          <Link href="/login" style={{ fontSize: 12, color: '#64748b', textDecoration: 'none', background: 'rgba(255,255,255,0.05)', padding: '5px 12px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.08)' }}>
            Personal →
          </Link>
        </div>

        {/* Sent state */}
        {step === 'sent' && (
          <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 22, padding: '40px 28px', textAlign: 'center' }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>📬</div>
            <h2 style={{ fontSize: 22, fontWeight: 800, color: '#f1f5f9', margin: '0 0 10px' }}>Check your email</h2>
            <p style={{ fontSize: 14, color: '#64748b', lineHeight: 1.7, marginBottom: 20 }}>
              We sent a sign-in email with an 8-digit code to <strong style={{ color: G }}>{email}</strong>.<br />
              Click it to open your business workspace.
            </p>
            <button
              onClick={() => { window.location.href = `/auth/verify?email=${encodeURIComponent(email)}&next=/b/dashboard`; }}
              style={{ width: '100%', background: `linear-gradient(135deg,${G},#059669)`, color: '#fff', border: 'none', borderRadius: 12, padding: '13px', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', marginBottom: 10 }}
            >
              🔢 Enter 8-digit code →
            </button>
            <button onClick={() => { setStep('email'); setError(''); }}
              style={{ background: 'none', border: 'none', color: '#64748b', fontSize: 13, cursor: 'pointer', textDecoration: 'underline' }}>
              Try a different email
            </button>
          </div>
        )}

        {/* Email step */}
        {step === 'email' && (
          <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 22, padding: '36px 28px', backdropFilter: 'blur(20px)' }}>
            <div style={{ display: 'inline-block', background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.25)', borderRadius: 999, padding: '3px 12px', fontSize: 11, color: G, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 16 }}>
              🏢 Business Workspace
            </div>
            <h1 style={{ fontSize: 24, fontWeight: 800, color: '#f1f5f9', margin: '0 0 6px' }}>Sign in</h1>
            <p style={{ fontSize: 14, color: '#64748b', margin: '0 0 24px', lineHeight: 1.6 }}>
              Enter your email to access your business workspace.
            </p>
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 12, color: '#64748b', display: 'block', marginBottom: 6, fontWeight: 500 }}>
                Email address
              </label>
              <input
                type="email" value={email}
                onChange={e => { setEmail(e.target.value); setError(''); }}
                onKeyDown={e => e.key === 'Enter' && !loading && handleContinue()}
                placeholder="beta@quietkeep.com"
                autoFocus
                style={inp}
                onFocus={e => e.target.style.borderColor = 'rgba(16,185,129,0.5)'}
                onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,0.1)'}
              />
            </div>
            {error && <div style={{ color: '#ef4444', fontSize: 12, marginBottom: 12 }}>⚠️ {error}</div>}
            <button onClick={handleContinue} disabled={loading || !email.trim()}
              style={{ width: '100%', background: `linear-gradient(135deg,${G},#059669)`, color: '#fff', border: 'none', borderRadius: 12, padding: '15px', fontSize: 15, fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer', fontFamily: 'inherit', opacity: loading ? 0.7 : 1 }}>
              {loading ? 'Please wait…' : 'Continue →'}
            </button>
            <div style={{ marginTop: 16, padding: '12px 14px', background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.15)', borderRadius: 10, fontSize: 12, color: '#64748b', lineHeight: 1.6 }}>
              <strong style={{ color: G }}>Beta test:</strong> Use{' '}
              <code style={{ color: '#a5b4fc', fontSize: 11 }}>beta@quietkeep.com</code>{' '}
              for full business demo with sample data (retail store, 5 staff, inventory, GST).
            </div>
          </div>
        )}

        {/* OTP / Password step */}
        {step === 'otp' && (
          <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 22, padding: '36px 28px', backdropFilter: 'blur(20px)' }}>
            <h1 style={{ fontSize: 22, fontWeight: 800, color: '#f1f5f9', margin: '0 0 4px' }}>Enter password</h1>
            <p style={{ fontSize: 13, color: '#64748b', margin: '0 0 24px' }}>
              {email}
            </p>

            <label style={{ fontSize: 12, color: '#64748b', display: 'block', marginBottom: 10, fontWeight: 500 }}>
              Password — enter each character in a box
            </label>
            <div style={{ display: 'flex', gap: 6, marginBottom: 16, justifyContent: 'center' }}>
              {otp.map((v, i) => (
                <input
                  key={i}
                  ref={el => { refs.current[i] = el; }}
                  type="password"
                  maxLength={1}
                  value={v}
                  onChange={e => handleOtpInput(i, e.target.value)}
                  onKeyDown={e => handleOtpKey(i, e)}
                  style={{
                    width: 36, height: 44, textAlign: 'center',
                    background: 'rgba(255,255,255,0.08)',
                    border: `1.5px solid ${v ? 'rgba(16,185,129,0.5)' : 'rgba(255,255,255,0.12)'}`,
                    borderRadius: 8, color: '#f1f5f9', fontSize: 18,
                    fontWeight: 700, outline: 'none', fontFamily: 'inherit',
                  }}
                />
              ))}
            </div>

            <div style={{ background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.2)', borderRadius: 8, padding: '10px 12px', fontSize: 12, color: '#94a3b8', marginBottom: 16, lineHeight: 1.6 }}>
              Enter your beta access password, one character per box.
            </div>

            {error && <div style={{ color: '#ef4444', fontSize: 12, marginBottom: 12 }}>⚠️ {error}</div>}

            <button onClick={verifyBeta} disabled={loading || otp.join('').length < OTP_LEN}
              style={{ width: '100%', background: `linear-gradient(135deg,${G},#059669)`, color: '#fff', border: 'none', borderRadius: 12, padding: '15px', fontSize: 15, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', opacity: loading || otp.join('').length < OTP_LEN ? 0.6 : 1 }}>
              {loading ? 'Signing in…' : 'Sign In →'}
            </button>

            <button onClick={() => { setStep('email'); setOtp(Array(OTP_LEN).fill('')); setError(''); }}
              style={{ background: 'none', border: 'none', color: '#64748b', fontSize: 12, cursor: 'pointer', width: '100%', marginTop: 12, fontFamily: 'inherit' }}>
              ← Back
            </button>
          </div>
        )}

        <p style={{ textAlign: 'center', marginTop: 20, fontSize: 12, color: '#334155' }}>
          By continuing you agree to{' '}
          <Link href="/brand" style={{ color: G, textDecoration: 'none' }}>Terms & Privacy</Link>
        </p>
      </div>
    </div>
  );
}
