import Link from 'next/link';

export default function Home() {
  return (
    <main style={{
      minHeight: '100vh',
      backgroundColor: '#0a0a0f',
      color: '#f1f5f9',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    }}>
      {/* Hero Section */}
      <section style={{
        maxWidth: '1200px',
        margin: '0 auto',
        padding: '100px 24px 80px',
        textAlign: 'center',
      }}>
        {/* Logo Mark */}
        <div style={{
          width: '80px',
          height: '80px',
          background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
          borderRadius: '20px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '32px',
          fontWeight: '800',
          color: '#fff',
          margin: '0 auto 32px',
          boxShadow: '0 0 40px rgba(99,102,241,0.3)',
        }}>QK</div>

        {/* Badge */}
        <div style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '8px',
          backgroundColor: 'rgba(99,102,241,0.1)',
          border: '1px solid rgba(99,102,241,0.3)',
          borderRadius: '100px',
          padding: '6px 16px',
          fontSize: '13px',
          color: '#a5b4fc',
          marginBottom: '32px',
        }}>
          <span style={{ width: '6px', height: '6px', backgroundColor: '#6366f1', borderRadius: '50%', display: 'inline-block' }}></span>
          Voice-First Personal Keeper
        </div>

        {/* Headline */}
        <h1 style={{
          fontSize: 'clamp(40px, 6vw, 72px)',
          fontWeight: '800',
          lineHeight: '1.1',
          letterSpacing: '-1.5px',
          margin: '0 0 24px',
          background: 'linear-gradient(135deg, #f1f5f9 0%, #a5b4fc 100%)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          backgroundClip: 'text',
        }}>
          Keep Everything.<br />Say It Once.
        </h1>

        {/* Subheadline */}
        <p style={{
          fontSize: '20px',
          color: '#64748b',
          lineHeight: '1.6',
          maxWidth: '560px',
          margin: '0 auto 48px',
        }}>
          QuietKeep is your intelligent voice-first vault. Capture notes, tasks, and memories — quietly and securely.
        </p>

        {/* CTA Buttons */}
        <div style={{ display: 'flex', gap: '16px', justifyContent: 'center', flexWrap: 'wrap' }}>
          <Link href="/login" style={{
            backgroundColor: '#6366f1',
            color: '#fff',
            textDecoration: 'none',
            padding: '14px 32px',
            borderRadius: '10px',
            fontSize: '16px',
            fontWeight: '600',
            boxShadow: '0 4px 24px rgba(99,102,241,0.4)',
            display: 'inline-block',
          }}>
            Get Started Free →
          </Link>
          <Link href="/dashboard" style={{
            backgroundColor: 'transparent',
            color: '#94a3b8',
            textDecoration: 'none',
            padding: '14px 32px',
            borderRadius: '10px',
            fontSize: '16px',
            fontWeight: '600',
            border: '1px solid #1e293b',
            display: 'inline-block',
          }}>
            View Dashboard
          </Link>
        </div>
      </section>

      {/* Features Grid */}
      <section style={{
        maxWidth: '1200px',
        margin: '0 auto',
        padding: '40px 24px 100px',
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
        gap: '20px',
      }}>
        {[
          { icon: '🎙️', title: 'Voice Capture', desc: 'Record thoughts instantly with one tap. Transcribed and stored automatically.' },
          { icon: '🔒', title: 'Private & Secure', desc: 'End-to-end encrypted. Your notes belong to you alone.' },
          { icon: '⚡', title: 'Instant Recall', desc: 'Smart search surfaces any memory in milliseconds.' },
          { icon: '📱', title: 'PWA Ready', desc: 'Install on any device. Works offline. No app store needed.' },
        ].map((feature, i) => (
          <div key={i} style={{
            backgroundColor: '#0f0f1a',
            border: '1px solid #1e1e2e',
            borderRadius: '16px',
            padding: '28px',
          }}>
            <div style={{ fontSize: '32px', marginBottom: '16px' }}>{feature.icon}</div>
            <h3 style={{ fontSize: '16px', fontWeight: '700', color: '#f1f5f9', margin: '0 0 8px' }}>{feature.title}</h3>
            <p style={{ fontSize: '14px', color: '#475569', lineHeight: '1.6', margin: 0 }}>{feature.desc}</p>
          </div>
        ))}
      </section>

      {/* Footer */}
      <footer style={{
        borderTop: '1px solid #1e1e2e',
        padding: '32px 24px',
        textAlign: 'center',
        color: '#334155',
        fontSize: '13px',
      }}>
        © {new Date().getFullYear()} QuietKeep · Pranix AI Labs Private Limited
      </footer>
    </main>
  );
}
