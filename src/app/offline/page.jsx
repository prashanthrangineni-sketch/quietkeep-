'use client';
// src/app/offline/page.jsx
// MUST be 'use client' — uses onClick event handler

export default function OfflinePage() {
  return (
    <div
      style={{
        minHeight: '100dvh',
        background: 'var(--bg)',
        color: 'var(--text)',
        fontFamily: "'Inter', system-ui, sans-serif",
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
        textAlign: 'center',
      }}
    >
      <div style={{ fontSize: 52, marginBottom: 20 }}>📡</div>
      <h1
        style={{
          fontSize: 22,
          fontWeight: 800,
          color: 'var(--text)',
          margin: '0 0 10px',
          letterSpacing: '-0.5px',
        }}
      >
        You&apos;re offline
      </h1>
      <p
        style={{
          fontSize: 14,
          color: 'var(--text-muted)',
          lineHeight: 1.7,
          maxWidth: 340,
          margin: '0 0 28px',
        }}
      >
        QuietKeep needs a connection to sync your keeps. Your data is safe and
        will update as soon as you&apos;re back online.
      </p>
      <button
        onClick={() => window.location.reload()}
        style={{
          padding: '12px 28px',
          borderRadius: 12,
          border: 'none',
          background: 'var(--primary)',
          color: '#fff',
          fontSize: 14,
          fontWeight: 700,
          cursor: 'pointer',
          fontFamily: 'inherit',
        }}
      >
        Try again
      </button>
    </div>
  );
}
