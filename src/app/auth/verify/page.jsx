'use client';
// src/app/auth/verify/page.jsx
// COMPLETE OTP verification page.
//
// ROOT CAUSE FIXES:
// A. OTP_LEN was 6 — Supabase is configured to send 8-digit OTPs.
//    This caused EVERY verification attempt to fail with "token not found".
//    Fixed: OTP_LEN = 8.
//
// B. No resend functionality — users were stuck if code expired.
//    Fixed: 60-second resend cooldown with countdown timer.
//
// C. No expiry information — users didn't know codes expire in 1 hour.
//    Fixed: clear expiry messaging added.
//
// D. No auto-submit — required extra tap after last digit.
//    Fixed: auto-submits when all 8 digits are filled.
//
// E. Paste support — entering 8 digits manually is error-prone.
//    Fixed: pasting an 8-digit string fills all boxes and auto-submits.
//
// SUPABASE OTP NOTE:
// Supabase sends OTPs via its configured email provider (Resend or built-in).
// The OTP length is set in Supabase Dashboard → Authentication → Email Templates.
// This app's Supabase project is configured for 8-digit OTPs.
// To change back to 6: set OTP_LEN = 6 AND change the Supabase config.

import { useState, useEffect, useRef, Suspense } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import { useRouter, useSearchParams } from 'next/navigation';

// FIX: Do NOT use NEXT_PUBLIC_APP_TYPE to determine post-auth destination.
// On the web (Vercel), this env var is always 'personal' regardless of which login
// page the user came from. Instead, read 'next' from the URL query param:
//   /biz-login sends: /auth/verify?email=...&next=/b/dashboard
//   /login sends:     /auth/verify?email=...  (no next param → default /dashboard)
// POST_AUTH and LOGIN_PATH are resolved inside VerifyContent() from searchParams.
const OTP_LEN    = 8; // MUST match Supabase Auth settings → Email OTP length
const RESEND_COOLDOWN = 60; // seconds

function getClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

