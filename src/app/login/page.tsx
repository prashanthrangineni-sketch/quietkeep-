'use client';
// OTP EMAIL LOGIN — replaces magic link entirely
// Flow: user enters email → Supabase sends 6-digit code → user types code → logged in
// Works 100% on Android + iPhone: no browser switching, no link opening, no PKCE issues
// Uses signInWithOtp (email, options.shouldCreateUser) + verifyOtp (type: 'email')

import { useState, useRef, useEffect } from 'react';
import { createBrowserClient } from '@supabase/ssr';

function getSupabase() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [step, setStep] = useState<'email' | 'otp'>('email');
  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [resendCountdown, setResendCountdown] = useState(0);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Countdown timer for resend
  useEffect(() => {
    if (resendCountdown <= 0) return;
    const t = setTimeout(() => setResendCountdown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [resendCountdown]);

  async function sendOtp() {
    if (!email.trim()) return;
    setLoading(true);
    setError('');
    const supabase = getSupabase();
    const { error: err } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { shouldCreateUser: true },
    });
    setLoading(false);
    if (err) {
      setError(err.message);
      return;
    }
    setStep('otp');
    setResendCountdown(30);
    setTimeout(() => inputRefs.current[0]?.focus(), 100);
  }

  async function verifyOtp() {
    const code = otp.join('');
    if (code.length !== 6) return;
    setLoading(true);
    setError('');
    const supabase = getSupabase();
    const { error: err } = await supabase.auth.verifyOtp({
      email: email.trim(),
      token: code,
      type: 'email',
    });
    setLoading(false);
    if (err) {
      setError('Invalid code. Please try again.');
      setOtp(['', '', '', '', '', '']);
      setTimeout(() => inputRefs.current[0]?.focus(), 100);
      return;
    }
    window.location.href = '/dashboard';
  }

  function handleOtpInput(index: number, value: string) {
    // Allow paste of full 6-digit code
    if (value.length === 6 && /^\d{6}$/.test(value)) {
      const digits = value.split('');
      setOtp(digits);
      setTimeout(() => verifyOtp(), 50);
      return;
    }
    const digit = value.replace(/\D/g, '').slice(-1);
    const next = [...otp];
    next[index] = digit;
    setOtp(next);
    if (digit && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
    // Auto-submit when all 6 filled
    if (digit && next.every(d => d !== '')) {
      setTimeout(() => {
        const code = next.join('');
        if (code.length === 6) {
          setLoading(true);
          setError('');
          const supabase = getSupabase();
          supabase.auth.verifyOtp({ email: email.trim(), token: code, type: 'email' })
            .then(({ error: err }) => {
              setLoading(false);
              if (err) {
                setError('Invalid code. Please try again.');
                setOtp(['', '', '', '', '', '']);
                setTimeout(() => inputRefs.current[0]?.focus(), 100);
              } else {
                window.location.href = '/dashboard';
              }
            });
        }
      }, 50);
    }
  }

  function handleOtpKeyDown(index: number, e: React.KeyboardEvent) {
    if (e.key === 'Backspace' && !otp[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  }

  const cardStyle = {
    minHeight: '100vh',
    background: '#0a0a0f',
    color: '#fff',
    fontFamily: 'system-ui,sans-serif',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '16px',
  };

  const innerStyle = {
    width: '100%',
    maxWidth: '360px',
    background: '#12121a',
    borderRadius: '20px',
    padding: '32px 24px',
  };

  const btnActive = {
    width: '100%', padding: '14px',
    background: 'linear-gradient(90deg,#6366f1,#818cf8)',
    border: 'none', color: '#fff',
    borderRadius: '10px', fontSize: '15px', fontWeight: 700,
    cursor: 'pointer', marginTop: '12px',
  } as const;

  const btnDisabled = {
    ...btnActive,
    background: '#2a2a3a', color: '#666', cursor: 'not-allowed',
  };

  // ── STEP 1: Email entry ──
  if (step === 'email') return (
    <div style={cardStyle}>
      <div style={innerStyle}>
        <div style={{ fontSize: '28px', fontWeight: 800, background: 'linear-gradient(90deg,#818cf8,#c4b5fd)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', marginBottom: '4px' }}>
          QuietKeep
        </div>
        <div style={{ fontSize: '13px', color: '#666', marginBottom: '28px' }}>
          Sign in with a one-time code sent to your email.
        </div>

        {error && (
          <div style={{ background: '#2a1a1a', border: '1px solid #5a2020', borderRadius: '8px', padding: '10px 12px', fontSize: '12px', color: '#ff8080', marginBottom: '12px' }}>
            ⚠️ {error}
          </div>
        )}

        <label style={{ fontSize: '12px', color: '#888', fontWeight: 600, marginBottom: '6px', display: 'block' }}>
          Email address
        </label>
        <input
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && !loading && email.trim() && sendOtp()}
          placeholder="you@example.com"
          autoFocus
          style={{ width: '100%', background: '#1e1e2e', border: '1px solid #333', color: '#fff', padding: '13px', borderRadius: '10px', fontSize: '15px', boxSizing: 'border-box', outline: 'none' }}
        />
        <button
          onClick={sendOtp}
          disabled={loading || !email.trim()}
          style={email.trim() && !loading ? btnActive : btnDisabled}>
          {loading ? 'Sending code…' : 'Send Code →'}
        </button>
      </div>
    </div>
  );

  // ── STEP 2: OTP entry ──
  return (
    <div style={cardStyle}>
      <div style={innerStyle}>
        <div style={{ fontSize: '36px', textAlign: 'center', marginBottom: '12px' }}>📨</div>
        <div style={{ fontSize: '18px', fontWeight: 700, textAlign: 'center', marginBottom: '6px' }}>
          Check your email
        </div>
        <div style={{ fontSize: '13px', color: '#888', textAlign: 'center', marginBottom: '24px', lineHeight: 1.6 }}>
          We sent a 6-digit code to<br />
          <strong style={{ color: '#c4b5fd' }}>{email}</strong>
        </div>

        {error && (
          <div style={{ background: '#2a1a1a', border: '1px solid #5a2020', borderRadius: '8px', padding: '10px 12px', fontSize: '12px', color: '#ff8080', marginBottom: '12px', textAlign: 'center' }}>
            ⚠️ {error}
          </div>
        )}

        {/* 6-digit OTP boxes */}
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', marginBottom: '20px' }}>
          {otp.map((digit, i) => (
            <input
              key={i}
              ref={el => { inputRefs.current[i] = el; }}
              type="text"
              inputMode="numeric"
              maxLength={6}
              value={digit}
              onChange={e => handleOtpInput(i, e.target.value)}
              onKeyDown={e => handleOtpKeyDown(i, e)}
              style={{
                width: '42px', height: '52px',
                background: digit ? '#1e1e3e' : '#1e1e2e',
                border: digit ? '2px solid #6366f1' : '1px solid #333',
                borderRadius: '10px',
                color: '#fff', fontSize: '22px', fontWeight: 700,
                textAlign: 'center',
                outline: 'none',
                transition: 'border 0.15s',
              }}
            />
          ))}
        </div>

        <button
          onClick={verifyOtp}
          disabled={loading || otp.join('').length < 6}
          style={otp.join('').length === 6 && !loading ? btnActive : btnDisabled}>
          {loading ? 'Verifying…' : 'Verify & Sign In'}
        </button>

        {/* Resend */}
        <div style={{ textAlign: 'center', marginTop: '16px', fontSize: '13px', color: '#555' }}>
          {resendCountdown > 0 ? (
            <span>Resend code in {resendCountdown}s</span>
          ) : (
            <button
              onClick={() => { setError(''); setOtp(['','','','','','']); sendOtp(); }}
              style={{ background: 'none', border: 'none', color: '#818cf8', cursor: 'pointer', fontSize: '13px', textDecoration: 'underline' }}>
              Resend code
            </button>
          )}
        </div>

        {/* Back */}
        <div style={{ textAlign: 'center', marginTop: '10px' }}>
          <button
            onClick={() => { setStep('email'); setOtp(['','','','','','']); setError(''); }}
            style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: '12px' }}>
            ← Use different email
          </button>
        </div>
      </div>
    </div>
  );
}
