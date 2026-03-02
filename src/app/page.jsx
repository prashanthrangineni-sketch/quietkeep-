'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';
import Link from 'next/link';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) router.replace('/dashboard');
    });
  }, [router]);

  return (
    <main style={{
      minHeight: '100vh',
      backgroundColor: '#0a0a0f',
      color: '#f1f5f9',
    }}>
      {/* Hero */}
      <section style={{
        maxWidth: '1100px',
        margin: '0 auto',
        padding: '100px 24px 80px',
        textAlign: 'center',
      }}>
        <div style={{
          width: '88px', height: '88px',
          background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
          borderRadius: '22px',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          margin: '0 auto 32px',
          boxShadow: '0 0 48px rgba(99,102,241,0.35)',
        }}>
          <img src="/qk-logo.svg" alt="QuietKeep" style={{ width: '56px', height: '56px', objectFit: 'contain' }}
            onError={e => { e.target.style.display='none'; e.target.parentNode.innerHTML='<span style="font-size:28px;font-weight:800;color:#fff">QK</span>'; }}
          />
        </div>

        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: '8px',
          backgroundColor: 'rgba(99,102,241,0.1)',
          border: '1px solid rgba(99,102,241,0.3)',
          borderRadius: '100px', padding: '6px 16px',
          fontSize: '13px', color: '#a5b4fc', marginBottom: '28px',
        }}>
          <span style={{ width: '6px', height: '6px', backgroundColor: '#22c55e', borderRadius: '50%', display: 'inline-block' }} />
          Now live · Voice-First Personal Keeper
        </div>

        <h1 style={{
          fontSize: 'clamp(38px, 6vw, 68px)',
          fontWeight: '800', lineHeight: '1.1',
          letterSpacing: '-1.5px', margin: '0 0 24px',
          background: 'linear-gradient(135deg, #f1f5f9 0%, #a5b4fc 100%)',
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
        }}>
          Keep Everything.<br />Say It Once.
        </h1>

        <p style={{
          fontSize: '19px', color: '#64748b', lineHeight: '1.65',
          maxWidth: '520px', margin: '0 auto 48px',
        }}>
          QuietKeep is your voice-first vault. Capture notes, tasks, reminders — quietly, securely, instantly.
        </p>

        <div style={{ display: 'flex', gap: '14px', justifyContent: 'center', flexWrap: 'wrap' }}>
          <Link href="/login" style={{
            backgroundColor: '#6366f1', color: '#fff', textDecoration: 'none',
            padding: '14px 32px', borderRadius: '10px', fontSize: '16px', fontWeight: '600',
            boxShadow: '0 4px 24px rgba(99,102,241,0.4)', display: 'inline-block',
          }}>
            Get Started Free →
          </Link>
          <Link href="/dashboard" style={{
            backgroundColor: 'transparent', color: '#94a3b8', textDecoration: 'none',
            padding: '14px 32px', borderRadius: '10px', fontSize: '16px', fontWeight: '600',
            border: '1px solid #1e293b', display: 'inline-block',
          }}>
            My Dashboard
          </Link>
        </div>
      </section>

      {/* Features */}
      <section style={{
        maxWidth: '1100px', margin: '0 auto',
        padding: '20px 24px 100px',
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '18px',
      }}>
        {[
          { icon: '🎙️', title: 'Voice Capture', desc: 'Record thoughts instantly. Auto-transcribed and stored.' },
          { icon: '🔒', title: 'Private & Secure', desc: 'End-to-end encrypted. Your notes belong only to you.' },
          { icon: '⚡', title: 'Smart Recall', desc: 'Search any memory in milliseconds with AI.' },
          { icon: '📱', title: 'PWA Ready', desc: 'Install on any device. Works offline.' },
        ].map((f, i) => (
          <div key={i} style={{
            backgroundColor: '#0f0f1a', border: '1px solid #1e1e2e',
            borderRadius: '16px', padding: '28px',
          }}>
            <div style={{ fontSize: '32px', marginBottom: '14px' }}>{f.icon}</div>
            <h3 style={{ fontSize: '15px', fontWeight: '700', color: '#f1f5f9', margin: '0 0 8px' }}>{f.title}</h3>
            <p style={{ fontSize: '14px', color: '#475569', lineHeight: '1.6', margin: 0 }}>{f.desc}</p>
          </div>
        ))}
      </section>

      <footer style={{
        borderTop: '1px solid #1e1e2e', padding: '28px 24px',
        textAlign: 'center', color: '#334155', fontSize: '13px',
      }}>
        © {new Date().getFullYear()} QuietKeep · Pranix AI Labs Private Limited
      </footer>
    </main>
  );
}
