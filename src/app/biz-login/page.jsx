'use client';
// src/app/biz-login/page.jsx — Business Login with Welcome Intro & (◕‿◕) Brand Orb
// Primary Auth: Phone Number SMS OTP via MSG91
// Secondary Auth: Email + Beta Password / Magic Link

import { useState, useRef } from 'react';
import Link from 'next/link';
import { supabase as _supabaseSingleton } from '@/lib/supabase';

const BETA_OTP_LEN = 8;
const SMS_OTP_LEN = 6;
const G = '#10b981';
const G2 = '#059669';

function getClient() {
  return _supabaseSingleton;
}

function setBusinessMode() {
  document.cookie = 'qk_app_mode=business; path=/; max-age=2592000; SameSite=Lax';
}

function SmileyOrb({ size = 36, bg1 = G, bg2 = G2 }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: Math.round(size * 0.28),
      background: `linear-gradient(135deg, ${bg1}, ${bg2})`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      boxShadow: `0 4px 14px rgba(16,185,129,0.35)`, flexShrink: 0
    }}>
      <svg width={Math.round(size * 0.72)} height={Math.round(size * 0.72)} viewBox="0 0 100 100" aria-hidden="true">
        <ellipse cx="35" cy="42" rx="8.5" ry="12" fill="#ffffff" />
        <ellipse cx="65" cy="42" rx="8.5" ry="12" fill="#ffffff" />
        <path d="M 32 58 Q 50 74 68 58" fill="none" stroke="#ffffff" strokeWidth="7.5" strokeLinecap="round" />
      </svg>
    </div>
  );
}

