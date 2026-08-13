'use client';
import { useAuth } from '@/lib/context/auth';
import { safeFetch } from '@/lib/safeFetch';
import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useRouter } from 'next/navigation';
import ConsentScreen from '@/components/ConsentScreen';

const LANGUAGES = [
  { value: 'en-IN', label: 'English', desc: 'Default voice & text assistant' },
  { value: 'te-IN', label: 'తెలుగు (Telugu)', desc: 'Telugu voice support & Panchangam' },
  { value: 'hi-IN', label: 'हिंदी (Hindi)', desc: 'Hindi voice support & Vikram Samvat' },
  { value: 'ta-IN', label: 'தமிழ் (Tamil)', desc: 'Tamil voice support & Panchangam' },
];

const CALENDARS = [
  { value: 'gregorian', label: 'Gregorian', emoji: '📅', desc: 'English dates, Christian & Indian national holidays' },
  { value: 'telugu', label: 'Telugu (Panchangam)', emoji: '🌙', desc: 'Telugu festivals, tithis, nakshatras, Ugadi' },
  { value: 'hindi', label: 'Hindi (Vikram Samvat)', emoji: '🪔', desc: 'Diwali, Holi, Navratri, Hindi calendar' },
  { value: 'tamil', label: 'Tamil (Panchangam)', emoji: '🌺', desc: 'Tamil festivals, Pongal, Tamil New Year' },
  { value: 'islamic', label: 'Islamic (Hijri)', emoji: '☪️', desc: 'Ramadan, Eid, Islamic months' },
];

const PERSONAS = [
  { value: 'professional', emoji: '👔', label: 'Professional', desc: 'Work reminders, meetings, expenses' },
  { value: 'homemaker', emoji: '🏠', label: 'Homemaker', desc: 'Family, groceries, bills, kids' },
  { value: 'student', emoji: '📚', label: 'Student', desc: 'Assignments, deadlines, notes' },
  { value: 'business_owner', emoji: '🏢', label: 'Business Owner', desc: 'Team tasks, clients, finance' },
  { value: 'elderly', emoji: '👴', label: 'Caregiver / Senior', desc: 'Medications, appointments, family' },
];

const STEPS = [
  { id: 'details', title: 'Welcome to QuietKeep!', subtitle: 'Tell us a bit about yourself to get started.' },
  { id: 'language', title: 'Preferred Language', subtitle: 'Choose your assistant voice & UI language.' },
  { id: 'persona', title: 'How do you use QuietKeep?', subtitle: "We'll personalise your experience." },
  { id: 'calendar', title: 'Pick your calendar tradition', subtitle: 'Your daily brief will show relevant events.' },
  { id: 'keep', title: 'Add your first keep', subtitle: 'A keep is anything you want to remember.' },
];