function VerifyContent() {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const email        = searchParams.get('email') || '';
  const tokenHash    = searchParams.get('token_hash');
  const type         = searchParams.get('type') || 'email';
  // FIX: Resolve destination from 'next' URL param (set by biz-login or login page).
  // This correctly routes business users to /b/dashboard even on the shared Vercel build
  // where NEXT_PUBLIC_APP_TYPE is always 'personal'.
  const nextParam  = searchParams.get('next') || '';
  const POST_AUTH  = nextParam && nextParam.startsWith('/') ? nextParam : '/dashboard';
  const LOGIN_PATH = POST_AUTH.startsWith('/b/') ? '/biz-login' : '/login';

  const [digits, setDigits]     = useState(Array(OTP_LEN).fill(''));
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');
  const [status, setStatus]     = useState(''); // 'verifying' | 'success'
  const [resendTimer, setResendTimer] = useState(0);
  const [resendMsg, setResendMsg] = useState('');
  const refs = useRef([]);
  const timerRef = useRef(null);

  // Set qk_app_mode cookie client-side so middleware enforces correct routing isolation
  function setAppModeCookie(destination) {
    const mode = destination.startsWith('/b/') ? 'business' : 'personal';
    document.cookie = `qk_app_mode=${mode}; path=/; max-age=86400; SameSite=Lax`;
  }

  // Auto-verify if token_hash present in URL (magic link fallback)
  useEffect(() => {
    if (tokenHash && type) {
      setStatus('verifying');
      getClient().auth.verifyOtp({ token_hash: tokenHash, type })
        .then(({ error: err }) => {
          if (err) {
            setStatus('');
            setError('Link expired or already used. Enter your OTP code below.');
          } else {
            setAppModeCookie(POST_AUTH);
            router.replace(POST_AUTH);
          }
        });
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []); // eslint-disable-line

  function startResendTimer() {
    setResendTimer(RESEND_COOLDOWN);
    timerRef.current = setInterval(() => {
      setResendTimer(t => {
        if (t <= 1) { clearInterval(timerRef.current); return 0; }
        return t - 1;
      });
    }, 1000);
  }

  async function resendOtp() {
    if (!email || resendTimer > 0) return;
    setResendMsg('');
    setError('');
    const { error: err } = await getClient().auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false },
    });
    if (err) {
      setResendMsg('Could not resend — ' + (err.message || 'try again'));
    } else {
      setResendMsg('New code sent! Check your inbox.');
      startResendTimer();
    }
  }

  async function verify(digitArray) {
    const arr  = digitArray || digits;
    const code = arr.join('');
    if (code.length !== OTP_LEN) return;
    if (!email) {
      setError('Email missing. Go back and log in again.');
      return;
    }
    setLoading(true);
    setError('');

    const { error: err } = await getClient().auth.verifyOtp({
      email,
      token: code,
      type: 'email',
    });

    setLoading(false);

    if (err) {
      const msg = err.message || '';
      if (msg.includes('expired') || msg.includes('invalid'))
        setError('Code is incorrect or expired. Request a new one below.');
      else if (msg.includes('Token has expired or is invalid'))
        setError('Code expired. Use the Resend button to get a new one.');
      else
        setError(msg || 'Verification failed. Please try again.');
      setDigits(Array(OTP_LEN).fill(''));
      setTimeout(() => refs.current[0]?.focus(), 80);
      return;
    }
    setAppModeCookie(POST_AUTH);
    router.replace(POST_AUTH);
  }

  function handleChange(i, val) {
    // Paste: fill all boxes
    if (val.length > 1) {
      const clean = val.replace(/\D/g, '').slice(0, OTP_LEN);
      const next  = [...Array(OTP_LEN).fill('')];
      for (let j = 0; j < clean.length; j++) next[j] = clean[j];
      setDigits(next);
      const focusIdx = Math.min(clean.length, OTP_LEN - 1);
      setTimeout(() => refs.current[focusIdx]?.focus(), 40);
      if (clean.length === OTP_LEN) setTimeout(() => verify(next), 100);
      return;
    }
    const digit = val.replace(/\D/g, '').slice(-1);
    const next  = [...digits]; next[i] = digit; setDigits(next);
    if (digit && i < OTP_LEN - 1) refs.current[i + 1]?.focus();
    if (digit && i === OTP_LEN - 1 && next.every(d => d)) setTimeout(() => verify(next), 80);
  }

  function handleKey(i, e) {
    if (e.key === 'Backspace' && !digits[i] && i > 0) refs.current[i - 1]?.focus();
    if (e.key === 'Enter') verify();
    if (e.key === 'ArrowLeft'  && i > 0)           refs.current[i - 1]?.focus();
    if (e.key === 'ArrowRight' && i < OTP_LEN - 1) refs.current[i + 1]?.focus();
  }

  const wrap = {
    minHeight: '100dvh', background: 'var(--bg)', color: 'var(--text)',
    fontFamily: "'Inter', system-ui, sans-serif",
    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
  };
  const card = {
    width: '100%', maxWidth: 420,
    background: 'var(--surface)', border: '1px solid var(--border)',
    borderRadius: 20, padding: '32px 24px', textAlign: 'center',
    boxShadow: 'var(--shadow)',
  };

  if (status === 'verifying') return (
    <div style={wrap}>
      <div style={card}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>🔐</div>
        <div style={{ fontSize: 16, color: 'var(--text-muted)', lineHeight: 1.6 }}>
          Verifying your link…
        </div>
      </div>
    </div>
  );

  return (
    <div style={wrap}>
      <div style={card}>
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 24, justifyContent: 'center' }}>
          <div style={{ width: 36, height: 36, borderRadius: 9, background: 'linear-gradient(135deg,#5b5ef4,#8b5cf6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ fontSize: 14, fontWeight: 900, color: '#fff' }}>QK</span>
          </div>
          <span style={{ fontSize: 18, fontWeight: 800, color: 'var(--text)', letterSpacing: '-0.5px' }}>QuietKeep</span>
        </div>

        <div style={{ fontSize: 36, marginBottom: 12 }}>📬</div>
        <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--text)', marginBottom: 8 }}>
          Enter your 8-digit code
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.7, marginBottom: 4 }}>
          We sent an 8-digit code to
        </div>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--primary)', marginBottom: 20 }}>
          {email || 'your email'}
        </div>

        {/* Expiry reminder */}
        <div style={{
          background: 'var(--primary-dim)', border: '1px solid var(--primary-glow)',
          borderRadius: 8, padding: '8px 12px', fontSize: 11, color: 'var(--text-muted)',
          marginBottom: 20, lineHeight: 1.6,
        }}>
          ⏱ Code valid for 60 minutes · Check spam if not in inbox
        </div>

        {error && (
          <div style={{
            background: 'var(--red-dim)', border: '1px solid rgba(220,38,38,0.2)',
            borderRadius: 8, padding: '10px 12px', fontSize: 12, color: 'var(--red)',
            marginBottom: 16, textAlign: 'left',
          }}>
            ⚠️ {error}
          </div>
        )}

        {/* 8 OTP boxes — arranged 4+4 for readability */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', gap: 6, justifyContent: 'center', marginBottom: 8 }}>
            {digits.slice(0, 4).map((d, i) => (
              <input
                key={i}
                ref={el => { refs.current[i] = el; }}
                type="text"
                inputMode="numeric"
                pattern="[0-9]"
                maxLength={OTP_LEN}
                value={d}
                autoFocus={i === 0}
                onChange={e => handleChange(i, e.target.value)}
                onKeyDown={e => handleKey(i, e)}
                onFocus={e => e.target.select()}
                style={{
                  width: 48, height: 58, textAlign: 'center',
                  background: d ? 'var(--primary-dim)' : 'var(--surface-hover)',
                  border: `2px solid ${d ? 'var(--primary)' : 'var(--border)'}`,
                  borderRadius: 12, color: 'var(--text)', fontSize: 22, fontWeight: 700,
                  outline: 'none', fontFamily: 'inherit', caretColor: 'transparent',
                  transition: 'border-color 0.15s',
                }}
              />
            ))}
          </div>
          <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
            {digits.slice(4, 8).map((d, i) => {
              const idx = i + 4;
              return (
                <input
                  key={idx}
                  ref={el => { refs.current[idx] = el; }}
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]"
                  maxLength={OTP_LEN}
                  value={d}
                  onChange={e => handleChange(idx, e.target.value)}
                  onKeyDown={e => handleKey(idx, e)}
                  onFocus={e => e.target.select()}
                  style={{
                    width: 48, height: 58, textAlign: 'center',
                    background: d ? 'var(--primary-dim)' : 'var(--surface-hover)',
                    border: `2px solid ${d ? 'var(--primary)' : 'var(--border)'}`,
                    borderRadius: 12, color: 'var(--text)', fontSize: 22, fontWeight: 700,
                    outline: 'none', fontFamily: 'inherit', caretColor: 'transparent',
                    transition: 'border-color 0.15s',
                  }}
                />
              );
            })}
          </div>
        </div>

        <button
          onClick={() => verify(undefined)}
          disabled={loading || digits.some(d => !d)}
          style={{
            width: '100%', padding: 14, marginBottom: 14,
            background: loading || digits.some(d => !d)
              ? 'var(--surface-hover)'
              : 'linear-gradient(135deg,#5b5ef4,#818cf8)',
            border: 'none',
            color: loading || digits.some(d => !d) ? 'var(--text-subtle)' : '#fff',
            borderRadius: 12, fontSize: 15, fontWeight: 700,
            cursor: loading || digits.some(d => !d) ? 'not-allowed' : 'pointer',
            fontFamily: 'inherit',
            boxShadow: loading || digits.some(d => !d) ? 'none' : '0 4px 20px rgba(91,94,244,0.3)',
          }}
        >
          {loading ? 'Verifying…' : 'Verify & Sign In →'}
        </button>

        {/* Resend section */}
        <div style={{ marginBottom: 16 }}>
          {resendMsg && (
            <div style={{ fontSize: 12, color: '#22c55e', marginBottom: 8 }}>{resendMsg}</div>
          )}
          {email && (
            <button
              onClick={resendOtp}
              disabled={resendTimer > 0}
              style={{
                background: 'none', border: 'none',
                color: resendTimer > 0 ? 'var(--text-subtle)' : 'var(--primary)',
                cursor: resendTimer > 0 ? 'default' : 'pointer',
                fontSize: 13, fontFamily: 'inherit', fontWeight: 600,
              }}
            >
              {resendTimer > 0
                ? `Resend in ${resendTimer}s`
                : '↩ Resend code'}
            </button>
          )}
        </div>

        <button
          onClick={() => router.replace(LOGIN_PATH)}
          style={{
            background: 'none', border: 'none', color: 'var(--text-subtle)',
            cursor: 'pointer', fontSize: 12, fontFamily: 'inherit', textDecoration: 'underline',
          }}
        >
          ← Back to login
        </button>
      </div>
    </div>
  );
}

export default function VerifyPage() {
  return (
    <Suspense fallback={
      <div style={{ minHeight: '100dvh', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ fontSize: 14, color: 'var(--text-muted)' }}>Loading…</div>
      </div>
    }>
      <VerifyContent />
    </Suspense>
  );
                }
