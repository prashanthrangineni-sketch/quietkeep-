'use client';

import './globals.css';
import Link from 'next/link';

function Navbar() {
  return (
    <nav style={{
      position: 'sticky', top: 0, zIndex: 1000,
      backgroundColor: '#0a0a0f',
      borderBottom: '1px solid #1e1e2e',
      backdropFilter: 'blur(12px)',
      WebkitBackdropFilter: 'blur(12px)',
    }}>
      <div style={{
        maxWidth: '1200px', margin: '0 auto', padding: '0 24px',
        height: '64px', display: 'flex', alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: '10px', textDecoration: 'none' }}>
          <div style={{
            width: '36px', height: '36px',
            background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
            borderRadius: '8px', display: 'flex', alignItems: 'center',
            justifyContent: 'center', fontWeight: '800', fontSize: '16px', color: '#fff',
          }}>QK</div>
          <span style={{ fontSize: '18px', fontWeight: '700', color: '#f1f5f9' }}>QuietKeep</span>
        </Link>
        <div style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>
          <Link href="/dashboard" style={{ color: '#94a3b8', textDecoration: 'none', fontSize: '14px', fontWeight: '500' }}>
            Dashboard
          </Link>
          <Link href="/login" style={{
            backgroundColor: '#6366f1', color: '#fff', textDecoration: 'none',
            padding: '8px 20px', borderRadius: '8px', fontSize: '14px', fontWeight: '600',
          }}>Sign In</Link>
        </div>
      </div>
    </nav>
  );
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body style={{
        margin: 0, padding: 0,
        backgroundColor: '#0a0a0f',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      }}>
        <Navbar />
        {children}
      </body>
    </html>
  );
}
