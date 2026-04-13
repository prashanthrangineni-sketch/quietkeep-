'use client';
import { useAuth } from '@/lib/context/auth';
import { safeFetch } from '@/lib/safeFetch';
// File: src/app/onboarding/page.jsx
// FIX 3: Robust onboarding — handles both INSERT (new user) and UPDATE (existing row)
// Uses upsert so it never fails if profile row already exists

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

const PERSONAS = [
  { value: 'professional', emoji: '👔', label: 'Professional', desc: 'Work reminders, meetings, expenses' },
  { value: 'homemaker', emoji: '🏠', label: 'Homemaker', desc: 'Family, groceries, bills, kids' },
  { value: 'student', emoji: '📚', label: 'Student', desc: 'Assignments, deadlines, notes' },
  { value: 'business_owner', emoji: '🏢', label: 'Business Owner', desc: 'Team tasks, clients, finance' },
  { value: 'elderly', emoji: '👴', label: 'Caregiver / Senior', desc: 'Medications, appointments, family' },
];

const STEPS = [
  { id: 'name', title: 'What should we call you?', subtitle: 'Your name stays private.' },
  { id: 'persona', title: 'How do you use QuietKeep?', subtitle: "We'll personalise your experience." },
  { id: 'calendar', title: 'Pick your calendar tradition', subtitle: 'Your daily brief will show relevant events.' },
  { id: 'keep', title: 'Add your first keep', subtitle: 'A keep is anything you want to remember.' },
];

