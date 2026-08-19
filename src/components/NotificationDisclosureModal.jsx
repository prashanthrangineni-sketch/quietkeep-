'use client';
import { useLanguage } from '@/lib/context/language';
import enMessages from '@/messages/en.json';
import hiMessages from '@/messages/hi.json';
import teMessages from '@/messages/te.json';

const MESSAGES = {
  'en-IN': enMessages,
  'en-US': enMessages,
  'hi-IN': hiMessages,
  'te-IN': teMessages,
};

export default function NotificationDisclosureModal({ isOpen, onContinue, onCancel }) {
  const { voiceLang } = useLanguage?.() || { voiceLang: 'en-IN' };
  const msgs = (MESSAGES[voiceLang] || enMessages)?.notificationDisclosure || enMessages.notificationDisclosure;

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="notification-disclosure-title"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: 'var(--bg, #090d16)',
        color: 'var(--text, #f1f5f9)',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '28px 24px calc(28px + env(safe-area-inset-bottom, 0px))',
        boxSizing: 'border-box',
        overflowY: 'auto',
        fontFamily: 'inherit',
      }}
    >
      <div style={{ maxWidth: 540, margin: '0 auto', width: '100%', paddingTop: 16 }}>
        {/* Prominent Header & Badge */}
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.25)', borderRadius: 20, padding: '6px 14px', marginBottom: 20 }}>
          <span style={{ fontSize: 16 }}>🔔</span>
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--primary, #818cf8)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
            Notification Permission Disclosure
          </span>
        </div>

        <h1
          id="notification-disclosure-title"
          style={{
            fontSize: 24,
            fontWeight: 800,
            lineHeight: 1.25,
            color: 'var(--text, #f1f5f9)',
            marginBottom: 16,
            letterSpacing: '-0.02em',
          }}
        >
          {msgs.title}
        </h1>

        <p
          style={{
            fontSize: 15,
            lineHeight: 1.6,
            color: 'var(--text-muted, #94a3b8)',
            marginBottom: 20,
          }}
        >
          {msgs.intro}
        </p>

        {/* Highlighted Policy Card */}
        <div
          style={{
            background: 'var(--surface, #131b2e)',
            border: '1px solid var(--border, rgba(255,255,255,0.08))',
            borderRadius: 16,
            padding: '20px',
            marginBottom: 20,
          }}
        >
          <div
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: 'var(--text, #f1f5f9)',
              marginBottom: 14,
              lineHeight: 1.4,
            }}
          >
            {msgs.bulletHeader}
          </div>

          <ul
            style={{
              margin: 0,
              paddingLeft: 20,
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
              color: 'var(--text, #f1f5f9)',
              fontSize: 14,
              lineHeight: 1.5,
            }}
          >
            <li>
              <strong>{msgs.bullet1}</strong>
            </li>
            <li>
              <strong>{msgs.bullet2}</strong>
            </li>
            <li>
              <strong>{msgs.bullet3}</strong>
            </li>
          </ul>
        </div>

        <p
          style={{
            fontSize: 13,
            lineHeight: 1.6,
            color: 'var(--text-subtle, #64748b)',
            margin: '0 0 24px 0',
          }}
        >
          {msgs.optional}
        </p>
      </div>

      {/* Two Prominent Action Buttons */}
      <div
        style={{
          maxWidth: 540,
          margin: '0 auto',
          width: '100%',
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 14,
          paddingTop: 12,
          borderTop: '1px solid var(--border, rgba(255,255,255,0.08))',
        }}
      >
        <button
          type="button"
          onClick={onCancel}
          style={{
            padding: '14px 20px',
            borderRadius: 12,
            border: '1.5px solid var(--border, rgba(255,255,255,0.15))',
            background: 'var(--surface, #1e293b)',
            color: 'var(--text, #f1f5f9)',
            fontSize: 15,
            fontWeight: 700,
            cursor: 'pointer',
            fontFamily: 'inherit',
            transition: 'all 0.15s ease',
            textAlign: 'center',
          }}
        >
          {msgs.notNow}
        </button>

        <button
          type="button"
          onClick={onContinue}
          style={{
            padding: '14px 20px',
            borderRadius: 12,
            border: 'none',
            background: 'linear-gradient(135deg, #4f46e5, #6366f1)',
            color: '#ffffff',
            fontSize: 15,
            fontWeight: 700,
            cursor: 'pointer',
            fontFamily: 'inherit',
            boxShadow: '0 4px 16px rgba(79, 70, 229, 0.35)',
            transition: 'all 0.15s ease',
            textAlign: 'center',
          }}
        >
          {msgs.continue}
        </button>
      </div>
    </div>
  );
}