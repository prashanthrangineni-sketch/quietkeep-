'use client';
// src/app/login/page.tsx
// QuietKeep Personal Login Page
// Welcome Intro Step + Primary Auth: Phone Number SMS OTP via MSG91

import { useState, useRef } from 'react';
import { supabase as _supabaseSingleton } from '@/lib/supabase';
import Link from 'next/link';

const APP_TYPE = process.env.NEXT_PUBLIC_APP_TYPE || 'personal';
const POST_AUTH_PATH = APP_TYPE === 'business' ? '/b/dashboard' : '/dashboard';

const BETA_OTP_LEN = 8;
const SMS_OTP_LEN = 6;

function getClient() {
  return _supabaseSingleton;
}

function setPersonalMode() {
  document.cookie = 'qk_app_mode=personal; path=/; max-age=2592000; SameSite=Lax';
}

function SmileyOrb({ size = 36, bg1 = '#5b5ef4', bg2 = '#8b5cf6' }: { size?: number; bg1?: string; bg2?: string }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: Math.round(size * 0.28),
      background: `linear-gradient(135deg, ${bg1}, ${bg2})`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      boxShadow: `0 4px 14px ${bg1}66`, flexShrink: 0
    }}>
      <svg width={Math.round(size * 0.72)} height={Math.round(size * 0.72)} viewBox="0 0 100 100" aria-hidden="true">
        <ellipse cx="35" cy="42" rx="8.5" ry="12" fill="#ffffff" />
        <ellipse cx="65" cy="42" rx="8.5" ry="12" fill="#ffffff" />
        <path d="M 32 58 Q 50 74 68 58" fill="none" stroke="#ffffff" strokeWidth="7.5" strokeLinecap="round" />
      </svg>
    </div>
  );
}

type Step = 'welcome' | 'phone' | 'phone_otp' | 'email' | 'password' | 'signup' | 'forgot' | 'otp' | 'sent' | 'reset_sent';

