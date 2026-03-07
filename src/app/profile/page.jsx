'use client';
import { useEffect, useState } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import NavbarClient from '@/components/NavbarClient';

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

const TIERS = { free: { label: 'Free', color: '#666' }, personal: { label: 'Personal ₹199/mo', color: '#6366f1' }, family: { label: 'Family ₹399/mo', color: '#8b5cf6' }, pro: { label: 'Pro ₹699/mo', color: '#f59e0b' } };

export default function ProfilePage() {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState('');
  const [stats, setStats] = useState({ keeps: 0, reminders: 0, expenses: 0, docs: 0 });

  const [fullName, setFullName] = useState('');
  const [timezone, setTimezone] = useState('Asia/Kolkata');

  useEffect(() => { loadProfile(); }, []);

  async function loadProfile() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { window.location.href = '/login'; return; }
    setUser(user);

    const [profileRes, keepsRes, expensesRes, docsRes] = await Promise.all([
      supabase.from('profiles').select('*').eq('user_id', user.id).single(),
      supabase.from('keeps').select('id', { count: 'exact', head: true }).eq('user_id', user.id),
      supabase.from('expenses').select('id', { count: 'exact', head: true }).eq('user_id', user.id),
      supabase.from('documents').select('id', { count: 'exact', head: true }).eq('user_id', user.id),
    ]);

    if (profileRes.data) {
      setProfile(profileRes.data);
      setFullName(profileRes.data.full_name || '');
      setTimezone(profileRes.data.timezone || 'Asia/Kolkata');
    }

    setStats({
      keeps: keepsRes.count || 0,
      expenses: expensesRes.count || 0,
      docs: docsRes.count || 0,
    });

    setLoading(false);
  }

  async function saveProfile() {
    if (!user) return;
    setSaving(true);

    await supabase.from('profiles').upsert({
      user_id: user.id,
      full_name: fullName,
      timezone,
      onboarding_done: true,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });

    await supabase.from('audit_log').insert({
      user_id: user.id,
      action: 'profile_updated',
      service: 'profile',
      details: { full_name: fullName, timezone },
    });

    setSaving(false);
    setSaved('✓ Saved');
    setTimeout(() => setSaved(''), 2500);
  }

  async function signOut() {
    await supabase.auth.signOut();
    window.location.href = '/login';
  }

  if (loading) return (
    <div style={{ minHeight: '100vh', background: '#0f0f0f', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ color: '#6366f1' }}>Loading profile…</div>
    </div>
  );

  const tier = profile?.subscription_tier || 'free';
  const tierInfo = TIERS[tier] || TIERS.free;

  const initials = (fullName || user?.email || 'U').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);

  return (
    <div style={{ minHeight: '100vh', background: '#0f0f0f', color: '#fff' }}>
      <NavbarClient />
      <div style={{ maxWidth: 560, margin: '0 auto', padding: '2rem 1rem 4rem' }}>

        {/* Avatar + name */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: '2rem' }}>
          <div style={{
            width: 80, height: 80, borderRadius: '50%', background: '#6366f1',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '1.8rem', fontWeight: 700, color: '#fff', marginBottom: '1rem',
          }}>
            {initials}
          </div>
          <h1 style={{ fontSize: '1.4rem', fontWeight: 700, marginBottom: 4 }}>{fullName || user?.email?.split('@')[0]}</h1>
          <div style={{ display: 'inline-block', padding: '3px 12px', borderRadius: 20, background: tierInfo.color + '22', color: tierInfo.color, fontSize: '0.8rem', fontWeight: 600 }}>
            {tierInfo.label}
          </div>
        </div>

        {/* Stats */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.75rem', marginBottom: '2rem' }}>
          {[
            { label: 'Keeps', value: stats.keeps },
            { label: 'Expenses', value: stats.expenses },
            { label: 'Documents', value: stats.docs },
          ].map(s => (
            <div key={s.label} style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 10, padding: '1rem', textAlign: 'center' }}>
              <div style={{ fontSize: '1.6rem', fontWeight: 700, color: '#6366f1' }}>{s.value}</div>
              <div style={{ color: '#666', fontSize: '0.78rem', marginTop: 2 }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* Edit form */}
        <div style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 12, padding: '1.5rem', marginBottom: '1.5rem' }}>
          <h3 style={{ color: '#fff', fontSize: '0.85rem', fontWeight: 600, marginBottom: '1.2rem', textTransform: 'uppercase', letterSpacing: '0.05em', opacity: 0.6 }}>Edit Profile</h3>

          <div style={{ marginBottom: '1rem' }}>
            <label style={{ color: '#aaa', fontSize: '0.82rem', display: 'block', marginBottom: 6 }}>Full Name</label>
            <input
              value={fullName}
              onChange={e => setFullName(e.target.value)}
              placeholder="Your name"
              style={{ width: '100%', background: '#111', border: '1px solid #333', borderRadius: 8, color: '#fff', padding: '0.65rem 0.8rem', fontSize: '0.9rem', outline: 'none', boxSizing: 'border-box' }}
            />
          </div>

          <div style={{ marginBottom: '1rem' }}>
            <label style={{ color: '#aaa', fontSize: '0.82rem', display: 'block', marginBottom: 6 }}>Email</label>
            <div style={{ color: '#555', fontSize: '0.88rem', padding: '0.65rem 0.8rem', background: '#111', border: '1px solid #222', borderRadius: 8 }}>{user?.email}</div>
          </div>

          <div style={{ marginBottom: '1.2rem' }}>
            <label style={{ color: '#aaa', fontSize: '0.82rem', display: 'block', marginBottom: 6 }}>Timezone</label>
            <select
              value={timezone}
              onChange={e => setTimezone(e.target.value)}
              style={{ width: '100%', background: '#111', border: '1px solid #333', borderRadius: 8, color: '#fff', padding: '0.65rem 0.8rem', fontSize: '0.9rem', outline: 'none' }}
            >
              <option value="Asia/Kolkata">Asia/Kolkata (IST)</option>
              <option value="Asia/Dubai">Asia/Dubai (GST)</option>
              <option value="Europe/London">Europe/London (GMT)</option>
              <option value="America/New_York">America/New_York (EST)</option>
            </select>
          </div>

          <button
            onClick={saveProfile}
            disabled={saving}
            style={{ width: '100%', padding: '0.75rem', borderRadius: 8, border: 'none', background: saving ? '#333' : '#6366f1', color: '#fff', fontSize: '0.95rem', fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer' }}
          >
            {saving ? 'Saving…' : saved || 'Save Profile'}
          </button>
        </div>

        {/* Account info */}
        <div style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 12, padding: '1.5rem', marginBottom: '1.5rem' }}>
          <h3 style={{ color: '#fff', fontSize: '0.85rem', fontWeight: 600, marginBottom: '1rem', textTransform: 'uppercase', letterSpacing: '0.05em', opacity: 0.6 }}>Account</h3>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.6rem 0', borderBottom: '1px solid #222' }}>
            <span style={{ color: '#aaa', fontSize: '0.88rem' }}>Plan</span>
            <span style={{ color: tierInfo.color, fontSize: '0.88rem', fontWeight: 600 }}>{tierInfo.label}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.6rem 0', borderBottom: '1px solid #222' }}>
            <span style={{ color: '#aaa', fontSize: '0.88rem' }}>Member since</span>
            <span style={{ color: '#fff', fontSize: '0.88rem' }}>{new Date(user?.created_at).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.6rem 0' }}>
            <span style={{ color: '#aaa', fontSize: '0.88rem' }}>Onboarding</span>
            <span style={{ color: profile?.onboarding_done ? '#22c55e' : '#f59e0b', fontSize: '0.88rem' }}>{profile?.onboarding_done ? 'Complete' : 'Pending'}</span>
          </div>
        </div>

        {/* Sign out */}
        <button
          onClick={signOut}
          style={{ width: '100%', padding: '0.75rem', borderRadius: 8, border: '1px solid #ef4444', background: 'transparent', color: '#ef4444', fontSize: '0.95rem', fontWeight: 600, cursor: 'pointer' }}
        >
          Sign Out
        </button>

      </div>
    </div>
  );
}
