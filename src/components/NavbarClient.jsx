'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import NotificationBell from '@/components/NotificationBell';

const NAV_LINKS = [
  { href: '/dashboard', icon: '🏠', label: 'Home' },
  { href: '/reminders', icon: '⏰', label: 'Remind' },
  { href: '/calendar', icon: '📅', label: 'Calendar' },
  { href: '/daily-brief', icon: '☀️', label: 'Brief' },
  { href: '/finance', icon: '💰', label: 'Finance' },
  { href: '/documents', icon: '📄', label: 'Docs' },
  { href: '/health', icon: '❤️', label: 'Health' },
  { href: '/family', icon: '👨‍👩‍👧', label: 'Family' },
  { href: '/memories', icon: '🧠', label: 'Life' },
  { href: '/mood', icon: '🧘', label: 'Mood' },
];

const BOTTOM_TABS = [
  { href: '/dashboard', icon: '🏠', label: 'Home' },
  { href: '/daily-brief', icon: '☀️', label: 'Brief' },
  { href: '/calendar', icon: '📅', label: 'Cal' },
  { href: '/reminders', icon: '⏰', label: 'Remind' },
  { href: '/more', icon: '☰', label: 'More' },
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
    <>
      {/* ── Top navbar ── */}
      <nav style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 1000,
        background: 'rgba(11,15,25,0.82)',
        backdropFilter: 'blur(20px) saturate(180%)',
        WebkitBackdropFilter: 'blur(20px) saturate(180%)',
        borderBottom: '1px solid rgba(255,255,255,0.08)',
      }}>
        {/* Brand row */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 16px', height: 48,
        }}>
          <Link href="/dashboard" style={{
            fontWeight: 800, fontSize: 18,
            background: 'linear-gradient(135deg, #818cf8, #c4b5fd)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
            textDecoration: 'none', letterSpacing: '-0.5px',
          }}>
            QuietKeep
          </Link>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <NotificationBell />
            <Link href="/subscription" style={{
              fontSize: 11, color: '#a5b4fc', fontWeight: 700,
              border: '1px solid rgba(99,102,241,0.35)',
              background: 'rgba(99,102,241,0.1)',
              borderRadius: 999, padding: '3px 10px',
              textDecoration: 'none',
            }}>
              ⭐ Pro
            </Link>
            <button
              onClick={handleSignOut}
              style={{
                background: 'none',
                border: '1px solid rgba(239,68,68,0.25)',
                borderRadius: 6, cursor: 'pointer',
                color: '#ef4444', fontSize: 11,
                fontWeight: 600, padding: '4px 10px',
                WebkitTapHighlightColor: 'transparent',
                fontFamily: 'inherit',
              }}
            >
              Sign Out
            </button>
          </div>
        </div>

        {/* Scrollable nav row */}
        <div style={{
          display: 'flex', overflowX: 'auto', scrollbarWidth: 'none',
          msOverflowStyle: 'none',
          borderTop: '1px solid rgba(255,255,255,0.05)',
          padding: '0 4px',
        }}>
          {NAV_LINKS.map(({ href, icon, label }) => {
            const active = isActive(href);
            return (
              <Link key={href} href={href} style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center',
                padding: '7px 13px', minWidth: 58, textDecoration: 'none',
                borderBottom: active ? '2px solid #6366f1' : '2px solid transparent',
                transition: 'border-color 0.18s',
                flexShrink: 0,
              }}>
                <span style={{ fontSize: 15 }}>{icon}</span>
                <span style={{
                  fontSize: 9, marginTop: 2, fontWeight: active ? 700 : 400,
                  color: active ? '#818cf8' : '#475569',
                  transition: 'color 0.18s',
                }}>
                  {label}
                </span>
              </Link>
            );
          })}
        </div>
      </nav>

      {/* ── Bottom tab bar ── */}
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 1000,
        background: 'rgba(11,15,25,0.92)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        borderTop: '1px solid rgba(255,255,255,0.08)',
        display: 'flex',
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
      }}>
        {BOTTOM_TABS.map(({ href, icon, label }) => {
          const active = href === '/more'
            ? pathname === '/more'
            : isActive(href);
          return (
            <Link key={href} href={href} style={{
              flex: 1, display: 'flex', flexDirection: 'column',
              alignItems: 'center', padding: '10px 4px 8px',
              textDecoration: 'none',
              WebkitTapHighlightColor: 'transparent',
            }}>
              <span style={{
                fontSize: 20,
                filter: active ? 'drop-shadow(0 0 6px rgba(99,102,241,0.8))' : 'none',
                transition: 'filter 0.18s',
              }}>
                {icon}
              </span>
              <span style={{
                fontSize: 10, marginTop: 3, fontWeight: active ? 700 : 400,
                color: active ? '#818cf8' : '#475569',
                transition: 'color 0.18s',
              }}>
                {label}
              </span>
            </Link>
          );
        })}
      </div>
    </>
  );
}
