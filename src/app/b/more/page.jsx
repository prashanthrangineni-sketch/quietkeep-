'use client';
import { useAuth } from '@/lib/context/auth';
/**
 * src/app/b/more/page.jsx
 * CHANGE: Added Chat channel to Operations section.
 */
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import BizNavbar from '@/components/biz/BizNavbar';
const G = '#10b981';

export default function BizMorePage() {
  const { user, accessToken, loading: authLoading } = useAuth();
  const router = useRouter();
  const [workspace, setWorkspace] = useState(null);
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  useEffect(() => {
    if (authLoading) return; // wait for auth context to resolve
    if (!user) { router.replace('/biz-login'); return; }
    (async () => {
      let { data: ws } = await supabase
        .from('business_workspaces').select('*')
        .eq('owner_user_id', user?.id).maybeSingle();

      // Staff joined by invite own nothing — fall back to membership so the
      // workspace card does not read "My Business" for the whole team.
      if (!ws) {
        const { data: membership } = await supabase
          .from('business_members')
          .select('workspace_id')
          .eq('user_id', user.id)
          .eq('status', 'active')
          .maybeSingle();
        if (membership?.workspace_id) {
          const { data: memberWs } = await supabase
            .from('business_workspaces').select('*')
            .eq('id', membership.workspace_id).maybeSingle();
          ws = memberWs || null;
        }
      }
      setWorkspace(ws);

      // Only platform staff see the internal admin panel.
      const { data: admin } = await supabase
        .from('admin_users').select('user_id').eq('user_id', user.id).maybeSingle();
      setIsPlatformAdmin(!!admin);
    })();
  }, [user, authLoading]);

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.replace('/');
  }

  const MENU_SECTIONS = [
    {
      title: 'Operations',
      items: [
        { href: '/b/team',       icon: '👨‍💼', title: 'Team Members',    sub: 'Add, edit, roles & tasks' },
        { href: '/b/chat',       icon: '💬', title: 'Team Chat',        sub: 'WhatsApp-style messaging' }, // ← NEW
        { href: '/b/attendance', icon: '👥', title: 'Attendance',       sub: 'Daily attendance + geo check-in' },
        { href: '/b/payroll',    icon: '💳', title: 'Payroll',          sub: 'Salary calculation + WhatsApp payslips' },
        { href: '/b/inventory',  icon: '📦', title: 'Inventory',        sub: 'Stock tracking + alerts' },
        { href: '/b/tasks',      icon: '✅', title: 'Task Board',       sub: 'Assign and track tasks' },
        { href: '/b/geo',        icon: '🗺️', title: 'Field Tracking',   sub: 'Geo check-ins for field team' },
      ],
    },
    {
      title: 'Finance',
      items: [
        { href: '/b/ledger',      icon: '📒', title: 'Khata / Ledger',   sub: 'Voice-first income & expense' },
        { href: '/b/invoices',    icon: '🧾', title: 'GST Invoices',     sub: 'Create, PDF, send via WhatsApp' },
        { href: '/b/customers',   icon: '🤝', title: 'Customers',        sub: 'CRM with credit tracking' },
        // These three were finished and working but appeared ONLY in the
        // hamburger drawer, so anyone who tapped the "More" tab never found
        // them. Scan & Pay in particular is the fastest way to take money.
        { href: '/b/scan',        icon: '📷', title: 'Scan & Pay',       sub: 'Barcode, UPI QR, spoken confirmation' },
        { href: '/b/collections', icon: '💸', title: 'Collections',      sub: 'Chase overdue payments on WhatsApp' },
        { href: '/b/reports',     icon: '📑', title: 'Reports',          sub: 'GSTR-3B, ledger, payroll, outstanding' },
      ],
    },
    {
      title: 'Compliance',
      items: [
        { href: '/b/compliance', icon: '⚖️', title: 'Compliance', sub: 'GST, IT returns, licences, renewals' },
      ],
    },
    {
      title: 'Account',
      items: [
        { href: '/b/onboarding', icon: '⚙️', title: 'Workspace Settings', sub: 'Edit business name, GSTIN, type' },
        // NOTE: 'Switch to Personal' intentionally removed.
        // In the business APK, middleware does not run — navigating to /dashboard
        // would load the personal UI inside the business APK with no re-isolation.
        // Users who need personal QuietKeep should install the separate personal APK.
        { href: '/pricing',      icon: '💎', title: 'Plans & Billing',     sub: 'Business · Growth · Enterprise' },
        // The internal admin panel (platform metrics, all users, feature flags)
        // was linked from every business owner's More menu. It is not a customer
        // feature — it is now hidden unless the account is flagged as staff.
        ...(isPlatformAdmin
          ? [{ href: '/admin', icon: '🔐', title: 'Admin Panel', sub: 'Metrics, users, feature flags' }]
          : []),
        { href: '/privacy?app=business', icon: '🔒', title: 'Privacy Policy', sub: 'Data protection and DPDP compliance' },
        { href: '/terms',                icon: '📄', title: 'Terms of Service', sub: 'Terms and conditions of use' },
      ],
    },
  ];

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--bg)',
      paddingTop: 56,
      paddingBottom: 'calc(52px + env(safe-area-inset-bottom,0px) + 16px)' }}>
      <BizNavbar />
      <div style={{ maxWidth: 480, margin: '0 auto', padding: '20px 16px' }}>

        {/* Workspace card */}
        <div className="qk-card"
          style={{ padding: '16px', marginBottom: 20, borderColor: `${G}30` }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <div style={{ width: 44, height: 44, borderRadius: 12, flexShrink: 0,
              background: `linear-gradient(135deg,${G},#059669)`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 18, fontWeight: 900, color: '#fff' }}>
              {(workspace?.name || 'B')[0].toUpperCase()}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)' }}>
                {workspace?.name || 'My Business'}
              </div>
              <div style={{ fontSize: 11, color: G, fontWeight: 600 }}>
                QuietKeep Business · {workspace?.plan || 'Starter'}
              </div>
              {workspace?.gstin && (
                <div style={{ fontSize: 10, color: 'var(--text-subtle)', marginTop: 2 }}>
                  GSTIN: {workspace.gstin}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Menu sections — grouped already, but they stacked in one column at
            every width. .qk-grid-auto lets them reflow to 2 up at 900px and
            3 up at 1280px, same as the personal More page. */}
        <div className="qk-grid-auto" style={{ marginBottom: 16 }}>
        {MENU_SECTIONS.map(section => (
          <div key={section.title} style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
              letterSpacing: '0.08em', color: 'var(--text-subtle)',
              marginBottom: 6, paddingLeft: 4 }}>
              {section.title}
            </div>
            <div className="qk-card" style={{ overflow: 'hidden' }}>
              {section.items.map((item, i) => (
                <Link key={item.href} href={item.href} className="qk-list-item"
                  style={{ borderBottom: i < section.items.length - 1
                    ? '1px solid var(--border)' : 'none' }}>
                  <span style={{ fontSize: 20, marginRight: 12, flexShrink: 0 }}>
                    {item.icon}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
                      {item.title}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 2 }}>
                      {item.sub}
                    </div>
                  </div>
                  <span style={{ color: 'var(--text-subtle)', fontSize: 14 }}>›</span>
                </Link>
              ))}
            </div>
          </div>
        ))}
        </div>

        {/* Sign out */}
        <button onClick={handleSignOut}
          style={{ width: '100%', padding: '13px', borderRadius: 12,
            border: '1px solid rgba(239,68,68,0.2)',
            background: 'rgba(239,68,68,0.04)', color: '#ef4444',
            fontSize: 14, fontWeight: 600, cursor: 'pointer',
            fontFamily: 'inherit', marginTop: 8 }}>
          Sign Out
        </button>

        <div style={{ textAlign: 'center', marginTop: 20, fontSize: 11,
          color: 'var(--text-subtle)' }}>
          QuietKeep Business · Pranix AI Labs · 🇮🇳
        </div>
      </div>
    </div>
  );
}
