'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';

export default function Login() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const router = useRouter();

  async function handleSendLink() {
    if (!email.trim()) return;
    setLoading(true);
    setError('');

    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: {
        emailRedirectTo: 'https://quietkeep.com/auth/callback',
      },
    });

    setLoading(false);
    if (error) {
      setError(error.message);
    } else {
      setSent(true);
    }
  }

  if (sent) return (
    <div style={{
      minHeight: '100vh', backgroundColor: '#0a0a0f',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '24px',
    }}>
      <div style={{
        maxWidth: '400px', width: '100%', textAlign: 'center',
        backgroundColor: '#0f0f1a', border: '1px solid #1e1e2e',
        borderRadius: '20px', padding: '40px 32px',
      }}>
        <div style={{ fontSize: '48px', marginBottom: '20px' }}>📬</div>
        <h2 style={{ color: '#f1f5f9', fontWeight: '700', fontSize: '22px', margin: '0 0 12px' }}>
          Check your inbox
        </h2>
        <p style={{ color: '#64748b', fontSize: '15px', lineHeight: '1.6', margin: '0 0 24px' }}>
          We sent a magic link to <strong style={{ color: '#a5b4fc' }}>{email}</strong>.<br />
          Click it to sign in — no password needed.
        </p>
        <p style={{ color: '#334155', fontSize: '13px' }}>
          Wrong email?{' '}
          <button onClick={() => { setSent(false); setEmail(''); }}
            style={{ color: '#6366f1', background: 'none', border: 'none', cursor: 'pointer', fontSize: '13px', padding: 0 }}>
            Try again
          </button>
        </p>
      </div>
    </div>
  );

  return (
    <div style={{
      minHeight: '100vh', backgroundColor: '#0a0a0f',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '24px',
    }}>
      <div style={{ maxWidth: '400px', width: '100%' }}>

        <Link href="/" style={{
          display: 'inline-flex', alignItems: 'center', gap: '6px',
          color: '#475569', textDecoration: 'none', fontSize: '14px', marginBottom: '32px',
        }}>
          ← Back to home
        </Link>

        <div style={{
          backgroundColor: '#0f0f1a', border: '1px solid #1e1e2e',
          borderRadius: '20px', padding: '36px 28px',
        }}>
          <div style={{
            width: '48px', height: '48px',
            background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
            borderRadius: '12px', display: 'flex', alignItems: 'center',
            justifyContent: 'center', fontWeight: '800', fontSize: '18px',
            color: '#fff', marginBottom: '24px',
          }}>QK</div>

          <h1 style={{ color: '#f1f5f9', fontSize: '24px', fontWeight: '800', margin: '0 0 8px', letterSpacing: '-0.5px' }}>
            Sign in to QuietKeep
          </h1>
          <p style={{ color: '#64748b', fontSize: '14px', margin: '0 0 28px', lineHeight: '1.5' }}>
            Enter your email and we'll send a magic link.
          </p>

          <label style={{ fontSize: '13px', fontWeight: '600', color: '#94a3b8', display: 'block', marginBottom: '8px' }}>
            Email address
          </label>
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSendLink()}
            placeholder="you@example.com"
            autoFocus
            style={{
              width: '100%', backgroundColor: '#0a0a0f',
              border: '1px solid #1e293b', borderRadius: '10px',
              padding: '12px 14px', color: '#f1f5f9', fontSize: '15px',
              outline: 'none', boxSizing: 'border-box', marginBottom: '12px',
            }}
          />

          {error && (
            <div style={{
              backgroundColor: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
              borderRadius: '8px', padding: '10px 14px', marginBottom: '12px',
              color: '#ef4444', fontSize: '13px',
            }}>
              {error}
            </div>
          )}

          <button
            onClick={handleSendLink}
            disabled={loading || !email.trim()}
            style={{
              width: '100%', backgroundColor: loading || !email.trim() ? '#1a1a2e' : '#6366f1',
              color: loading || !email.trim() ? '#475569' : '#fff',
              border: 'none', borderRadius: '10px', padding: '13px',
              fontSize: '15px', fontWeight: '600',
              cursor: loading || !email.trim() ? 'not-allowed' : 'pointer',
            }}
          >
            {loading ? 'Sending...' : 'Send magic link'}
          </button>

          <p style={{ textAlign: 'center', color: '#334155', fontSize: '12px', marginTop: '20px', marginBottom: 0 }}>
            No password. No tracking. Just your intentions.
          </p>
        </div>
      </div>
    </div>
  );
}
