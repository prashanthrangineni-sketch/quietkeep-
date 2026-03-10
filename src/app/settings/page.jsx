'use client';
import { useEffect, useState } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import NavbarClient from '@/components/NavbarClient';

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

const LANGUAGES = [
  { code: 'en-IN', label: 'English (India)' },
  { code: 'hi-IN', label: 'Hindi — हिंदी' },
  { code: 'te-IN', label: 'Telugu — తెలుగు' },
  { code: 'ta-IN', label: 'Tamil — தமிழ்' },
  { code: 'kn-IN', label: 'Kannada — ಕನ್ನಡ' },
  { code: 'ml-IN', label: 'Malayalam — മലയാളം' },
  { code: 'bn-IN', label: 'Bengali — বাংলা' },
  { code: 'mr-IN', label: 'Marathi — मराठी' },
  { code: 'gu-IN', label: 'Gujarati — ગુજરાતી' },
  { code: 'pa-IN', label: 'Punjabi — ਪੰਜਾਬੀ' },
  { code: 'or-IN', label: 'Odia — ଓଡ଼ିଆ' },
];

const TONES = [
  { value: 'friendly', label: '😊 Friendly' },
  { value: 'professional', label: '💼 Professional' },
  { value: 'concise', label: '⚡ Concise' },
];

const PERSONAS = [
  { value: 'professional', label: '👔 Professional' },
  { value: 'homemaker', label: '🏠 Homemaker' },
  { value: 'student', label: '📚 Student' },
  { value: 'business_owner', label: '🏢 Business Owner' },
  { value: 'elderly', label: '👴 Elderly / Caregiver' },
];

// SPRINT 2 ADDITION: Theme options
const THEMES = [
  { value: 'dark', label: '🌑 Dark (default)' },
  { value: 'light', label: '☀️ Light' },
  { value: 'amoled', label: '⚫ AMOLED (pure black)' },
];

