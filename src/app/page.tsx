import Link from 'next/link'

export default function LandingPage() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-4" style={{ background: 'var(--background)' }}>
      <div className="max-w-2xl w-full text-center space-y-8 animate-fade-in">
        {/* Logo / wordmark */}
        <div className="flex items-center justify-center gap-3">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ background: 'var(--accent)' }}
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <circle cx="10" cy="10" r="3" fill="white" />
              <path
                d="M10 2C10 2 6 6 6 10C6 14 10 18 10 18C10 18 14 14 14 10C14 6 10 2 10 2Z"
                stroke="white"
                strokeWidth="1.5"
                fill="none"
                opacity="0.5"
              />
            </svg>
          </div>
          <span className="text-2xl font-semibold tracking-tight" style={{ color: 'var(--foreground)' }}>
            QuietKeep
          </span>
        </div>

        {/* Headline */}
        <div className="space-y-4">
          <h1 className="text-5xl font-bold tracking-tight text-balance" style={{ color: 'var(--foreground)' }}>
            Speak your intentions.
            <br />
            <span style={{ color: 'var(--accent)' }}>Act on them.</span>
          </h1>
          <p className="text-lg leading-relaxed" style={{ color: 'var(--muted)' }}>
            QuietKeep listens, understands, and organizes your voice-captured intentions
            into actionable suggestions — privately and intelligently.
          </p>
        </div>

        {/* Features */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-left">
          {[
            { icon: '🎙️', title: 'Voice Capture', desc: 'Speak naturally. QuietKeep transcribes and parses in real time.' },
            { icon: '🧠', title: 'Intent Parsing', desc: 'Structured intent extraction with confidence scoring.' },
            { icon: '📋', title: 'Audit Trail', desc: 'Full history of every action, reviewable any time.' },
          ].map(f => (
            <div
              key={f.title}
              className="rounded-xl p-4 space-y-2"
              style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
            >
              <span className="text-2xl">{f.icon}</span>
              <h3 className="font-medium text-sm" style={{ color: 'var(--foreground)' }}>{f.title}</h3>
              <p className="text-xs leading-relaxed" style={{ color: 'var(--muted)' }}>{f.desc}</p>
            </div>
          ))}
        </div>

        {/* CTA */}
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link
            href="/login"
            className="inline-flex items-center justify-center px-8 py-3 rounded-xl font-medium text-sm transition-all duration-200"
            style={{ background: 'var(--accent)', color: '#fff' }}
          >
            Get started — it&apos;s free
          </Link>
          <Link
            href="/login"
            className="inline-flex items-center justify-center px-8 py-3 rounded-xl font-medium text-sm transition-all duration-200"
            style={{ background: 'var(--surface)', color: 'var(--foreground)', border: '1px solid var(--border)' }}
          >
            Sign in
          </Link>
        </div>

        <p className="text-xs" style={{ color: 'var(--muted)' }}>
          No password required. Magic link authentication via email.
        </p>
      </div>
    </main>
  )
}
