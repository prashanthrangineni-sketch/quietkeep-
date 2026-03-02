'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import Link from 'next/link';

const LANGUAGES = [
  { code: 'en-IN', label: '🇮🇳 English (India)' },
  { code: 'hi-IN', label: '🇮🇳 हिंदी (Hindi)' },
  { code: 'te-IN', label: '🇮🇳 తెలుగు (Telugu)' },
  { code: 'ta-IN', label: '🇮🇳 தமிழ் (Tamil)' },
  { code: 'kn-IN', label: '🇮🇳 ಕನ್ನಡ (Kannada)' },
  { code: 'ml-IN', label: '🇮🇳 മലയാളം (Malayalam)' },
  { code: 'bn-IN', label: '🇮🇳 বাংলা (Bengali)' },
  { code: 'mr-IN', label: '🇮🇳 मराठी (Marathi)' },
  { code: 'gu-IN', label: '🇮🇳 ગુજરાતી (Gujarati)' },
  { code: 'pa-IN', label: '🇮🇳 ਪੰਜਾਬੀ (Punjabi)' },
];

const PERSONAS = [
  { value: 'professional', label: '👔 Professional', desc: 'Work, meetings, travel' },
  { value: 'homemaker', label: '🏠 Homemaker', desc: 'Family, groceries, events' },
  { value: 'student', label: '🎓 Student', desc: 'Study, exams, goals' },
  { value: 'business', label: '💼 Business Owner', desc: 'Clients, payments, orders' },
  { value: 'elderly', label: '👴 Elderly / Caregiver', desc: 'Medicines, appointments' },
];

