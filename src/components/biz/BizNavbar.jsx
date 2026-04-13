'use client';
// src/components/biz/BizNavbar.jsx
// Completely separate navbar for business workspace — does NOT touch NavbarClient.jsx
// Green brand, business-specific nav items, workspace switcher

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

const BIZ_BOTTOM_TABS = [
  { href: '/b/dashboard', icon: '📊', label: 'Dashboard' },
  { href: '/b/ledger',    icon: '📒', label: 'Ledger' },
  { href: '/b/attendance',icon: '👥', label: 'Attend' },
  { href: '/b/invoices',  icon: '🧾', label: 'Invoice' },
  { href: '/b/more',      icon: '☰',  label: 'More' },
];

const BIZ_NAV_LINKS = [
  { href: '/b/dashboard',   icon: '📊', label: 'Dashboard' },
  { href: '/b/ledger',      icon: '📒', label: 'Ledger' },
  { href: '/b/team',        icon: '👨‍💼', label: 'Team' },
  { href: '/b/attendance',  icon: '👥', label: 'Attendance' },
  { href: '/b/payroll',     icon: '💳', label: 'Payroll' },
  { href: '/b/invoices',    icon: '🧾', label: 'Invoices' },
  { href: '/b/inventory',   icon: '📦', label: 'Inventory' },
  { href: '/b/compliance',  icon: '⚖️', label: 'Compliance' },
  { href: '/b/customers',   icon: '🤝', label: 'Customers' },
  { href: '/b/tasks',       icon: '✅', label: 'Tasks' },
  { href: '/b/geo',         icon: '🗺️', label: 'Field' },
];