export default function LoginPage() {
  const [phone,    setPhone]    = useState('');
  const [smsOtp,   setSmsOtp]   = useState(Array(SMS_OTP_LEN).fill(''));
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [confirm,  setConfirm]  = useState('');
  const [step,     setStep]     = useState<Step>('welcome');
  const [otp,      setOtp]      = useState(Array(BETA_OTP_LEN).fill(''));
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');
  const [isBeta,   setIsBeta]   = useState(false);
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const smsRefs = useRef<(HTMLInputElement | null)[]>([]);

  // ── MSG91 Phone SMS OTP ──────────────────────────────────────────────────
  async function handleSendSmsOtp() {
    const clean = phone.replace(/\D/g, '');
    if (clean.length < 10) {
      setError('Enter a valid 10-digit mobile number.');
      return;
    }
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/auth/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: clean, type: 'personal' }),
      });
      const data = await res.json();
      setLoading(false);

      if (!res.ok || data.error) {
        setError(data.error || 'Failed to send SMS OTP. Try again.');
        return;
      }

      setStep('phone_otp');
      setTimeout(() => smsRefs.current[0]?.focus(), 120);
    } catch (err: any) {
      setLoading(false);
      setError(err?.message || 'Network error sending SMS OTP.');
    }
  }

  async function handleVerifySmsOtp(otpArr?: string[]) {
    const clean = phone.replace(/\D/g, '');
    const code = (otpArr || smsOtp).join('');
    if (code.length !== SMS_OTP_LEN) {
      setError(`Enter all ${SMS_OTP_LEN} digits of your SMS OTP.`);
      return;
    }

    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: clean, otp: code }),
      });
      const data = await res.json();
      setLoading(false);

      if (!res.ok || data.error || !data.session) {
        setError(data.error || 'Invalid OTP code. Please check and try again.');
        setSmsOtp(Array(SMS_OTP_LEN).fill(''));
        setTimeout(() => smsRefs.current[0]?.focus(), 100);
        return;
      }

      await getClient().auth.setSession({
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
      });

      setPersonalMode();
      window.location.href = POST_AUTH_PATH;
    } catch (err: any) {
      setLoading(false);
      setError(err?.message || 'Verification failed. Try again.');
    }
  }

  function handleSmsDigit(i: number, val: string) {
    const char = val.replace(/\D/g, '').slice(-1);
    const next = [...smsOtp]; next[i] = char; setSmsOtp(next);
    if (char && i < SMS_OTP_LEN - 1) smsRefs.current[i + 1]?.focus();
    if (next.every(d => d !== '') && next.join('').length === SMS_OTP_LEN) {
      setTimeout(() => handleVerifySmsOtp(next), 80);
    }
  }

  function handleSmsKey(i: number, e: React.KeyboardEvent) {
    if (e.key === 'Backspace' && !smsOtp[i] && i > 0) smsRefs.current[i - 1]?.focus();
    if (e.key === 'Enter') handleVerifySmsOtp();
  }

  // ── Email Step ────────────────────────────────────────────────────────────
  async function handleContinueEmail() {
    if (!email.trim()) return;
    const norm = email.trim().toLowerCase();
    setError('');

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
    } catch {}

    setStep('password');
    setTimeout(() => document.getElementById('qk-password-input')?.focus(), 100);
  }

  async function verifyPassword() {
    if (!password) { setError('Enter your password.'); return; }
    setLoading(true);
    setError('');

    const { error: authErr } = await getClient().auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });

    setLoading(false);

    if (authErr) {
      const msg = authErr.message || '';
      if (msg.includes('Invalid login credentials') || msg.includes('invalid_credentials')) {
        setError('Incorrect password. Use "Forgot password?" if you need to reset it.');
      } else {
        setError(msg || 'Sign-in failed. Try again.');
      }
      return;
    }

    setPersonalMode();
    window.location.href = POST_AUTH_PATH;
  }

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
      setPersonalMode();
      window.location.href = POST_AUTH_PATH;
    } else {
      setStep('sent');
    }
  }

  async function sendReset() {
    setLoading(true);
    setError('');

    const { error: resetErr } = await getClient().auth.resetPasswordForEmail(
      email.trim().toLowerCase(),
      { redirectTo: `${window.location.origin}/auth/confirm?next=${POST_AUTH_PATH}` }
    );

    setLoading(false);
    if (resetErr) { setError(resetErr.message || 'Could not send reset email.'); return; }
    setStep('reset_sent');
  }

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
    if (otpErr) { setError(otpErr.message || 'Could not send login link.'); return; }
    setStep('sent');
  }

  async function verifyBeta() {
    const norm = email.trim().toLowerCase();
    const pwd = otp.join('');
    if (!pwd || pwd.length < BETA_OTP_LEN) { setError('Enter your full beta password.'); return; }

    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/auth/beta-verify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: norm, code: pwd }),
      });
      const data = await res.json();
      if (!data.access_token) {
        setError(data.error || 'Beta sign-in failed.');
        setOtp(Array(BETA_OTP_LEN).fill(''));
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
      setOtp(Array(BETA_OTP_LEN).fill(''));
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
    if (char && i < BETA_OTP_LEN - 1) refs.current[i + 1]?.focus();
    if (isBeta && next.every(d => d !== '') && next.join('').length === BETA_OTP_LEN) {
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
    position: 'relative', overflow: 'hidden'
  };
  const card: React.CSSProperties = {
    width: '100%', maxWidth: '400px',
    background: 'var(--surface)', border: '1px solid var(--border)',
    borderRadius: '24px', padding: '32px 24px',
    boxShadow: 'var(--shadow)', position: 'relative', zIndex: 1
  };
  const logo = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 24 }}>
      <SmileyOrb size={36} bg1="#5b5ef4" bg2="#8b5cf6" />
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

  // ── Step: Welcome & Intro ──────────────────────────────────────────────────
  if (step === 'welcome') return (
    <div style={wrap}>
      {/* Aurora Ambient Glow */}
      <div style={{ position: 'absolute', top: -150, right: -150, width: 450, height: 450, background: 'radial-gradient(circle, rgba(91,94,244,0.15) 0%, transparent 70%)', pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', bottom: -150, left: -150, width: 450, height: 450, background: 'radial-gradient(circle, rgba(139,92,246,0.12) 0%, transparent 70%)', pointerEvents: 'none' }} />

      <div style={{ ...card, textAlign: 'center' }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
          <SmileyOrb size={54} bg1="#5b5ef4" bg2="#8b5cf6" />
        </div>

        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'var(--primary-dim)', border: '1px solid var(--primary-glow)', borderRadius: 999, padding: '4px 12px', marginBottom: 16 }}>
          <span style={{ width: 6, height: 6, background: '#22c55e', borderRadius: '50%', display: 'inline-block' }} />
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--primary)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>QuietKeep Personal</span>
        </div>

        <h1 style={{ fontSize: 24, fontWeight: 900, letterSpacing: '-1px', color: 'var(--text)', margin: '0 0 10px', lineHeight: 1.15 }}>
          Keep everything.<br />
          <span style={{ background: 'linear-gradient(135deg,#5b5ef4,#8b5cf6)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            Say it once.
          </span>
        </h1>

        <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6, margin: '0 0 28px' }}>
          Voice-first life OS for reminders, warranty wallet, family space, and daily spoken briefs.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
          <button onClick={() => setStep('phone')}
            style={{ width: '100%', padding: '14px', background: 'linear-gradient(135deg,#5b5ef4,#8b5cf6)', border: 'none', color: '#fff', borderRadius: 12, fontSize: 15, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', boxShadow: '0 4px 18px rgba(91,94,244,0.35)' }}>
            Sign Up / Sign In with Mobile OTP →
          </button>

          <button onClick={() => setStep('email')}
            style={{ width: '100%', padding: '12px', background: 'var(--surface-hover)', border: '1px solid var(--border)', color: 'var(--text-muted)', borderRadius: 12, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
            Sign In with Email / Beta Code
          </button>
        </div>

        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: 'var(--text-subtle)' }}>Need business features?</span>
          <Link href="/biz-login" style={{ fontSize: 12, color: '#10b981', fontWeight: 700, textDecoration: 'none' }}>
            Business App →
          </Link>
        </div>
      </div>
    </div>
  );

  // ── Step: Primary Mobile Phone SMS OTP ──────────────────────────────────────
  if (step === 'phone') return (
    <div style={wrap}>
      <div style={card}>
        {logo}
        <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text)', margin: '0 0 6px', letterSpacing: '-0.5px' }}>Mobile Sign In</h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 22px', lineHeight: 1.6 }}>Enter your mobile number to receive a 6-digit SMS OTP.</p>
        {errorBox}
        <label style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600, marginBottom: 6, display: 'block' }}>Mobile Number</label>
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <div style={{ background: 'var(--surface-hover)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 14px', fontSize: 15, fontWeight: 700, color: 'var(--text)', display: 'flex', alignItems: 'center' }}>
            +91
          </div>
          <input type="tel" value={phone} onChange={e => { setPhone(e.target.value.replace(/\D/g, '').slice(0, 10)); setError(''); }}
            onKeyDown={e => e.key === 'Enter' && !loading && phone.trim().length >= 10 && handleSendSmsOtp()}
            placeholder="9876543210" autoFocus className="qk-input" style={{ flex: 1, fontSize: 16, letterSpacing: '0.05em' }} />
        </div>
        <button onClick={handleSendSmsOtp} disabled={phone.trim().length < 10 || loading}
          style={{ width: '100%', padding: '14px', background: phone.trim().length < 10 || loading ? 'var(--surface-hover)' : 'linear-gradient(135deg,#5b5ef4,#818cf8)', border: 'none', color: phone.trim().length < 10 || loading ? 'var(--text-subtle)' : '#fff', borderRadius: 12, fontSize: 15, fontWeight: 700, cursor: phone.trim().length < 10 || loading ? 'not-allowed' : 'pointer', fontFamily: 'inherit', transition: 'all 0.2s' }}>
          {loading ? 'Sending SMS OTP…' : 'Send SMS OTP →'}
        </button>

        <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <button onClick={() => setStep('welcome')} style={{ background: 'none', border: 'none', color: 'var(--text-subtle)', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit' }}>
            ← Back
          </button>
          <button onClick={() => { setStep('email'); setError(''); }}
            style={{ background: 'none', border: 'none', color: 'var(--primary)', cursor: 'pointer', fontSize: 12, fontWeight: 600, fontFamily: 'inherit', textDecoration: 'underline' }}>
            Or Email / Password →
          </button>
        </div>
      </div>
    </div>
  );

  // ── Step: Verify Phone SMS OTP ─────────────────────────────────────────────
  if (step === 'phone_otp') return (
    <div style={wrap}>
      <div style={{ ...card, textAlign: 'center' }}>
        <div style={{ fontSize: 40, marginBottom: 10 }}>💬</div>
        <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--text)', marginBottom: 6 }}>Enter SMS OTP</div>
        <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 6, lineHeight: 1.6 }}>
          Sent to <strong style={{ color: 'var(--primary)' }}>+91 {phone}</strong>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-subtle)', marginBottom: 20, lineHeight: 1.6, background: 'var(--primary-dim)', borderRadius: 8, padding: '8px 12px' }}>
          Valid for 10 minutes · Powered by MSG91 SMS
        </div>
        {errorBox}
        <div style={{ display: 'flex', gap: 6, justifyContent: 'center', marginBottom: 20 }}>
          {smsOtp.map((d, i) => (
            <input key={i} ref={el => { smsRefs.current[i] = el; }}
              type="text" inputMode="numeric" pattern="[0-9]" maxLength={1} value={d}
              onChange={e => handleSmsDigit(i, e.target.value)}
              onKeyDown={e => handleSmsKey(i, e)}
              style={{ width: 44, height: 54, textAlign: 'center', background: d ? 'var(--primary-dim)' : 'var(--surface-hover)', border: d ? '2px solid var(--primary)' : '1px solid var(--border)', borderRadius: 10, color: 'var(--text)', fontSize: 22, fontWeight: 700, outline: 'none', fontFamily: 'inherit' }} />
          ))}
        </div>
        <button onClick={() => handleVerifySmsOtp()} disabled={loading || smsOtp.some(d => !d)}
          style={{ width: '100%', padding: '14px', background: loading || smsOtp.some(d => !d) ? 'var(--surface-hover)' : 'linear-gradient(135deg,#5b5ef4,#818cf8)', border: 'none', color: loading || smsOtp.some(d => !d) ? 'var(--text-subtle)' : '#fff', borderRadius: 12, fontSize: 15, fontWeight: 700, cursor: loading || smsOtp.some(d => !d) ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}>
          {loading ? 'Verifying…' : 'Verify & Sign In →'}
        </button>
        <div style={{ marginTop: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <button onClick={handleSendSmsOtp} disabled={loading}
            style={{ background: 'none', border: 'none', color: 'var(--primary)', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit', fontWeight: 600 }}>
            ↩ Resend SMS
          </button>
          <button onClick={() => { setStep('phone'); setSmsOtp(Array(SMS_OTP_LEN).fill('')); setError(''); }}
            style={{ background: 'none', border: 'none', color: 'var(--text-subtle)', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit' }}>
            ← Change Number
          </button>
        </div>
      </div>
    </div>
  );

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
            : <>We sent a sign-in link to <strong style={{ color: 'var(--primary)' }}>{email}</strong>. Click the link to access your account.</>
          }
        </div>
        <button onClick={() => { setStep('welcome'); setError(''); }}
          style={{ background: 'none', border: 'none', color: 'var(--text-subtle)', cursor: 'pointer', fontSize: 13, fontFamily: 'inherit', textDecoration: 'underline' }}>
          ← Back to start
        </button>
      </div>
    </div>
  );

  // ── Email step (secondary fallback) ──────────────────────────────────────
  if (step === 'email') return (
    <div style={wrap}>
      <div style={card}>
        {logo}
        <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text)', margin: '0 0 6px', letterSpacing: '-0.5px' }}>Email Sign In</h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 22px', lineHeight: 1.6 }}>Enter your registered email address.</p>
        {errorBox}
        <label style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600, marginBottom: 6, display: 'block' }}>Email address</label>
        <input type="email" value={email} onChange={e => { setEmail(e.target.value); setError(''); }}
          onKeyDown={e => e.key === 'Enter' && !loading && email.trim() && handleContinueEmail()}
          placeholder="you@example.com" autoFocus className="qk-input" style={{ marginBottom: 12, fontSize: 15 }} />
        <button onClick={handleContinueEmail} disabled={!email.trim() || loading}
          style={{ width: '100%', padding: '14px', marginTop: 4, background: !email.trim() || loading ? 'var(--surface-hover)' : 'linear-gradient(135deg,#5b5ef4,#818cf8)', border: 'none', color: !email.trim() || loading ? 'var(--text-subtle)' : '#fff', borderRadius: 12, fontSize: 15, fontWeight: 700, cursor: !email.trim() || loading ? 'not-allowed' : 'pointer', fontFamily: 'inherit', transition: 'all 0.2s' }}>
          {loading ? 'Checking…' : 'Continue →'}
        </button>
        <div style={{ marginTop: 16, textAlign: 'center' }}>
          <button onClick={() => { setStep('welcome'); setError(''); }}
            style={{ background: 'none', border: 'none', color: 'var(--text-subtle)', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit', textDecoration: 'underline' }}>
            ← Back to welcome screen
          </button>
        </div>
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

  // ── Beta Access Password Step ─────────────────────────────────────────────
  return (
    <div style={wrap}>
      <div style={{ ...card, textAlign: 'center' }}>
        <div style={{ fontSize: 40, marginBottom: 10 }}>🔑</div>
        <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>Beta Access Code</div>
        <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 6, lineHeight: 1.6 }}>{email}</div>
        <div style={{ fontSize: 12, color: 'var(--text-subtle)', marginBottom: 20, lineHeight: 1.6, background: 'var(--primary-dim)', borderRadius: 8, padding: '8px 12px' }}>
          Enter your pre-shared 8-character beta access password in the boxes below.
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
          <button onClick={() => { setStep('email'); setOtp(Array(BETA_OTP_LEN).fill('')); setError(''); setIsBeta(false); }}
            style={{ background: 'none', border: 'none', color: 'var(--text-subtle)', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit' }}>
            ← Back
          </button>
        </div>
      </div>
    </div>
  );
}
