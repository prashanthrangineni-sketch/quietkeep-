'use client';
import { useAuth } from '@/lib/context/auth';
/**
 * src/app/admin/page.jsx
 * FIX: checkAdmin() setLoading(false) was inside if(res.ok) — never fired on 403.
 * → Infinite spinner on every non-admin visit.
 * FIXED: try/catch/finally — setLoading(false) always fires.
 */
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useRouter } from 'next/navigation';
import { safeFetch, apiPost } from '@/lib/safeFetch';

const TIERS = { free: '#64748b', premium: '#6366f1', family: '#22c55e', pro: '#f59e0b' };
const TABS  = ['overview','users','subscriptions','waitlist','feature-flags'];

export default function AdminPage() {
  const { user, accessToken, loading: authLoading } = useAuth();
  const router = useRouter();
  const [isAdmin, setIsAdmin]               = useState(false);
  const [loading, setLoading]               = useState(true);
  const [sectionLoading, setSectionLoading] = useState(false);
  const [tab, setTab]                       = useState('overview');
  const [data, setData]                     = useState(null);
  const [claiming, setClaiming]             = useState(false);
  const [msg, setMsg]                       = useState('');

  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.replace('/login'); return; }
          checkAdmin(accessToken);
  }, [user]);

  async function checkAdmin(token) {
    try {
      const { data: d, error } = await safeFetch('/api/admin?section=overview', { token });
      if (!error && d) { setData(d); setIsAdmin(true); }
    } catch {}
    finally { setLoading(false); }
  }

  async function claimAdmin() {
    setClaiming(true); setMsg('');
    const { data: d, error } = await apiPost('/api/admin', { action: 'seed_admin' }, accessToken);
    if (!error && d) { setMsg('✓ Granted! Reloading…'); setTimeout(() => window.location.reload(), 1500); }
    else setMsg('⚠ ' + (error || 'Failed — check SUPABASE_SERVICE_ROLE_KEY in Vercel.'));
    setClaiming(false);
  }

  const loadSection = useCallback(async (section) => {
    if (!accessToken) return;
    setSectionLoading(true); setData(null);
    const { data } = await safeFetch(`/api/admin?section=${section}`, { token: accessToken });
    if (data) setData(data);
    setSectionLoading(false);
  }, [accessToken]);

  useEffect(() => { if (isAdmin && accessToken) loadSection(tab); }, [tab, isAdmin, accessToken, loadSection]);

  if (loading) return (
    <div style={{ minHeight:'100vh', background:'var(--bg)', display:'flex',
      alignItems:'center', justifyContent:'center', flexDirection:'column', gap:16 }}>
      <div className="qk-spinner" />
      <span style={{ color:'var(--text-subtle)', fontSize:13 }}>Checking admin access…</span>
    </div>
  );

  if (!isAdmin) return (
    <div style={{ minHeight:'100vh', background:'var(--bg)', display:'flex',
      alignItems:'center', justifyContent:'center', padding:20 }}>
      <div style={{ maxWidth:420, width:'100%', textAlign:'center' }}>
        <div style={{ fontSize:48, marginBottom:16 }}>🔐</div>
        <h1 style={{ fontSize:22, fontWeight:800, color:'var(--text)', marginBottom:8 }}>Admin Access Required</h1>
        <p style={{ color:'var(--text-muted)', fontSize:13, marginBottom:8, lineHeight:1.6 }}>
          Signed in as <strong style={{ color:'var(--text)' }}>{user?.email}</strong>
        </p>
        <div style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:10,
          padding:'10px 14px', marginBottom:20, fontSize:12, color:'var(--text-subtle)', textAlign:'left', lineHeight:1.7 }}>
          <strong>Requirements:</strong><br />
          • <code>SUPABASE_SERVICE_ROLE_KEY</code> set in Vercel env vars<br />
          • Your email in the <code>admin_users</code> table
        </div>
        {msg && (
          <div style={{ marginBottom:14, padding:'10px 14px', borderRadius:10, fontSize:13,
            background: msg.startsWith('✓') ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
            border:`1px solid ${msg.startsWith('✓') ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'}`,
            color: msg.startsWith('✓') ? '#22c55e' : '#f87171' }}>{msg}</div>
        )}
        <div style={{ display:'flex', gap:10, justifyContent:'center', flexWrap:'wrap' }}>
          <button onClick={claimAdmin} disabled={claiming}
            style={{ padding:'12px 24px', borderRadius:10, border:'none',
              background: claiming ? 'var(--surface-hover)' : 'var(--primary)',
              color: claiming ? 'var(--text-subtle)' : '#fff',
              fontSize:14, fontWeight:700, cursor: claiming ? 'not-allowed':'pointer', fontFamily:'inherit' }}>
            {claiming ? 'Claiming…' : '🔑 Claim Admin Access'}
          </button>
          <button onClick={() => router.replace('/dashboard')}
            style={{ padding:'12px 20px', borderRadius:10, border:'1px solid var(--border)',
              background:'transparent', color:'var(--text-muted)', fontSize:14, cursor:'pointer', fontFamily:'inherit' }}>
            ← Dashboard
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div style={{ minHeight:'100vh', background:'var(--bg)', color:'var(--text)' }}>
      <div style={{ background:'var(--surface)', borderBottom:'1px solid var(--border)',
        padding:'14px max(16px,calc(50vw - 600px))',
        display:'flex', justifyContent:'space-between', alignItems:'center' }}>
        <div>
          <div style={{ fontSize:18, fontWeight:800 }}>🔐 Admin Panel</div>
          <div style={{ fontSize:11, color:'var(--text-subtle)' }}>{user?.email}</div>
        </div>
        <button onClick={() => router.replace('/dashboard')}
          style={{ padding:'7px 14px', borderRadius:8, border:'1px solid var(--border)',
            background:'transparent', color:'var(--text-muted)', fontSize:13, cursor:'pointer', fontFamily:'inherit' }}>
          ← Back
        </button>
      </div>
      <div style={{ background:'var(--surface)', borderBottom:'1px solid var(--border)',
        padding:'0 max(16px,calc(50vw - 600px))', display:'flex', overflowX:'auto' }}>
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)}
            style={{ padding:'11px 16px', border:'none', background:'transparent',
              color: tab===t ? 'var(--primary)' : 'var(--text-muted)',
              borderBottom:`2px solid ${tab===t ? 'var(--primary)' : 'transparent'}`,
              fontWeight: tab===t ? 700 : 400, fontSize:13,
              cursor:'pointer', fontFamily:'inherit', whiteSpace:'nowrap', textTransform:'capitalize' }}>
            {t.replace('-',' ')}
          </button>
        ))}
      </div>
      <div style={{ padding:'24px max(16px,calc(50vw - 600px))' }}>
        {sectionLoading ? (
          <div style={{ display:'flex', alignItems:'center', gap:12, padding:'40px 0' }}>
            <div className="qk-spinner" />
            <span style={{ color:'var(--text-subtle)', fontSize:13 }}>Loading {tab}…</span>
          </div>
        ) : !data ? (
          <div style={{ color:'var(--text-subtle)', fontSize:14, padding:'40px 0' }}>No data.</div>
        ) : tab === 'overview' ? (
          <OverviewTab data={data} />
        ) : (
          <pre style={{ fontSize:12, color:'var(--text-muted)', background:'var(--surface)',
            border:'1px solid var(--border)', borderRadius:12, padding:16,
            overflowX:'auto', whiteSpace:'pre-wrap', wordBreak:'break-all' }}>
            {JSON.stringify(data, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}

function OverviewTab({ data }) {
  const stats = [
    { label:'Total Users', value:data.total_users    ?? '—', color:'#6366f1' },
    { label:'Active 7d',   value:data.active_7d      ?? '—', color:'#22c55e' },
    { label:'Keeps',       value:data.total_keeps    ?? '—', color:'#f59e0b' },
    { label:'Active Subs', value:data.active_subs    ?? '—', color:'#10b981' },
    { label:'MRR (₹)',     value:data.mrr ? ('₹' + (data.mrr)) : '—', color:'#8b5cf6' },
    { label:'Waitlist',    value:data.waitlist_count ?? '—', color:'#64748b' },
  ];
  return (
    <div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(148px,1fr))',
        gap:12, marginBottom:24 }}>
        {stats.map(s => (
          <div key={s.label} style={{ background:'var(--surface)', border:'1px solid var(--border)',
            borderRadius:12, padding:16, textAlign:'center' }}>
            <div style={{ fontSize:26, fontWeight:900, color:s.color }}>{s.value}</div>
            <div style={{ fontSize:11, color:'var(--text-subtle)', marginTop:4 }}>{s.label}</div>
          </div>
        ))}
      </div>
      {data.recent_users?.length > 0 && (
        <div style={{ background:'var(--surface)', border:'1px solid var(--border)',
          borderRadius:12, overflow:'hidden' }}>
          {data.recent_users.slice(0,10).map((u,i) => (
            <div key={u.id||i} style={{ padding:'10px 14px', display:'flex',
              justifyContent:'space-between', alignItems:'center',
              borderBottom: i < 9 ? '1px solid var(--border)' : 'none' }}>
              <div>
                <div style={{ fontSize:13, fontWeight:600 }}>{u.email}</div>
                <div style={{ fontSize:11, color:'var(--text-subtle)' }}>{u.full_name||'—'}</div>
              </div>
              <span style={{ fontSize:9, fontWeight:700, padding:'2px 7px', borderRadius:999,
                background:`${TIERS[u.subscription_tier]||'#64748b'}20`,
                color:TIERS[u.subscription_tier]||'#64748b', textTransform:'uppercase' }}>
                {u.subscription_tier||'free'}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
