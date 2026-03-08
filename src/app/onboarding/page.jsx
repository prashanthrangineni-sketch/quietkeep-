'use client';
// src/app/onboarding/page.jsx
// After completing, sets profiles.onboarding_done = true and redirects to /dashboard
// Middleware should redirect users with onboarding_done=false to /onboarding

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useRouter } from 'next/navigation';

const CALENDARS = [
  { value: 'gregorian', label: 'Gregorian', emoji: '📅', desc: 'English dates, Christian & Indian national holidays' },
  { value: 'telugu', label: 'Telugu (Panchangam)', emoji: '🌙', desc: 'Telugu festivals, tithis, nakshatras, Ugadi' },
  { value: 'hindi', label: 'Hindi (Vikram Samvat)', emoji: '🪔', desc: 'Diwali, Holi, Navratri, Hindi calendar' },
  { value: 'tamil', label: 'Tamil (Panchangam)', emoji: '🌺', desc: 'Tamil festivals, Pongal, Tamil New Year' },
  { value: 'islamic', label: 'Islamic (Hijri)', emoji: '☪️', desc: 'Ramadan, Eid, Islamic months' },
];

const STEPS = [
  { id: 'name', title: 'What should we call you?', subtitle: 'Your name stays private.' },
  { id: 'calendar', title: 'Pick your calendar', subtitle: 'Your daily brief will show relevant events.' },
  { id: 'keep', title: 'Add your first keep', subtitle: 'A keep is anything you want to remember.' },
];

