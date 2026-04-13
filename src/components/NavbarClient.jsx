'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { farewellOnLogout, resetGreetGuard } from '@/components/VoiceTalkback';
import { useTranslations } from 'next-intl';
import NotificationBell from '@/components/NotificationBell';

const NAV_LINKS = [
  { href: '/dashboard', icon: '🏠', label: 'Home',     tKey: 'home' },
  { href: '/reminders', icon: '⏰', label: 'Remind',   tKey: 'reminders' },
  { href: '/calendar',  icon: '📅', label: 'Calendar', tKey: 'calendar' },
  { href: '/daily-brief',icon: '☀️',label: 'Brief',    tKey: 'brief' },
  { href: '/finance',   icon: '💰', label: 'Finance',  tKey: 'finance' },
  { href: '/documents', icon: '📄', label: 'Docs',     tKey: 'documents' },
  { href: '/health',    icon: '❤️', label: 'Health',   tKey: 'health' },
  { href: '/family',    icon: '👨‍👩‍👧', label: 'Family',  tKey: 'family' },
  { href: '/memories',  icon: '🧠', label: 'Life',     tKey: 'mood' },
  { href: '/mood',      icon: '🧘', label: 'Mood',     tKey: 'mood' },
  { href: '/warranty',  icon: '🛡️', label: 'Warranty', tKey: 'documents' },
];

const BOTTOM_TABS = [
  { href: '/dashboard',  icon: '🏠', label: 'Home',   tKey: 'home' },
  { href: '/daily-brief',icon: '☀️', label: 'Brief',  tKey: 'brief' },
  { href: '/calendar',   icon: '📅', label: 'Cal',    tKey: 'calendar' },
  { href: '/reminders',  icon: '⏰', label: 'Remind', tKey: 'reminders' },
  { href: '/more',       icon: '☰',  label: 'More',   tKey: 'more' },
];

export default function NavbarClient() {
  const pathname = usePathname();
  const router   = useRouter();
  const [user, setUser] = useState(null);
  // next-intl: t() reads from messages/{locale}.json at runtime
  // Falls back gracefully — if key missing, returns the key string
  const t = useTranslations('nav');

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
    resetGreetGuard(); // allow greeting after next login
    farewellOnLogout(user);
    // Small delay so speech starts before navigation destroys the page
    await new Promise(r => setTimeout(r, 900));
    // Clear language preference so next user gets default English STT
    try {
      localStorage.removeItem('qk_voice_lang');
      localStorage.removeItem('qk_display_lang');
    } catch {}
    await supabase.auth.signOut();
    // Navigate to '/' — page.jsx APK routing detects the variant (personal/business)
    // and sends the user to the correct login page. This is consistent with all
    // other sign-out paths in the app (b/more, b/dashboard, DashboardClient).
    router.push('/');
  }

  const isActive = (href) => pathname === href || pathname.startsWith(href + '/');

  if (!user) return null;

  return (
    <>
      {/* ── Top navbar ── */}
      <nav style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 1000,
        background: 'var(--nav-bg)',
        backdropFilter: 'blur(20px) saturate(180%)',
        WebkitBackdropFilter: 'blur(20px) saturate(180%)',
        borderBottom: '1px solid var(--nav-border)',
      }}>
        {/* Brand row */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px', height: 50 }}>
          <Link href="/dashboard" style={{
            fontWeight: 800, fontSize: 18,
            background: 'linear-gradient(135deg, var(--primary), #8b5cf6)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
            backgroundClip: 'text', textDecoration: 'none', letterSpacing: '-0.5px',
          }}>
            QuietKeep
          </Link>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <NotificationBell />
            <Link href="/subscription" style={{
              fontSize: 11, color: 'var(--primary)', fontWeight: 700,
              border: '1px solid var(--primary-glow)',
              background: 'var(--primary-dim)',
              borderRadius: 999, padding: '3px 10px', textDecoration: 'none',
            }}>
              ⭐ Pro
            </Link>
            <button onClick={handleSignOut} style={{
              background: 'var(--red-dim)', border: '1px solid rgba(220,38,38,0.25)',
              borderRadius: 6, cursor: 'pointer', color: 'var(--red)',
              fontSize: 11, fontWeight: 600, padding: '4px 10px',
              WebkitTapHighlightColor: 'transparent', fontFamily: 'inherit',
            }}>
              Sign Out
            </button>
          </div>
        </div>

        {/* Scrollable nav row */}
        <div style={{
          display: 'flex', overflowX: 'auto', scrollbarWidth: 'none',
          msOverflowStyle: 'none',
          borderTop: '1px solid var(--border)', padding: '0 4px',
        }}>
          {NAV_LINKS.map(({ href, icon, label, tKey }) => {
            const active = isActive(href);
            return (
              <Link key={href} href={href} style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center',
                padding: '7px 13px', minWidth: 58, textDecoration: 'none',
                borderBottom: active ? '2px solid var(--primary)' : '2px solid transparent',
                transition: 'border-color 0.18s', flexShrink: 0,
              }}>
                <span style={{ fontSize: 15 }}>{icon}</span>
                <span style={{
                  fontSize: 9, marginTop: 2, fontWeight: active ? 700 : 500,
                  color: active ? 'var(--primary)' : 'var(--text-subtle)',
                  transition: 'color 0.18s',
                }}>
                  {(tKey && t(tKey)) || label}
                </span>
              </Link>
            );
          })}
        </div>
      </nav>

      {/* ── Bottom tab bar ── */}
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 1000,
        background: 'var(--nav-bg)',
        backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
        borderTop: '1px solid var(--nav-border)',
        display: 'flex',
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
      }}>
        {BOTTOM_TABS.map(({ href, icon, label, tKey }) => {
          const active = href === '/more' ? pathname === '/more' : isActive(href);
          return (
            <Link key={href} href={href} style={{
              flex: 1, display: 'flex', flexDirection: 'column',
              alignItems: 'center', padding: '10px 4px 8px',
              textDecoration: 'none', WebkitTapHighlightColor: 'transparent',
            }}>
              <span style={{
                fontSize: 20,
                filter: active ? 'drop-shadow(0 0 5px rgba(91,94,244,0.55))' : 'none',
                transition: 'filter 0.18s',
              }}>
                {icon}
              </span>
              <span style={{
                fontSize: 10, marginTop: 3, fontWeight: active ? 700 : 500,
                color: active ? 'var(--primary)' : 'var(--text-subtle)',
                transition: 'color 0.18s',
              }}>
                {(tKey && t(tKey)) || label}
              </span>
            </Link>
          );
        })}
      </div>
    </>
  );
}
