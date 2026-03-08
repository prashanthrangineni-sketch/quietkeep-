'use client';
import { useEffect, useState } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import { useRouter } from 'next/navigation';

export default function AuthConfirmPage() {
  const [status, setStatus] = useState('Verifying your link…');
  const router = useRouter();

  useEffect(() => {
    const url = new URL(window.location.href);
    // Handle fragment (#) for implicit flow — iOS Mail opens with fragment
    const hash = window.location.hash.substring(1);
    const hashParams = new URLSearchParams(hash);
    
    const code = url.searchParams.get('code');
    const token_hash = url.searchParams.get('token_hash') || hashParams.get('token_hash');
    const type = url.searchParams.get('type') || hashParams.get('type') || 'magiclink';
    const access_token = hashParams.get('access_token');
    const refresh_token = hashParams.get('refresh_token');

    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    );

    async function verify() {
      try {
        // Case 1: Fragment-based implicit flow (access_token in hash)
        if (access_token && refresh_token) {
          const { error } = await supabase.auth.setSession({ access_token, refresh_token });
          if (error) { setStatus('Login failed: ' + error.message); return; }
          router.replace('/dashboard');
          return;
        }

        // Case 2: token_hash (OTP / magic link)
        if (token_hash) {
          const { error } = await supabase.auth.verifyOtp({
            token_hash,
            type: type as any,
          });
          if (error) { setStatus('Login failed: ' + error.message); return; }
          router.replace('/dashboard');
          return;
        }

        // Case 3: PKCE code exchange (desktop browsers)
        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) { setStatus('Login failed: ' + error.message); return; }
          router.replace('/dashboard');
          return;
        }

        setStatus('Invalid login link. Please request a new one.');
      } catch (err: any) {
        setStatus('Something went wrong: ' + err.message);
      }
    }

    verify();
  }, [router]);

  const isError = status.startsWith('Login failed') || status.startsWith('Invalid') || status.startsWith('Something');

  return (
    <div style={{ minHeight: '100vh', background: '#0a0a0f', color: '#fff', fontFamily: 'system-ui,sans-serif', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
      <div style={{ width: '100%', maxWidth: '360px', background: '#12121a', borderRadius: '20px', padding: '32px 24px', textAlign: 'center' }}>
        <div style={{ fontSize: '48px', marginBottom: '16px' }}>{isError ? '❌' : '🔐'}</div>
        <div style={{ fontSize: '16px', color: isError ? '#f87171' : '#888', lineHeight: 1.6 }}>{status}</div>
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