export default function OnboardingPage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [calendar, setCalendar] = useState('gregorian');
  const [firstKeep, setFirstKeep] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) { router.replace('/login'); return; }
      setUser(user);
      // Pre-fill name from email prefix
      setName(user.user_metadata?.full_name || user.email?.split('@')[0] || '');
    });
  }, []);

  async function handleNext() {
    setError('');
    if (step === 0 && !name.trim()) { setError('Please enter your name.'); return; }
    if (step < STEPS.length - 1) { setStep(s => s + 1); return; }
    // Final step — save everything
    await finishOnboarding();
  }

  async function finishOnboarding() {
    if (!user) return;
    setSaving(true);
    try {
      // Update profile
      const { error: profileErr } = await supabase
        .from('profiles')
        .update({
          full_name: name.trim(),
          selected_calendar: calendar,
          onboarding_done: true,
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', user.id);
      if (profileErr) throw profileErr;

      // Save first keep if provided
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
      setError('Something went wrong. Please try again.');
      setSaving(false);
    }
  }

  async function skipKeep() {
    setFirstKeep('');
    await finishOnboarding();
  }

  const currentStep = STEPS[step];

  const S = {
    page: { minHeight: '100vh', background: '#0a0a0f', color: '#f1f5f9', fontFamily: "'DM Sans',-apple-system,sans-serif", display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-start', padding: '0 0 40px' },
    header: { width: '100%', padding: '24px 20px 0', maxWidth: '480px' },
    card: { width: '100%', maxWidth: '480px', padding: '0 20px', marginTop: '32px' },
    input: { width: '100%', background: '#0f0f1a', border: '1px solid #1e293b', borderRadius: '12px', padding: '14px 16px', color: '#f1f5f9', fontSize: '16px', outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit' },
    btn: (disabled) => ({ width: '100%', background: disabled ? '#1a1a2e' : '#6366f1', color: disabled ? '#334155' : '#fff', border: 'none', borderRadius: '12px', padding: '16px', fontSize: '16px', fontWeight: 700, cursor: disabled ? 'not-allowed' : 'pointer', marginTop: '16px' }),
    calCard: (selected) => ({ display: 'flex', alignItems: 'flex-start', gap: '14px', padding: '14px', borderRadius: '12px', border: `1px solid ${selected ? '#6366f1' : '#1e293b'}`, background: selected ? 'rgba(99,102,241,0.1)' : '#0f0f1a', cursor: 'pointer', marginBottom: '10px', transition: 'all 0.15s' }),
  };

  return (
    <div style={S.page}>
      {/* Logo */}
      <div style={{ width: '100%', maxWidth: '480px', padding: '32px 20px 0', display: 'flex', alignItems: 'center', gap: '10px' }}>
        <div style={{ width: '36px', height: '36px', background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px' }}>🤫</div>
        <span style={{ fontSize: '18px', fontWeight: 800, color: '#f1f5f9' }}>QuietKeep</span>
      </div>

      {/* Progress dots */}
      <div style={{ display: 'flex', gap: '8px', marginTop: '28px' }}>
        {STEPS.map((_, i) => (
          <div key={i} style={{ width: i === step ? '24px' : '8px', height: '8px', borderRadius: '4px', background: i <= step ? '#6366f1' : '#1e293b', transition: 'all 0.3s' }} />
        ))}
      </div>

      {/* Step content */}
      <div style={S.card}>
        <div style={{ marginBottom: '8px' }}>
          <div style={{ fontSize: '11px', color: '#6366f1', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '8px' }}>
            Step {step + 1} of {STEPS.length}
          </div>
          <div style={{ fontSize: '24px', fontWeight: 800, lineHeight: 1.2, marginBottom: '6px' }}>{currentStep.title}</div>
          <div style={{ fontSize: '13px', color: 'rgba(255,255,255,0.4)' }}>{currentStep.subtitle}</div>
        </div>

        {/* Step 1: Name */}
        {step === 0 && (
          <div style={{ marginTop: '24px' }}>
            <input
              autoFocus
              style={S.input}
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleNext()}
              placeholder="Your name..."
              maxLength={60}
            />
            <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.2)', marginTop: '8px' }}>This is only shown to you.</div>
          </div>
        )}

        {/* Step 2: Calendar */}
        {step === 1 && (
          <div style={{ marginTop: '20px' }}>
            {CALENDARS.map(cal => (
              <div key={cal.value} style={S.calCard(calendar === cal.value)} onClick={() => setCalendar(cal.value)}>
                <span style={{ fontSize: '24px', flexShrink: 0 }}>{cal.emoji}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '14px', fontWeight: 700, color: calendar === cal.value ? '#a5b4fc' : '#f1f5f9', marginBottom: '3px' }}>{cal.label}</div>
                  <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.4)' }}>{cal.desc}</div>
                </div>
                {calendar === cal.value && (
                  <div style={{ width: '20px', height: '20px', borderRadius: '50%', background: '#6366f1', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', flexShrink: 0 }}>✓</div>
                )}
              </div>
            ))}
            <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.2)', marginTop: '4px' }}>You can change this anytime in Settings.</div>
          </div>
        )}

        {/* Step 3: First keep */}
        {step === 2 && (
          <div style={{ marginTop: '24px' }}>
            <textarea
              autoFocus
              style={{ ...S.input, resize: 'none', lineHeight: 1.6 }}
              rows={4}
              value={firstKeep}
              onChange={e => setFirstKeep(e.target.value)}
              placeholder="Eg: Call Mum on Sunday. Pick up medicine tomorrow. Book dentist next week..."
            />
            <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.2)', marginTop: '8px' }}>Your first keep will be pinned to your daily brief.</div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div style={{ marginTop: '12px', padding: '10px 14px', background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.3)', borderRadius: '8px', fontSize: '13px', color: '#f87171' }}>
            {error}
          </div>
        )}

        {/* Action buttons */}
        <button
          onClick={handleNext}
          disabled={saving || (step === 0 && !name.trim())}
          style={S.btn(saving || (step === 0 && !name.trim()))}
        >
          {saving ? 'Setting up...' : step < STEPS.length - 1 ? 'Continue →' : firstKeep.trim() ? 'Save & Start →' : 'Start QuietKeep →'}
        </button>

        {step === 2 && !saving && (
          <button
            onClick={skipKeep}
            style={{ width: '100%', background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.3)', fontSize: '14px', padding: '12px', cursor: 'pointer', marginTop: '4px' }}
          >
            Skip for now
          </button>
        )}

        {step > 0 && !saving && (
          <button
            onClick={() => setStep(s => s - 1)}
            style={{ width: '100%', background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.25)', fontSize: '13px', padding: '10px', cursor: 'pointer', marginTop: '4px' }}
          >
            ← Back
          </button>
        )}
      </div>

      {/* Bottom illustration */}
      <div style={{ marginTop: 'auto', padding: '40px 20px 0', textAlign: 'center', color: 'rgba(255,255,255,0.1)', fontSize: '12px' }}>
        Your personal keeper. Private, offline-first, always yours.
      </div>
    </div>
  );
      }
