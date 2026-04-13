'use client';
/**
 * ConsentScreen — DPDP Act 2023 compliance
 * Shows what data is collected and why, with individual toggles.
 * Core consent (voice + location) required to proceed.
 */
import { useState } from 'react';

const CONSENT_ITEMS = [
  { key: 'voice_data_consent', label: 'Voice Data', desc: 'Record and process voice input for notes, reminders, and commands.', required: true, icon: '🎤' },
  { key: 'location_data_consent', label: 'Location Data', desc: 'Use your location for geo-triggered reminders and contextual suggestions.', required: false, icon: '📍' },
  { key: 'health_data_consent', label: 'Health Data', desc: 'Track water, sleep, exercise for health insights and streaks.', required: false, icon: '❤️' },
  { key: 'finance_data_consent', label: 'Finance Data', desc: 'Record expenses, budgets, and subscriptions for financial tracking.', required: false, icon: '💰' },
  { key: 'messaging_data_consent', label: 'Messaging Data', desc: 'Store messages with other QK users for conversations.', required: false, icon: '💬' },
  { key: 'marketing_consent', label: 'Updates & Tips', desc: 'Receive product updates and usage tips via email.', required: false, icon: '📧' },
];

export default function ConsentScreen({ onConsent }) {
  const [consents, setConsents] = useState(
    Object.fromEntries(CONSENT_ITEMS.map(c => [c.key, c.required]))
  );

  function toggle(key) {
    const item = CONSENT_ITEMS.find(c => c.key === key);
    if (item?.required) return; // Can't disable required
    setConsents(prev => ({ ...prev, [key]: !prev[key] }));
  }

  const canProceed = CONSENT_ITEMS.filter(c => c.required).every(c => consents[c.key]);

  return (
    <div style={{ maxWidth: 440, margin: '0 auto', padding: '0 20px' }}>
      <div style={{ textAlign: 'center', marginBottom: 24 }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>🔒</div>
        <h2 style={{ fontSize: 20, fontWeight: 800, color: 'var(--text)', marginBottom: 6 }}>Your Data, Your Choice</h2>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6, maxWidth: 320, margin: '0 auto' }}>
          QuietKeep processes data only on your device and your Supabase account. Nothing is sold or shared with third parties.
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 24 }}>
        {CONSENT_ITEMS.map(item => (
          <div key={item.key}
            onClick={() => toggle(item.key)}
            style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '14px 16px', borderRadius: 12, cursor: item.required ? 'default' : 'pointer',
              background: consents[item.key] ? 'rgba(99,102,241,0.08)' : 'var(--surface)',
              border: `1px solid ${consents[item.key] ? 'rgba(99,102,241,0.25)' : 'var(--border)'}`,
              transition: 'all 0.2s',
            }}>
            <span style={{ fontSize: 22, flexShrink: 0 }}>{item.icon}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 6 }}>
                {item.label}
                {item.required && <span style={{ fontSize: 10, color: 'var(--primary)', background: 'rgba(99,102,241,0.15)', padding: '1px 6px', borderRadius: 4, fontWeight: 700 }}>Required</span>}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2, lineHeight: 1.4 }}>{item.desc}</div>
            </div>
            <div style={{
              width: 40, height: 22, borderRadius: 11, flexShrink: 0,
              background: consents[item.key] ? '#6366f1' : 'var(--border-strong)',
              position: 'relative', transition: 'background 0.2s',
              opacity: item.required ? 0.7 : 1,
            }}>
              <div style={{
                position: 'absolute', top: 2, width: 18, height: 18, borderRadius: '50%', background: '#fff',
                left: consents[item.key] ? 20 : 2, transition: 'left 0.2s',
              }} />
            </div>
          </div>
        ))}
      </div>

      <div style={{ fontSize: 11, color: 'var(--text-subtle)', textAlign: 'center', marginBottom: 16, lineHeight: 1.6 }}>
        By proceeding you agree to our <a href="/privacy" style={{ color: 'var(--primary)', textDecoration: 'none' }}>Privacy Policy</a> and <a href="/terms" style={{ color: 'var(--primary)', textDecoration: 'none' }}>Terms of Service</a>.
        You can change these preferences anytime in Settings.
      </div>

      <button
        onClick={() => canProceed && onConsent(consents)}
        disabled={!canProceed}
        style={{
          width: '100%', padding: 14, borderRadius: 12, border: 'none',
          background: canProceed ? 'linear-gradient(135deg,#5b5ef4,#818cf8)' : 'var(--surface-hover)',
          color: canProceed ? '#fff' : 'var(--text-subtle)',
          fontSize: 15, fontWeight: 700, cursor: canProceed ? 'pointer' : 'not-allowed',
          fontFamily: 'inherit', boxShadow: canProceed ? '0 4px 20px rgba(91,94,244,0.3)' : 'none',
        }}
      >
        Continue
      </button>
    </div>
  );
}
