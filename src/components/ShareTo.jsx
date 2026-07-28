'use client';
// src/components/ShareTo.jsx
// ─────────────────────────────────────────────────────────────────────────────
// Universal outbound "Send via…" composer — the compliant half of a messaging hub.
// Compose once, hand off to ANY installed app via the native share sheet
// (Web Share API) or app deep links. No API keys, no ToS risk, works on Android
// AND iOS. It cannot read replies — it composes and hands off, by design.
//
// (A true unified INBOX for WhatsApp/Insta/Snap is not possible compliantly — no
// personal-account APIs exist. This is the safe, universal outbound layer.)
// ─────────────────────────────────────────────────────────────────────────────
import { useState } from 'react';

const G = '#5b5ef4';

// Each target builds a deep link from the composed text (+ optional recipient).
const TARGETS = [
  { key: 'whatsapp', label: 'WhatsApp', emoji: '🟢',
    href: (t, to) => to ? `https://wa.me/${to.replace(/\D/g, '')}?text=${enc(t)}` : `https://wa.me/?text=${enc(t)}` },
  { key: 'telegram', label: 'Telegram', emoji: '✈️',
    href: (t) => `https://t.me/share/url?url=&text=${enc(t)}` },
  { key: 'sms', label: 'SMS', emoji: '💬',
    href: (t, to) => `sms:${to ? to.replace(/[^\d+]/g, '') : ''}?&body=${enc(t)}` },
  { key: 'email', label: 'Email', emoji: '✉️',
    href: (t) => `mailto:?body=${enc(t)}` },
  { key: 'x', label: 'X', emoji: '𝕏',
    href: (t) => `https://twitter.com/intent/tweet?text=${enc(t)}` },
];

function enc(s) { return encodeURIComponent(s || ''); }

export default function ShareTo({ initialText = '', recipientHint = true }) {
  const [text, setText] = useState(initialText);
  const [to, setTo] = useState('');
  const [copied, setCopied] = useState(false);
  const canNativeShare = typeof navigator !== 'undefined' && !!navigator.share;

  async function nativeShare() {
    if (!text.trim()) return;
    try { await navigator.share({ text }); } catch (_) { /* user cancelled */ }
  }

  function copy() {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 1600);
    });
  }

  const disabled = !text.trim();

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder="Type your message once — send it anywhere…"
        rows={4}
        style={ta}
      />
      {recipientHint && (
        <input
          value={to}
          onChange={e => setTo(e.target.value)}
          placeholder="Optional: phone number (for WhatsApp / SMS)"
          inputMode="tel"
          style={inp}
        />
      )}

      {canNativeShare && (
        <button onClick={nativeShare} disabled={disabled} style={{ ...btn, opacity: disabled ? 0.5 : 1 }}>
          📲 Share via any app…
        </button>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(96px,1fr))', gap: 10 }}>
        {TARGETS.map(t => (
          <a
            key={t.key}
            href={disabled ? undefined : t.href(text, to)}
            target="_blank"
            rel="noreferrer"
            aria-disabled={disabled}
            style={{ ...tile, pointerEvents: disabled ? 'none' : 'auto', opacity: disabled ? 0.5 : 1 }}
          >
            <span style={{ fontSize: 22 }}>{t.emoji}</span>
            <span style={{ fontSize: 12, fontWeight: 700 }}>{t.label}</span>
          </a>
        ))}
        <button onClick={copy} disabled={disabled} style={{ ...tile, border: 'none', cursor: 'pointer', opacity: disabled ? 0.5 : 1 }}>
          <span style={{ fontSize: 22 }}>{copied ? '✅' : '📋'}</span>
          <span style={{ fontSize: 12, fontWeight: 700 }}>{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </div>

      <p style={{ fontSize: 12, color: '#94a3b8', margin: 0, lineHeight: 1.5 }}>
        QuietKeep composes your message and hands it to the app you pick — it doesn’t read your other chats.
        For Instagram &amp; Snapchat, use “Share via any app…” and choose them in the share sheet.
      </p>
    </div>
  );
}

const ta = { width: '100%', padding: '13px 14px', border: '1.5px solid rgba(0,0,0,.12)', borderRadius: 12, fontSize: 15, fontFamily: 'inherit', outline: 'none', resize: 'vertical', boxSizing: 'border-box' };
const inp = { width: '100%', padding: '11px 14px', border: '1.5px solid rgba(0,0,0,.12)', borderRadius: 10, fontSize: 15, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' };
const btn = { padding: '13px 18px', border: 0, borderRadius: 12, background: G, color: '#fff', fontWeight: 700, fontSize: 15, cursor: 'pointer' };
const tile = { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '14px 8px', background: '#fff', border: '1px solid rgba(0,0,0,.09)', borderRadius: 14, textDecoration: 'none', color: '#334155', boxShadow: '0 4px 14px rgba(80,90,160,.06)' };