export default function BizNavbar() {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [workspace, setWorkspace] = useState(null);
  const [showNav, setShowNav] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) return;
      setUser(session.user);
      const { data: ws } = await supabase
        .from('business_workspaces')
        .select('id, name, business_type')
        .eq('owner_user_id', session.user.id)
        .maybeSingle();
      setWorkspace(ws);
    });
  }, []);

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.replace('/');
  }

  const isActive = (href) => pathname === href || pathname.startsWith(href + '/');
  const BIZ_GREEN = '#10b981';
  const BIZ_GREEN_DIM = 'rgba(16,185,129,0.1)';
  const BIZ_GREEN_GLOW = 'rgba(16,185,129,0.25)';

  return (
    <>
      {/* ── TOP NAV ─────────────────────────────────────────────────────── */}
      <header style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 500,
        background: 'var(--nav-bg)', backdropFilter: 'blur(20px)',
        borderBottom: '1px solid var(--nav-border)',
        height: 56, display: 'flex', alignItems: 'center',
        padding: '0 16px', gap: 12,
      }}>
        {/* Hamburger */}
        <button onClick={() => setShowNav(v => !v)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 6, borderRadius: 8, color: 'var(--text)' }}>
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <rect y="2" width="18" height="2" rx="1" fill="currentColor"/>
            <rect y="8" width="18" height="2" rx="1" fill="currentColor"/>
            <rect y="14" width="18" height="2" rx="1" fill="currentColor"/>
          </svg>
        </button>

        {/* Logo + workspace */}
        <Link href="/b/dashboard" style={{ display: 'flex', alignItems: 'center', gap: 8, textDecoration: 'none', flex: 1, minWidth: 0 }}>
          <div style={{ width: 28, height: 28, borderRadius: 7, background: `linear-gradient(135deg,${BIZ_GREEN},#059669)`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <span style={{ fontSize: 11, fontWeight: 900, color: '#fff' }}>QB</span>
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)', lineHeight: 1.2, letterSpacing: '-0.3px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {workspace?.name || 'My Business'}
            </div>
            <div style={{ fontSize: 10, color: BIZ_GREEN, fontWeight: 600, lineHeight: 1 }}>QuietKeep Business</div>
          </div>
        </Link>

        {/* Switch to personal */}
        <Link href="/dashboard" style={{ fontSize: 11, color: 'var(--text-subtle)', textDecoration: 'none', background: 'var(--surface)', border: '1px solid var(--border)', padding: '5px 10px', borderRadius: 8, whiteSpace: 'nowrap', fontWeight: 600 }}>
          Personal ↗
        </Link>

        <button onClick={handleSignOut} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '6px 10px', borderRadius: 8, fontSize: 11, color: 'var(--text-subtle)', fontFamily: 'inherit', fontWeight: 600 }}>
          Sign out
        </button>
      </header>

      {/* ── SLIDE-OUT NAV ────────────────────────────────────────────────── */}
      {showNav && (
        <>
          <div onClick={() => setShowNav(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 600, backdropFilter: 'blur(2px)' }} />
          <nav style={{
            position: 'fixed', top: 0, left: 0, bottom: 0, width: 260, zIndex: 700,
            background: 'var(--bg-raised)', borderRight: '1px solid var(--border)',
            display: 'flex', flexDirection: 'column', overflowY: 'auto',
            boxShadow: '4px 0 24px rgba(0,0,0,0.15)',
            animation: 'slideIn 0.2s cubic-bezier(0.4,0,0.2,1)',
          }}>
            {/* Nav header */}
            <div style={{ padding: '16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 32, height: 32, borderRadius: 8, background: `linear-gradient(135deg,${BIZ_GREEN},#059669)`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span style={{ fontSize: 13, fontWeight: 900, color: '#fff' }}>QB</span>
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)' }}>{workspace?.name || 'My Business'}</div>
                <div style={{ fontSize: 10, color: BIZ_GREEN, fontWeight: 600 }}>Business Workspace</div>
              </div>
              <button onClick={() => setShowNav(false)} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-subtle)', fontSize: 18, padding: 4 }}>✕</button>
            </div>

            {/* Nav items */}
            <div style={{ flex: 1, padding: '8px 0' }}>
              {BIZ_NAV_LINKS.map(({ href, icon, label }) => {
                const active = isActive(href);
                return (
                  <Link key={href} href={href} onClick={() => setShowNav(false)} style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '11px 16px', textDecoration: 'none',
                    background: active ? BIZ_GREEN_DIM : 'transparent',
                    borderLeft: `3px solid ${active ? BIZ_GREEN : 'transparent'}`,
                    transition: 'all 0.15s',
                  }}>
                    <span style={{ fontSize: 16, width: 20, textAlign: 'center' }}>{icon}</span>
                    <span style={{ fontSize: 13, fontWeight: active ? 700 : 500, color: active ? BIZ_GREEN : 'var(--text-muted)' }}>{label}</span>
                  </Link>
                );
              })}
            </div>

            {/* Footer links */}
            <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)' }}>
              <Link href="/b/onboarding" onClick={() => setShowNav(false)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', textDecoration: 'none', color: 'var(--text-muted)', fontSize: 13 }}>
                ⚙️ Workspace Settings
              </Link>
              <Link href="/dashboard" onClick={() => setShowNav(false)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', textDecoration: 'none', color: 'var(--text-muted)', fontSize: 13 }}>
                👤 Switch to Personal
              </Link>
            </div>
          </nav>
        </>
      )}

      {/* ── BOTTOM TABS ──────────────────────────────────────────────────── */}
      <nav style={{
        position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 500,
        background: 'var(--nav-bg)', backdropFilter: 'blur(20px)',
        borderTop: '1px solid var(--nav-border)',
        display: 'grid', gridTemplateColumns: `repeat(${BIZ_BOTTOM_TABS.length},1fr)`,
        height: `calc(52px + env(safe-area-inset-bottom, 0px))`,
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
      }}>
        {BIZ_BOTTOM_TABS.map(({ href, icon, label }) => {
          const active = href === '/b/more' ? pathname === '/b/more' : isActive(href);
          return (
            <Link key={href} href={href} style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              gap: 2, textDecoration: 'none', padding: '6px 4px',
              color: active ? BIZ_GREEN : 'var(--text-subtle)',
              background: active ? BIZ_GREEN_DIM : 'transparent',
              borderTop: `2px solid ${active ? BIZ_GREEN : 'transparent'}`,
              transition: 'all 0.15s',
            }}>
              <span style={{ fontSize: 18 }}>{icon}</span>
              <span style={{ fontSize: 9, fontWeight: active ? 700 : 500, letterSpacing: '0.02em' }}>{label}</span>
            </Link>
          );
        })}
      </nav>

      <style>{`
        @keyframes slideIn { from { transform: translateX(-100%); } to { transform: translateX(0); } }
      `}</style>
    </>
  );
}