export default function BizLoginPage() {
  const [phone, setPhone] = useState('');
  const [smsOtp, setSmsOtp] = useState(Array(SMS_OTP_LEN).fill(''));
  const [email, setEmail] = useState('');
  const [step, setStep] = useState('welcome'); // 'welcome' | 'phone' | 'phone_otp' | 'email' | 'otp' | 'sent'
  const [otp, setOtp] = useState(Array(BETA_OTP_LEN).fill(''));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const refs = useRef([]);
  const smsRefs = useRef([]);
  const otpTokenRef = useRef('');

  // ── MSG91 Phone SMS OTP (Business) ─────────────────────────────────────────
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
        body: JSON.stringify({ phone: clean, type: 'business' }),
      });
      const data = await res.json();
      setLoading(false);

      if (!res.ok || data.error) {
        setError(data.error || 'Failed to send SMS OTP. Try again.');
        return;
      }

      setStep('phone_otp');
      setTimeout(() => smsRefs.current[0]?.focus(), 120);
    } catch (err) {
      setLoading(false);
      setError(err?.message || 'Network error sending SMS OTP.');
    }
  }

  async function handleVerifySmsOtp(otpArr) {
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

      setBusinessMode();
      window.location.href = '/b/dashboard';
    } catch (err) {
      setLoading(false);
      setError(err?.message || 'Verification failed. Try again.');
    }
  }

  function handleSmsDigit(i, val) {
    const char = val.replace(/\D/g, '').slice(-1);
    const next = [...smsOtp]; next[i] = char; setSmsOtp(next);
    if (char && i < SMS_OTP_LEN - 1) smsRefs.current[i + 1]?.focus();
    if (next.every(d => d !== '') && next.join('').length === SMS_OTP_LEN) {
      setTimeout(() => handleVerifySmsOtp(next), 80);
    }
  }

  function handleSmsKey(i, e) {
    if (e.key === 'Backspace' && !smsOtp[i] && i > 0) smsRefs.current[i - 1]?.focus();
    if (e.key === 'Enter') handleVerifySmsOtp();
  }

  // ── Email Step ────────────────────────────────────────────────────────────
  async function handleContinueEmail() {
    if (!email.trim()) return;
    const norm = email.trim().toLowerCase();
    try {
      const res = await fetch('/api/auth/beta-verify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: norm }),
      });
      const data = await res.json();
      if (data.isBeta) {
        setError('');
        setStep('otp');
        setTimeout(() => refs.current[0]?.focus(), 120);
        return;
      }
    } catch {}
    sendMagicLink(norm);
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
    if (val && idx < BETA_OTP_LEN - 1) refs.current[idx + 1]?.focus();
  }

  function handleOtpKey(idx, e) {
    if (e.key === 'Backspace' && !otp[idx] && idx > 0) refs.current[idx - 1]?.focus();
    if (e.key === 'Enter' && otp.join('').length === BETA_OTP_LEN) verifyBeta();
  }

  async function verifyBeta() {
    const norm = email.trim().toLowerCase();
    setLoading(true); setError('');
    try {
      const res = await fetch('/api/auth/beta-verify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: norm, code: otp.join('') }),
      });
      const data = await res.json();
      if (!data.access_token) {
        setError(data.error || 'Beta sign-in failed.');
        setLoading(false);
        return;
      }
      const sb = getClient();
      await sb.auth.setSession({
        access_token: data.access_token,
        refresh_token: data.refresh_token,
      });
    } catch {
      setError('Sign-in failed. Please try again.');
      setLoading(false);
      return;
    }
    setLoading(false);
    setBusinessMode();
    window.location.href = '/b/dashboard';
  }

  const inp = {
    width: '100%', background: 'rgba(255,255,255,0.06)',
    border: '1.5px solid rgba(255,255,255,0.1)',
    borderRadius: 12, padding: '14px 16px',
    color: '#f1f5f9', fontSize: 15, outline: 'none',
    boxSizing: 'border-box', fontFamily: 'inherit',
  };

  async function handleGoogleSignIn() {
    setLoading(true);
    setError('');
    try {
      const { GoogleAuth } = await import('@codetrix-studio/capacitor-google-auth');
      GoogleAuth.initialize({
        clientId: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || '854117079237-7n53t4i57l3slst108u7o1n9msmbs845.apps.googleusercontent.com',
        scopes: ['profile', 'email'],
        grantOfflineAccess: true,
      });
      const user = await GoogleAuth.signIn();
      const idToken = user?.authentication?.idToken || user?.idToken;
      if (idToken) {
        const { data, error: authErr } = await getClient().auth.signInWithIdToken({
          provider: 'google',
          token: idToken,
        });
        if (authErr) {
          setError(authErr.message || 'Google sign-in failed with Supabase.');
          setLoading(false);
          return;
        }
        setBusinessMode();
        window.location.href = '/b/dashboard';
      } else {
        setError('Could not retrieve Google ID token.');
      }
    } catch (err) {
      console.error('Google Auth Error:', err);
      setError(err?.message || 'Google sign-in failed.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ minHeight: '100dvh', background: 'linear-gradient(135deg,#0a1628 0%,#0d2a1e 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, fontFamily: "'Inter',-apple-system,sans-serif", position: 'relative', overflow: 'hidden' }}>
      {/* Aurora Glow */}
      <div style={{ position: 'absolute', top: -200, right: -200, width: 600, height: 600, background: 'radial-gradient(circle,rgba(16,185,129,0.12) 0%,transparent 70%)', pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', bottom: -200, left: -200, width: 600, height: 600, background: 'radial-gradient(circle,rgba(5,150,105,0.1) 0%,transparent 70%)', pointerEvents: 'none' }} />

      <div style={{ width: '100%', maxWidth: 420, position: 'relative', zIndex: 1 }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 28 }}>
          <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: 8, textDecoration: 'none' }}>
            <SmileyOrb size={32} bg1={G} bg2={G2} />
            <span style={{ fontWeight: 800, fontSize: 16, color: '#e2e8f0' }}>
              QuietKeep <span style={{ color: G }}>Business</span>
            </span>
          </Link>
          <Link href="/login" style={{ fontSize: 12, color: '#64748b', textDecoration: 'none', background: 'rgba(255,255,255,0.05)', padding: '5px 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.08)' }}>
            Personal →
          </Link>
        </div>

        {/* Welcome / Intro Step */}
        {step === 'welcome' && (
          <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 24, padding: '36px 28px', backdropFilter: 'blur(20px)', textAlign: 'center' }}>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
              <SmileyOrb size={54} bg1={G} bg2={G2} />
            </div>

            <div style={{ display: 'inline-block', background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.25)', borderRadius: 999, padding: '4px 14px', fontSize: 11, color: G, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 16 }}>
              🏢 Built for Indian SMBs
            </div>

            <h1 style={{ fontSize: 24, fontWeight: 900, color: '#f1f5f9', margin: '0 0 10px', lineHeight: 1.15 }}>
              Run your business<br />
              <span style={{ background: `linear-gradient(135deg,${G},#34d399)`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                by voice.
              </span>
            </h1>

            <p style={{ fontSize: 13, color: '#94a3b8', margin: '0 0 28px', lineHeight: 1.6 }}>
              Voice ledger, staff attendance, GST invoices, payroll, and compliance reminders — all in one app.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
              <button onClick={() => setStep('phone')}
                style={{ width: '100%', background: `linear-gradient(135deg,${G},#059669)`, color: '#fff', border: 'none', borderRadius: 12, padding: '15px', fontSize: 15, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', boxShadow: '0 4px 18px rgba(16,185,129,0.35)' }}>
                Business Sign Up / Sign In with OTP →
              </button>

              <button onClick={handleGoogleSignIn} disabled={loading}
                style={{ width: '100%', padding: '12px', background: '#ffffff', border: '1px solid rgba(255,255,255,0.1)', color: '#0f172a', borderRadius: 12, fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                <svg width="18" height="18" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/></svg>
                Continue with Google
              </button>

              <button onClick={() => setStep('email')}
                style={{ width: '100%', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: '#e2e8f0', borderRadius: 12, padding: '13px', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                Sign In with Email / Beta Code
              </button>
            </div>

            <p style={{ fontSize: 12, color: '#64748b', margin: 0 }}>
              Replaces Khatabook, StaffPicks, and manual ledgers.
            </p>
          </div>
        )}

        {/* Phone Step (Primary) */}
        {step === 'phone' && (
          <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 22, padding: '36px 28px', backdropFilter: 'blur(20px)' }}>
            <div style={{ display: 'inline-block', background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.25)', borderRadius: 999, padding: '3px 12px', fontSize: 11, color: G, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 16 }}>
              🏢 Business Mobile OTP
            </div>
            <h1 style={{ fontSize: 24, fontWeight: 800, color: '#f1f5f9', margin: '0 0 6px' }}>Business Sign In</h1>
            <p style={{ fontSize: 14, color: '#64748b', margin: '0 0 24px', lineHeight: 1.6 }}>
              Enter your mobile number to receive a 6-digit SMS OTP.
            </p>
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 12, color: '#64748b', display: 'block', marginBottom: 6, fontWeight: 500 }}>
                Mobile Number
              </label>
              <div style={{ display: 'flex', gap: 8 }}>
                <div style={{ background: 'rgba(255,255,255,0.08)', border: '1.5px solid rgba(255,255,255,0.1)', borderRadius: 12, padding: '14px 14px', fontSize: 15, fontWeight: 700, color: '#f1f5f9', display: 'flex', alignItems: 'center' }}>
                  +91
                </div>
                <input
                  type="tel" value={phone}
                  onChange={e => { setPhone(e.target.value.replace(/\D/g, '').slice(0, 10)); setError(''); }}
                  onKeyDown={e => e.key === 'Enter' && !loading && phone.trim().length >= 10 && handleSendSmsOtp()}
                  placeholder="9876543210"
                  autoFocus
                  style={{ ...inp, flex: 1, letterSpacing: '0.05em' }}
                />
              </div>
            </div>
            {error && <div style={{ color: '#ef4444', fontSize: 12, marginBottom: 12 }}>⚠️ {error}</div>}
            <button onClick={handleSendSmsOtp} disabled={loading || phone.trim().length < 10}
              style={{ width: '100%', background: `linear-gradient(135deg,${G},#059669)`, color: '#fff', border: 'none', borderRadius: 12, padding: '15px', fontSize: 15, fontWeight: 700, cursor: loading || phone.trim().length < 10 ? 'not-allowed' : 'pointer', fontFamily: 'inherit', opacity: loading || phone.trim().length < 10 ? 0.6 : 1 }}>
              {loading ? 'Sending SMS OTP…' : 'Send Business SMS OTP →'}
            </button>
            <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid rgba(255,255,255,0.08)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <button onClick={() => setStep('welcome')} style={{ background: 'none', border: 'none', color: '#64748b', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>
                ← Back
              </button>
              <button onClick={() => { setStep('email'); setError(''); }}
                style={{ background: 'none', border: 'none', color: G, cursor: 'pointer', fontSize: 12, fontWeight: 600, fontFamily: 'inherit', textDecoration: 'underline' }}>
                Or Email / Beta Code →
              </button>
            </div>
          </div>
        )}

        {/* Phone OTP Step */}
        {step === 'phone_otp' && (
          <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 22, padding: '36px 28px', backdropFilter: 'blur(20px)', textAlign: 'center' }}>
            <div style={{ fontSize: 40, marginBottom: 10 }}>💬</div>
            <h1 style={{ fontSize: 22, fontWeight: 800, color: '#f1f5f9', margin: '0 0 6px' }}>Enter SMS OTP</h1>
            <p style={{ fontSize: 13, color: '#64748b', margin: '0 0 6px' }}>
              Sent to <strong style={{ color: G }}>+91 {phone}</strong>
            </p>
            <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 20, lineHeight: 1.6, background: 'rgba(16,185,129,0.1)', borderRadius: 8, padding: '8px 12px' }}>
              Valid for 10 minutes · Powered by MSG91 SMS
            </div>
            {error && <div style={{ color: '#ef4444', fontSize: 12, marginBottom: 12, textAlign: 'left' }}>⚠️ {error}</div>}
            <div style={{ display: 'flex', gap: 6, marginBottom: 20, justifyContent: 'center' }}>
              {smsOtp.map((v, i) => (
                <input
                  key={i}
                  ref={el => { smsRefs.current[i] = el; }}
                  type="text" inputMode="numeric" pattern="[0-9]" maxLength={1} value={v}
                  onChange={e => handleSmsDigit(i, e.target.value)}
                  onKeyDown={e => handleSmsKey(i, e)}
                  style={{
                    width: 44, height: 54, textAlign: 'center',
                    background: v ? 'rgba(16,185,129,0.15)' : 'rgba(255,255,255,0.08)',
                    border: `1.5px solid ${v ? G : 'rgba(255,255,255,0.12)'}`,
                    borderRadius: 10, color: '#f1f5f9', fontSize: 22,
                    fontWeight: 700, outline: 'none', fontFamily: 'inherit',
                  }}
                />
              ))}
            </div>
            <button onClick={() => handleVerifySmsOtp()} disabled={loading || smsOtp.some(d => !d)}
              style={{ width: '100%', background: `linear-gradient(135deg,${G},#059669)`, color: '#fff', border: 'none', borderRadius: 12, padding: '15px', fontSize: 15, fontWeight: 700, cursor: loading || smsOtp.some(d => !d) ? 'not-allowed' : 'pointer', fontFamily: 'inherit', opacity: loading || smsOtp.some(d => !d) ? 0.6 : 1 }}>
              {loading ? 'Verifying…' : 'Verify & Sign In →'}
            </button>
            <div style={{ marginTop: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <button onClick={handleSendSmsOtp} disabled={loading}
                style={{ background: 'none', border: 'none', color: G, cursor: 'pointer', fontSize: 12, fontFamily: 'inherit', fontWeight: 600 }}>
                ↩ Resend SMS
              </button>
              <button onClick={() => { setStep('phone'); setSmsOtp(Array(SMS_OTP_LEN).fill('')); setError(''); }}
                style={{ background: 'none', border: 'none', color: '#64748b', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>
                ← Change Number
              </button>
            </div>
          </div>
        )}

        {/* Sent state */}
        {step === 'sent' && (
          <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 22, padding: '40px 28px', textAlign: 'center' }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>📬</div>
            <h2 style={{ fontSize: 22, fontWeight: 800, color: '#f1f5f9', margin: '0 0 10px' }}>Check your email</h2>
            <p style={{ fontSize: 14, color: '#64748b', lineHeight: 1.7, marginBottom: 20 }}>
              We sent a sign-in link to <strong style={{ color: G }}>{email}</strong>.<br />
              Click the link to open your business workspace.
            </p>
            <button onClick={() => { setStep('welcome'); setError(''); }}
              style={{ background: 'none', border: 'none', color: '#64748b', fontSize: 13, cursor: 'pointer', textDecoration: 'underline' }}>
              ← Back to start
            </button>
          </div>
        )}

        {/* Email step */}
        {step === 'email' && (
          <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 22, padding: '36px 28px', backdropFilter: 'blur(20px)' }}>
            <div style={{ display: 'inline-block', background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.25)', borderRadius: 999, padding: '3px 12px', fontSize: 11, color: G, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 16 }}>
              🏢 Business Workspace
            </div>
            <h1 style={{ fontSize: 24, fontWeight: 800, color: '#f1f5f9', margin: '0 0 6px' }}>Email Sign In</h1>
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
                onKeyDown={e => e.key === 'Enter' && !loading && handleContinueEmail()}
                placeholder="beta@quietkeep.com"
                autoFocus
                style={inp}
                onFocus={e => e.target.style.borderColor = 'rgba(16,185,129,0.5)'}
                onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,0.1)'}
              />
            </div>
            {error && <div style={{ color: '#ef4444', fontSize: 12, marginBottom: 12 }}>⚠️ {error}</div>}
            <button onClick={handleContinueEmail} disabled={loading || !email.trim()}
              style={{ width: '100%', background: `linear-gradient(135deg,${G},#059669)`, color: '#fff', border: 'none', borderRadius: 12, padding: '15px', fontSize: 15, fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer', fontFamily: 'inherit', opacity: loading ? 0.7 : 1 }}>
              {loading ? 'Please wait…' : 'Continue →'}
            </button>
            <div style={{ marginTop: 16, textAlign: 'center' }}>
              <button onClick={() => { setStep('welcome'); setError(''); }}
                style={{ background: 'none', border: 'none', color: '#64748b', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', textDecoration: 'underline' }}>
                ← Back to welcome screen
              </button>
            </div>
          </div>
        )}

        {/* Beta Password step */}
        {step === 'otp' && (
          <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 22, padding: '36px 28px', backdropFilter: 'blur(20px)' }}>
            <h1 style={{ fontSize: 22, fontWeight: 800, color: '#f1f5f9', margin: '0 0 4px' }}>Beta Access Code</h1>
            <p style={{ fontSize: 13, color: '#64748b', margin: '0 0 24px' }}>
              {email}
            </p>

            <label style={{ fontSize: 12, color: '#64748b', display: 'block', marginBottom: 10, fontWeight: 500 }}>
              Enter pre-shared beta password in the boxes
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

            <div style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)', borderRadius: 8, padding: '10px 12px', fontSize: 12, color: '#94a3b8', marginBottom: 16, lineHeight: 1.6 }}>
              Enter your pre-shared 8-character beta password in the boxes.
            </div>

            {error && <div style={{ color: '#ef4444', fontSize: 12, marginBottom: 12 }}>⚠️ {error}</div>}

            <button onClick={verifyBeta} disabled={loading || otp.join('').length < BETA_OTP_LEN}
              style={{ width: '100%', background: `linear-gradient(135deg,${G},#059669)`, color: '#fff', border: 'none', borderRadius: 12, padding: '15px', fontSize: 15, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', opacity: loading || otp.join('').length < BETA_OTP_LEN ? 0.6 : 1 }}>
              {loading ? 'Signing in…' : 'Sign In →'}
            </button>

            <button onClick={() => { setStep('email'); setOtp(Array(BETA_OTP_LEN).fill('')); setError(''); }}
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
