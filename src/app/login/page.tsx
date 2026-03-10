'use client';
import { useState, useRef, useEffect } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';

// ── OTP client (PKCE mode) — for real user email OTP ──────────────────────────
function getSupabase() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

// ── Password client (implicit/no PKCE) — required for signInWithPassword ──────
// @supabase/ssr uses PKCE which breaks signInWithPassword. Use raw client.
function getPwdClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { flowType: 'implicit', persistSession: true, autoRefreshToken: true } }
  );
}

const OTP_LEN = 8;

// ── BETA / TEST ACCOUNTS ────────────────────────────────────────────────────────
// These skip OTP entirely — zero emails sent, zero rate limits triggered.
// Flow: enter email → Send Code → type 00000000 (eight zeros) → instant sign-in.
// Both accounts have Family plan (full access) valid until April 9 2026.
//
// To add more testers:
//   1. Create user in Supabase Auth dashboard → set a password
//   2. Seed a row in public.subscriptions with plan_id='family', is_active=true
//   3. Set onboarding_done=true in public.profiles
//   4. Add entry below: 'email@domain.com': 'ThePassword'
const BETA: Record<string, string> = {
  'beta@quietkeep.com':     'BetaQK@2026',
  'pranixailabs@gmail.com': 'PranixQK@2026',
};
// ────────────────────────────────────────────────────────────────────────────────

