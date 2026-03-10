'use client';
import { useEffect } from 'react';
import { createBrowserClient } from '@supabase/ssr';

export default function WaitlistPage() {
  useEffect(() => {
    // Sign them out silently — they verified email but aren't granted access yet
    const sb = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    );
    sb.auth.signOut();
  }, []);

  return (
    <div style={{
      minHeight: '100dvh',
      background: 'radial-gradient(ellipse at 50% 0%, rgba(99,102,241,0.1) 0%, #0b0f19 60%)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 16, fontFamily: "'Inter',-apple-system,sans-serif",
    }}>
      <div style={{
        width: '100%', maxWidth: 420,
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(255,255,255,0.08)',
        backdropFilter: 'blur(20px)',
        borderRadius: 24, padding: '40px 28px',
        textAlign: 'center',
      }}>
        <div style={{ fontSize: 52, marginBottom: 16 }}>🎉</div>

        <div style={{
          fontSize: 26, fontWeight: 800, letterSpacing: '-0.02em',
          background: 'linear-gradient(135deg, #818cf8, #c4b5fd)',
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
          backgroundClip: 'text', marginBottom: 12,
        }}>
          You&apos;re on the list!
        </div>

        <div style={{ color: '#94a3b8', fontSize: 15, lineHeight: 1.7, marginBottom: 28 }}>
          QuietKeep is in private beta.<br />
          We&apos;ll notify you the moment your access is ready.
        </div>

        <div style={{
          background: 'rgba(99,102,241,0.08)',
          border: '1px solid rgba(99,102,241,0.2)',
          borderRadius: 12, padding: '16px 20px', marginBottom: 28,
        }}>
          <div style={{ fontSize: 13, color: '#a5b4fc', fontWeight: 600, marginBottom: 6 }}>What&apos;s coming for you</div>
          <div style={{ fontSize: 13, color: '#64748b', lineHeight: 1.8, textAlign: 'left' }}>
            ✦ AI-powered daily brief<br />
            ✦ Voice-first keeps & reminders<br />
            ✦ Finance, family & documents<br />
            ✦ Driving mode & emergency contacts
          </div>
        </div>

        <a
          href="https://www.cart2save.com"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: 'block', padding: '12px 20px', marginBottom: 12,
            background: 'linear-gradient(135deg, #6366f1, #818cf8)',
            color: '#fff', borderRadius: 12, fontSize: 14, fontWeight: 700,
            textDecoration: 'none', boxShadow: '0 2px 16px rgba(99,102,241,0.35)',
          }}
        >
          Explore Cart2Save while you wait →
        </a>

        <a
          href="/login"
          style={{ fontSize: 12, color: '#334155', textDecoration: 'none' }}
        >
          ← Back to login
        </a>
      </div>
    </div>
  );
}
