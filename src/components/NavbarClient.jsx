'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import NotificationBell from '@/components/NotificationBell';

const NAV_PRIMARY = [
  { href: '/dashboard', icon: '🏠', label: 'Home' },
  { href: '/keeps', icon: '📌', label: 'Keeps' },
  { href: '/reminders', icon: '⏰', label: 'Remind' },
  { href: '/calendar', icon: '📅', label: 'Calendar' },
  { href: '/daily-brief', icon: '☀️', label: 'Brief' },
];

const NAV_SECONDARY = [
  { href: '/finance', icon: '💰', label: 'Finance' },
  { href: '/documents', icon: '📄', label: 'Docs' },
  { href: '/health', icon: '❤️', label: 'Health' },
  { href: '/family', icon: '👨‍👩‍👧', label: 'Family' },
  { href: '/memories', icon: '🧠', label: 'Life' },
];

export default function NavbarClient() {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push('/login');
  }

  const isActive = (href) => pathname === href || pathname.startsWith(href + '/');

  if (!user) return null;

  return (
    <nav style={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 1000,
      background: 'rgba(10,10,15,0.95)',
      backdropFilter: 'blur(12px)',
      borderBottom: '1px solid rgba(255,255,255,0.06)',
    }}>
      {/* Top bar */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 16px', height: 48,
      }}>
        <Link href="/dashboard" style={{
          fontWeight: 800, fontSize: 18, color: '#6366f1',
          textDecoration: 'none', letterSpacing: '-0.5px',
        }}>
          QuietKeep
        </Link>

        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <NotificationBell />
          <Link href="/subscription" style={{
            fontSize: 11, color: '#6366f1', fontWeight: 700,
            border: '1px solid rgba(99,102,241,0.4)',
            borderRadius: 20, padding: '3px 10px',
            textDecoration: 'none',
          }}>
            ⭐ Pro
          </Link>
          <button
            onClick={handleSignOut}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: '#475569', fontSize: 20, padding: '6px 4px',
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            ⏻
          </button>
        </div>
      </div>

      {/* Primary nav row */}
      <div style={{
        display: 'flex', overflowX: 'auto', scrollbarWidth: 'none',
        borderBottom: '1px solid rgba(255,255,255,0.04)',
      }}>
        {NAV_PRIMARY.map(({ href, icon, label }) => (
          <Link key={href} href={href} style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            padding: '6px 14px', minWidth: 60, textDecoration: 'none',
            borderBottom: isActive(href) ? '2px solid #6366f1' : '2px solid transparent',
            transition: 'border-color 0.15s',
          }}>
            <span style={{ fontSize: 16 }}>{icon}</span>
            <span style={{
              fontSize: 9, color: isActive(href) ? '#6366f1' : '#64748b',
              fontWeight: isActive(href) ? 700 : 400, marginTop: 2,
            }}>
              {label}
            </span>
          </Link>
        ))}
      </div>

      {/* Secondary nav row */}
      <div style={{
        display: 'flex', overflowX: 'auto', scrollbarWidth: 'none',
      }}>
        {NAV_SECONDARY.map(({ href, icon, label }) => (
          <Link key={href} href={href} style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            padding: '5px 14px', minWidth: 60, textDecoration: 'none',
            borderBottom: isActive(href) ? '2px solid #a78bfa' : '2px solid transparent',
            transition: 'border-color 0.15s',
          }}>
            <span style={{ fontSize: 15 }}>{icon}</span>
            <span style={{
              fontSize: 9, color: isActive(href) ? '#a78bfa' : '#475569',
              fontWeight: isActive(href) ? 700 : 400, marginTop: 2,
            }}>
              {label}
            </span>
          </Link>
        ))}
      </div>
    </nav>
  );
}
