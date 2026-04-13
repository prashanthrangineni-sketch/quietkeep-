'use client';
// auth/confirm — fallback handler for old magic links still in inboxes
// Primary login is now OTP (6-digit code) on /login — no email links sent anymore
// This page handles: token_hash (old links), access_token in hash (iOS implicit), PKCE code (desktop same-browser)

import { useEffect, useState } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import { useRouter } from 'next/navigation';

// APP_TYPE is baked into the bundle at build time by next.config.js.
// auth/confirm is a fallback handler for old-style magic links.
// It must redirect to the correct dashboard for the current APK variant.
const APP_TYPE = process.env.NEXT_PUBLIC_APP_TYPE || 'personal';
const POST_AUTH_PATH = APP_TYPE === 'business' ? '/b/dashboard' : '/dashboard';
const LOGIN_PATH     = APP_TYPE === 'business' ? '/biz-login'   : '/login';

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
        const hash = window.location.hash.replace(/^#/, '');
        const hashParams = new URLSearchParams(hash);

        const token_hash   = url.searchParams.get('token_hash') || hashParams.get('token_hash');
        const type         = url.searchParams.get('type') || hashParams.get('type') || 'magiclink';
        const access_token = hashParams.get('access_token');
        const refresh_token = hashParams.get('refresh_token');
        const code         = url.searchParams.get('code');

        // PATH 1: token_hash — stateless OTP, works on all devices
        if (token_hash) {
          const { error } = await supabase.auth.verifyOtp({ token_hash, type });
          if (!error) { router.replace(POST_AUTH_PATH); return; }
          setStatus('Login failed: ' + error.message);
          return;
        }

        // PATH 2: access_token in hash — iOS Mail implicit flow
        if (access_token && refresh_token) {
          const { error } = await supabase.auth.setSession({ access_token, refresh_token });
          if (!error) { router.replace(POST_AUTH_PATH); return; }
          setStatus('Login failed: ' + error.message);
          return;
        }

        // PATH 3: PKCE code — desktop only, same-browser session required
        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (!error) { router.replace(POST_AUTH_PATH); return; }
          setStatus('This link expired or was opened in a different browser. Use the sign-in page instead.');
          return;
        }

        setStatus('Invalid or expired link. Please sign in again.');
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
            onClick={() => router.replace(LOGIN_PATH)}
            style={{ marginTop: '20px', background: '#6366f1', border: 'none', color: '#fff', padding: '10px 24px', borderRadius: '8px', cursor: 'pointer', fontSize: '14px', fontWeight: 600 }}>
            Back to Login
          </button>
        )}
      </div>
    </div>
  );
}
