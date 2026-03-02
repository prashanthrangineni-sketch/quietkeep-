'use client';

import './globals.css';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

function Navbar() {
  const [user, setUser] = useState(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setChecked(true);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

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

        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          {checked && (
            user ? (
              <>
                <Link href="/dashboard" style={{
                  color: '#a5b4fc', textDecoration: 'none',
                  fontSize: '14px', fontWeight: '600',
                }}>
                  My Dashboard
                </Link>
                <button
                  onClick={() => supabase.auth.signOut()}
                  style={{
                    backgroundColor: 'transparent',
                    border: '1px solid #1e293b',
                    color: '#64748b', padding: '7px 16px',
                    borderRadius: '8px', fontSize: '13px',
                    cursor: 'pointer', fontWeight: '500',
                  }}
                >
                  Sign Out
                </button>
              </>
            ) : (
              <>
                <Link href="/dashboard" style={{ color: '#94a3b8', textDecoration: 'none', fontSize: '14px', fontWeight: '500' }}>
                  Dashboard
                </Link>
                <Link href="/login" style={{
                  backgroundColor: '#6366f1', color: '#fff', textDecoration: 'none',
                  padding: '8px 20px', borderRadius: '8px', fontSize: '14px', fontWeight: '600',
                }}>
                  Sign In
                </Link>
              </>
            )
          )}
        </div>
      </div>
    </nav>
  );
}
