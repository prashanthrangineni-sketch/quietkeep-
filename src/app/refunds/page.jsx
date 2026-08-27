// src/app/refunds/page.jsx
import Link from 'next/link';

export const metadata = {
  title: 'Refund & Cancellation Policy',
  description:
    'How cancellations and refunds work for QuietKeep subscriptions — the 7-day first-subscription refund, how to cancel, how long money takes to return, and how to escalate.',
  robots: 'index, follow',
  alternates: {
    canonical: 'https://quietkeep.com/refunds',
  },
  openGraph: {
    title: 'Refund & Cancellation Policy — QuietKeep',
    description: 'Cancel any time. Full refund on a first subscription within 7 days.',
    url: 'https://quietkeep.com/refunds',
  },
};

const sections = [
  {
    title: '1. Scope',
    body: 'This policy covers every paid QuietKeep subscription — Personal, Family and Business — sold by Pranix AI Labs Private Limited through quietkeep.com and the QuietKeep apps. It forms part of our Terms of Service.',
  },
  {
    title: '2. Free tier',
    body: 'QuietKeep has a Free tier that takes no payment at all. Nothing is charged, so nothing is refundable, and you can stop using it at any time without notice or penalty.',
  },
  {
    title: '3. Cancellation',
    body: 'You can cancel from Settings → Subscription inside the app, or by emailing support@quietkeep.com. There is no cancellation fee and no notice period.\n\nCancelling stops the next renewal. Your plan stays active until the end of the term you have already paid for, and your data stays available to you for that whole period.\n\nCancelling is not the same as deleting your account. If you also want your data erased, delete the account and we erase your personal data within 30 days.',
  },
  {
    title: '4. When we refund',
    body: 'We give a full refund on a first-time paid subscription if you ask within 7 days of the first payment — no questions asked. Email us from the address on the account with the plan and the payment reference.\n\nWe also refund in full:\n• a charge you did not authorise, or a duplicate charge, once verified\n• a billing error on our side\n• a paid feature that did not work and that we could not fix\n\nAnd pro-rata if we discontinue a paid plan or feature during a term you have paid for.',
  },
  {
    title: '5. When we do not refund',
    body: 'Renewals after the first term are not refundable, and cancelling part-way through a term does not produce a refund — the service simply continues to the end of that term.\n\nAccounts terminated for a breach of the Acceptable Use terms are not refunded.',
  },
  {
    title: '6. How the money comes back',
    body: 'Refunds go back to the original payment method through the payment aggregator that took the payment. We cannot refund to a different card, account or UPI ID.\n\nWe initiate an approved refund within 3 working days. Your aggregator and bank then take a further 5 to 7 working days, and occasionally up to one billing cycle on a credit card, to post it.\n\nIf it has not reached you 10 working days after we confirm it was initiated, write to us with the order reference and we will chase the aggregator and give you the reference number.',
  },
  {
    title: '7. Money debited but no subscription',
    body: 'If money left your account and the plan did not activate, the payment almost always failed at the aggregator and your bank auto-reverses it within 5 to 7 working days.\n\nTell us anyway, with the UTR or payment reference. We will confirm the status, and if the payment did reach us without activating your plan we will either activate it or refund it — your choice.',
  },
  {
    title: '8. How to raise a request, and how to escalate',
    body: 'Email support@quietkeep.com from the address registered on the account. Include the plan, the payment date and the order or payment reference.\n\nWe acknowledge within 48 hours and give a decision within 30 days, usually much sooner. If you are not satisfied, escalate to our Grievance Officer, Prashanth Rangineni, at support@pranixailabs.com.\n\nUnresolved consumer complaints may be taken to the National Consumer Helpline or the Online Dispute Resolution facility at consumerhelpline.gov.in, or filed on the e-Daakhil portal.',
  },
];

export default function RefundsPage() {
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
          Refund &amp; Cancellation Policy
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text-subtle)', marginBottom: 40 }}>
          Last updated: August 27, 2026 · Pranix AI Labs Pvt Ltd
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
                fontSize: 14,
                lineHeight: 1.75,
                color: 'var(--text-muted)',
                whiteSpace: 'pre-line',
              }}
            >
              {body}
            </p>
          </section>
        ))}

        <p style={{ fontSize: 13, color: 'var(--text-subtle)', marginTop: 48 }}>
          See also our <Link href="/terms">Terms of Service</Link>,{' '}
          <Link href="/privacy">Privacy Policy</Link> and{' '}
          <Link href="/contact">Contact &amp; registered office</Link>.
        </p>
      </div>
    </div>
  );
}
