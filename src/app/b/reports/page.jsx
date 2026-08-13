'use client';
// src/app/b/reports/page.jsx
//
// /b/reports used to 404 (verified live, 13 Aug 2026) even though a complete
// GSTR-3B report existed at /b/reports/gstr-3b. This is the index that route
// always needed.

import Link from 'next/link';
import BizNavbar from '@/components/biz/BizNavbar';

const REPORTS = [
  {
    href: '/b/reports/gstr-3b',
    icon: '📑',
    title: 'GSTR-3B',
    desc: 'Monthly GST summary — outward supplies, input credit, tax payable.',
    ready: true,
  },
  {
    href: '/b/ledger',
    icon: '📒',
    title: 'Khata / Ledger',
    desc: 'Every income and expense entry, filterable by period.',
    ready: true,
  },
  {
    href: '/b/collections',
    icon: '💸',
    title: 'Outstanding & Collections',
    desc: 'Who owes you, how long overdue, and one-tap WhatsApp reminders.',
    ready: true,
  },
  {
    href: '/b/payroll',
    icon: '💳',
    title: 'Payroll summary',
    desc: 'Salary due and paid this month, calculated from attendance.',
    ready: true,
  },
  {
    href: '/b/compliance',
    icon: '⚖️',
    title: 'Compliance calendar',
    desc: 'GST, PF and IT dates, with reminders before each deadline.',
    ready: true,
  },
];

export default function BizReportsIndex() {
  return (
    <div style={{ minHeight: '100dvh', background: 'var(--bg)', color: 'var(--text)', paddingTop: 56, paddingBottom: 90 }}>
      <BizNavbar />

      <div style={{ maxWidth: 560, margin: '0 auto', padding: '20px 16px' }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-0.5px', margin: 0 }}>Reports</h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '4px 0 20px' }}>
          Everything your accountant asks for, in one place.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {REPORTS.map((r) => (
            <Link
              key={r.href}
              href={r.href}
              style={{
                display: 'flex', alignItems: 'center', gap: 14,
                padding: '16px 18px', borderRadius: 14,
                background: 'var(--surface)', border: '1px solid var(--border)',
                textDecoration: 'none', color: 'inherit',
              }}
            >
              <span style={{ fontSize: 22, flexShrink: 0 }}>{r.icon}</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 15, fontWeight: 700 }}>{r.title}</span>
                <span style={{ display: 'block', fontSize: 12.5, color: 'var(--text-muted)', marginTop: 2, lineHeight: 1.45 }}>
                  {r.desc}
                </span>
              </span>
              <span style={{ color: 'var(--text-subtle)', fontSize: 18 }}>›</span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
