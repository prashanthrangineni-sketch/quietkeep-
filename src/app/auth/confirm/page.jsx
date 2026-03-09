'use client';
// FIX: Rewritten to handle all mobile/desktop scenarios robustly
// Primary path: token_hash (stateless OTP — works everywhere)
// Fallback: access_token in hash (implicit flow — iOS Mail)
// Last resort: PKCE code (desktop only, same-browser session)

import { useEffect, useState } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import { useRouter } from 'next/navigation';

export default function AuthConfirmPage() {
  const [status, setStatus] = useState('Verifying your link…');
  const router = useRouter();

  useEffect(() => {
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    );

    async function verify() {
      try {
        const url = new URL(window.location.href);

        // Parse both query string and hash fragment
        const hash = window.location.hash.replace(/^#/, '');
        const hashParams = new URLSearchParams(hash);

        const token_hash = url.searchParams.get('token_hash') || hashParams.get('token_hash');
        const type       = url.searchParams.get('type')       || hashParams.get('type') || 'magiclink';
        const access_token  = hashParams.get('access_token');
        const refresh_token = hashParams.get('refresh_token');
        const code       = url.searchParams.get('code');

        // ── PATH 1: token_hash (OTP / magic link — PRIMARY, stateless, works on all devices) ──
        if (token_hash) {
          const { error } = await supabase.auth.verifyOtp({ token_hash, type });
          if (!error) { router.replace('/dashboard'); return; }
          setStatus('Login failed: ' + error.message);
          return;
        }

        // ── PATH 2: access_token in hash (implicit flow — some iOS Mail clients) ──
        if (access_token && refresh_token) {
          const { error } = await supabase.auth.setSession({ access_token, refresh_token });
          if (!error) { router.replace('/dashboard'); return; }
          setStatus('Login failed: ' + error.message);
          return;
        }

        // ── PATH 3: PKCE code exchange (desktop browsers only — same browser session) ──
        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (!error) { router.replace('/dashboard'); return; }
          // PKCE fails cross-browser — give a clear, friendly message instead of error
          setStatus('This link was opened in a different browser. Please request a new magic link.');
          return;
        }

        setStatus('Invalid login link. Please request a new one.');
      } catch (err) {
        setStatus('Something went wrong: ' + (err?.message || String(err)));
      }
    }

    verify();
  }, [router]);

  const isError = !status.startsWith('Verifying');

  return (
    <div style={{ minHeight: '100vh', background: '#0a0a0f', color: '#fff', fontFamily: 'system-ui,sans-serif', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
      <div style={{ width: '100%', maxWidth: '360px', background: '#12121a', borderRadius: '20px', padding: '32px 24px', textAlign: 'center' }}>
        <div style={{ fontSize: '48px', marginBottom: '16px' }}>
          {isError ? '❌' : '🔐'}
        </div>
        <div style={{ fontSize: '16px', color: isError ? '#f87171' : '#888', lineHeight: 1.6 }}>
          {status}
        </div>
        {isError && (
          <button
            onClick={() => router.replace('/login')}
            style={{ marginTop: '20px', background: '#6366f1', border: 'none', color: '#fff', padding: '10px 24px', borderRadius: '8px', cursor: 'pointer', fontSize: '14px', fontWeight: 600 }}>
            Back to Login
          </button>
        )}
      </div>
    </div>
  );
}
