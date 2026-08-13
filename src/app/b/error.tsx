'use client';
// src/app/b/error.tsx — Error boundary for all business /b/* pages

import { useEffect } from 'react';
import Link from 'next/link';

export default function BizError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[QuietKeep Business Error]', error);
  }, [error]);

  return (
    <div style={{
      minHeight: '100dvh', background: 'linear-gradient(135deg,#0a1628,#0d2a1e)',
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', padding: '24px 16px',
      fontFamily: "'Inter', system-ui, sans-serif", textAlign: 'center',
    }}>
      <div style={{ fontSize: 52, marginBottom: 16 }}>⚠️</div>
      <h1 style={{ fontSize: 22, fontWeight: 800, color: '#f1f5f9', margin: '0 0 8px' }}>
        Something went wrong
      </h1>
      <p style={{ fontSize: 14, color: '#64748b', lineHeight: 1.7, margin: '0 0 24px', maxWidth: 360 }}>
        A business page error occurred. Your data is safe. Try again or return to the business dashboard.
      </p>

      {process.env.NODE_ENV === 'development' && error?.message && (
        <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 10, padding: '12px 16px', fontSize: 11, color: '#ef4444', marginBottom: 20, maxWidth: 400, textAlign: 'left', fontFamily: 'monospace', wordBreak: 'break-all' }}>
          {error.message}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
        <button
          onClick={reset}
          style={{ padding: '12px 24px', borderRadius: 10, border: 'none', background: '#10b981', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}
        >
          Try again
        </button>
        <Link
          href="/b/dashboard"
          style={{ padding: '12px 24px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.12)', color: '#94a3b8', fontSize: 14, fontWeight: 600, textDecoration: 'none', display: 'inline-block' }}
        >
          Back to business dashboard
        </Link>
      </div>
    </div>
  );
}
