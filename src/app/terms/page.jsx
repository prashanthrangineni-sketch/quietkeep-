// src/app/terms/page.jsx
import Link from 'next/link';

export const metadata = {
  title: 'Terms of Service',
  description: 'Terms and conditions for using QuietKeep personal and business apps by Pranix AI Labs.',
  robots: 'index, follow',
  alternates: {
    canonical: 'https://quietkeep.com/terms',
  },
  openGraph: {
    title: 'Terms of Service — QuietKeep',
    description: 'Terms and conditions for using QuietKeep personal and business apps.',
    url: 'https://quietkeep.com/terms',
  },
};

const sections = [
  {
    title: '1. Acceptance of Terms',
    body: 'By creating an account and using QuietKeep, you agree to these Terms of Service. If you do not agree, do not use the service. These terms form a binding agreement between you and Pranix AI Labs Private Limited.',
  },
  {
    title: '2. Description of Service',
    body: 'QuietKeep provides a voice-first personal life operating system including: keep and note management, smart reminders, Indian calendar with Panchangam, family and kids profiles, finance tracking, health logging, business management tools (invoicing, payroll, attendance), and AI-powered features.\n\nWe offer a Free tier and paid tiers (Personal ₹99/mo, Family ₹199/mo, Business ₹299/mo) billed monthly via Razorpay.',
  },
  {
    title: '3. Account Registration',
    body: 'You must provide a valid email address to create an account. You are responsible for maintaining the security of your account. You must be at least 18 years old to create an account.\n\nThe Kids feature is for parents to manage their minor children\'s profiles — children under 13 may not create their own accounts.',
  },
  {
    title: '4. Acceptable Use',
    body: 'You agree NOT to:\n• Use QuietKeep to store illegal, harmful, or abusive content\n• Attempt to gain unauthorised access to other users\' data\n• Reverse engineer, decompile, or extract the source code\n• Use automated scripts or bots to access the service\n• Resell or sub-license access to QuietKeep\n• Violate any applicable laws, including India\'s IT Act 2000 and DPDP Act 2023',
  },
  {
    title: '5. Subscription and Payments',
    body: 'Free tier: available indefinitely with usage limits.\nPaid plans: billed monthly via Razorpay. Prices in Indian Rupees (INR).\n\nRefund policy: we offer a 7-day refund for first-time paid subscriptions. Contact support@quietkeep.com within 7 days of payment.\n\nCancellation: you can cancel anytime. Access continues until the end of your billing period.\n\nPrices may change with 30 days notice to existing subscribers.',
  },
  {
    title: '6. Your Data Ownership',
    body: 'You own your data. Everything you store in QuietKeep — keeps, notes, reminders, financial data — belongs to you.\n\nYou grant us a limited, non-exclusive license to process your data solely to provide the service. We do not claim ownership of your content.\n\nOn account deletion, all your data is permanently erased within 30 days.',
  },
  {
    title: '7. AI Features and Accuracy',
    body: 'QuietKeep uses AI (Anthropic Claude) for intent parsing, daily brief generation, and warranty OCR. AI-generated content may not be 100% accurate. You are responsible for verifying important information.\n\nWe are not responsible for decisions made based on AI-generated summaries or suggestions.',
  },
  {
    title: '8. Service Availability',
    body: 'We strive for 99.9% uptime but do not guarantee uninterrupted service. Scheduled maintenance will be announced in advance when possible.\n\nWe reserve the right to modify, suspend, or discontinue features with 30 days notice for material changes.',
  },
  {
    title: '9. Limitation of Liability',
    body: 'To the maximum extent permitted by law, Pranix AI Labs shall not be liable for any indirect, incidental, special, or consequential damages. Our total liability shall not exceed the amount you paid us in the 12 months preceding the claim.\n\nQuietKeep is not a substitute for professional medical, financial, or legal advice.',
  },
  {
    title: '10. Governing Law',
    body: 'These terms are governed by the laws of India. Disputes shall be subject to the exclusive jurisdiction of courts in Hyderabad, Telangana, India.\n\nFor consumer disputes, you may also use the Online Dispute Resolution platform at consumerhelpline.gov.in',
  },
  {
    title: '11. Changes to Terms',
    body: 'We may update these terms. Material changes will be notified by email and in-app notification at least 14 days before taking effect. Continued use after the effective date constitutes acceptance.',
  },
  {
    title: '12. Contact',
    body: 'Pranix AI Labs Private Limited\nEmail: support@quietkeep.com\nGrievances: privacy@quietkeep.com\nHyderabad, Telangana, India',
  },
];

export default function TermsPage() {
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
          Terms of Service
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
              href="/privacy"
              style={{ color: 'var(--text-muted)', textDecoration: 'none' }}
            >
              Privacy Policy
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