export default function Settings() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState({});
  const [voiceSettings, setVoiceSettings] = useState({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('profile');

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) { router.replace('/login'); return; }
      setUser(session.user);

      const [{ data: prof }, { data: vs }] = await Promise.all([
        supabase.from('profiles').select('*').eq('user_id', session.user.id).single(),
        supabase.from('user_settings').select('*').eq('user_id', session.user.id).single(),
      ]);
      if (prof) setProfile(prof);
      if (vs) setVoiceSettings(vs);
      setLoading(false);
    });
  }, [router]);

  async function handleSave() {
    setSaving(true);
    const uid = user.id;

    await Promise.all([
      supabase.from('profiles').upsert({
        user_id: uid,
        full_name: profile.full_name,
        persona_type: profile.persona_type || 'professional',
        language_preference: profile.language_preference || 'en-IN',
        timezone: 'Asia/Kolkata',
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' }),

      supabase.from('user_settings').upsert({
        user_id: uid,
        voice_input_enabled: voiceSettings.voice_input_enabled ?? true,
        voice_language: profile.language_preference || 'en-IN',
        voice_tone: voiceSettings.voice_tone || 'calm',
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' }),

      supabase.from('audit_log').insert([{
        user_id: uid, action: 'settings_updated', service: 'settings',
        details: { persona_type: profile.persona_type, language: profile.language_preference },
      }]),
    ]);

    setSaving(false); setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  const card = { backgroundColor: '#0f0f1a', border: '1px solid #1e1e2e', borderRadius: '14px', padding: '20px', marginBottom: '16px' };
  const label = { fontSize: '11px', color: '#475569', display: 'block', marginBottom: '6px', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.05em' };
  const input = { width: '100%', backgroundColor: '#0a0a0f', border: '1px solid #1e293b', borderRadius: '8px', padding: '10px 12px', color: '#f1f5f9', fontSize: '14px', outline: 'none', boxSizing: 'border-box' };

  if (loading) return (
    <div style={{ minHeight: '100vh', backgroundColor: '#0a0a0f', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6366f1' }}>Loading settings...</div>
  );

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#0a0a0f', color: '#f1f5f9' }}>
      <div style={{ borderBottom: '1px solid #1e1e2e', padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <Link href="/dashboard" style={{ color: '#475569', textDecoration: 'none', fontSize: '13px' }}>← Dashboard</Link>
          <span style={{ color: '#1e293b' }}>|</span>
          <span style={{ fontWeight: '700', color: '#f1f5f9' }}>⚙️ Settings</span>
        </div>
        <button onClick={handleSave} disabled={saving} style={{
          backgroundColor: saving ? '#1a1a2e' : '#6366f1', color: saving ? '#475569' : '#fff',
          border: 'none', padding: '8px 20px', borderRadius: '8px', fontSize: '13px',
          fontWeight: '600', cursor: saving ? 'not-allowed' : 'pointer',
        }}>
          {saved ? '✅ Saved!' : saving ? 'Saving...' : 'Save Changes'}
        </button>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '2px', padding: '12px 20px', borderBottom: '1px solid #1e1e2e', overflowX: 'auto' }}>
        {[
          { key: 'profile', label: '👤 Profile' },
          { key: 'voice', label: '🎙️ Voice & Language' },
          { key: 'notifications', label: '🔔 Notifications' },
          { key: 'privacy', label: '🔒 Privacy' },
        ].map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)} style={{
            backgroundColor: activeTab === tab.key ? '#6366f1' : 'transparent',
            color: activeTab === tab.key ? '#fff' : '#64748b',
            border: activeTab === tab.key ? 'none' : '1px solid #1e293b',
            padding: '7px 16px', borderRadius: '8px', fontSize: '13px',
            fontWeight: '600', cursor: 'pointer', whiteSpace: 'nowrap',
          }}>{tab.label}</button>
        ))}
      </div>

      <div style={{ maxWidth: '620px', margin: '0 auto', padding: '24px 20px' }}>

        {activeTab === 'profile' && (
          <>
            <div style={card}>
              <h3 style={{ fontSize: '13px', fontWeight: '700', color: '#6366f1', margin: '0 0 16px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Personal Details</h3>
              <div style={{ marginBottom: '14px' }}>
                <label style={label}>Full Name</label>
                <input style={input} value={profile.full_name || ''} onChange={e => setProfile(p => ({ ...p, full_name: e.target.value }))} placeholder="Your name" />
              </div>
              <div>
                <label style={label}>Email</label>
                <input style={{ ...input, opacity: 0.5 }} value={user?.email || ''} readOnly />
              </div>
            </div>

            <div style={card}>
              <h3 style={{ fontSize: '13px', fontWeight: '700', color: '#6366f1', margin: '0 0 16px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>I am a...</h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                {PERSONAS.map(p => (
                  <button key={p.value} onClick={() => setProfile(pr => ({ ...pr, persona_type: p.value }))} style={{
                    backgroundColor: profile.persona_type === p.value ? 'rgba(99,102,241,0.15)' : '#0a0a0f',
                    border: `1px solid ${profile.persona_type === p.value ? '#6366f1' : '#1e293b'}`,
                    borderRadius: '10px', padding: '12px', cursor: 'pointer', textAlign: 'left',
                  }}>
                    <div style={{ fontSize: '14px', fontWeight: '700', color: '#f1f5f9', marginBottom: '2px' }}>{p.label}</div>
                    <div style={{ fontSize: '11px', color: '#475569' }}>{p.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            <div style={card}>
              <h3 style={{ fontSize: '13px', fontWeight: '700', color: '#6366f1', margin: '0 0 16px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Subscription</h3>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontSize: '15px', fontWeight: '700', color: '#f1f5f9' }}>
                    {profile.subscription_tier === 'free' ? '🆓 Free Plan' :
                     profile.subscription_tier === 'personal' ? '⭐ Personal' :
                     profile.subscription_tier === 'family' ? '👨‍👩‍👧 Family' : '💼 Pro'}
                  </div>
                  <div style={{ fontSize: '12px', color: '#475569', marginTop: '2px' }}>
                    {profile.subscription_tier === 'free' ? '50 keeps/month · English only' : 'Unlimited · All languages'}
                  </div>
                </div>
                {profile.subscription_tier === 'free' && (
                  <button style={{ backgroundColor: '#6366f1', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: '8px', fontSize: '12px', fontWeight: '600', cursor: 'pointer' }}>
                    Upgrade ↗
                  </button>
                )}
              </div>
            </div>
          </>
        )}

        {activeTab === 'voice' && (
          <>
            <div style={card}>
              <h3 style={{ fontSize: '13px', fontWeight: '700', color: '#6366f1', margin: '0 0 16px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Voice Language</h3>
              <label style={label}>Preferred Language for Voice</label>
              <select value={profile.language_preference || 'en-IN'} onChange={e => setProfile(p => ({ ...p, language_preference: e.target.value }))}
                style={{ ...input }}>
                {LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
              </select>
              <p style={{ fontSize: '11px', color: '#334155', marginTop: '8px' }}>
                Indian languages use Sarvam AI (80%+ accuracy). Requires Personal plan or above.
              </p>
            </div>

            <div style={card}>
              <h3 style={{ fontSize: '13px', fontWeight: '700', color: '#6366f1', margin: '0 0 16px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Voice Settings</h3>
              {[
                { key: 'voice_input_enabled', label: 'Enable Voice Capture', desc: 'Show microphone button in keeps' },
              ].map(item => (
                <div key={item.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
                  <div>
                    <div style={{ fontSize: '14px', color: '#f1f5f9', fontWeight: '500' }}>{item.label}</div>
                    <div style={{ fontSize: '11px', color: '#475569' }}>{item.desc}</div>
                  </div>
                  <button onClick={() => setVoiceSettings(v => ({ ...v, [item.key]: !v[item.key] }))} style={{
                    width: '44px', height: '24px', borderRadius: '12px', border: 'none', cursor: 'pointer',
                    backgroundColor: voiceSettings[item.key] ? '#6366f1' : '#1e293b',
                    position: 'relative', transition: 'background-color 0.2s',
                  }}>
                    <span style={{
                      position: 'absolute', top: '3px',
                      left: voiceSettings[item.key] ? '22px' : '3px',
                      width: '18px', height: '18px', borderRadius: '50%',
                      backgroundColor: '#fff', transition: 'left 0.2s',
                      display: 'block',
                    }} />
                  </button>
                </div>
              ))}

              <div>
                <label style={label}>Voice Tone</label>
                <select value={voiceSettings.voice_tone || 'calm'} onChange={e => setVoiceSettings(v => ({ ...v, voice_tone: e.target.value }))} style={input}>
                  <option value="calm">😌 Calm</option>
                  <option value="professional">💼 Professional</option>
                  <option value="friendly">😊 Friendly</option>
                  <option value="energetic">⚡ Energetic</option>
                </select>
              </div>
            </div>
          </>
        )}

        {activeTab === 'notifications' && (
          <div style={card}>
            <h3 style={{ fontSize: '13px', fontWeight: '700', color: '#6366f1', margin: '0 0 16px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Notification Preferences</h3>
            <p style={{ fontSize: '13px', color: '#475569', lineHeight: '1.6' }}>
              Reminder emails are sent to <strong style={{ color: '#a5b4fc' }}>{user?.email}</strong> when your set reminder time arrives.
            </p>
            <div style={{ marginTop: '16px', padding: '12px', backgroundColor: '#0a0a0f', borderRadius: '8px', border: '1px solid #1e293b' }}>
              <div style={{ fontSize: '12px', color: '#64748b' }}>🔜 Push notifications coming in next update</div>
            </div>
          </div>
        )}

        {activeTab === 'privacy' && (
          <div style={card}>
            <h3 style={{ fontSize: '13px', fontWeight: '700', color: '#6366f1', margin: '0 0 16px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Privacy & Data</h3>
            {[
              { icon: '🔒', title: 'Your data is private', desc: 'All keeps are protected by Row Level Security. Only you can access your data.' },
              { icon: '🚫', title: 'No data resale', desc: 'QuietKeep never sells your data to advertisers or third parties.' },
              { icon: '📋', title: 'Full audit trail', desc: 'Every action in your account is logged and visible to you.' },
              { icon: '🎙️', title: 'No background listening', desc: 'Voice capture is push-to-talk only. No continuous microphone access.' },
              { icon: '✅', title: 'No auto-execution', desc: 'QuietKeep never takes action without your explicit confirmation.' },
            ].map((item, i) => (
              <div key={i} style={{ display: 'flex', gap: '12px', marginBottom: '14px' }}>
                <span style={{ fontSize: '20px', flexShrink: 0 }}>{item.icon}</span>
                <div>
                  <div style={{ fontSize: '13px', fontWeight: '600', color: '#f1f5f9', marginBottom: '2px' }}>{item.title}</div>
                  <div style={{ fontSize: '12px', color: '#475569', lineHeight: '1.5' }}>{item.desc}</div>
                </div>
              </div>
            ))}
            <div style={{ marginTop: '16px', borderTop: '1px solid #1e293b', paddingTop: '16px' }}>
              <button onClick={() => supabase.auth.signOut().then(() => router.replace('/'))} style={{
                backgroundColor: 'transparent', border: '1px solid #2d1515', color: '#ef4444',
                padding: '9px 20px', borderRadius: '8px', fontSize: '13px', cursor: 'pointer',
              }}>Sign Out of All Devices</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
            }
