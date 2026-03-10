'use client';
import { useState, useRef, useEffect } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';

// OTP client — PKCE mode, for normal OTP login
function getSupabase() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

// Password client — plain JS client, NO PKCE, required for signInWithPassword
function getPasswordClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { flowType: 'implicit', persistSession: true, autoRefreshToken: true } }
  );
}

const OTP_LEN = 8;

// ─── BETA TEST BYPASS ────────────────────────────────────────────────────────
// These accounts skip OTP entirely and use password login.
// Bypass code: type 00000000 (eight zeros) in the OTP boxes.
// To add more testers: create user in Supabase Auth dashboard → set password → add entry here.
const BETA_ACCOUNTS: Record<string, string> = {
  'beta@quietkeep.com': 'BetaQK@2026',
};
// ─────────────────────────────────────────────────────────────────────────────

export default function LoginPage() {
  const [email, setEmail]         = useState('');
  const [step, setStep]           = useState<'email' | 'otp'>('email');
  const [otp, setOtp]             = useState(Array(OTP_LEN).fill(''));
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState('');
  const [countdown, setCountdown] = useState(0);
  const [isBeta, setIsBeta]       = useState(false);
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    if (countdown <= 0) return;
    const t = setTimeout(() => setCountdown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [countdown]);

  async function sendOtp() {
    if (!email.trim()) return;
    const norm = email.trim().toLowerCase();
    setLoading(true);
    setError('');

    if (BETA_ACCOUNTS[norm]) {
      setIsBeta(true);
      setLoading(false);
      setStep('otp');
      setTimeout(() => refs.current[0]?.focus(), 120);
      return;
    }

    setIsBeta(false);
    const { error: err } = await getSupabase().auth.signInWithOtp({
      email: norm,
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

    const norm = email.trim().toLowerCase();

    // ── Beta bypass: eight zeros → password login ─────────────────────────
    if (BETA_ACCOUNTS[norm] && code === '00000000') {
      try {
        // Use plain supabase-js client — bypasses PKCE which breaks signInWithPassword
        const { data, error: err } = await getPasswordClient().auth.signInWithPassword({
          email: norm,
          password: BETA_ACCOUNTS[norm],
        });
        if (err) throw err;

        // Sync session into SSR cookie store so middleware sees it
        if (data?.session) {
          await getSupabase().auth.setSession({
            access_token: data.session.access_token,
            refresh_token: data.session.refresh_token,
          });
        }

        setLoading(false);
        window.location.href = '/dashboard';
        return;
      } catch (e: any) {
        setLoading(false);
        setError('Beta login failed: ' + (e?.message || String(e)));
        setOtp(Array(OTP_LEN).fill(''));
        setTimeout(() => refs.current[0]?.focus(), 100);
        return;
      }
    }
    // ─────────────────────────────────────────────────────────────────────

    // Normal OTP verify
    const { error: err } = await getSupabase().auth.verifyOtp({
      email: norm,
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
    window.location.href = '/dashboard';
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

  const wrap: React.CSSProperties = {
    minHeight: '100vh', background: '#0a0a0f', color: '#fff',
    fontFamily: 'system-ui,sans-serif', display: 'flex',
    alignItems: 'center', justifyContent: 'center', padding: '16px',
  };
  const card: React.CSSProperties = {
    width: '100%', maxWidth: '400px', background: '#12121a',
    borderRadius: '20px', padding: '32px 24px',
  };
  const btnOn: React.CSSProperties = {
    width: '100%', padding: '14px', marginTop: '12px',
    background: 'linear-gradient(90deg,#6366f1,#818cf8)',
    border: 'none', color: '#fff', borderRadius: '10px',
    fontSize: '15px', fontWeight: 700, cursor: 'pointer',
  };
  const btnOff: React.CSSProperties = {
    ...btnOn, background: '#2a2a3a', color: '#666', cursor: 'not-allowed',
  };

  if (step === 'email') return (
    <div style={wrap}>
      <div style={card}>
        <div style={{ fontSize: '28px', fontWeight: 800, background: 'linear-gradient(90deg,#818cf8,#c4b5fd)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', marginBottom: '4px' }}>
          QuietKeep
        </div>
        <div style={{ fontSize: '13px', color: '#666', marginBottom: '28px' }}>
          Enter your email to receive a sign-in code.
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
        <button onClick={sendOtp} disabled={loading || !email.trim()} style={email.trim() && !loading ? btnOn : btnOff}>
          {loading ? 'Sending code…' : 'Send Code →'}
        </button>
      </div>
    </div>
  );

  const filled = otp.join('').length;

  return (
    <div style={wrap}>
      <div style={{ ...card, textAlign: 'center' }}>
        <div style={{ fontSize: '40px', marginBottom: '10px' }}>{isBeta ? '🔑' : '📨'}</div>
        <div style={{ fontSize: '18px', fontWeight: 700, marginBottom: '6px' }}>
          {isBeta ? 'Beta Access' : 'Enter your code'}
        </div>
        <div style={{ fontSize: '13px', color: '#888', marginBottom: '24px', lineHeight: 1.6 }}>
          {isBeta ? (
            <>Beta account detected.<br />
            <strong style={{ color: '#c4b5fd' }}>Type 00000000 (eight zeros)</strong><br />
            to sign in instantly.</>
          ) : (
            <>{OTP_LEN}-digit code sent to<br />
            <strong style={{ color: '#c4b5fd' }}>{email}</strong></>
          )}
        </div>
        {error && (
          <div style={{ background: '#2a1a1a', border: '1px solid #5a2020', borderRadius: '8px', padding: '10px 12px', fontSize: '12px', color: '#ff8080', marginBottom: '14px' }}>
            ⚠️ {error}
          </div>
        )}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', justifyContent: 'center', marginBottom: '20px' }}>
          {otp.map((d, i) => (
            <input
              key={i}
              ref={el => { refs.current[i] = el; }}
              type="text"
              inputMode="numeric"
              maxLength={OTP_LEN}
              value={d}
              onChange={e => handleDigit(i, e.target.value)}
              onKeyDown={e => handleKey(i, e)}
              style={{
                width: '44px', height: '54px', textAlign: 'center',
                background: d ? '#1e1e3e' : '#1e1e2e',
                border: d ? '2px solid #6366f1' : '1px solid #333',
                borderRadius: '10px', color: '#fff',
                fontSize: '22px', fontWeight: 700, outline: 'none',
              }}
            />
          ))}
        </div>
        <button
          onClick={() => verifyOtp(otp)}
          disabled={loading || filled < OTP_LEN}
          style={filled === OTP_LEN && !loading ? btnOn : btnOff}>
          {loading ? 'Verifying…' : 'Verify & Sign In'}
        </button>
        {!isBeta && (
          <div style={{ marginTop: '16px', fontSize: '13px', color: '#555' }}>
            {countdown > 0
              ? <span>Resend in {countdown}s</span>
              : <button onClick={() => { setError(''); setOtp(Array(OTP_LEN).fill('')); sendOtp(); }}
                  style={{ background: 'none', border: 'none', color: '#818cf8', cursor: 'pointer', fontSize: '13px', textDecoration: 'underline' }}>
                  Resend code
                </button>
            }
          </div>
        )}
        <div style={{ marginTop: '8px' }}>
          <button onClick={() => { setStep('email'); setOtp(Array(OTP_LEN).fill('')); setError(''); setIsBeta(false); }}
            style={{ background: 'none', border: 'none', color: '#444', cursor: 'pointer', fontSize: '12px' }}>
            ← Use different email
          </button>
        </div>
      </div>
    </div>
  );
          }