export default function OnboardingPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [step, setStep] = useState(-1); // -1 = consent screen
  const [consentData, setConsentData] = useState(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [language, setLanguage] = useState('en-IN');
  const [calendar, setCalendar] = useState('gregorian');
  const [persona, setPersona] = useState('professional');
  const [referralCode, setReferralCode] = useState('');
  const [firstKeep, setFirstKeep] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.replace('/login'); return; }
    if (user?.user_metadata?.full_name) setName(user.user_metadata.full_name);
    if (user?.email && !user.email.endsWith('@quietkeep.com')) setEmail(user.email);
  }, [user, authLoading, router]);

  async function handleNext() {
    setError('');
    if (step === 0 && !name.trim()) { setError('Full name is required.'); return; }
    if (step < STEPS.length - 1) { setStep(s => s + 1); return; }
    await finishOnboarding();
  }

  async function finishOnboarding() {
    if (!user) return;
    setSaving(true);
    setError('');
    try {
      const { error: profileErr } = await supabase
        .from('profiles')
        .upsert({
          user_id: user.id,
          full_name: name.trim(),
          email: email.trim() || (user.email && !user.email.endsWith('@quietkeep.com') ? user.email : null),
          language: language,
          preferred_language: language,
          selected_calendar: calendar,
          persona_type: persona,
          onboarding_done: true,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id' });

      if (profileErr) {
        console.error('Profile upsert error:', profileErr);
        throw profileErr;
      }

      if (consentData) {
        await supabase.from('user_consent').upsert({
          user_id: user.id,
          ...consentData,
          consent_version: 'v1.0',
          consented_at: new Date().toISOString(),
        }, { onConflict: 'user_id' }).catch(() => {});
      }

      if (referralCode.trim()) {
        try { safeFetch('/api/referral').catch(()=>{}); } catch {}
      }

      if (firstKeep.trim()) {
        await supabase.from('keeps').insert({
          user_id: user.id,
          content: firstKeep.trim(),
          status: 'open',
          intent_type: 'note',
          is_pinned: true,
          show_on_brief: true,
          confidence: 1.0,
          parsing_method: 'manual',
        });
      }

      router.replace('/dashboard');
    } catch (e) {
      console.error('Onboarding error:', e);
      setError('Something went wrong. Please try again.');
      setSaving(false);
    }
  }

  async function skipKeep() {
    setFirstKeep('');
    await finishOnboarding();
  }

  const currentStep = step >= 0 ? STEPS[step] : null;

  if (step === -1) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--bg, #09090b)', color: 'var(--text, #f4f4f5)', fontFamily: "'Inter',-apple-system,sans-serif", display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 0' }}>
        <ConsentScreen onConsent={(data) => { setConsentData(data); setStep(0); }} />
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg, #09090b)', color: 'var(--text, #f4f4f5)', fontFamily: "'Inter',-apple-system,sans-serif", display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '0 0 60px' }}>

      {/* Header */}
      <div style={{ width: '100%', maxWidth: '480px', padding: '32px 20px 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '28px' }}>
          <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: 'linear-gradient(135deg, #7c3aed, #a855f7)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: '18px', fontWeight: 'bold' }}>
            ◕‿◕
          </div>
          <span style={{ fontWeight: '700', fontSize: '18px', color: 'var(--text, #f4f4f5)', letterSpacing: '-0.02em' }}>QuietKeep</span>
        </div>

        {/* Progress bar */}
        <div style={{ display: 'flex', gap: '6px', marginBottom: '8px' }}>
          {STEPS.map((s, i) => (
            <div key={s.id} style={{ height: '4px', flex: 1, borderRadius: '2px', background: i <= step ? '#7c3aed' : 'rgba(255,255,255,0.1)', transition: 'background 0.3s' }} />
          ))}
        </div>
        <p style={{ fontSize: '12px', color: 'var(--text-subtle, #a1a1aa)', margin: '0 0 24px' }}>Step {step + 1} of {STEPS.length}</p>

        <h1 style={{ fontSize: '24px', fontWeight: '700', color: 'var(--text, #f4f4f5)', margin: '0 0 6px', letterSpacing: '-0.02em' }}>{currentStep.title}</h1>
        <p style={{ fontSize: '14px', color: 'var(--text-muted, #71717a)', margin: '0 0 24px' }}>{currentStep.subtitle}</p>
      </div>

      {/* Step content */}
      <div style={{ width: '100%', maxWidth: '480px', padding: '0 20px' }}>

        {/* Step 0: Name & Email */}
        {step === 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div>
              <label style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-subtle, #a1a1aa)', display: 'block', marginBottom: '6px' }}>
                Full Name <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleNext()}
                placeholder="e.g. Prashanth Rao"
                autoFocus
                style={{ width: '100%', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '12px', padding: '14px 16px', color: 'var(--text, #fff)', fontSize: '15px', outline: 'none', boxSizing: 'border-box' }}
              />
            </div>
            <div>
              <label style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-subtle, #a1a1aa)', display: 'block', marginBottom: '6px' }}>
                Email Address <span style={{ fontSize: '12px', fontWeight: '400', opacity: 0.7 }}>(optional)</span>
              </label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleNext()}
                placeholder="name@example.com"
                style={{ width: '100%', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '12px', padding: '14px 16px', color: 'var(--text, #fff)', fontSize: '15px', outline: 'none', boxSizing: 'border-box' }}
              />
            </div>
          </div>
        )}

        {/* Step 1: Language */}
        {step === 1 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {LANGUAGES.map(lang => (
              <button
                key={lang.value}
                onClick={() => setLanguage(lang.value)}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '16px', borderRadius: '12px', cursor: 'pointer',
                  border: `1px solid ${language === lang.value ? '#7c3aed' : 'rgba(255,255,255,0.1)'}`,
                  background: language === lang.value ? 'rgba(124, 58, 237, 0.15)' : 'rgba(255,255,255,0.03)',
                  textAlign: 'left', WebkitTapHighlightColor: 'transparent',
                }}
              >
                <div>
                  <div style={{ fontSize: '15px', fontWeight: '600', color: language === lang.value ? '#a855f7' : 'var(--text, #fff)' }}>{lang.label}</div>
                  <div style={{ fontSize: '12px', color: 'var(--text-subtle, #a1a1aa)', marginTop: '2px' }}>{lang.desc}</div>
                </div>
                {language === lang.value && <span style={{ color: '#a855f7', fontSize: '18px', fontWeight: 'bold' }}>✓</span>}
              </button>
            ))}
          </div>
        )}

        {/* Step 2: Persona */}
        {step === 2 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {PERSONAS.map(p => (
              <button key={p.value} onClick={() => setPersona(p.value)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '14px',
                  padding: '14px 16px', borderRadius: '12px', cursor: 'pointer',
                  border: `1px solid ${persona === p.value ? '#7c3aed' : 'rgba(255,255,255,0.1)'}`,
                  background: persona === p.value ? 'rgba(124, 58, 237, 0.15)' : 'rgba(255,255,255,0.03)',
                  textAlign: 'left', WebkitTapHighlightColor: 'transparent',
                }}>
                <span style={{ fontSize: '24px' }}>{p.emoji}</span>
                <div>
                  <div style={{ fontSize: '14px', fontWeight: '600', color: persona === p.value ? '#a855f7' : 'var(--text, #fff)' }}>{p.label}</div>
                  <div style={{ fontSize: '12px', color: 'var(--text-subtle, #a1a1aa)', marginTop: '2px' }}>{p.desc}</div>
                </div>
                {persona === p.value && <span style={{ marginLeft: 'auto', color: '#a855f7', fontSize: '18px' }}>✓</span>}
              </button>
            ))}
          </div>
        )}

        {/* Step 3: Calendar */}
        {step === 3 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {CALENDARS.map(cal => (
              <button
                key={cal.value}
                onClick={() => setCalendar(cal.value)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '14px',
                  padding: '14px 16px', borderRadius: '12px', cursor: 'pointer',
                  border: `1px solid ${calendar === cal.value ? '#7c3aed' : 'rgba(255,255,255,0.1)'}`,
                  background: calendar === cal.value ? 'rgba(124, 58, 237, 0.15)' : 'rgba(255,255,255,0.03)',
                  textAlign: 'left', minHeight: '60px', WebkitTapHighlightColor: 'transparent',
                }}
              >
                <span style={{ fontSize: '22px' }}>{cal.emoji}</span>
                <div>
                  <div style={{ fontSize: '14px', fontWeight: '600', color: calendar === cal.value ? '#a855f7' : 'var(--text, #fff)' }}>{cal.label}</div>
                  <div style={{ fontSize: '12px', color: 'var(--text-subtle, #a1a1aa)', marginTop: '2px' }}>{cal.desc}</div>
                </div>
                {calendar === cal.value && <span style={{ marginLeft: 'auto', color: '#a855f7', fontSize: '18px' }}>✓</span>}
              </button>
            ))}
          </div>
        )}

        {/* Step 4: First keep */}
        {step === 4 && (
          <>
            <textarea
              value={firstKeep}
              onChange={e => setFirstKeep(e.target.value)}
              placeholder="e.g. Call dad on Sunday, or Buy milk tomorrow..."
              rows={3}
              style={{ width: '100%', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '12px', padding: '14px 16px', color: 'var(--text, #fff)', fontSize: '15px', outline: 'none', boxSizing: 'border-box', resize: 'none', lineHeight: '1.5' }}
            />
            <div style={{ marginTop: '14px' }}>
              <label style={{ fontSize: '12px', color: 'var(--text-subtle, #a1a1aa)', display: 'block', marginBottom: '6px' }}>Got a referral code? (optional)</label>
              <input
                value={referralCode}
                onChange={e => setReferralCode(e.target.value.toUpperCase())}
                placeholder="e.g. PRASHANTH1234"
                style={{ width: '100%', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '10px', padding: '12px 14px', color: 'var(--text, #fff)', fontSize: '14px', outline: 'none', boxSizing: 'border-box', fontFamily: 'monospace', letterSpacing: '0.06em' }}
              />
            </div>
          </>
        )}

        {error && (
          <div style={{ marginTop: '14px', padding: '10px 14px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: '8px', color: '#ef4444', fontSize: '13px' }}>
            {error}
          </div>
        )}

        {/* Actions */}
        <div style={{ marginTop: '24px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <button
            onClick={handleNext}
            disabled={saving}
            style={{ width: '100%', background: saving ? 'rgba(255,255,255,0.1)' : 'linear-gradient(135deg, #7c3aed, #6366f1)', color: '#fff', border: 'none', borderRadius: '12px', padding: '16px', fontSize: '15px', fontWeight: '700', cursor: saving ? 'not-allowed' : 'pointer', minHeight: '52px', WebkitTapHighlightColor: 'transparent', boxShadow: '0 4px 12px rgba(124,58,237,0.3)' }}
          >
            {saving ? 'Setting up your space…' : step < STEPS.length - 1 ? 'Continue →' : "Let's go →"}
          </button>

          {step === 4 && !saving && (
            <button
              onClick={skipKeep}
              style={{ width: '100%', background: 'transparent', color: 'var(--text-subtle, #a1a1aa)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px', padding: '14px', fontSize: '14px', cursor: 'pointer', minHeight: '48px' }}
            >
              Skip for now
            </button>
          )}

          {step > 0 && !saving && (
            <button
              onClick={() => setStep(s => s - 1)}
              style={{ width: '100%', background: 'transparent', color: 'var(--text-subtle, #a1a1aa)', border: 'none', padding: '10px', fontSize: '13px', cursor: 'pointer' }}
            >
              ← Back
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
