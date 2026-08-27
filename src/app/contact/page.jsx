// src/app/contact/page.jsx
import Link from 'next/link';

export const metadata = {
  title: 'Contact Us',
  description:
    'Contact QuietKeep and Pranix AI Labs Private Limited — support email, phone, registered office address, CIN and Grievance Officer.',
  robots: 'index, follow',
  alternates: {
    canonical: 'https://quietkeep.com/contact',
  },
  openGraph: {
    title: 'Contact Us — QuietKeep',
    description: 'Support email, phone, registered office and Grievance Officer for QuietKeep.',
    url: 'https://quietkeep.com/contact',
  },
};

const label = {
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--text-subtle)',
  marginBottom: 8,
};

const body = {
  fontSize: 14,
  lineHeight: 1.8,
  color: 'var(--text-muted)',
};

export default function ContactPage() {
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
          Contact us
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text-subtle)', marginBottom: 40 }}>
          QuietKeep is built and operated by Pranix AI Labs Private Limited, Hyderabad.
        </p>

        <section style={{ marginBottom: 34 }}>
          <div style={label}>Support</div>
          <p style={body}>
            <a href="mailto:support@quietkeep.com">support@quietkeep.com</a>
            <br />
            <a href="tel:+919515479595">+91 95154 79595</a>
            <br />
            Monday–Saturday, 10:00–19:00 IST
          </p>
        </section>

        <section style={{ marginBottom: 34 }}>
          <div style={label}>Registered office</div>
          <address style={{ ...body, fontStyle: 'normal' }}>
            Pranix AI Labs Private Limited
            <br />
            D. No. 8-2-618/2, 2nd Floor
            <br />
            Reliance Humsafar Building
            <br />
            Road No. 11, Banjara Hills
            <br />
            Hyderabad, Telangana, 500034
            <br />
            India
          </address>
          <p style={{ ...body, fontSize: 12, marginTop: 12, color: 'var(--text-subtle)' }}>
            CIN U62011TS2026PTC209631 · MSME UDYAM-TS-02-0307772 · DPIIT DIPP241828
          </p>
        </section>

        <section style={{ marginBottom: 34 }}>
          <div style={label}>Grievance Officer</div>
          <p style={body}>
            Prashanth Rangineni
            <br />
            Pranix AI Labs Private Limited
            <br />
            <a href="mailto:support@pranixailabs.com">support@pranixailabs.com</a>
          </p>
          <p style={{ ...body, fontSize: 12, marginTop: 12, color: 'var(--text-subtle)' }}>
            Appointed under the Digital Personal Data Protection Act 2023 and the Information
            Technology (Intermediary Guidelines and Digital Media Ethics Code) Rules 2021.
            Complaints and data-rights requests are acknowledged within 48 hours and answered
            within 30 days.
          </p>
        </section>

        <section style={{ marginBottom: 34 }}>
          <div style={label}>Data protection</div>
          <p style={body}>
            For access, correction, erasure or consent-withdrawal requests, write to{' '}
            <a href="mailto:privacy@quietkeep.com">privacy@quietkeep.com</a>. Full detail is in
            our <Link href="/privacy">Privacy Policy</Link>.
          </p>
        </section>

        <p style={{ fontSize: 13, color: 'var(--text-subtle)', marginTop: 48 }}>
          See also our <Link href="/terms">Terms of Service</Link>,{' '}
          <Link href="/privacy">Privacy Policy</Link> and{' '}
          <Link href="/refunds">Refund &amp; Cancellation Policy</Link>.
        </p>
      </div>
    </div>
  );
}
