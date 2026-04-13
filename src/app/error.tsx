'use client';
// src/app/error.tsx — Root error boundary for Next.js App Router
// Catches any runtime error in any personal page component

import { useEffect } from 'react';
import Link from 'next/link';

export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log to console for debugging
    console.error('[QuietKeep Error]', error);
  }, [error]);

  return (
    <div style={{
      minHeight: '100dvh', background: 'var(--bg)', color: 'var(--text)',
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', padding: '24px 16px',
      fontFamily: "'Inter', system-ui, sans-serif",
      textAlign: 'center',
    }}>
      <div style={{ fontSize: 52, marginBottom: 16 }}>😔</div>
      <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text)', margin: '0 0 8px', letterSpacing: '-0.5px' }}>
        Something went wrong
      </h1>
      <p style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.7, margin: '0 0 24px', maxWidth: 360 }}>
        We hit an unexpected error. Your data is safe. You can try again or go back to your keeps.
      </p>

      {process.env.NODE_ENV === 'development' && error?.message && (
        <div style={{ background: 'var(--red-dim)', border: '1px solid rgba(220,38,38,0.2)', borderRadius: 10, padding: '12px 16px', fontSize: 11, color: 'var(--red)', marginBottom: 20, maxWidth: 400, textAlign: 'left', fontFamily: 'monospace', wordBreak: 'break-all' }}>
          {error.message}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
        <button
          onClick={reset}
          style={{
            padding: '12px 24px', borderRadius: 10, border: 'none',
            background: 'var(--primary)', color: '#fff', fontSize: 14, fontWeight: 700,
            cursor: 'pointer', fontFamily: 'inherit',
          }}
        >
          Try again
        </button>
        <Link
          href="/dashboard"
          style={{
            padding: '12px 24px', borderRadius: 10,
            border: '1.5px solid var(--border)', color: 'var(--text-muted)',
            fontSize: 14, fontWeight: 600, textDecoration: 'none',
            display: 'inline-block',
          }}
        >
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}
