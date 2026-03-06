'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

export default function ProfilePage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState({
    full_name: '',
    persona_type: 'professional',
    language_preference: 'en-IN',
    timezone: 'Asia/Kolkata',
  });

  useEffect(() => {
    loadProfile();
  }, []);

  const loadProfile = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        setUser(session.user);
        const { data, error } = await supabase.from('profiles').select('*').eq('user_id', session.user.id).single();
        
        if (error && error.code !== 'PGRST116') {
          throw error;
        }

        if (data) {
          setProfile(data);
          setFormData({
            full_name: data.full_name || '',
            persona_type: data.persona_type || 'professional',
            language_preference: data.language_preference || 'en-IN',
            timezone: data.timezone || 'Asia/Kolkata',
          });
        }
      }
    } catch (error) {
      console.error('Error loading profile:', error);
      alert('Error loading profile');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveProfile = async () => {
    if (!formData.full_name.trim()) {
      alert('Please enter your name');
      return;
    }

    setSaving(true);
    try {
      const { data, error } = await supabase.from('profiles')
        .upsert({
          user_id: user.id,
          full_name: formData.full_name,
          persona_type: formData.persona_type,
          language_preference: formData.language_preference,
          timezone: formData.timezone,
          updated_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (error) throw error;

      setProfile(data);
      alert('Profile saved successfully!');
    } catch (error) {
      console.error('Error:', error);
      alert('Error saving profile: ' + error.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div style={{ padding: '20px', textAlign: 'center', color: '#94a3b8' }}>Loading...</div>;

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#0a0a0f', color: '#f1f5f9', padding: '20px' }}>
      <div style={{ maxWidth: '600px', margin: '0 auto' }}>
        <div style={{ marginBottom: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h1 style={{ fontSize: '28px', fontWeight: '800', margin: 0 }}>👤 Profile</h1>
          <button onClick={() => router.push('/dashboard')} style={{ backgroundColor: '#6366f1', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: '6px', cursor: 'pointer', fontSize: '12px' }}>
            ← Back
          </button>
        </div>

        <div style={{ backgroundColor: '#0f0f1a', border: '1px solid #1e293b', borderRadius: '14px', padding: '20px' }}>
          <div style={{ marginBottom: '16px' }}>
            <label style={{ fontSize: '12px', color: '#94a3b8', display: 'block', marginBottom: '6px' }}>Full Name</label>
            <input 
              type="text" 
              value={formData.full_name} 
              onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
              style={{ width: '100%', padding: '10px', backgroundColor: '#1a1a2e', border: '1px solid #334155', color: '#f1f5f9', borderRadius: '8px', fontSize: '13px', boxSizing: 'border-box' }}
            />
          </div>

          <div style={{ marginBottom: '16px' }}>
            <label style={{ fontSize: '12px', color: '#94a3b8', display: 'block', marginBottom: '6px' }}>Persona Type</label>
            <select 
              value={formData.persona_type} 
              onChange={(e) => setFormData({ ...formData, persona_type: e.target.value })}
              style={{ width: '100%', padding: '10px', backgroundColor: '#1a1a2e', border: '1px solid #334155', color: '#f1f5f9', borderRadius: '8px', fontSize: '13px', boxSizing: 'border-box' }}
            >
              <option value="professional">Professional</option>
              <option value="homemaker">Homemaker</option>
              <option value="student">Student</option>
              <option value="elderly">Elderly</option>
              <option value="business">Business</option>
            </select>
          </div>

          <div style={{ marginBottom: '16px' }}>
            <label style={{ fontSize: '12px', color: '#94a3b8', display: 'block', marginBottom: '6px' }}>Language Preference</label>
            <select 
              value={formData.language_preference} 
              onChange={(e) => setFormData({ ...formData, language_preference: e.target.value })}
              style={{ width: '100%', padding: '10px', backgroundColor: '#1a1a2e', border: '1px solid #334155', color: '#f1f5f9', borderRadius: '8px', fontSize: '13px', boxSizing: 'border-box' }}
            >
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

          <div style={{ marginBottom: '20px' }}>
            <label style={{ fontSize: '12px', color: '#94a3b8', display: 'block', marginBottom: '6px' }}>Timezone</label>
            <select 
              value={formData.timezone} 
              onChange={(e) => setFormData({ ...formData, timezone: e.target.value })}
              style={{ width: '100%', padding: '10px', backgroundColor: '#1a1a2e', border: '1px solid #334155', color: '#f1f5f9', borderRadius: '8px', fontSize: '13px', boxSizing: 'border-box' }}
            >
              <option value="Asia/Kolkata">IST (India Standard Time)</option>
              <option value="Asia/Kolkata">Asia/Kolkata</option>
              <option value="UTC">UTC</option>
            </select>
          </div>

          <button 
            onClick={handleSaveProfile} 
            disabled={saving}
            style={{ width: '100%', backgroundColor: '#6366f1', color: '#fff', border: 'none', padding: '12px', borderRadius: '8px', cursor: 'pointer', fontSize: '14px', fontWeight: '600', marginBottom: '12px' }}
          >
            {saving ? 'Saving...' : 'Save Profile'}
          </button>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <button 
              onClick={() => router.push('/family')}
              style={{ backgroundColor: '#8b5cf6', color: '#fff', border: 'none', padding: '12px', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: '600' }}
            >
              👨‍👩‍👧 Family
            </button>
            <button 
              onClick={() => router.push('/kids')}
              style={{ backgroundColor: '#ec4899', color: '#fff', border: 'none', padding: '12px', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: '600' }}
            >
              👧 Kids
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