export default function OnboardingPage() {
  const { user, accessToken, loading: authLoading } = useAuth();
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [calendar, setCalendar] = useState('gregorian');
  const [persona, setPersona] = useState('professional');
  const [referralCode, setReferralCode] = useState('');
  const [firstKeep, setFirstKeep] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.replace('/login'); return; }
    setName(user?.user_metadata?.full_name || user?.email?.split('@')[0] || '');
  }, [user, router]);

  async function handleNext() {
    setError('');
    if (step === 0 && !name.trim()) { setError('Please enter your name.'); return; }
    if (step < STEPS.length - 1) { setStep(s => s + 1); return; }
    await finishOnboarding();
  }

  async function finishOnboarding() {
    if (!user) return;
    setSaving(true);
    setError('');
    try {
      // FIX 3: Use upsert so it works whether profile row exists or not
      const { error: profileErr } = await supabase
        .from('profiles')
        .upsert({
          user_id: user.id,
          full_name: name.trim(),
          selected_calendar: calendar,
          persona_type: persona,
          onboarding_done: true,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id' });

      if (profileErr) {
        console.error('Profile upsert error:', profileErr);
        throw profileErr;
      }

      // Apply referral code if provided
      if (referralCode.trim()) {
        try {
          safeFetch('/api/referral').catch(()=>{});
        } catch {} // silent fail — don't block onboarding
      }

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
      console.error('Onboarding error:', e);
      setError('Something went wrong. Please try again.');
      setSaving(false);
    }
  }

  async function skipKeep() {
    setFirstKeep('');
    await finishOnboarding();
  }

  const currentStep = STEPS[step];

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--text)', fontFamily: "'DM Sans',-apple-system,sans-serif", display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '0 0 60px' }}>

      {/* Header */}
      <div style={{ width: '100%', maxWidth: '480px', padding: '32px 20px 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '32px' }}>
          <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: '#6366f1', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px' }}>🔒</div>
          <span style={{ fontWeight: '700', fontSize: '16px', color: 'var(--text)' }}>QuietKeep</span>
        </div>

        {/* Progress dots */}
        <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
          {STEPS.map((s, i) => (
            <div key={s.id} style={{ height: '3px', flex: 1, borderRadius: '2px', background: i <= step ? 'var(--primary)' : 'var(--border)', transition: 'background 0.3s' }} />
          ))}
        </div>
        <p style={{ fontSize: '12px', color: 'var(--text-subtle)', margin: '0 0 28px' }}>Step {step + 1} of {STEPS.length}</p>

        <h1 style={{ fontSize: '24px', fontWeight: '700', color: 'var(--text)', margin: '0 0 8px' }}>{currentStep.title}</h1>
        <p style={{ fontSize: '14px', color: 'var(--text-muted)', margin: '0 0 28px' }}>{currentStep.subtitle}</p>
      </div>

      {/* Step content */}
      <div style={{ width: '100%', maxWidth: '480px', padding: '0 20px' }}>

        {/* Step 0: Name */}
        {step === 0 && (
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleNext()}
            placeholder="Your name"
            autoFocus
            style={{ width: '100%', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '12px', padding: '16px', color: 'var(--text)', fontSize: '16px', outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit' }}
          />
        )}

        {/* Step 1: Persona */}
        {step === 1 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {PERSONAS.map(p => (
              <button key={p.value} onClick={() => setPersona(p.value)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 14,
                  padding: '14px 16px', borderRadius: '12px', cursor: 'pointer',
                  border: `1px solid ${persona === p.value ? '#6366f1' : 'var(--border)'}`,
                  background: persona === p.value ? 'var(--primary-dim)' : 'var(--surface)',
                  textAlign: 'left', WebkitTapHighlightColor: 'transparent',
                }}>
                <span style={{ fontSize: 24 }}>{p.emoji}</span>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: persona === p.value ? 'var(--primary)' : 'var(--text)' }}>{p.label}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 2 }}>{p.desc}</div>
                </div>
                {persona === p.value && <span style={{ marginLeft: 'auto', color: 'var(--primary)', fontSize: 18 }}>✓</span>}
              </button>
            ))}
          </div>
        )}

        {/* Step 2: Calendar */}
        {step === 2 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {CALENDARS.map(cal => (
              <button
                key={cal.value}
                onClick={() => setCalendar(cal.value)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '14px',
                  padding: '14px 16px', borderRadius: '12px', cursor: 'pointer',
                  border: `1px solid ${calendar === cal.value ? '#6366f1' : 'var(--border)'}`,
                  background: calendar === cal.value ? 'var(--primary-dim)' : 'var(--surface)',
                  textAlign: 'left', minHeight: '60px',
                  WebkitTapHighlightColor: 'transparent',
                }}
              >
                <span style={{ fontSize: '22px' }}>{cal.emoji}</span>
                <div>
                  <div style={{ fontSize: '14px', fontWeight: '600', color: calendar === cal.value ? 'var(--primary)' : 'var(--text)' }}>{cal.label}</div>
                  <div style={{ fontSize: '12px', color: 'var(--text-subtle)', marginTop: '2px' }}>{cal.desc}</div>
                </div>
                {calendar === cal.value && <span style={{ marginLeft: 'auto', color: '#6366f1', fontSize: '18px' }}>✓</span>}
              </button>
            ))}
          </div>
        )}

        {/* Step 3: First keep */}
        {step === 3 && (
          <>
            <textarea
              value={firstKeep}
              onChange={e => setFirstKeep(e.target.value)}
              placeholder="e.g. Call dad on Sunday, or Buy milk tomorrow..."
              rows={3}
              style={{ width: '100%', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '12px', padding: '14px 16px', color: 'var(--text)', fontSize: '15px', outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit', resize: 'none', lineHeight: '1.5' }}
            />
            <div style={{ marginTop: 14 }}>
              <label style={{ fontSize: 12, color: 'var(--text-subtle)', display: 'block', marginBottom: 6 }}>Got a referral code? (optional — gives you 30 days Premium free)</label>
              <input
                value={referralCode}
                onChange={e => setReferralCode(e.target.value.toUpperCase())}
                placeholder="e.g. PRASHANTH1234"
                style={{ width: '100%', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '10px', padding: '12px 14px', color: 'var(--text)', fontSize: '14px', outline: 'none', boxSizing: 'border-box', fontFamily: 'monospace', letterSpacing: '0.06em' }}
              />
            </div>
          </>
        )}

        {error && (
          <div style={{ marginTop: '12px', padding: '10px 14px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: '8px', color: '#ef4444', fontSize: '13px' }}>
            {error}
          </div>
        )}

        {/* Actions */}
        <div style={{ marginTop: '24px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <button
            onClick={handleNext}
            disabled={saving}
            style={{ width: '100%', background: saving ? 'var(--border)' : 'var(--primary)', color: saving ? 'var(--text-subtle)' : '#fff', border: 'none', borderRadius: '12px', padding: '16px', fontSize: '15px', fontWeight: '700', cursor: saving ? 'not-allowed' : 'pointer', minHeight: '52px', WebkitTapHighlightColor: 'transparent' }}
          >
            {saving ? 'Setting up your space…' : step < STEPS.length - 1 ? 'Continue →' : "Let's go →"}
          </button>

          {step === 3 && !saving && (
            <button
              onClick={skipKeep}
              style={{ width: '100%', background: 'transparent', color: 'var(--text-subtle)', border: '1px solid var(--border)', borderRadius: '12px', padding: '14px', fontSize: '14px', cursor: 'pointer', minHeight: '48px' }}
            >
              Skip for now
            </button>
          )}

          {step > 0 && !saving && (
            <button
              onClick={() => setStep(s => s - 1)}
              style={{ width: '100%', background: 'transparent', color: 'var(--text-subtle)', border: 'none', padding: '10px', fontSize: '13px', cursor: 'pointer' }}
            >
              ← Back
            </button>
          )}
        </div>
      </div>
    </div>
  );
                      }
