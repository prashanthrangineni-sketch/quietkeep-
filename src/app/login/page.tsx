'use client';
import { useState, useRef, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';

const BETA_EMAILS = ['beta@quietkeep.com', 'pranixailabs@gmail.com'];
const BETA_PASSWORDS: Record<string, string> = {
  'beta@quietkeep.com': 'BetaQK@2026',
  'pranixailabs@gmail.com': 'PranixQK@2026',
};
const OTP_LEN = 8;

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [step, setStep] = useState<'email' | 'otp'>('email');
  const [otp, setOtp] = useState(Array(OTP_LEN).fill(''));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  function handleContinue() {
    if (!email.trim()) return;
    const emailNorm = email.trim().toLowerCase();
    if (BETA_EMAILS.includes(emailNorm)) {
      // Beta user — go to OTP screen, no email sent
      setError('');
      setStep('otp');
      setTimeout(() => refs.current[0]?.focus(), 120);
    } else {
      // Everyone else — straight to waitlist, no Supabase call at all
      window.location.href = '/waitlist';
    }
  }

  async function verifyOtp(digits: string[]) {
    const code = digits.join('');
    if (code.length !== OTP_LEN) return;
    if (code !== '00000000') {
      setError('Type eight zeros: 00000000');
      setOtp(Array(OTP_LEN).fill(''));
      setTimeout(() => refs.current[0]?.focus(), 100);
      return;
    }
    setLoading(true);
    setError('');
    // Plain createClient — no PKCE, works with signInWithPassword
    const sb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
    const emailNorm = email.trim().toLowerCase();
    const { error: signErr } = await sb.auth.signInWithPassword({
      email: emailNorm,
      password: BETA_PASSWORDS[emailNorm],
    });
    setLoading(false);
    if (signErr) { setError('Sign-in failed: ' + signErr.message); return; }
    window.location.href = '/dashboard';
  }

  function handleDigit(i: number, val: string) {
    if (val.length === OTP_LEN && /^\d{8}$/.test(val)) {
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
    minHeight: '100dvh', background: '#0a0a0f', color: '#fff',
    fontFamily: 'system-ui,sans-serif',
    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px',
  };
  const card: React.CSSProperties = {
    width: '100%', maxWidth: '400px', background: '#12121a',
    borderRadius: '20px', padding: '32px 24px',
  };
  const btnOn: React.CSSProperties = {
    width: '100%', padding: '14px', marginTop: '12px',
    background: 'linear-gradient(90deg,#6366f1,#818cf8)',
    border: 'none', color: '#fff', borderRadius: '10px',
    fontSize: '15px', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
  };
  const btnOff: React.CSSProperties = { ...btnOn, background: '#2a2a3a', color: '#666', cursor: 'not-allowed' };

  if (step === 'email') return (
    <div style={wrap}>
      <div style={card}>
        <div style={{ fontSize: '28px', fontWeight: 800, background: 'linear-gradient(90deg,#818cf8,#c4b5fd)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', marginBottom: '4px' }}>
          QuietKeep
        </div>
        <div style={{ fontSize: '13px', color: '#666', marginBottom: '28px' }}>Enter your email to continue.</div>
        {error && <div style={{ background: '#2a1a1a', border: '1px solid #5a2020', borderRadius: '8px', padding: '10px 12px', fontSize: '12px', color: '#ff8080', marginBottom: '12px' }}>⚠️ {error}</div>}
        <label style={{ fontSize: '12px', color: '#888', fontWeight: 600, marginBottom: '6px', display: 'block' }}>Email address</label>
        <input
          type="email" value={email}
          onChange={e => setEmail(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && email.trim() && handleContinue()}
          placeholder="you@example.com" autoFocus
          style={{ width: '100%', background: '#1e1e2e', border: '1px solid #333', color: '#fff', padding: '13px', borderRadius: '10px', fontSize: '15px', boxSizing: 'border-box', outline: 'none', fontFamily: 'inherit' }}
        />
        <button onClick={handleContinue} disabled={!email.trim()} style={email.trim() ? btnOn : btnOff}>
          Continue →
        </button>
      </div>
    </div>
  );

  const filled = otp.join('').length;
  return (
    <div style={wrap}>
      <div style={{ ...card, textAlign: 'center' }}>
        <div style={{ fontSize: '40px', marginBottom: '10px' }}>🔑</div>
        <div style={{ fontSize: '18px', fontWeight: 700, marginBottom: '6px' }}>Beta Access</div>
        <div style={{ fontSize: '13px', color: '#888', marginBottom: '24px', lineHeight: 1.6 }}>
          Type <strong style={{ color: '#c4b5fd', letterSpacing: '0.15em' }}>00000000</strong> (eight zeros)
        </div>
        {error && <div style={{ background: '#2a1a1a', border: '1px solid #5a2020', borderRadius: '8px', padding: '10px 12px', fontSize: '12px', color: '#ff8080', marginBottom: '14px' }}>⚠️ {error}</div>}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', justifyContent: 'center', marginBottom: '20px' }}>
          {otp.map((d, i) => (
            <input key={i} ref={el => { refs.current[i] = el; }}
              type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={OTP_LEN}
              value={d}
              onChange={e => handleDigit(i, e.target.value)}
              onKeyDown={e => handleKey(i, e)}
              style={{ width: '44px', height: '54px', textAlign: 'center', background: d ? '#1e1e3e' : '#1e1e2e', border: d ? '2px solid #6366f1' : '1px solid #333', borderRadius: '10px', color: '#fff', fontSize: '22px', fontWeight: 700, outline: 'none', fontFamily: 'inherit' }}
            />
          ))}
        </div>
        <button onClick={() => verifyOtp(otp)} disabled={loading || filled < OTP_LEN} style={filled === OTP_LEN && !loading ? btnOn : btnOff}>
          {loading ? 'Signing in…' : 'Sign In'}
        </button>
        <div style={{ marginTop: '12px' }}>
          <button onClick={() => { setStep('email'); setOtp(Array(OTP_LEN).fill('')); setError(''); }} style={{ background: 'none', border: 'none', color: '#444', cursor: 'pointer', fontSize: '12px', fontFamily: 'inherit' }}>
            ← Back
          </button>
        </div>
      </div>
    </div>
  );
}
