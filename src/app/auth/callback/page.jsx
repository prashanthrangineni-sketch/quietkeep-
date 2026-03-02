'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

export default function AuthCallback() {
  const router = useRouter();
  const [status, setStatus] = useState('Verifying your magic link...');

  useEffect(() => {
    let mounted = true;

    async function handleCallback() {
      await new Promise(r => setTimeout(r, 800));
      const { data: { session } } = await supabase.auth.getSession();

      if (!mounted) return;

      if (session) {
        setStatus('Signed in! Taking you to your dashboard...');
        setTimeout(() => router.replace('/dashboard'), 600);
        return;
      }

      const { data: { subscription } } = supabase.auth.onAuthStateChange((event, newSession) => {
        if (!mounted) return;
        if ((event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') && newSession) {
          setStatus('Signed in! Taking you to your dashboard...');
          subscription.unsubscribe();
          setTimeout(() => router.replace('/dashboard'), 600);
        }
      });

      setTimeout(() => {
        if (!mounted) return;
        setStatus('Something went wrong. Redirecting to login...');
        setTimeout(() => router.replace('/login'), 1500);
      }, 5000);

      return () => subscription.unsubscribe();
    }

    handleCallback();
    return () => { mounted = false; };
  }, [router]);

  return (
    <div style={{
      minHeight: '100vh', backgroundColor: '#0a0a0f',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexDirection: 'column', gap: '20px',
    }}>
      <div style={{
        width: '48px', height: '48px',
        background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
        borderRadius: '12px', display: 'flex', alignItems: 'center',
        justifyContent: 'center', fontSize: '20px', fontWeight: '800', color: '#fff',
      }}>QK</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: '#94a3b8', fontSize: '15px' }}>
        <span style={{
          width: '16px', height: '16px', border: '2px solid #6366f1',
          borderTopColor: 'transparent', borderRadius: '50%',
          display: 'inline-block', animation: 'spin 0.8s linear infinite',
        }} />
        {status}
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
