'use client';
// src/app/messages/compose/page.jsx — "Send anywhere" universal composer
import Link from 'next/link';
import ShareTo from '@/components/ShareTo';

export default function ComposePage() {
  return (
    <div style={{ maxWidth: 520, margin: '0 auto', padding: 16, fontFamily: "'Inter',-apple-system,sans-serif" }}>
      <div style={{ marginBottom: 4 }}>
        <Link href="/messages" style={{ color: '#5b5ef4', textDecoration: 'none', fontWeight: 700, fontSize: 14 }}>← Messages</Link>
      </div>
      <h1 style={{ fontSize: 22, fontWeight: 800, margin: '4px 0' }}>Send anywhere</h1>
      <p style={{ color: '#64748b', fontSize: 14, margin: '0 0 18px' }}>
        Write once, send through WhatsApp, Telegram, SMS, Instagram, Snap — any app on your phone.
      </p>
      <ShareTo />
    </div>
  );
}
