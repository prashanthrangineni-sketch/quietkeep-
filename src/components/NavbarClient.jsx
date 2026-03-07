'use client';
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { createBrowserClient } from '@supabase/ssr';

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

const NAV_LINKS = [
  { label: 'Dashboard', href: '/dashboard' },
  { label: 'Finance', href: '/finance' },
  { label: 'Calendar', href: '/calendar' },
  { label: 'Brief', href: '/daily-brief' },
  { label: 'Docs', href: '/documents' },
  { label: 'Family', href: '/family' },
  { label: 'Kids', href: '/kids' },
  { label: 'Driving', href: '/drive' },
  { label: 'Settings', href: '/settings' },
];

export default function NavbarClient() {
  const pathname = usePathname();
  const [user, setUser] = useState(null);
  const [showMenu, setShowMenu] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => setUser(user));
  }, []);

  async function signOut() {
    await supabase.auth.signOut();
    window.location.href = '/login';
  }

  const initial = (user?.email || 'U')[0].toUpperCase();

  return (
    <>
      <nav style={{
        background: '#111',
        borderBottom: '1px solid #1e1e1e',
        position: 'sticky',
        top: 0,
        zIndex: 50,
        width: '100%',
      }}>
        {/* Top bar: logo + user */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 1rem', height: 48 }}>
          <a href="/dashboard" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', textDecoration: 'none' }}>
            <div style={{ background: '#6366f1', color: '#fff', fontWeight: 800, borderRadius: 6, padding: '2px 7px', fontSize: '0.85rem' }}>QK</div>
            <span style={{ color: '#fff', fontWeight: 700, fontSize: '0.95rem' }}>QuietKeep</span>
          </a>
          {/* User dropdown */}
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setShowMenu(!showMenu)}
              style={{ background: '#6366f1', border: 'none', borderRadius: 20, color: '#fff', padding: '0.25rem 0.75rem', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.3rem' }}
            >
              {user?.email?.split('@')[0]?.slice(0, 12)} ▾
            </button>
            {showMenu && (
              <div style={{ position: 'absolute', right: 0, top: '110%', background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 10, minWidth: 160, overflow: 'hidden', boxShadow: '0 8px 24px rgba(0,0,0,0.5)' }}>
                <a href="/profile" onClick={() => setShowMenu(false)} style={{ display: 'block', padding: '0.7rem 1rem', color: '#fff', textDecoration: 'none', fontSize: '0.88rem', borderBottom: '1px solid #222' }}>👤 Profile</a>
                <button onClick={signOut} style={{ width: '100%', padding: '0.7rem 1rem', background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', textAlign: 'left', fontSize: '0.88rem' }}>Sign Out</button>
              </div>
            )}
          </div>
        </div>

        {/* Horizontal scrollable nav links — works in both browser and PWA */}
        <div style={{
          display: 'flex',
          overflowX: 'auto',
          padding: '0 0.75rem 0.5rem',
          gap: '0.25rem',
          // Hide scrollbar across browsers
          scrollbarWidth: 'none',
          msOverflowStyle: 'none',
          WebkitOverflowScrolling: 'touch',
        }}>
          {NAV_LINKS.map(({ label, href }) => {
            const active = pathname === href;
            return (
              <a
                key={href}
                href={href}
                style={{
                  flexShrink: 0,
                  textDecoration: 'none',
                  padding: '0.3rem 0.75rem',
                  borderRadius: 20,
                  fontSize: '0.82rem',
                  fontWeight: active ? 600 : 400,
                  background: active ? '#6366f1' : 'transparent',
                  color: active ? '#fff' : '#666',
                  border: active ? 'none' : '1px solid #222',
                  whiteSpace: 'nowrap',
                  transition: 'all 0.15s',
                }}
              >
                {label}
              </a>
            );
          })}
        </div>
      </nav>

      {/* Close dropdown on outside click */}
      {showMenu && <div onClick={() => setShowMenu(false)} style={{ position: 'fixed', inset: 0, zIndex: 49 }} />}
    </>
  );
}
