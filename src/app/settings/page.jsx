'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

export default function SettingsPage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState({voice_language: 'en-IN', voice_tone: 'calm'});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        setUser(session.user);
        const { data } = await supabase.from('user_settings').select('*').eq('user_id', session.user.id).single();
        if (data) setSettings({voice_language: data.voice_language || 'en-IN', voice_tone: data.voice_tone || 'calm'});
      }
    } catch (error) {
      console.error('Error:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveSettings = async () => {
    setSaving(true);
    try {
      const { error } = await supabase.from('user_settings').upsert({
        user_id: user.id,
        voice_language: settings.voice_language,
        voice_tone: settings.voice_tone,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });

      if (error) throw error;
      alert('Settings saved!');
    } catch (error) {
      alert('Error: ' + error.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div style={{padding: '20px', textAlign: 'center', color: '#94a3b8'}}>Loading...</div>;

  return (
    <div style={{minHeight: '100vh', backgroundColor: '#0a0a0f', color: '#f1f5f9', padding: '20px'}}>
      <div style={{maxWidth: '600px', margin: '0 auto'}}>
        <div style={{marginBottom: '20px', display: 'flex', justifyContent: 'space-between'}}>
          <h1 style={{fontSize: '28px', fontWeight: '800', margin: 0}}>⚙️ Settings</h1>
          <button onClick={() => router.push('/dashboard')} style={{backgroundColor: '#6366f1', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: '6px', cursor: 'pointer', fontSize: '12px'}}>← Back</button>
        </div>

        <div style={{backgroundColor: '#0f0f1a', border: '1px solid #1e293b', borderRadius: '14px', padding: '20px'}}>
          <h2 style={{fontSize: '16px', fontWeight: '700', marginBottom: '16px'}}>Voice Settings</h2>
          <div style={{marginBottom: '16px'}}>
            <label style={{fontSize: '12px', color: '#94a3b8', display: 'block', marginBottom: '6px'}}>Language</label>
            <select value={settings.voice_language} onChange={(e) => setSettings({...settings, voice_language: e.target.value})} style={{width: '100%', padding: '10px', backgroundColor: '#1a1a2e', border: '1px solid #334155', color: '#f1f5f9', borderRadius: '8px', fontSize: '13px', boxSizing: 'border-box'}}>
              <option value="en-IN">English (India)</option>
              <option value="hi-IN">Hindi</option>
              <option value="te-IN">Telugu</option>
              <option value="ta-IN">Tamil</option>
              <option value="kn-IN">Kannada</option>
              <option value="ml-IN">Malayalam</option>
              <option value="mr-IN">Marathi</option>
              <option value="gu-IN">Gujarati</option>
            </select>
          </div>
          <button onClick={handleSaveSettings} disabled={saving} style={{width: '100%', backgroundColor: '#6366f1', color: '#fff', border: 'none', padding: '12px', borderRadius: '8px', cursor: 'pointer', fontSize: '14px', fontWeight: '600'}}>
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      </div>
    </div>
  );
}
