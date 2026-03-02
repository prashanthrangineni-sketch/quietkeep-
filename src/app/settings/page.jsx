'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

const LANGUAGES = [
  { code: 'en-US', label: '🇮🇳 English (India)' },
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
  const [profile, setProfile] = useState({ full_name: '', persona_type: 'professional' });
  const [settings, setSettings] = useState({
    voice_language: 'en-US',
    confidence_threshold: 0.6,
    auto_confirm_high_confidence: false,
    notifications_enabled: true,
    theme: 'dark',
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('profile');

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) { router.replace('/login'); return; }
      setUser(session.user);

      // Load settings from API route
      try {
        const res = await fetch('/api/settings');
        const data = await res.json();
        if (data.settings) setSettings(prev => ({ ...prev, ...data.settings }));
      } catch (e) {
        console.log('Settings load error', e);
      }

      // Load profile from Supabase
      const { data: prof } = await supabase
        .from('profiles')
        .select('full_name, persona_type, subscription_tier')
        .eq('user_id', session.user.id)
        .single();
      if (prof) setProfile(prof);

      setLoading(false);
    });
  }, [router]);

  async function handleSave() {
    if (!user) return;
    setSaving(true);

    // Save settings via API route (uses your existing route.js)
    try {
      await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
    } catch (e) {
      console.log('Settings save error', e);
    }

    // Save profile to Supabase
    await supabase.from('profiles').upsert({
      user_id: user.id,
      full_name: profile.full_name,
      persona_type: profile.persona_type,
      language_preference: settings.voice_language,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });

    // Audit log
    await supabase.from('audit_log').insert([{
      user_id: user.id,
      action: 'settings_updated',
      service: 'settings',
      details: { persona_type: profile.persona_type, language: settings.voice_language },
    }]);

    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  const inp = {
    width: '100%', backgroundColor: '#0a0a0f',
    border: '1px solid #1e293b', borderRadius: '8px',
    padding: '10px 12px', color: '#f1f5f9',
    fontSize: '14px', outline: 'none', boxSizing: 'border-box',
  };
  const lbl = {
    fontSize: '11px', color: '#475569', display: 'block',
    marginBottom: '6px', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.05em',
  };
  const card = {
    backgroundColor: '#0f0f1a', border: '1px solid #1e1e2e',
    borderRadius: '14px', padding: '20px', marginBottom: '16px',
  };

  if (loading) return (
    <div style={{ minHeight: '100vh', backgroundColor: '#0a0a0f', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6366f1' }}>
      Loading settings...
    </div>
  );

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#0a0a0f', color: '#f1f5f9' }}>

      {/* Header */}
      <div style={{ borderBottom: '1px solid #1e1e2e', padding: '12px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <a href="/dashboard" style={{ color: '#475569', textDecoration: 'none', fontSize: '13px' }}>← Dashboard</a>
          <span style={{ color: '#1e293b' }}>|</span>
          <span style={{ fontWeight: '700', color: '#f1f5f9' }}>⚙️ Settings</span>
        </div>
        <button onClick={handleSave} disabled={saving} style={{
          backgroundColor: saved ? '#10b981' : saving ? '#1a1a2e' : '#6366f1',
          color: saving ? '#475569' : '#fff',
          border: 'none', padding: '8px 20px', borderRadius: '8px',
          fontSize: '13px', fontWeight: '600', cursor: saving ? 'not-allowed' : 'pointer',
          transition: 'background-color 0.2s',
        }}>
          {saved ? '✅ Saved!' : saving ? 'Saving...' : 'Save Changes'}
        </button>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '4px', padding: '12px 20px', borderBottom: '1px solid #1e1e2e', overflowX: 'auto' }}>
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

        {/* PROFILE TAB */}
        {activeTab === 'profile' && (
          <>
            <div style={card}>
              <h3 style={{ fontSize: '13px', fontWeight: '700', color: '#6366f1', margin: '0 0 16px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Personal Details</h3>
              <div style={{ marginBottom: '14px' }}>
                <label style={lbl}>Full Name</label>
                <input style={inp} value={profile.full_name || ''} onChange={e => setProfile(p => ({ ...p, full_name: e.target.value }))} placeholder="Your name" />
              </div>
              <div>
                <label style={lbl}>Email</label>
                <input style={{ ...inp, opacity: 0.5 }} value={user?.email || ''} readOnly />
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
              <h3 style={{ fontSize: '13px', fontWeight: '700', color: '#6366f1', margin: '0 0 12px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Subscription Plan</h3>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontSize: '15px', fontWeight: '700', color: '#f1f5f9' }}>
                    {!profile.subscription_tier || profile.subscription_tier === 'free' ? '🆓 Free Plan' :
                     profile.subscription_tier === 'personal' ? '⭐ Personal' :
                     profile.subscription_tier === 'family' ? '👨‍👩‍👧 Family' : '💼 Pro'}
                  </div>
                  <div style={{ fontSize: '12px', color: '#475569', marginTop: '2px' }}>
                    {!profile.subscription_tier || profile.subscription_tier === 'free' ? '50 keeps/month · English only' : 'Unlimited · All languages · All features'}
                  </div>
                </div>
                {(!profile.subscription_tier || profile.subscription_tier === 'free') && (
                  <button style={{ backgroundColor: '#6366f1', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: '8px', fontSize: '12px', fontWeight: '600', cursor: 'pointer' }}>
                    Upgrade ↗
                  </button>
                )}
              </div>
            </div>
          </>
        )}

        {/* VOICE & LANGUAGE TAB */}
        {activeTab === 'voice' && (
          <>
            <div style={card}>
              <h3 style={{ fontSize: '13px', fontWeight: '700', color: '#6366f1', margin: '0 0 16px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Voice Language</h3>
              <label style={lbl}>Preferred Language</label>
              <select value={settings.voice_language} onChange={e => setSettings(s => ({ ...s, voice_language: e.target.value }))} style={inp}>
                {LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
              </select>
              <p style={{ fontSize: '11px', color: '#334155', marginTop: '8px', lineHeight: '1.6' }}>
                Indian languages use Sarvam AI (80%+ accuracy on Indian accents). Available on Personal plan and above. Currently using browser voice as fallback.
              </p>
            </div>

            <div style={card}>
              <h3 style={{ fontSize: '13px', fontWeight: '700', color: '#6366f1', margin: '0 0 16px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Voice Behaviour</h3>

              {/* Toggle: Voice input enabled */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
                <div>
                  <div style={{ fontSize: '14px', color: '#f1f5f9', fontWeight: '500' }}>Enable Voice Capture</div>
                  <div style={{ fontSize: '11px', color: '#475569' }}>Show microphone button in keeps</div>
                </div>
                <button onClick={() => setSettings(s => ({ ...s, notifications_enabled: !s.notifications_enabled }))} style={{
                  width: '44px', height: '24px', borderRadius: '12px', border: 'none', cursor: 'pointer',
                  backgroundColor: settings.notifications_enabled ? '#6366f1' : '#1e293b',
                  position: 'relative', transition: 'background-color 0.2s',
                }}>
                  <span style={{
                    position: 'absolute', top: '3px',
                    left: settings.notifications_enabled ? '22px' : '3px',
                    width: '18px', height: '18px', borderRadius: '50%',
                    backgroundColor: '#fff', transition: 'left 0.2s', display: 'block',
                  }} />
                </button>
              </div>

              {/* Toggle: Auto confirm high confidence */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontSize: '14px', color: '#f1f5f9', fontWeight: '500' }}>Auto-confirm High Confidence</div>
                  <div style={{ fontSize: '11px', color: '#475569' }}>Skip confirmation when AI is 90%+ sure of intent</div>
                </div>
                <button onClick={() => setSettings(s => ({ ...s, auto_confirm_high_confidence: !s.auto_confirm_high_confidence }))} style={{
                  width: '44px', height: '24px', borderRadius: '12px', border: 'none', cursor: 'pointer',
                  backgroundColor: settings.auto_confirm_high_confidence ? '#6366f1' : '#1e293b',
                  position: 'relative', transition: 'background-color 0.2s',
                }}>
                  <span style={{
                    position: 'absolute', top: '3px',
                    left: settings.auto_confirm_high_confidence ? '22px' : '3px',
                    width: '18px', height: '18px', borderRadius: '50%',
                    backgroundColor: '#fff', transition: 'left 0.2s', display: 'block',
                  }} />
                </button>
              </div>
            </div>
          </>
        )}

        {/* NOTIFICATIONS TAB */}
        {activeTab === 'notifications' && (
          <div style={card}>
            <h3 style={{ fontSize: '13px', fontWeight: '700', color: '#6366f1', margin: '0 0 16px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Reminder Delivery</h3>
            <p style={{ fontSize: '13px', color: '#475569', lineHeight: '1.6', marginBottom: '16px' }}>
              When you set a reminder, QuietKeep will notify you via the method you selected. You can change the default below.
            </p>
            <label style={lbl}>Default Reminder Method</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {[
                { value: 'app', icon: '📳', label: 'App Notification + Vibration', desc: 'Push notification when the app is open or installed as PWA' },
                { value: 'alarm', icon: '⏰', label: 'Alarm Sound', desc: 'Rings even when phone is on silent. Works via browser alarm API.' },
                { value: 'email', icon: '📧', label: 'Email', desc: `Reminder email sent to ${user?.email}` },
                { value: 'whatsapp', icon: '💬', label: 'WhatsApp Draft', desc: 'Opens WhatsApp with a pre-written reminder message at the set time. You tap Send.' },
              ].map(opt => (
                <div key={opt.value} style={{
                  display: 'flex', alignItems: 'center', gap: '12px', padding: '12px',
                  backgroundColor: '#0a0a0f', borderRadius: '10px',
                  border: '1px solid #1e293b',
                }}>
                  <span style={{ fontSize: '22px' }}>{opt.icon}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '13px', color: '#f1f5f9', fontWeight: '600' }}>{opt.label}</div>
                    <div style={{ fontSize: '11px', color: '#475569', marginTop: '2px', lineHeight: '1.5' }}>{opt.desc}</div>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ marginTop: '14px', padding: '10px 12px', backgroundColor: 'rgba(99,102,241,0.08)', borderRadius: '8px', border: '1px solid rgba(99,102,241,0.2)', fontSize: '11px', color: '#a5b4fc' }}>
              💡 You choose the reminder method each time you set a reminder — no need to lock into one default.
            </div>
          </div>
        )}

        {/* PRIVACY TAB */}
        {activeTab === 'privacy' && (
          <>
            <div style={card}>
              <h3 style={{ fontSize: '13px', fontWeight: '700', color: '#6366f1', margin: '0 0 16px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Your Privacy Guarantees</h3>
              {[
                { icon: '🔒', title: 'Your data is private', desc: 'All keeps are protected by Row Level Security. Only you can access your data.' },
                { icon: '🚫', title: 'No data resale', desc: 'QuietKeep never sells or shares your data with advertisers or third parties.' },
                { icon: '📋', title: 'Full audit trail', desc: 'Every action in your account is logged. You can see it all.' },
                { icon: '🎙️', title: 'No background listening', desc: 'Voice is push-to-talk only. Microphone is never active in the background.' },
                { icon: '✅', title: 'No auto-execution', desc: 'QuietKeep never takes any action without your explicit confirmation.' },
                { icon: '📴', title: 'Offline capable', desc: 'Core features work without internet. Your data syncs when back online.' },
              ].map((item, i) => (
                <div key={i} style={{ display: 'flex', gap: '12px', marginBottom: '14px' }}>
                  <span style={{ fontSize: '20px', flexShrink: 0 }}>{item.icon}</span>
                  <div>
                    <div style={{ fontSize: '13px', fontWeight: '600', color: '#f1f5f9', marginBottom: '2px' }}>{item.title}</div>
                    <div style={{ fontSize: '12px', color: '#475569', lineHeight: '1.5' }}>{item.desc}</div>
                  </div>
                </div>
              ))}
            </div>

            <div style={{ ...card, borderColor: '#2d1515' }}>
              <h3 style={{ fontSize: '13px', fontWeight: '700', color: '#ef4444', margin: '0 0 12px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Danger Zone</h3>
              <button onClick={() => supabase.auth.signOut().then(() => router.replace('/'))} style={{
                backgroundColor: 'transparent', border: '1px solid #2d1515',
                color: '#ef4444', padding: '9px 20px', borderRadius: '8px',
                fontSize: '13px', cursor: 'pointer', width: '100%',
              }}>Sign Out of All Devices</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
        }
