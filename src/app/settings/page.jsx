'use client';
import useAndroidBack from '@/lib/useAndroidBack';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/context/auth';
import { safeFetch } from '@/lib/safeFetch';
import { useEffect, useState } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import NavbarClient from '@/components/NavbarClient';
import { useLanguage } from '@/lib/context/language';

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

const DISPLAY_LANGUAGES = [
  { value: 'en', label: '🇬🇧 English' },
  { value: 'hi', label: '🇮🇳 हिंदी (Hindi)' },
  { value: 'te', label: '🇮🇳 తెలుగు (Telugu)' },
];

const FONT_SIZES = [
  { value: 'small', label: '🔡 Small' },
  { value: 'medium', label: '🔤 Medium (default)' },
  { value: 'large', label: '🔠 Large' },
  { value: 'xlarge', label: '🅰️ Extra Large' },
];

// SPRINT 2 ADDITION: Theme options
const THEMES = [
  { value: 'dark', label: '🌑 Dark (default)' },
  { value: 'light', label: '☀️ Light' },
  { value: 'amoled', label: '⚫ AMOLED (pure black)' },
];

export default function SettingsPage() {
  const router = useRouter();
  useAndroidBack();
  const { user, accessToken, loading: authLoading } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [referralCode, setReferralCode] = useState('');
  const [referralUses, setReferralUses] = useState(0);
  const [copyMsg, setCopyMsg] = useState('');
  const [saved, setSaved] = useState('');
  // Phase 4: Automation settings
  const [autoEnabled, setAutoEnabled]   = useState(false);
  const [autoTypes, setAutoTypes]       = useState({ reminder: false, contact: false, task: false, expense: false, note: false });
  const [autoThreshold, setAutoThreshold] = useState(0.90);
  const [aggressiveness, setAggressiveness] = useState('medium'); // Phase 5: suggestion frequency

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
  const [theme, setTheme] = useState('light');

  // i18n + Font settings (display language separate from voice language)
  const [displayLanguage, setDisplayLanguage] = useState('en');
  const { setVoiceLang } = useLanguage();  // instant language apply
  const [fontSize, setFontSize] = useState('medium');

  useEffect(() => {
    if (!authLoading) loadAll();
  }, [authLoading]);

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
    try {
      localStorage.setItem('qk_display_lang', displayLanguage);
      // Also write cookie so SSR i18n.ts can read it for server-rendered text
      document.cookie = `qk_display_lang=${displayLanguage};path=/;max-age=31536000;SameSite=Lax`;
    } catch {}
    try {
      localStorage.setItem('qk_font_size', fontSize);
      // Apply font size immediately
      const sizes = { small: '14px', medium: '16px', large: '18px', xlarge: '20px' };
      document.documentElement.style.setProperty('--base-font-size', sizes[fontSize] || '16px');
    } catch {}
  // FIXED: was [theme] only — displayLanguage and fontSize changes never triggered
  // the localStorage/cookie write. Changed to include all three state vars.
  }, [theme, displayLanguage, fontSize]);

  async function loadAll() {
        if (authLoading) return;
    if (!user) { router.replace('/login'); return; }
    
    const [profileRes, settingsRes, briefRes] = await Promise.all([
      supabase.from('profiles').select('*').eq('user_id', user.id).single(),
      supabase.from('user_settings').select('*').eq('user_id', user.id).single(),
      // Phase 4: automation settings loaded below
      supabase.from('brief_settings').select('*').eq('user_id', user.id).single(),
    ]);

    if (profileRes.data) {
      setFullName(profileRes.data.full_name || '');
      setPersona(profileRes.data.persona_type || 'professional');
      setTimezone(profileRes.data.timezone || 'Asia/Kolkata');
    }

    if (settingsRes.data) {
      setVoiceLanguage(settingsRes.data.voice_language || 'en-IN');
      // FIX: sync DB voice_language to localStorage + context so STT uses the
      // correct language immediately. Previously only setVoiceLanguage() was called
      // which updated local state only — qk_voice_lang in localStorage stayed stale.
      setVoiceLang(settingsRes.data.voice_language || 'en-IN');
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
      // FIX: always load displayLanguage and fontSize regardless of theme_preference.
      // Previously inside the else branch — any user with a saved theme never loaded
      // their display language, causing permanent language/font mismatch.
      try { const dl = localStorage.getItem('qk_display_lang'); if (dl) setDisplayLanguage(dl); } catch {}
      try { const fs = localStorage.getItem('qk_font_size'); if (fs) setFontSize(fs); } catch {}
    }

    if (briefRes.data) {
      setBriefTime(briefRes.data.brief_time || '08:00');
      setShowWeather(briefRes.data.show_weather !== false);
      setShowFinance(briefRes.data.show_finance !== false);
      setShowReminders(briefRes.data.show_reminders !== false);
      setShowSuggestions(briefRes.data.show_suggestions !== false);
    }

    // Phase 4: load automation settings from user_settings.settings.automation
    const automation = settingsRes.data?.settings?.automation;
    if (automation) {
      setAutoEnabled(automation.enabled ?? false);
      setAutoTypes({ reminder: false, contact: false, task: false, expense: false, note: false, ...automation.types });
      setAutoThreshold(automation.auto_threshold ?? 0.90);
    }
    // Phase 5: aggressiveness
    const agg = settingsRes.data?.settings?.suggestion_aggressiveness;
    if (agg) setAggressiveness(agg);
    setLoading(false);
  }


  async function loadReferral(token) {
    try {
      const { data: res, error: resErr } = await safeFetch('/api/referral');
      if (!resErr && res) { const d = res; setReferralCode(d.code?.code || ''); setReferralUses(d.uses || 0); }
    } catch {}
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
        theme_preference: theme,
        notification_settings: {
          email_reminders: emailReminders,
          budget_alerts: budgetAlerts,
          subscription_alerts: subscriptionAlerts,
          doc_expiry_alerts: docExpiryAlerts,
        },
        // Phase 4: automation settings stored in JSONB
        settings: {
          automation: {
            enabled:        autoEnabled,
            types:          autoTypes,
            auto_threshold: autoThreshold,
          },
          suggestion_aggressiveness: aggressiveness,
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
    <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ color: '#6366f1', fontSize: '1.1rem' }}>Loading settings…</div>
    </div>
  );

  const Section = ({ title, children }) => (
    <div style={{ background: 'var(--surface)', border: '1px solid #2a2a2a', borderRadius: 12, padding: '1.5rem', marginBottom: '1.5rem' }}>
      <h3 style={{ color: 'var(--text)', fontSize: '0.95rem', fontWeight: 600, marginBottom: '1.2rem', textTransform: 'uppercase', letterSpacing: '0.05em', opacity: 0.6 }}>{title}</h3>
      {children}
    </div>
  );

  const Toggle = ({ label, desc, value, onChange }) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem 0', borderBottom: '1px solid #222' }}>
      <div>
        <div style={{ color: 'var(--text)', fontSize: '0.9rem' }}>{label}</div>
        {desc && <div style={{ color: 'var(--text-muted)', fontSize: '0.78rem', marginTop: 2 }}>{desc}</div>}
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
      <label style={{ color: 'var(--text-muted)', fontSize: '0.82rem', display: 'block', marginBottom: 6 }}>{label}</label>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{
          width: '100%', background: 'var(--input-bg, var(--bg-raised))',
          border: '1px solid var(--border)', borderRadius: 8,
          color: 'var(--text)', padding: '0.6rem 0.8rem', fontSize: '0.9rem', outline: 'none',
        }}
      >
        {options.map(o => (
          <option key={o.value || o.code} value={o.value || o.code}>{o.label}</option>
        ))}
      </select>
    </div>
  );

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--text)' }}>
      <NavbarClient />
      <div style={{ maxWidth: 640, margin: '0 auto', padding: '2rem 1rem 4rem' }}>

        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '0.4rem' }}>Settings</h1>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '2rem' }}>Manage your preferences, language, and notifications.</p>

        {/* Profile */}
        <Section title="Profile">
          <div style={{ marginBottom: '1rem' }}>
            <label style={{ color: 'var(--text-muted)', fontSize: '0.82rem', display: 'block', marginBottom: 6 }}>Your Name</label>
            <input
              value={fullName}
              onChange={e => setFullName(e.target.value)}
              placeholder="Enter your name"
              style={{ width: '100%', background: 'var(--input-bg, var(--bg-raised))', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)', padding: '0.6rem 0.8rem', fontSize: '0.9rem', outline: 'none', boxSizing: 'border-box' }}
            />
          </div>
          <Select label="I am a…" value={persona} onChange={setPersona} options={PERSONAS} />
          <div>
            <label style={{ color: 'var(--text-muted)', fontSize: '0.82rem', display: 'block', marginBottom: 6 }}>Email</label>
            <div style={{ color: 'var(--text-subtle)', fontSize: '0.88rem', padding: '0.6rem 0.8rem', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8 }}>{user?.email}</div>
          </div>
        </Section>

        {/* Voice & Language */}
        <Section title="Voice & Language">
          <Select label="Primary Language" value={voiceLanguage} onChange={(val) => {
            setVoiceLanguage(val);
            // FIX: also update localStorage + LanguageProvider context so STT uses
            // the new language immediately — not only after the next DB load.
            setVoiceLang(val);
          }} options={LANGUAGES} />
          <Select label="Voice Tone" value={voiceTone} onChange={setVoiceTone} options={TONES} />
          <Toggle label="Voice Input Enabled" desc="Allow voice capture on dashboard" value={voiceEnabled} onChange={setVoiceEnabled} />
        </Section>

        {/* SPRINT 2 ADDITION: Appearance section */}
        <Section title="Appearance">
          <Select label="Theme" value={theme} onChange={setTheme} options={THEMES} />
          <Select label="Display Language (UI text)" value={displayLanguage} onChange={(val) => {
            setDisplayLanguage(val);
            // Immediately apply: write cookie + update LanguageProvider context
            try {
              localStorage.setItem('qk_display_lang', val);
              document.cookie = `qk_display_lang=${val};path=/;max-age=31536000;SameSite=Lax`;
            } catch {}
            // Map display locale to full voice lang code for STT/TTS
            const LOCALE_TO_VOICE = { en: 'en-IN', hi: 'hi-IN', te: 'te-IN' };
            const voiceLangCode = LOCALE_TO_VOICE[val] || 'en-IN';
            // Sync the STT voice language to match display language
            setVoiceLanguage(voiceLangCode);
            // Apply font + update LanguageProvider context (updates body font via CSS var)
            setVoiceLang(voiceLangCode);
          }} options={DISPLAY_LANGUAGES} />
          <Select label="Font Size" value={fontSize} onChange={setFontSize} options={FONT_SIZES} />
          <div style={{ color: 'var(--text-subtle)', fontSize: '0.78rem', marginTop: -8, marginBottom: 8 }}>
            Theme applies instantly. AMOLED is best for OLED screens to save battery.
          </div>
        </Section>

        {/* Daily Brief */}
        <Section title="Daily Brief">
          <div style={{ marginBottom: '1rem' }}>
            <label style={{ color: 'var(--text-muted)', fontSize: '0.82rem', display: 'block', marginBottom: 6 }}>Brief Time</label>
            <input
              type="time"
              value={briefTime}
              onChange={e => setBriefTime(e.target.value)}
              style={{ background: 'var(--input-bg, var(--bg-raised))', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)', padding: '0.6rem 0.8rem', fontSize: '0.9rem', outline: 'none' }}
            />
          </div>
          <Toggle label="Show Weather" desc="Local weather in morning brief" value={showWeather} onChange={setShowWeather} />
          <Toggle label="Show Finance Summary" desc="Today's spending and budget status" value={showFinance} onChange={setShowFinance} />
          <Toggle label="Show Reminders" desc="Upcoming reminders for today" value={showReminders} onChange={setShowReminders} />
          <Toggle label="Show Smart Suggestions" desc="AI-powered daily suggestions" value={showSuggestions} onChange={setShowSuggestions} />
        </Section>

        {/* Phase 5: Intelligence Tuning */}
        <Section title="🎛️ Intelligence Tuning">
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8, lineHeight: 1.6 }}>
              Control how often QuietKeep surfaces predictions and suggestions.
            </div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 4 }}>
              {[
                { value: 'low',    label: '🔕 Low',    desc: 'Only highest-confidence suggestions' },
                { value: 'medium', label: '🔔 Medium', desc: 'Balanced (recommended)' },
                { value: 'high',   label: '🔊 High',   desc: 'Surface more, learn faster' },
              ].map(opt => (
                <button key={opt.value}
                  onClick={() => setAggressiveness(opt.value)}
                  style={{
                    flex: 1, padding: '8px 4px', borderRadius: 8, border: 'none',
                    fontFamily: 'inherit', fontSize: 11, fontWeight: aggressiveness === opt.value ? 700 : 400,
                    cursor: 'pointer',
                    background: aggressiveness === opt.value
                      ? 'rgba(99,102,241,0.25)' : 'var(--surface)',
                    color: aggressiveness === opt.value ? '#a5b4fc' : 'var(--text-muted)',
                    border: aggressiveness === opt.value
                      ? '1px solid rgba(99,102,241,0.4)' : '1px solid var(--border)',
                  }}>
                  {opt.label}
                </button>
              ))}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-subtle)', paddingLeft: 4 }}>
              {aggressiveness === 'low'    && 'Max 1 suggestion/hour · confidence ≥ 75%'}
              {aggressiveness === 'medium' && 'Max 3 suggestions/hour · confidence ≥ 60%'}
              {aggressiveness === 'high'   && 'Max 6 suggestions/hour · confidence ≥ 45%'}
            </div>
          </div>
        </Section>

        {/* Phase 4: Automation */}
        <Section title="🤖 Automation">
          <div style={{ marginBottom: 16, padding: '12px 14px', background: 'rgba(99,102,241,0.07)', border: '1px solid rgba(99,102,241,0.2)', borderRadius: 10 }}>
            <div style={{ fontSize: 12, color: '#a5b4fc', lineHeight: 1.6, marginBottom: 8 }}>
              When enabled, QuietKeep can act on your behalf when it's highly confident (≥90%) about your next action. Every automated action shows a 5-second cancel window.
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-subtle)' }}>
              All actions are logged and explainable. You can disable at any time.
            </div>
          </div>
          <Toggle
            label="Enable Automation"
            desc="Allow QuietKeep to act automatically on high-confidence predictions"
            value={autoEnabled}
            onChange={setAutoEnabled}
          />
          {autoEnabled && (
            <div style={{ marginTop: 12, paddingLeft: 14, borderLeft: '2px solid rgba(99,102,241,0.25)' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
                Allow automation for:
              </div>
              {[
                { key: 'reminder', label: 'Reminders', desc: 'Auto-create reminders from patterns' },
                { key: 'contact',  label: 'Contacts',  desc: 'Pre-fill WhatsApp when you often call someone' },
                { key: 'task',     label: 'Tasks',     desc: 'Auto-add tasks at usual times' },
                { key: 'expense',  label: 'Expenses',  desc: 'Auto-log expenses from spending patterns' },
                { key: 'note',     label: 'Notes',     desc: 'Auto-capture notes from context' },
              ].map(({ key, label, desc }) => (
                <Toggle
                  key={key}
                  label={label}
                  desc={desc}
                  value={autoTypes[key] ?? false}
                  onChange={v => setAutoTypes(prev => ({ ...prev, [key]: v }))}
                />
              ))}
              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>
                  Confidence threshold for auto-trigger:
                  <strong style={{ color: '#a5b4fc', marginLeft: 6 }}>{Math.round(autoThreshold * 100)}%</strong>
                </div>
                <input
                  type="range" min="80" max="99" step="1"
                  value={Math.round(autoThreshold * 100)}
                  onChange={e => setAutoThreshold(parseInt(e.target.value) / 100)}
                  style={{ width: '100%', accentColor: '#6366f1' }}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-subtle)', marginTop: 3 }}>
                  <span>80% (more actions)</span>
                  <span>99% (fewer, safer)</span>
                </div>
              </div>
            </div>
          )}
        </Section>

        {/* Notifications */}
        <Section title="Notifications">
          <Toggle label="Reminder Emails" desc="Get email when reminder is due" value={emailReminders} onChange={setEmailReminders} />
          <Toggle label="Budget Alerts" desc="Alert when you hit 80% of budget" value={budgetAlerts} onChange={setBudgetAlerts} />
          <Toggle label="Subscription Renewal Alerts" desc="Alert 3 days before renewal" value={subscriptionAlerts} onChange={setSubscriptionAlerts} />
          <Toggle label="Document Expiry Alerts" desc="Alert 30/60/90 days before expiry" value={docExpiryAlerts} onChange={setDocExpiryAlerts} />

        </Section>


        {/* Referral */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-subtle)', marginBottom: 14 }}>🎁 Referral Program</div>
          <div style={{ background: 'var(--primary-dim)', border: '1px solid var(--primary-glow)', borderRadius: 12, padding: '16px 18px' }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>Share &amp; earn 30 days Premium</div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 14, lineHeight: 1.6 }}>
              When a friend activates using your link, you both get 30 days Premium free. Rewards stack — no cap.
            </div>
            {referralCode ? (
              <>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
                  <code style={{ flex: 1, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px', fontSize: 13, color: 'var(--primary)', fontWeight: 700, letterSpacing: '0.06em', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    quietkeep.com/waitlist?ref={referralCode}
                  </code>
                  <button onClick={async () => {
                    await navigator.clipboard.writeText(`https://quietkeep.com/waitlist?ref=${referralCode}`);
                    setCopyMsg('Copied!'); setTimeout(() => setCopyMsg(''), 2500);
                  }} className="qk-btn qk-btn-primary qk-btn-sm" style={{ flexShrink: 0 }}>
                    {copyMsg || '📋 Copy'}
                  </button>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-subtle)', marginBottom: 10 }}>
                  Code: <strong style={{ fontFamily: 'monospace', color: 'var(--primary)' }}>{referralCode}</strong> · {referralUses} referral{referralUses !== 1 ? 's' : ''} so far
                </div>
                <button onClick={async () => {
                  const url = `https://quietkeep.com/waitlist?ref=${referralCode}`;
                  const text = `Join me on QuietKeep — private voice-first life OS! We both get 30 days Premium free: ${url}`;
                  if (navigator.share) { try { await navigator.share({ title: 'QuietKeep', text, url }); } catch {} }
                  else { await navigator.clipboard.writeText(text); setCopyMsg('Message copied!'); setTimeout(() => setCopyMsg(''), 2500); }
                }} className="qk-btn qk-btn-ghost qk-btn-sm" style={{ width: '100%', justifyContent: 'center' }}>
                  📤 Share via WhatsApp / apps
                </button>
              </>
            ) : (
              <div style={{ fontSize: 13, color: 'var(--text-subtle)' }}>Loading your referral code…</div>
            )}
          </div>
        </div>

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
