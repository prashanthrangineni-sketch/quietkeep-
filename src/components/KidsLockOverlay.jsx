'use client';
// KidsLockOverlay.jsx — soft PIN lock for Kids Mode
// Uses localStorage for PIN storage (no backend required)
// Controlled by kids_soft_lock feature flag (checked by parent)

import { useState, useEffect, useRef } from 'react';

const PIN_KEY = 'qk_kids_pin';
const LOCK_KEY = 'qk_kids_locked';

export function setKidsLock(enabled) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(LOCK_KEY, enabled ? 'true' : 'false');
}

export function isKidsLocked() {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem(LOCK_KEY) === 'true';
}

export function getStoredPin() {
  return localStorage.getItem(PIN_KEY) || null;
}

export function savePin(pin) {
  localStorage.setItem(PIN_KEY, pin);
}

// PIN Setup modal — shown when Kids Mode is first enabled and no PIN exists
export function PinSetupModal({ onSave, onCancel }) {
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [step, setStep] = useState('set'); // 'set' | 'confirm'
  const [error, setError] = useState('');
  const refs = useRef([]);

  function handleDigit(i, val, arr, setArr) {
    const digit = val.replace(/\D/g, '').slice(-1);
    const next = [...arr]; next[i] = digit; setArr(next.join('').slice(0, 4));
    if (digit && i < 3) refs.current[i + 1 + (step === 'confirm' ? 4 : 0)]?.focus();
    if (next.filter(Boolean).length === 4) {
      if (step === 'set') {
        setStep('confirm');
        setTimeout(() => refs.current[4]?.focus(), 120);
      } else {
        const p = pin; const c = next.join('');
        if (p === c) { savePin(p); onSave(p); }
        else { setError('PINs do not match. Try again.'); setConfirm(''); setStep('set'); setPin(''); setTimeout(() => refs.current[0]?.focus(), 120); }
      }
    }
  }

  const pinArr = pin.split('').concat(Array(4 - pin.length).fill(''));
  const confArr = confirm.split('').concat(Array(4 - confirm.length).fill(''));

  const boxStyle = (filled) => ({
    width: 52, height: 62, textAlign: 'center', fontSize: 26, fontWeight: 700,
    background: filled ? 'rgba(99,102,241,0.15)' : 'rgba(255,255,255,0.04)',
    border: filled ? '2px solid #6366f1' : '1px solid rgba(255,255,255,0.12)',
    borderRadius: 12, color: '#fff', outline: 'none', fontFamily: 'inherit',
    caretColor: 'transparent',
  });

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ background: '#12121a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 24, padding: '36px 28px', maxWidth: 380, width: '100%', textAlign: 'center' }}>
        <div style={{ fontSize: 44, marginBottom: 12 }}>🔒</div>
        <div style={{ fontSize: 20, fontWeight: 700, color: '#fff', marginBottom: 6 }}>Set Kids Lock PIN</div>
        <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.45)', marginBottom: 28, lineHeight: 1.5 }}>
          {step === 'set' ? 'Enter a 4-digit PIN to lock Kids Mode' : 'Confirm your PIN'}
        </div>
        {error && <div style={{ color: '#ef4444', fontSize: 13, marginBottom: 16, background: 'rgba(239,68,68,0.1)', borderRadius: 8, padding: '8px 12px' }}>{error}</div>}

        {/* PIN boxes */}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginBottom: 24 }}>
          {(step === 'set' ? pinArr : confArr).map((d, i) => (
            <input key={i}
              ref={el => { refs.current[i + (step === 'confirm' ? 4 : 0)] = el; }}
              type="password" inputMode="numeric" maxLength={1}
              value={d}
              onChange={e => step === 'set'
                ? handleDigit(i, e.target.value, pinArr, setPin)
                : handleDigit(i, e.target.value, confArr, setConfirm)
              }
              style={boxStyle(!!d)}
              autoFocus={i === 0 && step === 'set'}
            />
          ))}
        </div>

        <button onClick={onCancel} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.35)', cursor: 'pointer', fontSize: 13, fontFamily: 'inherit' }}>
          Cancel (Kids Mode won't be locked)
        </button>
      </div>
    </div>
  );
}