export default function LoginPage() {
  const [email, setEmail]       = useState('');
  const [step, setStep]         = useState<'email' | 'otp'>('email');
  const [otp, setOtp]           = useState(Array(OTP_LEN).fill(''));
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');
  const [countdown, setCd]      = useState(0);
  const [isBeta, setIsBeta]     = useState(false);
  const [attempt, setAttempt]   = useState(0); // track failed OTP attempts for real users
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    if (countdown <= 0) return;
    const t = setTimeout(() => setCd(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [countdown]);

  // Normalise email for consistent lookup
  const norm = (e: string) => e.trim().toLowerCase();

  async function sendOtp() {
    const em = norm(email);
    if (!em) return;
    setLoading(true);
    setError('');

    // Beta bypass — skip OTP send entirely
    if (BETA[em]) {
      setIsBeta(true);
      setLoading(false);
      setStep('otp');
      setTimeout(() => refs.current[0]?.focus(), 120);
      return;
    }

    setIsBeta(false);
    try {
      const { error: err } = await getSupabase().auth.signInWithOtp({
        email: em,
        options: { shouldCreateUser: true },
      });
      if (err) {
        // Translate Supabase error codes into user-friendly messages
        const msg = err.message || '';
        if (msg.includes('rate') || msg.includes('429') || msg.includes('too many')) {
          setError('Too many sign-in attempts. Please wait a few minutes and try again.');
        } else if (msg.includes('invalid email') || msg.includes('email address')) {
          setError('Please enter a valid email address.');
        } else if (msg.includes('network') || msg.includes('fetch')) {
          setError('Network error. Please check your connection and try again.');
        } else {
          setError('Could not send code. Please try again.');
        }
        setLoading(false);
        return;
      }
      setStep('otp');
      setCd(60); // 60-second resend cooldown
      setTimeout(() => refs.current[0]?.focus(), 120);
    } catch {
      setError('Network error. Please check your connection.');
    }
    setLoading(false);
  }

  async function verifyOtp(digits: string[]) {
    const code = digits.join('');
    if (code.length !== OTP_LEN) return;
    setLoading(true);
    setError('');
    const em = norm(email);

    // ── Beta bypass: eight zeros → password sign-in ──────────────────────────
    if (BETA[em] && code === '00000000') {
      try {
        const { data, error: err } = await getPwdClient().auth.signInWithPassword({
          email: em,
          password: BETA[em],
        });
        if (err) throw err;
        // Propagate session to SSR cookie store so middleware can read it
        if (data?.session) {
          await getSupabase().auth.setSession({
            access_token:  data.session.access_token,
            refresh_token: data.session.refresh_token,
          });
        }
        setLoading(false);
        window.location.href = '/dashboard';
        return;
      } catch (e: any) {
        setLoading(false);
        setError('Beta login failed: ' + (e?.message || 'Unknown error'));
        setOtp(Array(OTP_LEN).fill(''));
        setTimeout(() => refs.current[0]?.focus(), 100);
        return;
      }
    }
    // ────────────────────────────────────────────────────────────────────────────

    // Real user OTP verify
    try {
      const { error: err } = await getSupabase().auth.verifyOtp({
        email: em,
        token: code,
        type: 'email',
      });
      setLoading(false);
      if (err) {
        const next = attempt + 1;
        setAttempt(next);
        if (next >= 3) {
          setError('Too many incorrect attempts. Please request a new code.');
          setOtp(Array(OTP_LEN).fill(''));
          setStep('email');
          setAttempt(0);
        } else {
          setError(`Incorrect code — ${3 - next} attempt${3 - next === 1 ? '' : 's'} remaining.`);
          setOtp(Array(OTP_LEN).fill(''));
          setTimeout(() => refs.current[0]?.focus(), 100);
        }
        return;
      }
      window.location.href = '/dashboard';
    } catch {
      setLoading(false);
      setError('Verification failed. Please check your connection.');
      setOtp(Array(OTP_LEN).fill(''));
      setTimeout(() => refs.current[0]?.focus(), 100);
    }
  }

  function handleDigit(i: number, val: string) {
    // Full-code paste (e.g., autofill from SMS)
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

  // ── Styles ──────────────────────────────────────────────────────────────────
  const wrap: React.CSSProperties = {
    minHeight: '100dvh', background: '#0a0a0f', color: '#fff',
    fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif',
    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px',
  };
  const card: React.CSSProperties = {
    width: '100%', maxWidth: '400px', background: '#12121a',
    borderRadius: '20px', padding: '32px 24px',
    boxShadow: '0 0 0 1px rgba(255,255,255,0.06), 0 24px 48px rgba(0,0,0,0.5)',
  };
  const btnPrimary: React.CSSProperties = {
    width: '100%', padding: '15px', marginTop: '14px',
    background: 'linear-gradient(90deg,#6366f1,#818cf8)',
    border: 'none', color: '#fff', borderRadius: '12px',
    fontSize: '15px', fontWeight: 700, cursor: 'pointer',
    WebkitTapHighlightColor: 'transparent',
    transition: 'opacity 0.15s',
  };
  const btnDisabled: React.CSSProperties = {
    ...btnPrimary, background: '#1e1e2e', color: '#334155', cursor: 'not-allowed',
  };
  const errStyle: React.CSSProperties = {
    background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)',
    borderRadius: '10px', padding: '10px 14px', fontSize: '13px',
    color: '#fca5a5', marginBottom: '14px', lineHeight: 1.5,
  };

  // ── Email step ──────────────────────────────────────────────────────────────
  if (step === 'email') return (
    <div style={wrap}>
      <div style={card}>
        {/* Logo */}
        <div style={{ marginBottom: '28px' }}>
          <div style={{
            fontSize: '26px', fontWeight: 800, letterSpacing: '-0.5px',
            background: 'linear-gradient(90deg,#818cf8,#c4b5fd)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
            marginBottom: '4px',
          }}>
            QuietKeep
          </div>
          <div style={{ fontSize: '13px', color: '#475569' }}>
            Your personal AI organiser. Sign in below.
          </div>
        </div>

        {error && <div style={errStyle}>⚠️ {error}</div>}

        <label style={{ fontSize: '12px', color: '#64748b', fontWeight: 600, marginBottom: '6px', display: 'block', letterSpacing: '0.04em' }}>
          EMAIL ADDRESS
        </label>
        <input
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && !loading && email.trim() && sendOtp()}
          placeholder="you@example.com"
          autoFocus
          autoComplete="email"
          inputMode="email"
          style={{
            width: '100%', background: '#1a1a2e', border: '1px solid #2a2a4a',
            color: '#f1f5f9', padding: '14px', borderRadius: '12px',
            fontSize: '16px', boxSizing: 'border-box', outline: 'none',
            WebkitAppearance: 'none',
          }}
        />
        <button
          onClick={sendOtp}
          disabled={loading || !email.trim()}
          style={email.trim() && !loading ? btnPrimary : btnDisabled}
        >
          {loading ? 'Sending…' : 'Send Code →'}
        </button>

        <div style={{ marginTop: '20px', fontSize: '11px', color: '#1e293b', textAlign: 'center', lineHeight: 1.6 }}>
          By signing in you agree to our{' '}
          <a href="https://quietkeep.com/privacy" target="_blank" rel="noopener noreferrer" style={{ color: '#334155', textDecoration: 'underline' }}>Privacy Policy</a>
        </div>
      </div>
    </div>
  );

  // ── OTP / Beta code step ────────────────────────────────────────────────────
  const filled = otp.filter(d => d !== '').length;

  return (
    <div style={wrap}>
      <div style={{ ...card, textAlign: 'center' }}>
        <div style={{ fontSize: '40px', marginBottom: '12px' }}>
          {isBeta ? '🔑' : '📨'}
        </div>
        <div style={{ fontSize: '18px', fontWeight: 700, marginBottom: '6px' }}>
          {isBeta ? 'Beta Access' : 'Check your email'}
        </div>
        <div style={{ fontSize: '13px', color: '#475569', marginBottom: '24px', lineHeight: 1.7 }}>
          {isBeta ? (
            <>
              Beta account detected.<br />
              Type <strong style={{ color: '#c4b5fd', fontFamily: 'monospace', fontSize: '15px' }}>00000000</strong> (eight zeros)<br />
              to sign in instantly — no email needed.
            </>
          ) : (
            <>
              We sent an {OTP_LEN}-digit code to<br />
              <strong style={{ color: '#c4b5fd' }}>{email}</strong><br />
              <span style={{ fontSize: '12px', color: '#334155' }}>Check your spam folder if it doesn't arrive.</span>
            </>
          )}
        </div>

        {error && <div style={errStyle}>⚠️ {error}</div>}

        {/* OTP grid */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', justifyContent: 'center', marginBottom: '20px' }}>
          {otp.map((d, i) => (
            <input
              key={i}
              ref={el => { refs.current[i] = el; }}
              type="text"
              inputMode="numeric"
              autoComplete={i === 0 ? 'one-time-code' : 'off'}
              maxLength={OTP_LEN}
              value={d}
              onChange={e => handleDigit(i, e.target.value)}
              onKeyDown={e => handleKey(i, e)}
              style={{
                width: '44px', height: '54px', textAlign: 'center',
                background: d ? '#1e1e3e' : '#1a1a2e',
                border: d ? '2px solid #6366f1' : '1px solid #2a2a4a',
                borderRadius: '12px', color: '#fff',
                fontSize: '22px', fontWeight: 700, outline: 'none',
                WebkitAppearance: 'none',
              }}
            />
          ))}
        </div>

        <button
          onClick={() => verifyOtp(otp)}
          disabled={loading || filled < OTP_LEN}
          style={filled === OTP_LEN && !loading ? btnPrimary : btnDisabled}
        >
          {loading ? 'Verifying…' : 'Verify & Sign In'}
        </button>

        {!isBeta && (
          <div style={{ marginTop: '16px', fontSize: '13px', color: '#334155' }}>
            {countdown > 0
              ? <span>Resend available in {countdown}s</span>
              : (
                <button
                  onClick={() => { setError(''); setOtp(Array(OTP_LEN).fill('')); setAttempt(0); sendOtp(); }}
                  style={{ background: 'none', border: 'none', color: '#818cf8', cursor: 'pointer', fontSize: '13px', textDecoration: 'underline', WebkitTapHighlightColor: 'transparent' }}
                >
                  Resend code
                </button>
              )
            }
          </div>
        )}

        <div style={{ marginTop: '10px' }}>
          <button
            onClick={() => { setStep('email'); setOtp(Array(OTP_LEN).fill('')); setError(''); setIsBeta(false); setAttempt(0); }}
            style={{ background: 'none', border: 'none', color: '#334155', cursor: 'pointer', fontSize: '12px', WebkitTapHighlightColor: 'transparent' }}
          >
            ← Use different email
          </button>
        </div>
      </div>
    </div>
  );
                   }
