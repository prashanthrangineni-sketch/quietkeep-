'use client';
// src/app/biz-login/page.jsx — Business Login (pure JS, no TypeScript)
// Primary Auth: Phone Number SMS OTP via MSG91
// Secondary Auth: Email + Beta Password / Magic Link

import { useState, useRef } from 'react';
import Link from 'next/link';
import { supabase as _supabaseSingleton } from '@/lib/supabase';

const BETA_OTP_LEN = 8;
const SMS_OTP_LEN = 6;
const G = '#10b981';

function getClient() {
  return _supabaseSingleton;
}

function setBusinessMode() {
  document.cookie = 'qk_app_mode=business; path=/; max-age=2592000; SameSite=Lax';
}

export default function BizLoginPage() {
  const [phone, setPhone] = useState('');
  const [smsOtp, setSmsOtp] = useState(Array(SMS_OTP_LEN).fill(''));
  const [email, setEmail] = useState('');
  const [step, setStep] = useState('phone'); // 'phone' | 'phone_otp' | 'email' | 'otp' | 'sent'
  const [otp, setOtp] = useState(Array(BETA_OTP_LEN).fill(''));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const refs = useRef([]);
  const smsRefs = useRef([]);

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

        {/* Phone Step (Primary) */}
        {step === 'phone' && (
          <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 22, padding: '36px 28px', backdropFilter: 'blur(20px)' }}>
            <div style={{ display: 'inline-block', background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.25)', borderRadius: 999, padding: '3px 12px', fontSize: 11, color: G, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 16 }}>
              🏢 Business Workspace
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
            <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid rgba(255,255,255,0.08)', textAlign: 'center' }}>
              <button onClick={() => { setStep('email'); setError(''); }}
                style={{ background: 'none', border: 'none', color: G, cursor: 'pointer', fontSize: 13, fontWeight: 600, fontFamily: 'inherit', textDecoration: 'underline' }}>
                Or sign in with Email / Beta Code →
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
            <button onClick={() => { setStep('phone'); setError(''); }}
              style={{ background: 'none', border: 'none', color: '#64748b', fontSize: 13, cursor: 'pointer', textDecoration: 'underline' }}>
              Try a different sign in method
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
              <button onClick={() => { setStep('phone'); setError(''); }}
                style={{ background: 'none', border: 'none', color: '#64748b', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', textDecoration: 'underline' }}>
                ← Back to SMS OTP sign in
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
