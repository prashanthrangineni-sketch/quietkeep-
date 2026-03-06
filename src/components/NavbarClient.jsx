'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { useState, useEffect } from 'react';

export default function NavbarClient() {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [showDropdown, setShowDropdown] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user);
    });
  }, []);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push('/login');
  };

  if (!user) return null;

  const isActive = (path) => pathname === path ? '#6366f1' : '#64748b';

  return (
    <nav style={{ backgroundColor: '#0f0f1a', borderBottom: '1px solid #1e293b', padding: '12px 20px', position: 'sticky', top: 0, zIndex: 100 }}>
      <div style={{ maxWidth: '1200px', margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }} onClick={() => router.push('/dashboard')}>
          <div style={{ width: '32px', height: '32px', backgroundColor: '#6366f1', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px', fontWeight: '800' }}>
            QK
          </div>
          <span style={{ fontSize: '14px', fontWeight: '700' }}>QuietKeep</span>
        </div>

        {/* Nav Links */}
        <div style={{ display: 'flex', gap: '24px', alignItems: 'center' }}>
          <Link href="/dashboard" style={{ color: isActive('/dashboard'), textDecoration: 'none', fontSize: '13px', fontWeight: '600', transition: 'color 0.2s' }}>Dashboard</Link>
          <Link href="/finance" style={{ color: isActive('/finance'), textDecoration: 'none', fontSize: '13px', fontWeight: '600', transition: 'color 0.2s' }}>Finance</Link>
          <Link href="/calendar" style={{ color: isActive('/calendar'), textDecoration: 'none', fontSize: '13px', fontWeight: '600', transition: 'color 0.2s' }}>Calendar</Link>
          <Link href="/daily-brief" style={{ color: isActive('/daily-brief'), textDecoration: 'none', fontSize: '13px', fontWeight: '600', transition: 'color 0.2s' }}>Brief</Link>
          <Link href="/driving" style={{ color: isActive('/driving'), textDecoration: 'none', fontSize: '13px', fontWeight: '600', transition: 'color 0.2s' }}>Driving</Link>
          <Link href="/settings" style={{ color: isActive('/settings'), textDecoration: 'none', fontSize: '13px', fontWeight: '600', transition: 'color 0.2s' }}>Settings</Link>
        </div>

        {/* User Menu */}
        <div style={{ position: 'relative' }}>
          <button 
            onClick={() => setShowDropdown(!showDropdown)}
            style={{ backgroundColor: '#6366f1', color: '#fff', border: 'none', padding: '8px 12px', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: '600' }}
          >
            {user.email?.split('@')[0]} ▼
          </button>
          
          {showDropdown && (
            <div style={{ position: 'absolute', top: '100%', right: 0, backgroundColor: '#0f0f1a', border: '1px solid #1e293b', borderRadius: '8px', marginTop: '4px', minWidth: '150px', boxShadow: '0 4px 12px rgba(0,0,0,0.3)' }}>
              <Link href="/profile" style={{ display: 'block', padding: '10px 12px', color: '#f1f5f9', textDecoration: 'none', fontSize: '12px', borderBottom: '1px solid #1e293b' }}>
                👤 Profile
              </Link>
              <button 
                onClick={() => { handleSignOut(); setShowDropdown(false); }}
                style={{ width: '100%', textAlign: 'left', backgroundColor: 'transparent', border: 'none', padding: '10px 12px', color: '#ef4444', cursor: 'pointer', fontSize: '12px', fontWeight: '600' }}
              >
                🚪 Sign Out
              </button>
            </div>
          )}
        </div>
      </div>
    </nav>
  );
}
