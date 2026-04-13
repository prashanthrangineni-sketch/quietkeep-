// src/app/privacy/page.jsx
import Link from 'next/link';

export const metadata = {
  title: 'Privacy Policy',
  description: 'How QuietKeep collects, uses, and protects your personal data under DPDP Act 2023.',
  robots: 'index, follow',
  alternates: {
    canonical: 'https://quietkeep.com/privacy',
  },
  openGraph: {
    title: 'Privacy Policy — QuietKeep',
    description: 'DPDP Act 2023 compliant privacy policy for QuietKeep by Pranix AI Labs.',
    url: 'https://quietkeep.com/privacy',
  },
};

const sections = [
  {
    title: '1. Who We Are',
    body: 'QuietKeep is a product of Pranix AI Labs Private Limited ("we", "our", "us"), incorporated in India. We build voice-first personal and business productivity software.\n\nContact: privacy@quietkeep.com',
  },
  {
    title: '2. What Data We Collect',
    body: 'We collect:\n• Email address — for magic link authentication\n• Profile data — name, date of birth, city, language preference (all optional, you provide these)\n• Keeps and notes — text and voice content you record\n• Reminders and calendar events — dates, times, recurrence\n• Finance data — expenses, budgets, subscriptions you enter manually\n• Health and mood logs — data you choose to log\n• Location — only when you use Drive Mode or Business Geo Check-in (not stored continuously)\n• Device info — type, OS, browser for app functionality\n\nWe do NOT collect:\n• Passwords (we use passwordless magic link authentication)\n• Payment card details (handled by Razorpay — we never see them)\n• Biometric data\n• Your phone contacts (you manually enter contact details)',
  },
  {
    title: '3. How We Use Your Data',
    body: '• To provide QuietKeep — storing keeps, sending reminders, generating daily briefs\n• To improve the product — anonymised usage analytics\n• To send transactional emails — OTP magic links, subscription confirmations (via Resend)\n• To send notifications — reminders and alerts (via Knock.app)\n• To process payments — subscription billing (via Razorpay — they are the data controller for payment data)\n• To provide AI features — your keep text is sent to Anthropic Claude API for intent parsing and summaries\n\nWe do NOT sell your data or use it for advertising.',
  },
  {
    title: '4. Data Storage and Security',
    body: 'Your data is stored in Supabase (PostgreSQL on AWS). All data is encrypted at rest and in transit (TLS). Row-Level Security (RLS) is enabled on every database table — your data is only accessible by your authenticated account. HTTPS for all connections. No plaintext storage of sensitive data.',
  },
  {
    title: '5. Data Retention',
    body: 'Data is retained while your account is active. On account deletion, all your data is permanently deleted within 30 days. Audit logs are retained for 90 days for security. Backup data is purged within 30 days of deletion.\n\nTo delete your account: Settings → Profile → Delete Account, or email privacy@quietkeep.com',
  },
  {
    title: '6. Third-Party Services',
    body: 'QuietKeep uses these third-party services:\n• Supabase — database and authentication\n• Anthropic Claude — AI features\n• Razorpay — payment processing\n• Resend — transactional email\n• Knock.app — push notifications\n• Vercel — app hosting\n\nEach has their own privacy policy. We have data processing agreements with each provider.',
  },
  {
    title: '7. Your Rights (DPDP Act 2023)',
    body: 'Under India\'s Digital Personal Data Protection Act 2023, you have the right to:\n• Access — request a copy of all your personal data\n• Correction — update inaccurate data at any time via your profile settings\n• Deletion — permanently delete your account and all associated data\n• Portability — export your keeps and data in JSON format (Settings → Export)\n• Grievance redressal — contact our Data Protection Officer\n\nEmail: privacy@quietkeep.com — we respond within 30 days.\nData Protection Officer: Prashanth Rangineni, Pranix AI Labs Pvt Ltd',
  },
  {
    title: '8. Children\'s Privacy',
    body: 'QuietKeep is not directed to children under 13. The Kids feature within the app is designed for parents to manage their minor children\'s profiles — it does not require children to create accounts.\n\nIf you believe a child under 13 has provided us personal data, contact privacy@quietkeep.com immediately.',
  },
  {
    title: '9. Device Permissions We Request',
    body: 'QuietKeep requests these permissions and uses them only as described:\n• Microphone — to capture voice keeps and enable Drive Mode hands-free commands\n• Camera — to scan warranty invoices and capture documents\n• Location — for Drive Mode navigation and Business attendance geo check-in only\n• Notifications — to deliver reminders at scheduled times\n• Storage — to save offline content and downloaded documents\n\nYou can revoke any permission in your device settings at any time.',
  },
  {
    title: '10. Cookies and Local Storage',
    body: 'We use:\n• localStorage — to store your theme preference (qk_theme) and display language (qk_display_lang)\n• sessionStorage — to manage voice talkback state within a session\n• Supabase auth cookies — required for session persistence\n\nWe do not use advertising cookies or third-party tracking cookies.',
  },
  {
    title: '11. Changes to This Policy',
    body: 'We may update this Privacy Policy. If we make material changes, we will notify you via email or in-app notification at least 14 days before the changes take effect.',
  },
  {
    title: '12. Contact Us',
    body: 'Pranix AI Labs Private Limited\nEmail: privacy@quietkeep.com\nWebsite: https://quietkeep.com\nHyderabad, Telangana, India',
  },
];

export default function PrivacyPage() {
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
            marginBottom: 6,
            letterSpacing: '-0.5px',
          }}
        >
          Privacy Policy
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text-subtle)', marginBottom: 40 }}>
          Last updated: March 26, 2026 · Pranix AI Labs Pvt Ltd
        </p>

        {sections.map(({ title, body }) => (
          <section key={title} style={{ marginBottom: 32 }}>
            <h2
              style={{
                fontSize: 15,
                fontWeight: 700,
                color: 'var(--text)',
                marginBottom: 8,
              }}
            >
              {title}
            </h2>
            <p
              style={{
                fontSize: 13.5,
                color: 'var(--text-muted)',
                lineHeight: 1.85,
                whiteSpace: 'pre-line',
                margin: 0,
              }}
            >
              {body}
            </p>
          </section>
        ))}

        <div
          style={{
            borderTop: '1px solid var(--border)',
            paddingTop: 24,
            textAlign: 'center',
          }}
        >
          <p style={{ fontSize: 12, color: 'var(--text-subtle)' }}>
            © 2026 Pranix AI Labs ·{' '}
            <Link
              href="/terms"
              style={{ color: 'var(--text-muted)', textDecoration: 'none' }}
            >
              Terms of Service
            </Link>{' '}
            ·{' '}
            <Link
              href="/"
              style={{ color: 'var(--text-muted)', textDecoration: 'none' }}
            >
              Home
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
