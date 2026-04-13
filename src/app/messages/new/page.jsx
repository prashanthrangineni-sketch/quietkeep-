'use client';
/**
 * src/app/messages/new/page.jsx
 *
 * Find & Connect — Search for QK users by email or handle,
 * then send a connection request.
 */
import { useAuth } from '@/lib/context/auth';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import NavbarClient from '@/components/NavbarClient';
import { apiPost } from '@/lib/safeFetch';
import { supabase } from '@/lib/supabase';

const G = '#6366f1';

export default function NewMessagePage() {
  const router = useRouter();
  const { user, accessToken, loading: authLoading } = useAuth();
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState([]);
  const [searched, setSearched] = useState(false);
  const [sending, setSending] = useState(false);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.replace('/login'); return; }
  }, [authLoading, user]);

  async function handleSearch() {
    const q = query.trim().toLowerCase();
    if (!q) return;
    setSearching(true);
    setResults([]);
    setSearched(false);
    setError('');
    setSuccess('');

    // Search by email or qk_handle
    let profiles = [];
    if (q.includes('@')) {
      const { data } = await supabase
        .from('profiles')
        .select('id, full_name, qk_handle, email, avatar_url')
        .eq('email', q)
        .limit(5);
      profiles = data || [];
    } else {
      const { data } = await supabase
        .from('profiles')
        .select('id, full_name, qk_handle, email, avatar_url')
        .ilike('qk_handle', `%${q}%`)
        .limit(10);
      profiles = data || [];
    }

    // Filter out self
    profiles = profiles.filter(p => p.id !== user?.id);
    setResults(profiles);
    setSearched(true);
    setSearching(false);
  }

  async function sendConnect(profile) {
    setSending(true);
    setError('');
    setSuccess('');

    const payload = profile.email
      ? { receiver_email: profile.email }
      : { receiver_handle: profile.qk_handle };

    const { data, error: err } = await apiPost('/api/qk-connect/request', payload, accessToken);
    setSending(false);

    if (err) {
      if (err.includes('already exists')) {
        setError('Connection already exists with this user.');
      } else {
        setError(err);
      }
      return;
    }

    setSuccess('Request sent!');
  }

  // ── Styles ──
  const inp = {
    width: '100%', background: 'var(--surface)', border: '1px solid var(--border)',
    borderRadius: 10, padding: '10px 14px', color: 'var(--text)',
    fontSize: 14, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box',
  };

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--bg)', color: 'var(--text)', fontFamily: 'system-ui,sans-serif' }}>
      <NavbarClient />
      <div style={{ maxWidth: 540, margin: '0 auto', padding: '5rem 16px 6rem', paddingBottom: 100 }}>
        {/* Back + Header */}
        <button
          onClick={() => router.push('/messages')}
          style={{
            background: 'none', border: 'none', color: '#a5b4fc',
            fontSize: 13, cursor: 'pointer', fontFamily: 'inherit',
            padding: 0, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 4,
          }}
        >
          &larr; Back to Messages
        </button>
        <h1 style={{ fontSize: 22, fontWeight: 800, marginBottom: 4 }}>Find & Connect</h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20 }}>
          Search by email or QK handle to send a connection request.
        </p>

        {/* Search */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <input
            style={{ ...inp, flex: 1 }}
            placeholder="Email or @handle"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSearch()}
          />
          <button
            onClick={handleSearch}
            disabled={searching || !query.trim()}
            style={{
              padding: '0 18px', borderRadius: 10, border: 'none',
              background: query.trim() ? G : 'rgba(255,255,255,0.06)',
              color: query.trim() ? '#fff' : '#475569',
              fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
              opacity: searching ? 0.7 : 1,
            }}
          >
            {searching ? '...' : 'Search'}
          </button>
        </div>

        {/* Error / Success */}
        {error && (
          <div style={{
            padding: '10px 14px', borderRadius: 10, marginBottom: 12,
            background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.2)',
            color: '#f87171', fontSize: 13,
          }}>
            {error}
          </div>
        )}
        {success && (
          <div style={{
            padding: '10px 14px', borderRadius: 10, marginBottom: 12,
            background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.2)',
            color: '#6ee7b7', fontSize: 13, fontWeight: 600,
          }}>
            {success}
          </div>
        )}

        {/* Results */}
        {searched && results.length === 0 && (
          <div style={{ textAlign: 'center', padding: 30, color: 'var(--text-subtle)' }}>
            <div style={{ fontSize: 36, marginBottom: 8, opacity: 0.5 }}>🔍</div>
            <div style={{ fontSize: 14 }}>No QK users found</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
              Make sure the email or handle is correct.
            </div>
          </div>
        )}

        {results.map(profile => {
          const name = profile.full_name || profile.qk_handle || 'QK User';
          const handle = profile.qk_handle ? `@${profile.qk_handle}` : profile.email || '';
          const initial = name.charAt(0).toUpperCase();

          return (
            <div key={profile.id} style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '12px 14px', marginBottom: 6,
              background: 'var(--surface)', border: '1px solid var(--border)',
              borderRadius: 12,
            }}>
              <div style={{
                width: 42, height: 42, borderRadius: '50%',
                background: profile.avatar_url ? 'transparent' : 'rgba(99,102,241,0.2)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 16, fontWeight: 700, color: '#a5b4fc', flexShrink: 0,
                overflow: 'hidden',
              }}>
                {profile.avatar_url
                  ? <img src={profile.avatar_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : initial
                }
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{name}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{handle}</div>
              </div>
              <button
                onClick={() => sendConnect(profile)}
                disabled={sending || !!success}
                style={{
                  padding: '8px 16px', borderRadius: 8, border: 'none',
                  background: success ? 'rgba(16,185,129,0.15)' : G,
                  color: success ? '#6ee7b7' : '#fff',
                  fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                  opacity: sending ? 0.6 : 1,
                }}
              >
                {success ? 'Sent' : sending ? '...' : 'Connect'}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
