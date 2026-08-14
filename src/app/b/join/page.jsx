'use client';
// src/app/b/join/page.jsx — redeem a staff invite link (/b/join?token=...)
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';

export default function JoinPage() {
  const [status, setStatus] = useState('working'); // working | login | done | error
  const [msg, setMsg] = useState('Joining your workspace…');
  const [signInHref, setSignInHref] = useState('/biz-login');

  useEffect(() => {
    (async () => {
      const token = new URLSearchParams(window.location.search).get('token');
      if (!token) { setStatus('error'); setMsg('This invite link is missing its token.'); return; }

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        // The common case: a new employee who has never used QuietKeep. The
        // Sign in button used to point at a bare /biz-login, so the token was
        // gone by the time they got back and they had to hunt down the
        // original WhatsApp message. Carry it through the detour instead.
        setSignInHref('/biz-login?next=' + encodeURIComponent(`/b/join?token=${token}`));
        setStatus('login');
        setMsg('Sign in to accept this invite — we’ll bring you straight back.');
        return;
      }

      try {
        const res = await fetch('/api/business/team/accept-invite', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({ token }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Could not join the workspace.');
        document.cookie = 'qk_app_mode=business; path=/; max-age=2592000; SameSite=Lax';
        setStatus('done');
        setMsg('You’ve joined the workspace! Taking you in…');
        setTimeout(() => { window.location.href = '/b/dashboard'; }, 1200);
      } catch (e) {
        setStatus('error');
        setMsg(e.message);
      }
    })();
  }, []);

  return (
    <div style={wrap}>
      <div style={card}>
        <div style={{ fontSize: 44, marginBottom: 12 }}>
          {status === 'done' ? '✅' : status === 'error' ? '⚠️' : status === 'login' ? '🔐' : '⏳'}
        </div>
        <h1 style={{ fontSize: 20, fontWeight: 800, margin: '0 0 8px' }}>QuietKeep Business</h1>
        <p style={{ color: '#475569', fontSize: 15, lineHeight: 1.6, margin: 0 }}>{msg}</p>
        {status === 'login' && (
          <Link href={signInHref} style={btn}>Sign in</Link>
        )}
        {status === 'error' && (
          <Link href="/b/dashboard" style={btn}>Go to dashboard</Link>
        )}
      </div>
    </div>
  );
}

const wrap = { minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: 16, background: 'linear-gradient(135deg,#f7f8ff,#ecfdf5)', fontFamily: "'Inter',-apple-system,sans-serif" };
const card = { width: '100%', maxWidth: 400, background: '#fff', border: '1px solid rgba(0,0,0,.08)', borderRadius: 20, padding: '36px 28px', textAlign: 'center', boxShadow: '0 20px 50px rgba(80,90,160,.14)' };
const btn = { display: 'inline-block', marginTop: 18, padding: '11px 22px', borderRadius: 12, background: '#0e9f6e', color: '#fff', fontWeight: 700, textDecoration: 'none' };