export default function SettingsPage() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState('');

  // Voice settings
  const [voiceLanguage, setVoiceLanguage] = useState('en-IN');
  const [voiceTone, setVoiceTone] = useState('friendly');
  const [voiceEnabled, setVoiceEnabled] = useState(true);

  // Profile settings
  const [fullName, setFullName] = useState('');
  const [persona, setPersona] = useState('professional');
  const [timezone, setTimezone] = useState('Asia/Kolkata');

  // Brief settings
  const [briefTime, setBriefTime] = useState('08:00');
  const [showWeather, setShowWeather] = useState(true);
  const [showFinance, setShowFinance] = useState(true);
  const [showReminders, setShowReminders] = useState(true);
  const [showSuggestions, setShowSuggestions] = useState(true);

  // Notification settings
  const [emailReminders, setEmailReminders] = useState(true);
  const [budgetAlerts, setBudgetAlerts] = useState(true);
  const [subscriptionAlerts, setSubscriptionAlerts] = useState(true);
  const [docExpiryAlerts, setDocExpiryAlerts] = useState(true);

  // SPRINT 2 ADDITION: Theme preference
  const [theme, setTheme] = useState('dark');

  useEffect(() => {
    loadAll();
  }, []);

  // SPRINT 2 ADDITION: Apply theme to document root
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'amoled') {
      root.setAttribute('data-theme', 'amoled');
    } else if (theme === 'light') {
      root.setAttribute('data-theme', 'light');
    } else {
      root.setAttribute('data-theme', 'dark');
    }
    // Persist theme choice in localStorage for instant load next visit
    try { localStorage.setItem('qk_theme', theme); } catch {}
  }, [theme]);

  async function loadAll() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { window.location.href = '/login'; return; }
    setUser(user);

    const [profileRes, settingsRes, briefRes] = await Promise.all([
      supabase.from('profiles').select('*').eq('user_id', user.id).single(),
      supabase.from('user_settings').select('*').eq('user_id', user.id).single(),
      supabase.from('brief_settings').select('*').eq('user_id', user.id).single(),
    ]);

    if (profileRes.data) {
      setFullName(profileRes.data.full_name || '');
      setPersona(profileRes.data.persona_type || 'professional');
      setTimezone(profileRes.data.timezone || 'Asia/Kolkata');
    }

    if (settingsRes.data) {
      setVoiceLanguage(settingsRes.data.voice_language || 'en-IN');
      setVoiceTone(settingsRes.data.voice_tone || 'friendly');
      setVoiceEnabled(settingsRes.data.voice_input_enabled !== false);
      const notif = settingsRes.data.notification_settings || {};
      setEmailReminders(notif.email_reminders !== false);
      setBudgetAlerts(notif.budget_alerts !== false);
      setSubscriptionAlerts(notif.subscription_alerts !== false);
      setDocExpiryAlerts(notif.doc_expiry_alerts !== false);
      // SPRINT 2: Load theme from DB if saved, fall back to localStorage
      const savedTheme = settingsRes.data.theme_preference || null;
      if (savedTheme) {
        setTheme(savedTheme);
      } else {
        try { const lt = localStorage.getItem('qk_theme'); if (lt) setTheme(lt); } catch {}
      }
    }

    if (briefRes.data) {
      setBriefTime(briefRes.data.brief_time || '08:00');
      setShowWeather(briefRes.data.show_weather !== false);
      setShowFinance(briefRes.data.show_finance !== false);
      setShowReminders(briefRes.data.show_reminders !== false);
      setShowSuggestions(briefRes.data.show_suggestions !== false);
    }

    setLoading(false);
  }

  async function saveAll() {
    if (!user) return;
    setSaving(true);

    const [p, s, b] = await Promise.all([
      supabase.from('profiles').upsert({
        user_id: user.id,
        full_name: fullName,
        persona_type: persona,
        timezone,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' }),

      supabase.from('user_settings').upsert({
        user_id: user.id,
        voice_language: voiceLanguage,
        voice_tone: voiceTone,
        voice_input_enabled: voiceEnabled,
        // SPRINT 2: theme_preference saved alongside existing fields
        theme_preference: theme,
        notification_settings: {
          email_reminders: emailReminders,
          budget_alerts: budgetAlerts,
          subscription_alerts: subscriptionAlerts,
          doc_expiry_alerts: docExpiryAlerts,
        },
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' }),

      supabase.from('brief_settings').upsert({
        user_id: user.id,
        brief_time: briefTime,
        show_weather: showWeather,
        show_finance: showFinance,
        show_reminders: showReminders,
        show_suggestions: showSuggestions,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' }),
    ]);

    // Audit log
    await supabase.from('audit_log').insert({
      user_id: user.id,
      action: 'settings_updated',
      service: 'settings',
      details: { voice_language: voiceLanguage, persona, brief_time: briefTime, theme },
    });

    setSaving(false);
    setSaved('✓ Saved');
    setTimeout(() => setSaved(''), 2500);
  }

  if (loading) return (
    <div style={{ minHeight: '100vh', background: '#0f0f0f', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ color: '#6366f1', fontSize: '1.1rem' }}>Loading settings…</div>
    </div>
  );

  const Section = ({ title, children }) => (
    <div style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 12, padding: '1.5rem', marginBottom: '1.5rem' }}>
      <h3 style={{ color: '#fff', fontSize: '0.95rem', fontWeight: 600, marginBottom: '1.2rem', textTransform: 'uppercase', letterSpacing: '0.05em', opacity: 0.6 }}>{title}</h3>
      {children}
    </div>
  );

  const Toggle = ({ label, desc, value, onChange }) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem 0', borderBottom: '1px solid #222' }}>
      <div>
        <div style={{ color: '#fff', fontSize: '0.9rem' }}>{label}</div>
        {desc && <div style={{ color: '#666', fontSize: '0.78rem', marginTop: 2 }}>{desc}</div>}
      </div>
      <div
        onClick={() => onChange(!value)}
        style={{
          width: 44, height: 24, borderRadius: 12, cursor: 'pointer', transition: 'background 0.2s',
          background: value ? '#6366f1' : '#333', position: 'relative', flexShrink: 0,
        }}
      >
        <div style={{
          position: 'absolute', top: 3, left: value ? 23 : 3,
          width: 18, height: 18, borderRadius: '50%', background: '#fff', transition: 'left 0.2s',
        }} />
      </div>
    </div>
  );

  const Select = ({ label, value, onChange, options }) => (
    <div style={{ marginBottom: '1rem' }}>
      <label style={{ color: '#aaa', fontSize: '0.82rem', display: 'block', marginBottom: 6 }}>{label}</label>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{
          width: '100%', background: '#111', border: '1px solid #333', borderRadius: 8,
          color: '#fff', padding: '0.6rem 0.8rem', fontSize: '0.9rem', outline: 'none',
        }}
      >
        {options.map(o => (
          <option key={o.value || o.code} value={o.value || o.code}>{o.label}</option>
        ))}
      </select>
    </div>
  );

  return (
    <div style={{ minHeight: '100vh', background: '#0f0f0f', color: '#fff' }}>
      <NavbarClient />
      <div style={{ maxWidth: 640, margin: '0 auto', padding: '2rem 1rem 4rem' }}>

        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '0.4rem' }}>Settings</h1>
        <p style={{ color: '#666', fontSize: '0.9rem', marginBottom: '2rem' }}>Manage your preferences, language, and notifications.</p>

        {/* Profile */}
        <Section title="Profile">
          <div style={{ marginBottom: '1rem' }}>
            <label style={{ color: '#aaa', fontSize: '0.82rem', display: 'block', marginBottom: 6 }}>Your Name</label>
            <input
              value={fullName}
              onChange={e => setFullName(e.target.value)}
              placeholder="Enter your name"
              style={{ width: '100%', background: '#111', border: '1px solid #333', borderRadius: 8, color: '#fff', padding: '0.6rem 0.8rem', fontSize: '0.9rem', outline: 'none', boxSizing: 'border-box' }}
            />
          </div>
          <Select label="I am a…" value={persona} onChange={setPersona} options={PERSONAS} />
          <div>
            <label style={{ color: '#aaa', fontSize: '0.82rem', display: 'block', marginBottom: 6 }}>Email</label>
            <div style={{ color: '#555', fontSize: '0.88rem', padding: '0.6rem 0.8rem', background: '#111', border: '1px solid #222', borderRadius: 8 }}>{user?.email}</div>
          </div>
        </Section>

        {/* Voice & Language */}
        <Section title="Voice & Language">
          <Select label="Primary Language" value={voiceLanguage} onChange={setVoiceLanguage} options={LANGUAGES} />
          <Select label="Voice Tone" value={voiceTone} onChange={setVoiceTone} options={TONES} />
          <Toggle label="Voice Input Enabled" desc="Allow voice capture on dashboard" value={voiceEnabled} onChange={setVoiceEnabled} />
        </Section>

        {/* SPRINT 2 ADDITION: Appearance section */}
        <Section title="Appearance">
          <Select label="Theme" value={theme} onChange={setTheme} options={THEMES} />
          <div style={{ color: '#555', fontSize: '0.78rem', marginTop: -8, marginBottom: 8 }}>
            Theme applies instantly. AMOLED is best for OLED screens to save battery.
          </div>
        </Section>

        {/* Daily Brief */}
        <Section title="Daily Brief">
          <div style={{ marginBottom: '1rem' }}>
            <label style={{ color: '#aaa', fontSize: '0.82rem', display: 'block', marginBottom: 6 }}>Brief Time</label>
            <input
              type="time"
              value={briefTime}
              onChange={e => setBriefTime(e.target.value)}
              style={{ background: '#111', border: '1px solid #333', borderRadius: 8, color: '#fff', padding: '0.6rem 0.8rem', fontSize: '0.9rem', outline: 'none' }}
            />
          </div>
          <Toggle label="Show Weather" desc="Local weather in morning brief" value={showWeather} onChange={setShowWeather} />
          <Toggle label="Show Finance Summary" desc="Today's spending and budget status" value={showFinance} onChange={setShowFinance} />
          <Toggle label="Show Reminders" desc="Upcoming reminders for today" value={showReminders} onChange={setShowReminders} />
          <Toggle label="Show Smart Suggestions" desc="AI-powered daily suggestions" value={showSuggestions} onChange={setShowSuggestions} />
        </Section>

        {/* Notifications */}
        <Section title="Notifications">
          <Toggle label="Reminder Emails" desc="Get email when reminder is due" value={emailReminders} onChange={setEmailReminders} />
          <Toggle label="Budget Alerts" desc="Alert when you hit 80% of budget" value={budgetAlerts} onChange={setBudgetAlerts} />
          <Toggle label="Subscription Renewal Alerts" desc="Alert 3 days before renewal" value={subscriptionAlerts} onChange={setSubscriptionAlerts} />
          <Toggle label="Document Expiry Alerts" desc="Alert 30/60/90 days before expiry" value={docExpiryAlerts} onChange={setDocExpiryAlerts} />
          <div style={{ marginTop: 12 }}><WebPushSetup /></div>
        </Section>

        {/* Save Button */}
        <button
          onClick={saveAll}
          disabled={saving}
          style={{
            width: '100%', padding: '0.9rem', borderRadius: 10, border: 'none',
            background: saving ? '#333' : '#6366f1', color: '#fff', fontSize: '1rem',
            fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer',
          }}
        >
          {saving ? 'Saving…' : saved || 'Save Settings'}
        </button>
      </div>
    </div>
  );
}