// Main lock overlay — shown when kids mode is active and user tries to exit
export default function KidsLockOverlay({ onUnlock }) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [attempts, setAttempts] = useState(0);
  const [cooldown, setCooldown] = useState(0);
  const refs = useRef([]);

  useEffect(() => {
    if (cooldown > 0) {
      const t = setTimeout(() => setCooldown(c => c - 1), 1000);
      return () => clearTimeout(t);
    }
  }, [cooldown]);

  const pinArr = pin.split('').concat(Array(4 - pin.length).fill(''));

  function handleDigit(i, val) {
    if (cooldown > 0) return;
    const digit = val.replace(/\D/g, '').slice(-1);
    const next = pin + digit;
    setPin(next.slice(0, 4));
    if (digit && i < 3) refs.current[i + 1]?.focus();

    if (next.length === 4) {
      const stored = getStoredPin();
      if (next === stored) {
        setKidsLock(false);
        onUnlock?.();
      } else {
        const newAttempts = attempts + 1;
        setAttempts(newAttempts);
        setError(newAttempts >= 3 ? 'Too many attempts. Wait 30s.' : 'Wrong PIN. Try again.');
        setPin('');
        if (newAttempts >= 3) { setCooldown(30); setAttempts(0); }
        setTimeout(() => refs.current[0]?.focus(), 100);
      }
    }
  }

  function handleKey(i, e) {
    if (e.key === 'Backspace') {
      const next = pin.slice(0, -1);
      setPin(next);
      if (i > 0) refs.current[i - 1]?.focus();
    }
  }

  const boxStyle = (filled) => ({
    width: 58, height: 70, textAlign: 'center', fontSize: 32, fontWeight: 700,
    background: filled ? 'rgba(99,102,241,0.15)' : 'rgba(255,255,255,0.04)',
    border: filled ? '2px solid #6366f1' : '1px solid rgba(255,255,255,0.12)',
    borderRadius: 14, color: '#fff', outline: 'none', fontFamily: 'inherit',
    caretColor: 'transparent',
    boxShadow: filled ? '0 0 0 3px rgba(99,102,241,0.15)' : 'none',
    opacity: cooldown > 0 ? 0.5 : 1,
  });

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9998,
      background: 'linear-gradient(135deg, #0a0a14, #0d0a18)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      padding: 24, fontFamily: 'system-ui, sans-serif',
    }}>
      {/* Lock icon */}
      <div style={{ fontSize: 64, marginBottom: 8 }}>🔒</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: '#fff', marginBottom: 4, letterSpacing: '-0.02em' }}>Kids Mode Active</div>
      <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.4)', marginBottom: 36, textAlign: 'center', lineHeight: 1.5 }}>
        Enter your PIN to exit Kids Mode
      </div>

      {/* Error / Cooldown */}
      {(error || cooldown > 0) && (
        <div style={{ color: '#ef4444', fontSize: 13, marginBottom: 20, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 10, padding: '10px 16px', textAlign: 'center' }}>
          {cooldown > 0 ? `⏳ Wait ${cooldown}s before trying again` : `⚠️ ${error}`}
        </div>
      )}

      {/* PIN input boxes */}
      <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
        {pinArr.map((d, i) => (
          <input key={i}
            ref={el => { refs.current[i] = el; }}
            type="password" inputMode="numeric" maxLength={1}
            value={d}
            onChange={e => handleDigit(i, e.target.value)}
            onKeyDown={e => handleKey(i, e)}
            disabled={cooldown > 0}
            autoFocus={i === 0}
            style={boxStyle(!!d)}
          />
        ))}
      </div>

      <div style={{ marginTop: 40, fontSize: 12, color: 'rgba(255,255,255,0.2)', textAlign: 'center' }}>
        QuietKeep Kids Safe Zone
      </div>
    </div>
  );
}
