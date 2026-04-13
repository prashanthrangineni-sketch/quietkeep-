'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useState } from 'react';

export default function Navbar() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <nav style={{
      position: 'sticky',
      top: 0,
      zIndex: 1000,
      backgroundColor: 'var(--bg)',
      borderBottom: '1px solid #1e1e2e',
      backdropFilter: 'blur(12px)',
      WebkitBackdropFilter: 'blur(12px)',
    }}>
      <div style={{
        maxWidth: '1200px',
        margin: '0 auto',
        padding: '0 24px',
        height: '64px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        {/* Logo */}
        <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: '10px', textDecoration: 'none' }}>
          <div style={{
            width: '36px',
            height: '36px',
            background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
            borderRadius: '8px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: '800',
            fontSize: '16px',
            color: '#fff',
            letterSpacing: '-0.5px',
          }}>QK</div>
          <span style={{
            fontSize: '18px',
            fontWeight: '700',
            color: '#f1f5f9',
            letterSpacing: '-0.3px',
          }}>QuietKeep</span>
        </Link>

        {/* Desktop Nav */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '32px' }}>
          <Link href="/dashboard" style={{
            color: '#94a3b8',
            textDecoration: 'none',
            fontSize: '14px',
            fontWeight: '500',
            transition: 'color 0.2s',
          }}
            onMouseEnter={e => e.target.style.color = '#f1f5f9'}
            onMouseLeave={e => e.target.style.color = '#94a3b8'}
          >
            Dashboard
          </Link>

          <Link href="/login" style={{
            backgroundColor: '#6366f1',
            color: '#fff',
            textDecoration: 'none',
            padding: '8px 20px',
            borderRadius: '8px',
            fontSize: '14px',
            fontWeight: '600',
            transition: 'background-color 0.2s',
          }}
            onMouseEnter={e => e.target.style.backgroundColor = '#4f46e5'}
            onMouseLeave={e => e.target.style.backgroundColor = '#6366f1'}
          >
            Sign In
          </Link>
        </div>
      </div>
    </nav>
  );
}
