'use client';
/**
 * src/components/BiometricGate.jsx  —  Step 9: App-level biometric gate
 *
 * Drop-in client wrapper. Add to layout.jsx around children (APK only).
 * 
 * Usage in layout.jsx (add inside the body):
 *   import BiometricGate from '@/components/BiometricGate';
 *   // Replace: {children}
 *   // With:    <BiometricGate>{children}</BiometricGate>
 *
 * SAFETY:
 *   • Web/PWA: renders children immediately (no prompt, no block)
 *   • APK: if biometric_enabled=false, renders children immediately
 *   • APK: if biometric_enabled=true, shows lock screen until authenticated
 *   • NEVER modifies Supabase session — only controls UI visibility
 *   • Back button during prompt → stays on lock screen (cannot bypass)
 *   • Deep link → same check runs on mount
 */

import { useEffect, useState, useCallback } from 'react';

export default function BiometricGate({ children }) {
  const [status, setStatus] = useState('checking'); // checking | unlocked | locked

  const runGate = useCallback(async () => {
    try {
      const { checkBiometricGate } = await import('@/lib/biometricLock');
      const allowed = await checkBiometricGate();
      if (allowed) {
        // Notify trustState so sensitive intent layer knows biometric was verified
        try {
          const { markBiometricVerified } = await import('@/lib/trustState');
          markBiometricVerified();
        } catch {}
      }
      setStatus(allowed ? 'unlocked' : 'locked');
    } catch {
      // If biometricLock fails to load (web build), allow through
      setStatus('unlocked');
    }
  }, []);

  useEffect(() => {
    runGate();

    // Re-check on app resume (visibilitychange fires when app comes to foreground)
    function onResume() {
      if (document.visibilityState === 'visible') {
        runGate();
      }
    }
    document.addEventListener('visibilitychange', onResume);
    return () => document.removeEventListener('visibilitychange', onResume);
  }, [runGate]);

  // Checking: render a minimal loading state (avoid flash)
  if (status === 'checking') {
    return (
      <div style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'var(--background, #0f172a)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <div style={{ textAlign: 'center', color: 'var(--muted, #64748b)' }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>🔐</div>
          <div style={{ fontSize: 13 }}>Verifying…</div>
        </div>
      </div>
    );
  }

  // Locked: show lock screen with retry button
  if (status === 'locked') {
    return (
      <div style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'var(--background, #0f172a)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexDirection: 'column', gap: 16,
      }}>
        <div style={{ fontSize: 48 }}>👆</div>
        <p style={{ color: 'var(--foreground, #f8fafc)', fontSize: 18, fontWeight: 600 }}>
          QuietKeep is Locked
        </p>
        <p style={{ color: 'var(--muted, #64748b)', fontSize: 13, textAlign: 'center', maxWidth: 260 }}>
          Use your fingerprint to unlock
        </p>
        <button
          onClick={runGate}
          style={{
            background: 'var(--accent, #6366f1)', color: '#fff',
            border: 'none', borderRadius: 10, padding: '12px 28px',
            fontSize: 14, fontWeight: 600, cursor: 'pointer', marginTop: 8,
          }}
        >
          Try Again
        </button>
      </div>
    );
  }

  // Unlocked: render children normally
  return children;
}
