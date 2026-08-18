// src/app/delete-account/page.jsx
//
// Google Play requires a publicly reachable URL, linked from the store listing,
// where a user can find out how to delete their account. Its three stated
// requirements are that the page must:
//   1. refer to the app or developer name shown on the store listing
//   2. prominently feature the steps to request deletion
//   3. specify what data is deleted, what is kept, and for how long
//
// Section 5 of /privacy technically covers all three, but "prominently" is the
// operative word — it is one section of twelve, and reviewers have rejected
// policy-page-only links on exactly that ground. Hence a dedicated page whose
// only subject is deletion.
//
// It must stay reachable WITHOUT a login. Do not put this behind auth.

import Link from 'next/link';

export const metadata = {
  title: 'Delete your QuietKeep account',
  description:
    'How to delete your QuietKeep or QuietKeep Business account and what happens to your data.',
  robots: 'index, follow',
  alternates: { canonical: 'https://quietkeep.com/delete-account' },
  openGraph: {
    title: 'Delete your QuietKeep account — Pranix AI Labs',
    description: 'Steps to delete your account and exactly what data is removed.',
    url: 'https://quietkeep.com/delete-account',
  },
};

const steps = [
  'Open QuietKeep (or QuietKeep Business) and sign in.',
  'Go to Settings, then Profile.',
  'Tap "Delete Account".',
  'Confirm when asked. Deletion begins immediately.',
];

const deleted = [
  'Your keeps, notes and voice recordings',
  'Reminders, alarms and calendar entries',
  'Expenses, budgets and subscription records',
  'Health and mood entries',
  'Documents and scanned files you uploaded',
  'Contacts synced from your phone',
  'Saved locations and geo-reminders',
  'Your profile, email address and account record',
  'For QuietKeep Business: customers, invoices, khata entries, staff records, attendance and team messages in workspaces you own',
];

const kept = [
  'Security audit logs — retained for 90 days, then deleted. These record sign-in events only and are kept to investigate account compromise.',
  'Backups — purged within 30 days of deletion.',
  'Invoice and tax records you have already filed with GST authorities are yours, not ours; deleting your account does not affect anything already filed.',
];

export default function DeleteAccountPage() {
  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'var(--bg)',
        color: 'var(--text)',
        fontFamily: "'Inter', system-ui, sans-serif",
        padding: '80px 20px 60px',
      }}
    >
      <div style={{ maxWidth: 760, margin: '0 auto' }}>
        <Link
          href="/"
          style={{ fontSize: 13, color: 'var(--text-muted)', textDecoration: 'none' }}
        >
          ← Back to QuietKeep
        </Link>

        <h1
          style={{
            fontSize: 30,
            fontWeight: 800,
            color: 'var(--text)',
            marginTop: 24,
            marginBottom: 8,
          }}
        >
          Delete your account
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text-subtle)', marginBottom: 40 }}>
          QuietKeep and QuietKeep Business · Pranix AI Labs Private Limited
        </p>

        <section style={{ marginBottom: 40 }}>
          <h2 style={{ fontSize: 17, fontWeight: 700, marginBottom: 14 }}>
            How to delete your account
          </h2>
          <ol
            style={{
              fontSize: 13.5,
              color: 'var(--text-muted)',
              lineHeight: 1.9,
              paddingLeft: 20,
              margin: 0,
            }}
          >
            {steps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
          <p
            style={{
              fontSize: 13.5,
              color: 'var(--text-muted)',
              lineHeight: 1.85,
              marginTop: 18,
            }}
          >
            If you cannot sign in, email{' '}
            <a href="mailto:privacy@quietkeep.com" style={{ color: 'var(--primary)' }}>
              privacy@quietkeep.com
            </a>{' '}
            from the address on your account and ask for deletion. We reply within
            30 days, and usually far sooner.
          </p>
        </section>

        <section style={{ marginBottom: 40 }}>
          <h2 style={{ fontSize: 17, fontWeight: 700, marginBottom: 14 }}>
            What is deleted
          </h2>
          <p
            style={{
              fontSize: 13.5,
              color: 'var(--text-muted)',
              lineHeight: 1.85,
              marginTop: 0,
              marginBottom: 12,
            }}
          >
            Everything below is permanently deleted within 30 days. It cannot be
            recovered afterwards, by you or by us.
          </p>
          <ul
            style={{
              fontSize: 13.5,
              color: 'var(--text-muted)',
              lineHeight: 1.9,
              paddingLeft: 20,
              margin: 0,
            }}
          >
            {deleted.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
        </section>

        <section style={{ marginBottom: 40 }}>
          <h2 style={{ fontSize: 17, fontWeight: 700, marginBottom: 14 }}>
            What is kept, and for how long
          </h2>
          <ul
            style={{
              fontSize: 13.5,
              color: 'var(--text-muted)',
              lineHeight: 1.9,
              paddingLeft: 20,
              margin: 0,
            }}
          >
            {kept.map((k) => (
              <li key={k}>{k}</li>
            ))}
          </ul>
        </section>

        <section style={{ marginBottom: 40 }}>
          <h2 style={{ fontSize: 17, fontWeight: 700, marginBottom: 14 }}>
            Take your data with you first
          </h2>
          <p
            style={{
              fontSize: 13.5,
              color: 'var(--text-muted)',
              lineHeight: 1.85,
              margin: 0,
            }}
          >
            Deletion is permanent. If you want a copy of your keeps and records,
            export them before you delete: Settings → Export. You will get a JSON
            file you can keep or move elsewhere.
          </p>
        </section>

        <div
          style={{
            borderTop: '1px solid var(--border)',
            paddingTop: 24,
            textAlign: 'center',
          }}
        >
          <p style={{ fontSize: 12, color: 'var(--text-subtle)' }}>
            © 2026 Pranix AI Labs ·{' '}
            <Link href="/privacy" style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>
              Privacy Policy
            </Link>{' '}
            ·{' '}
            <Link href="/terms" style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>
              Terms of Service
            </Link>{' '}
            ·{' '}
            <Link href="/" style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>
              Home
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
