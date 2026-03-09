'use client';
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
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) { router.replace('/login'); return; }
      setUser(session.user);
      setName(session.user.user_metadata?.full_name || session.user.email?.split('@')[0] || '');
    });
  }, [router]);

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
          onboarding_done: true,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id' });

      if (profileErr) {
        console.error('Profile upsert error:', profileErr);
        throw profileErr;
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
    <div style={{ minHeight: '100vh', background: '#0a0a0f', color: '#f1f5f9', fontFamily: "'DM Sans',-apple-system,sans-serif", display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '0 0 60px' }}>

      {/* Header */}
      <div style={{ width: '100%', maxWidth: '480px', padding: '32px 20px 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '32px' }}>
          <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: '#6366f1', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px' }}>🔒</div>
          <span style={{ fontWeight: '700', fontSize: '16px', color: '#f1f5f9' }}>QuietKeep</span>
        </div>

        {/* Progress dots */}
        <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
          {STEPS.map((s, i) => (
            <div key={s.id} style={{ height: '3px', flex: 1, borderRadius: '2px', background: i <= step ? '#6366f1' : '#1e293b', transition: 'background 0.3s' }} />
          ))}
        </div>
        <p style={{ fontSize: '12px', color: '#475569', margin: '0 0 28px' }}>Step {step + 1} of {STEPS.length}</p>

        <h1 style={{ fontSize: '24px', fontWeight: '700', color: '#f1f5f9', margin: '0 0 8px' }}>{currentStep.title}</h1>
        <p style={{ fontSize: '14px', color: '#64748b', margin: '0 0 28px' }}>{currentStep.subtitle}</p>
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
            style={{ width: '100%', background: '#0f0f1a', border: '1px solid #1e293b', borderRadius: '12px', padding: '16px', color: '#f1f5f9', fontSize: '16px', outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit' }}
          />
        )}

        {/* Step 1: Calendar */}
        {step === 1 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {CALENDARS.map(cal => (
              <button
                key={cal.value}
                onClick={() => setCalendar(cal.value)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '14px',
                  padding: '14px 16px', borderRadius: '12px', cursor: 'pointer',
                  border: `1px solid ${calendar === cal.value ? '#6366f1' : '#1e293b'}`,
                  background: calendar === cal.value ? 'rgba(99,102,241,0.1)' : '#0f0f1a',
                  textAlign: 'left', minHeight: '60px',
                  WebkitTapHighlightColor: 'transparent',
                }}
              >
                <span style={{ fontSize: '22px' }}>{cal.emoji}</span>
                <div>
                  <div style={{ fontSize: '14px', fontWeight: '600', color: calendar === cal.value ? '#a5b4fc' : '#f1f5f9' }}>{cal.label}</div>
                  <div style={{ fontSize: '12px', color: '#475569', marginTop: '2px' }}>{cal.desc}</div>
                </div>
                {calendar === cal.value && <span style={{ marginLeft: 'auto', color: '#6366f1', fontSize: '18px' }}>✓</span>}
              </button>
            ))}
          </div>
        )}

        {/* Step 2: First keep */}
        {step === 2 && (
          <textarea
            value={firstKeep}
            onChange={e => setFirstKeep(e.target.value)}
            placeholder="e.g. Call dad on Sunday, or Buy milk tomorrow..."
            rows={4}
            style={{ width: '100%', background: '#0f0f1a', border: '1px solid #1e293b', borderRadius: '12px', padding: '14px 16px', color: '#f1f5f9', fontSize: '15px', outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit', resize: 'none', lineHeight: '1.5' }}
          />
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
            style={{ width: '100%', background: saving ? '#1a1a2e' : '#6366f1', color: saving ? '#334155' : '#fff', border: 'none', borderRadius: '12px', padding: '16px', fontSize: '15px', fontWeight: '700', cursor: saving ? 'not-allowed' : 'pointer', minHeight: '52px', WebkitTapHighlightColor: 'transparent' }}
          >
            {saving ? 'Setting up your space…' : step < STEPS.length - 1 ? 'Continue →' : "Let's go →"}
          </button>

          {step === 2 && !saving && (
            <button
              onClick={skipKeep}
              style={{ width: '100%', background: 'transparent', color: '#475569', border: '1px solid #1e293b', borderRadius: '12px', padding: '14px', fontSize: '14px', cursor: 'pointer', minHeight: '48px' }}
            >
              Skip for now
            </button>
          )}

          {step > 0 && !saving && (
            <button
              onClick={() => setStep(s => s - 1)}
              style={{ width: '100%', background: 'transparent', color: '#475569', border: 'none', padding: '10px', fontSize: '13px', cursor: 'pointer' }}
            >
              ← Back
            </button>
          )}
        </div>
      </div>
    </div>
  );
          }
