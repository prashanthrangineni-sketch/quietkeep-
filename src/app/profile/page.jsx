'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import NavbarClient from '@/components/NavbarClient';

export default function Profile() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState({
    full_name: '',
    avatar_emoji: '👤',
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) { router.replace('/login'); return; }
      setUser(session.user);

      const { data } = await supabase.from('profiles').select('*').eq('user_id', session.user.id).single();
      if (data) setProfile(data);
      setLoading(false);
    });
  }, [router]);

  const handleSaveProfile = async () => {
    if (!profile.full_name.trim()) { alert('Name required'); return; }
    setSaving(true);

    const { error } = await supabase.from('profiles').upsert({
      user_id: user.id,
      full_name: profile.full_name,
      avatar_emoji: profile.avatar_emoji,
    });

    if (!error) alert('Profile saved!');
    setSaving(false);
  };

  if (loading) {
    return (
      <>
        <NavbarClient />
        <div style={{ minHeight: '100vh', backgroundColor: '#0a0a0f', color: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div>Loading...</div>
        </div>
      </>
    );
  }

  return (
    <>
      <NavbarClient />
      <div style={{ minHeight: '100vh', backgroundColor: '#0a0a0f', color: '#f1f5f9', padding: '24px 16px' }}>
        <div style={{ maxWidth: '600px', margin: '0 auto' }}>
          <div style={{ marginBottom: '32px' }}>
            <h1 style={{ fontSize: '32px', fontWeight: '800', margin: '0 0 8px' }}>👤 Profile</h1>
            <div style={{ fontSize: '14px', color: '#94a3b8' }}>{user?.email}</div>
          </div>

          <div style={{ backgroundColor: '#0f0f1a', border: '1px solid #1e293b', borderRadius: '14px', padding: '20px', marginBottom: '20px', textAlign: 'center' }}>
            <div style={{ fontSize: '64px', marginBottom: '12px' }}>{profile.avatar_emoji}</div>
            <div style={{ fontSize: '16px', fontWeight: '700', color: '#e2e8f0' }}>{profile.full_name || 'Add your name'}</div>
          </div>

          <div style={{ backgroundColor: '#0f0f1a', border: '1px solid #1e293b', borderRadius: '14px', padding: '20px', marginBottom: '20px' }}>
            <h3 style={{ fontSize: '14px', fontWeight: '700', margin: '0 0 16px', color: '#f1f5f9' }}>Full Name</h3>
            <input type="text" placeholder="Your name" value={profile.full_name} onChange={(e) => setProfile({ ...profile, full_name: e.target.value })} style={{ width: '100%', backgroundColor: '#1a1a2e', border: '1px solid #334155', color: '#f1f5f9', padding: '10px 12px', borderRadius: '8px', fontSize: '13px', boxSizing: 'border-box' }} />
          </div>

          <button onClick={handleSaveProfile} disabled={saving} style={{ width: '100%', backgroundColor: '#6366f1', color: '#fff', border: 'none', padding: '12px', borderRadius: '8px', fontSize: '14px', fontWeight: '600', cursor: 'pointer' }}>
            {saving ? 'Saving...' : 'Save Profile'}
          </button>
        </div>
      </div>
    </>
  );
}
