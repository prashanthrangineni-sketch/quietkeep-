'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import NavbarClient from '@/components/NavbarClient';

const LANGUAGES = [
  { code: 'en-US', label: '🇮🇳 English (India)' },
  { code: 'hi-IN', label: '🇮🇳 हिंदी' },
  { code: 'te-IN', label: '🇮🇳 తెలుగు' },
];

export default function Settings() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [settings, setSettings] = useState({
    voice_language: 'en-US',
    notifications_enabled: true,
    theme: 'dark',
  });
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) { router.replace('/login'); return; }
      setUser(session.user);
      setLoading(false);
    });
  }, [router]);

  const handleSaveSettings = async () => {
    setSaving(true);
    const { error } = await supabase.from('user_settings').upsert({
      user_id: user.id,
      voice_language: settings.voice_language,
      notifications_enabled: settings.notifications_enabled,
      theme: settings.theme,
    });
    if (!error) alert('Settings saved!');
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
            <h1 style={{ fontSize: '32px', fontWeight: '800', margin: '0 0 8px' }}>⚙️ Settings</h1>
            <div style={{ fontSize: '14px', color: '#94a3b8' }}>Customize your experience</div>
          </div>

          <div style={{ backgroundColor: '#0f0f1a', border: '1px solid #1e293b', borderRadius: '14px', padding: '20px', marginBottom: '20px' }}>
            <h3 style={{ fontSize: '14px', fontWeight: '700', margin: '0 0 16px', color: '#f1f5f9' }}>Voice & Language</h3>
            <select value={settings.voice_language} onChange={(e) => setSettings({ ...settings, voice_language: e.target.value })} style={{ width: '100%', backgroundColor: '#1a1a2e', border: '1px solid #334155', color: '#f1f5f9', padding: '10px 12px', borderRadius: '8px', fontSize: '13px', marginBottom: '20px', boxSizing: 'border-box' }}>
              {LANGUAGES.map(lang => <option key={lang.code} value={lang.code}>{lang.label}</option>)}
            </select>
          </div>

          <div style={{ backgroundColor: '#0f0f1a', border: '1px solid #1e293b', borderRadius: '14px', padding: '20px', marginBottom: '20px' }}>
            <h3 style={{ fontSize: '14px', fontWeight: '700', margin: '0 0 16px', color: '#f1f5f9' }}>Notifications</h3>
            <label style={{ display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer', fontSize: '13px' }}>
              <input type="checkbox" checked={settings.notifications_enabled} onChange={(e) => setSettings({ ...settings, notifications_enabled: e.target.checked })} style={{ width: '18px', height: '18px', cursor: 'pointer' }} />
              <span>Enable notifications</span>
            </label>
          </div>

          <div style={{ backgroundColor: '#0f0f1a', border: '1px solid #1e293b', borderRadius: '14px', padding: '20px', marginBottom: '20px' }}>
            <h3 style={{ fontSize: '14px', fontWeight: '700', margin: '0 0 16px', color: '#f1f5f9' }}>Theme</h3>
            <select value={settings.theme} onChange={(e) => setSettings({ ...settings, theme: e.target.value })} style={{ width: '100%', backgroundColor: '#1a1a2e', border: '1px solid #334155', color: '#f1f5f9', padding: '10px 12px', borderRadius: '8px', fontSize: '13px', boxSizing: 'border-box' }}>
              <option value="dark">Dark</option>
              <option value="light">Light</option>
            </select>
          </div>

          <button onClick={handleSaveSettings} disabled={saving} style={{ width: '100%', backgroundColor: '#6366f1', color: '#fff', border: 'none', padding: '12px', borderRadius: '8px', fontSize: '14px', fontWeight: '600', cursor: 'pointer', marginBottom: '20px' }}>
            {saving ? 'Saving...' : 'Save Settings'}
          </button>

          <div style={{ backgroundColor: '#0f0f1a', border: '1px solid #2d1515', borderRadius: '14px', padding: '20px' }}>
            <h3 style={{ fontSize: '13px', fontWeight: '700', color: '#ef4444', margin: '0 0 12px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Danger Zone</h3>
            <button onClick={() => supabase.auth.signOut().then(() => router.replace('/'))} style={{ width: '100%', backgroundColor: 'transparent', border: '1px solid #2d1515', color: '#ef4444', padding: '9px 20px', borderRadius: '8px', fontSize: '13px', cursor: 'pointer', fontWeight: '600' }}>
              Sign Out
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
