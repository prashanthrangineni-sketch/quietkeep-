'use client';
import { useState } from 'react';
import { createBrowserClient } from '@supabase/ssr';

function getSupabase() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Check for error param in URL (from failed auth callback)
  if (typeof window !== 'undefined') {
    const params = new URLSearchParams(window.location.search);
    const urlError = params.get('error');
    if (urlError && !error) setError('Magic link expired or already used. Request a new one below.');
  }

  async function sendMagicLink() {
    if (!email.trim()) return;
    setLoading(true);
    setError('');
    const supabase = getSupabase();
    const { error: err } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
        shouldCreateUser: true,
      },
    });
    if (err) {
      setError(err.message);
    } else {
      setSent(true);
    }
    setLoading(false);
  }

  const S = {
    page: { minHeight:'100vh', background:'#0a0a0f', color:'#fff', fontFamily:'system-ui,sans-serif', display:'flex', alignItems:'center', justifyContent:'center', padding:'16px' },
    card: { width:'100%', maxWidth:'360px', background:'#12121a', borderRadius:'20px', padding:'32px 24px' },
    title: { fontSize:'28px', fontWeight:800, background:'linear-gradient(90deg,#818cf8,#c4b5fd)', WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent', marginBottom:'4px' },
    sub: { fontSize:'13px', color:'#666', marginBottom:'28px' },
    label: { fontSize:'12px', color:'#888', fontWeight:600, marginBottom:'6px', display:'block' },
    input: { width:'100%', background:'#1e1e2e', border:'1px solid #333', color:'#fff', padding:'13px', borderRadius:'10px', fontSize:'15px', boxSizing:'border-box', outline:'none' },
    btn: (can: boolean) => ({ width:'100%', padding:'14px', background: can ? 'linear-gradient(90deg,#6366f1,#818cf8)' : '#2a2a3a', border:'none', color: can ? '#fff' : '#666', borderRadius:'10px', fontSize:'15px', fontWeight:700, cursor: can ? 'pointer' : 'not-allowed', marginTop:'12px' }),
    error: { background:'#2a1a1a', border:'1px solid #5a2020', borderRadius:'8px', padding:'10px 12px', fontSize:'12px', color:'#ff8080', marginBottom:'12px' },
    success: { textAlign:'center' },
    successIcon: { fontSize:'48px', marginBottom:'12px' },
    successTitle: { fontSize:'20px', fontWeight:700, marginBottom:'8px' },
    successSub: { fontSize:'13px', color:'#888', lineHeight:'1.6' },
  };

  if (sent) return (
    <div style={S.page}>
      <div style={S.card}>
        <div style={S.success}>
          <div style={S.successIcon}>📬</div>
          <div style={S.successTitle}>Check your email</div>
          <div style={S.successSub}>
            Magic link sent to <strong>{email}</strong>.<br/>
            Click the link in your email to sign in.<br/>
            <span style={{ color:'#555', fontSize:'11px' }}>Link expires in 1 hour. Don't click it twice.</span>
          </div>
          <button onClick={() => { setSent(false); setEmail(''); }} 
            style={{ marginTop:'20px', background:'none', border:'1px solid #333', color:'#888', padding:'8px 16px', borderRadius:'8px', cursor:'pointer', fontSize:'12px' }}>
            Use different email
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div style={S.page}>
      <div style={S.card}>
        <div style={S.title}>QuietKeep</div>
        <div style={S.sub}>Your personal keeper. Sign in with email.</div>
        {error && <div style={S.error}>⚠️ {error}</div>}
        <label style={S.label}>Email address</label>
        <input
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && sendMagicLink()}
          placeholder="you@example.com"
          style={S.input}
          autoFocus
        />
        <button onClick={sendMagicLink} disabled={loading || !email.trim()}
          style={S.btn(email.trim() && !loading)}>
          {loading ? 'Sending...' : 'Send Magic Link →'}
        </button>
      </div>
    </div>
  );
}
