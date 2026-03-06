'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

export default function SettingsPage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState({
    voice_language: 'en-IN',
    voice_tone: 'calm',
    theme: 'dark',
  });
  const [saving, setSaving] = useState(false);

  const LANGUAGES = [
    { value: 'en-IN', label: 'English (India)' },
    { value: 'hi-IN', label: 'Hindi' },
    { value: 'te-IN', label: 'Telugu' },
    { value: 'ta-IN', label: 'Tamil' },
    { value: 'kn-IN', label: 'Kannada' },
    { value: 'ml-IN', label: 'Malayalam' },
    { value: 'mr-IN', label: 'Marathi' },
    { value: 'gu-IN', label: 'Gujarati' },
  ];

  const TONES = [
    { value: 'calm', label: 'Calm' },
    { value: 'energetic', label: 'Energetic' },
    { value: 'professional', label: 'Professional' },
  ];

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        setUser(session.user);
        const { data, error } = await supabase
          .from('user_settings')
          .select('*')
          .eq('user_id', session.user.id)
          .single();

        if (error && error.code !== 'PGRST116') throw error;

        if (data) {
          setSettings({
            voice_language: data.voice_language || 'en-IN',
            voice_tone: data.voice_tone || 'calm',
            theme: 'dark',
          });
        }
      }
    } catch (error) {
      console.error('Error loading settings:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveSettings = async () => {
    setSaving(true);
    try {
      const { error } = await supabase
        .from('user_settings')
        .upsert({
          user_id: user.id,
          voice_language: settings.voice_language,
          voice_tone: settings.voice_tone,
          settings: { theme: settings.theme },
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', user.id);

      if (error) throw error;
      alert('Settings saved successfully!');
    } catch (error) {
      console.error('Error:', error);
      alert('Error saving settings: ' + error.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (!confirm('Are you sure? This action cannot be undone.')) return;
    if (!confirm('This will permanently delete your account and all data. Continue?')) return;

    try {
      await supabase.auth.signOut();
      await supabase.auth.admin.deleteUser(user.id);
      router.push('/login');
    } catch (error) {
      alert('Error deleting account: ' + error.message);
    }
  };

  if (loading) return <div style={{ padding: '20px', textAlign: 'center', color: '#94a3b8' }}>Loading...</div>;

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#0a0a0f', color: '#f1f5f9', padding: '20px' }}>
      <div style={{ maxWidth: '600px', margin: '0 auto' }}>
        <div style={{ marginBottom: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h1 style={{ fontSize: '28px', fontWeight: '800', margin: 0 }}>⚙️ Settings</h1>
          <button onClick={() => router.push('/dashboard')} style={{ backgroundColor: '#6366f1', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: '6px', cursor: 'pointer', fontSize: '12px' }}>
            ← Back
          </button>
        </div>

        <div style={{ backgroundColor: '#0f0f1a', border: '1px solid #1e293b', borderRadius: '14px', padding: '20px', marginBottom: '20px' }}>
          <h2 style={{ fontSize: '16px', fontWeight: '700', marginBottom: '16px' }}>Voice Settings</h2>

          <div style={{ marginBottom: '16px' }}>
            <label style={{ fontSize: '12px', color: '#94a3b8', display: 'block', marginBottom: '6px' }}>Language</label>
            <select 
              value={settings.voice_language}
              onChange={(e) => setSettings({ ...settings, voice_language: e.target.value })}
              style={{ width: '100%', padding: '10px', backgroundColor: '#1a1a2e', border: '1px solid #334155', color: '#f1f5f9', borderRadius: '8px', fontSize: '13px', boxSizing: 'border-box' }}
            >
              {LANGUAGES.map(lang => (<option key={lang.value} value={lang.value}>{lang.label}</option>))}
            </select>
          </div>

          <div style={{ marginBottom: '20px' }}>
            <label style={{ fontSize: '12px', color: '#94a3b8', display: 'block', marginBottom: '6px' }}>Voice Tone</label>
            <select 
              value={settings.voice_tone}
              onChange={(e) => setSettings({ ...settings, voice_tone: e.target.value })}
              style={{ width: '100%', padding: '10px', backgroundColor: '#1a1a2e', border: '1px solid #334155', color: '#f1f5f9', borderRadius: '8px', fontSize: '13px', boxSizing: 'border-box' }}
            >
              {TONES.map(tone => (<option key={tone.value} value={tone.value}>{tone.label}</option>))}
            </select>
          </div>

          <button 
            onClick={handleSaveSettings}
            disabled={saving}
            style={{ width: '100%', backgroundColor: '#6366f1', color: '#fff', border: 'none', padding: '12px', borderRadius: '8px', cursor: 'pointer', fontSize: '14px', fontWeight: '600' }}
          >
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>

        <div style={{ backgroundColor: '#1a1a2e', border: '1px solid #ef4444', borderRadius: '14px', padding: '20px' }}>
          <h2 style={{ fontSize: '16px', fontWeight: '700', color: '#ef4444', marginBottom: '8px' }}>⚠️ Danger Zone</h2>
          <p style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '16px' }}>Permanently delete your account and all associated data. This action cannot be undone.</p>
          <button 
            onClick={handleDeleteAccount}
            style={{ width: '100%', backgroundColor: '#ef4444', color: '#fff', border: 'none', padding: '12px', borderRadius: '8px', cursor: 'pointer', fontSize: '14px', fontWeight: '600' }}
          >
            Delete Account
          </button>
        </div>
      </div>
    </div>
  );
}
