'use client';
/**
 * src/components/BiometricGate.jsx — App-level biometric gate (CARD 51)
 *
 * App lock rules:
 *   • Locks on cold start (if biometric_enabled)
 *   • Locks after app has been in background for > 5 minutes (App 'appStateChange')
 *   • Opt-in, default OFF
 *   • Web/PWA: renders children immediately (no prompt, no block)
 *   • If plugin is missing at runtime, falls back safely so app still opens
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { usePathname } from 'next/navigation';

const PUBLIC_PATH = '/';
const BACKGROUND_LOCK_MS = 5 * 60 * 1000; // 5 minutes

export default function BiometricGate({ children }) {
  const [status, setStatus] = useState('checking'); // checking | unlocked | locked
  const pathname = usePathname();
  const backgroundTimeRef = useRef(null);

  const runGate = useCallback(async () => {
    try {
      const { checkBiometricGate, getBiometricEnabled, isBiometricEnabled } = await import('@/lib/biometricLock');
      const enabled = typeof getBiometricEnabled === 'function' ? await getBiometricEnabled() : isBiometricEnabled();
      if (!enabled) {
        setStatus('unlocked');
        return;
      }
      const allowed = await checkBiometricGate();
      if (allowed) {
        try {
          const { markBiometricVerified } = await import('@/lib/trustState');
          markBiometricVerified();
        } catch {}
      }
      setStatus(allowed ? 'unlocked' : 'locked');
    } catch (e) {
      // QuietKeep must never break: if the plugin is missing at runtime, the app must still open
      console.warn('[BiometricGate] runtime fallback:', e);
      setStatus('unlocked');
    }
  }, []);

  useEffect(() => {
    // Web/PWA: skip biometric check entirely — render children immediately.
    if (typeof window !== 'undefined' && !window.Capacitor?.isNativePlatform?.()) {
      setStatus('unlocked');
      return;
    }

    // Cold start check
    runGate();

    // App state listener via Capacitor App plugin (appStateChange)
    let appStateHandle = null;

    import('@capacitor/app')
      .then(({ App }) => {
        return App.addListener('appStateChange', async ({ isActive }) => {
          if (!isActive) {
            // App went to background
            backgroundTimeRef.current = Date.now();
          } else {
            // App resumed to foreground
            if (backgroundTimeRef.current) {
              const elapsed = Date.now() - backgroundTimeRef.current;
              backgroundTimeRef.current = null;
              if (elapsed >= BACKGROUND_LOCK_MS) {
                const { getBiometricEnabled, isBiometricEnabled } = await import('@/lib/biometricLock');
                const enabled = typeof getBiometricEnabled === 'function' ? await getBiometricEnabled() : isBiometricEnabled();
                if (enabled) {
                  setStatus('checking');
                  runGate();
                }
              }
            }
          }
        });
      })
      .then(handle => {
        appStateHandle = handle;
      })
      .catch(() => {
        // Fallback to visibilitychange if @capacitor/app is not available
        function onVisibilityChange() {
          if (document.visibilityState === 'hidden') {
            backgroundTimeRef.current = Date.now();
          } else if (document.visibilityState === 'visible') {
            if (backgroundTimeRef.current) {
              const elapsed = Date.now() - backgroundTimeRef.current;
              backgroundTimeRef.current = null;
              if (elapsed >= BACKGROUND_LOCK_MS) {
                runGate();
              }
            }
          }
        }
        document.addEventListener('visibilitychange', onVisibilityChange);
      });

    return () => {
      if (appStateHandle && typeof appStateHandle.remove === 'function') {
        appStateHandle.remove();
      }
    };
  }, [runGate]);

  // Checking: render minimal loading state
  if (status === 'checking' && pathname !== PUBLIC_PATH) {
    return (
      <div style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'var(--background, var(--bg))',
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
        background: 'var(--background, var(--bg))',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexDirection: 'column', gap: 16,
      }}>
        <div style={{ fontSize: 48 }}>👆</div>
        <p style={{ color: 'var(--foreground, var(--text))', fontSize: 18, fontWeight: 600 }}>
          QuietKeep is Locked
        </p>
        <p style={{ color: 'var(--muted, #64748b)', fontSize: 13, textAlign: 'center', maxWidth: 260 }}>
          Use your fingerprint or device PIN to unlock
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
