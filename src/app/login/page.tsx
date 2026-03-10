'use client';
import { useState, useRef, useEffect } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';

function getSupabase() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

// Beta/admin emails that bypass all restrictions
const BETA_EMAILS = ['beta@quietkeep.com', 'pranixailabs@gmail.com'];
const BETA_CODE = '00000000';
const OTP_LEN = 8;

export default function LoginPage() {
  const [email, setEmail]     = useState('');
  const [step, setStep]       = useState<'email' | 'otp' | 'waitlist'>('email');
  const [otp, setOtp]         = useState(Array(OTP_LEN).fill(''));
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const [countdown, setCountdown] = useState(0);
  const [isBeta, setIsBeta]   = useState(false);
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    if (countdown <= 0) return;
    const t = setTimeout(() => setCountdown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [countdown]);

  async function sendOtp() {
    if (!email.trim()) return;
    const emailLower = email.trim().toLowerCase();
    const betaUser = BETA_EMAILS.includes(emailLower);
    setIsBeta(betaUser);

    if (betaUser) {
      // Beta bypass — no OTP email sent
      setStep('otp');
      setCountdown(0);
      setTimeout(() => refs.current[0]?.focus(), 120);
      return;
    }

    // Real users — send actual OTP but land on waitlist after verify
    setLoading(true);
    setError('');
    const { error: err } = await getSupabase().auth.signInWithOtp({
      email: email.trim(),
      options: { shouldCreateUser: true },
    });
    setLoading(false);
    if (err) { setError(err.message); return; }
    setStep('otp');
    setCountdown(30);
    setTimeout(() => refs.current[0]?.focus(), 120);
  }

  async function verifyOtp(digits: string[]) {
    const code = digits.join('');
    if (code.length !== OTP_LEN) return;
    setLoading(true);
    setError('');

    if (isBeta) {
      // Beta: accept only 00000000
      if (code !== BETA_CODE) {
        setLoading(false);
        setError('Incorrect beta code.');
        setOtp(Array(OTP_LEN).fill(''));
        setTimeout(() => refs.current[0]?.focus(), 100);
        return;
      }
      // Sign in beta user with password via plain client (no PKCE)
      const sb = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      );
      const pwMap: Record<string, string> = {
        'beta@quietkeep.com': 'BetaQK@2026',
        'pranixailabs@gmail.com': 'PranixQK@2026',
      };
      const { error: signErr } = await sb.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password: pwMap[email.trim().toLowerCase()],
      });
      setLoading(false);
      if (signErr) { setError('Beta sign-in failed: ' + signErr.message); return; }
      window.location.href = '/dashboard';
      return;
    }

    // Real user — verify OTP normally
    const { data, error: err } = await getSupabase().auth.verifyOtp({
      email: email.trim(),
      token: code,
      type: 'email',
    });
    setLoading(false);
    if (err) {
      setError('Incorrect code. Please try again.');
      setOtp(Array(OTP_LEN).fill(''));
      setTimeout(() => refs.current[0]?.focus(), 100);
      return;
    }
    // Real user verified — redirect to waitlist (not dashboard)
    window.location.href = '/waitlist';
  }

  function handleDigit(i: number, val: string) {
    if (val.length === OTP_LEN && new RegExp(`^\\d{${OTP_LEN}}$`).test(val)) {
      const d = val.split('');
      setOtp(d);
      verifyOtp(d);
      return;
    }
    const digit = val.replace(/\D/g, '').slice(-1);
    const next = [...otp];
    next[i] = digit;
    setOtp(next);
    if (digit && i < OTP_LEN - 1) refs.current[i + 1]?.focus();
    if (next.every(d => d !== '')) verifyOtp(next);
  }

  function handleKey(i: number, e: React.KeyboardEvent) {
    if (e.key === 'Backspace' && !otp[i] && i > 0) refs.current[i - 1]?.focus();
  }

  const pageStyle: React.CSSProperties = {
    minHeight: '100dvh',
    background: 'radial-gradient(ellipse at 50% 0%, rgba(99,102,241,0.12) 0%, #0b0f19 60%)',
    color: '#e2e8f0',
    fontFamily: "'Inter',-apple-system,sans-serif",
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: '16px',
  };

  const cardStyle: React.CSSProperties = {
    width: '100%', maxWidth: '420px',
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.08)',
    backdropFilter: 'blur(20px)',
    WebkitBackdropFilter: 'blur(20px)',
    borderRadius: '24px',
    padding: '36px 28px',
  };

  const btnActive: React.CSSProperties = {
    width: '100%', padding: '14px', marginTop: 12,
    background: 'linear-gradient(135deg, #6366f1, #818cf8)',
    border: 'none', color: '#fff', borderRadius: 12, fontSize: 15,
    fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
    boxShadow: '0 2px 16px rgba(99,102,241,0.4)', transition: 'all 0.18s',
  };
  const btnOff: React.CSSProperties = {
    ...btnActive, background: 'rgba(255,255,255,0.06)',
    color: '#475569', cursor: 'not-allowed', boxShadow: 'none',
  };

  const inputStyle: React.CSSProperties = {
    width: '100%', background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.1)',
    color: '#e2e8f0', padding: '13px 16px', borderRadius: 12,
    fontSize: 15, boxSizing: 'border-box', outline: 'none',
    fontFamily: 'inherit', transition: 'border-color 0.18s, box-shadow 0.18s',
  };

  // ── Email step ──────────────────────────────────────────────
  if (step === 'email') return (
    <div style={pageStyle}>
      <div style={cardStyle}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{
            fontSize: 32, fontWeight: 800, letterSpacing: '-0.03em',
            background: 'linear-gradient(135deg, #818cf8, #c4b5fd, #6ee7b7)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
            backgroundClip: 'text', marginBottom: 8,
          }}>
            QuietKeep
          </div>
          <div style={{ fontSize: 14, color: '#64748b', lineHeight: 1.5 }}>
            Your personal intelligence OS
          </div>
        </div>

        {error && (
          <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 10, padding: '10px 14px', fontSize: 13, color: '#fca5a5', marginBottom: 16 }}>
            ⚠️ {error}
          </div>
        )}

        <label style={{ fontSize: 11, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 8 }}>
          Email address
        </label>
        <input
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && !loading && email.trim() && sendOtp()}
          placeholder="you@example.com"
          autoFocus
          style={inputStyle}
          onFocus={e => { e.target.style.borderColor = '#6366f1'; e.target.style.boxShadow = '0 0 0 3px rgba(99,102,241,0.2)'; }}
          onBlur={e => { e.target.style.borderColor = 'rgba(255,255,255,0.1)'; e.target.style.boxShadow = 'none'; }}
        />

        <button onClick={sendOtp} disabled={loading || !email.trim()} style={email.trim() && !loading ? btnActive : btnOff}>
          {loading ? 'Sending…' : 'Continue →'}
        </button>

        <div style={{ textAlign: 'center', marginTop: 24, fontSize: 12, color: '#334155' }}>
          🔒 Sign in with a one-time code — no password needed
        </div>
      </div>
    </div>
  );

  // ── OTP step ────────────────────────────────────────────────
  const filled = otp.join('').length;

  return (
    <div style={pageStyle}>
      <div style={{ ...cardStyle, textAlign: 'center' }}>
        <div style={{ fontSize: 44, marginBottom: 12 }}>{isBeta ? '🔑' : '📨'}</div>
        <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 6, color: '#e2e8f0' }}>
          {isBeta ? 'Beta Access' : 'Enter your code'}
        </div>
        <div style={{ fontSize: 13, color: '#64748b', marginBottom: 28, lineHeight: 1.6 }}>
          {isBeta
            ? <>Type <strong style={{ color: '#a5b4fc', letterSpacing: '0.1em' }}>00000000</strong> (eight zeros)</>
            : <>{OTP_LEN}-digit code sent to<br /><strong style={{ color: '#a5b4fc' }}>{email}</strong></>
          }
        </div>

        {error && (
          <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 10, padding: '10px 14px', fontSize: 13, color: '#fca5a5', marginBottom: 20 }}>
            ⚠️ {error}
          </div>
        )}

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center', marginBottom: 24 }}>
          {otp.map((d, i) => (
            <input
              key={i}
              ref={el => { refs.current[i] = el; }}
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={OTP_LEN}
              value={d}
              onChange={e => handleDigit(i, e.target.value)}
              onKeyDown={e => handleKey(i, e)}
              style={{
                width: 46, height: 56, textAlign: 'center',
                background: d ? 'rgba(99,102,241,0.12)' : 'rgba(255,255,255,0.04)',
                border: d ? '2px solid rgba(99,102,241,0.6)' : '1px solid rgba(255,255,255,0.1)',
                borderRadius: 12, color: '#e2e8f0', fontSize: 22, fontWeight: 700,
                outline: 'none', fontFamily: 'inherit', transition: 'all 0.15s',
                boxShadow: d ? '0 0 0 3px rgba(99,102,241,0.15)' : 'none',
              }}
            />
          ))}
        </div>

        <button onClick={() => verifyOtp(otp)} disabled={loading || filled < OTP_LEN} style={filled === OTP_LEN && !loading ? btnActive : btnOff}>
          {loading ? 'Verifying…' : 'Verify & Sign In'}
        </button>

        {!isBeta && (
          <div style={{ marginTop: 18, fontSize: 13, color: '#475569' }}>
            {countdown > 0
              ? <span>Resend in {countdown}s</span>
              : <button onClick={() => { setError(''); setOtp(Array(OTP_LEN).fill('')); sendOtp(); }} style={{ background: 'none', border: 'none', color: '#818cf8', cursor: 'pointer', fontSize: 13, fontFamily: 'inherit', textDecoration: 'underline' }}>
                  Resend code
                </button>
            }
          </div>
        )}

        <div style={{ marginTop: 8 }}>
          <button onClick={() => { setStep('email'); setOtp(Array(OTP_LEN).fill('')); setError(''); setIsBeta(false); }} style={{ background: 'none', border: 'none', color: '#334155', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit' }}>
            ← Use different email
          </button>
        </div>
      </div>
    </div>
  );
}
