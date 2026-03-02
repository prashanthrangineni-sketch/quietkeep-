'use client'

import { useState, FormEvent } from 'react'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<'idle' | 'loading' | 'sent' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!email.trim()) return

    setStatus('loading')
    setErrorMsg('')

    const supabase = createClient()
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    })

    if (error) {
      setStatus('error')
      setErrorMsg(error.message)
    } else {
      setStatus('sent')
    }
  }

  return (
    <main
      className="min-h-screen flex flex-col items-center justify-center px-4"
      style={{ background: 'var(--background)' }}
    >
      <div className="w-full max-w-sm space-y-8 animate-fade-in">
        {/* Back link */}
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-sm transition-colors"
          style={{ color: 'var(--muted)' }}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M10 12L6 8L10 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Back to home
        </Link>

        {/* Header */}
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold" style={{ color: 'var(--foreground)' }}>
            Sign in to QuietKeep
          </h1>
          <p className="text-sm" style={{ color: 'var(--muted)' }}>
            Enter your email and we&apos;ll send a magic link.
          </p>
        </div>

        {status === 'sent' ? (
          <div
            className="rounded-xl p-6 space-y-3 text-center"
            style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
          >
            <div className="text-3xl">📬</div>
            <h2 className="font-medium" style={{ color: 'var(--foreground)' }}>
              Check your inbox
            </h2>
            <p className="text-sm" style={{ color: 'var(--muted)' }}>
              We sent a magic link to <strong style={{ color: 'var(--foreground)' }}>{email}</strong>.
              Click it to sign in.
            </p>
            <button
              onClick={() => { setStatus('idle'); setEmail('') }}
              className="text-sm underline"
              style={{ color: 'var(--accent)' }}
            >
              Use a different email
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="email" className="text-sm font-medium" style={{ color: 'var(--foreground)' }}>
                Email address
              </label>
              <input
                id="email"
                type="email"
                required
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                disabled={status === 'loading'}
                className="w-full rounded-xl px-4 py-3 text-sm outline-none transition-all"
                style={{
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  color: 'var(--foreground)',
                }}
              />
            </div>

            {status === 'error' && (
              <p className="text-sm rounded-lg px-3 py-2" style={{ background: 'rgba(248,113,113,0.1)', color: 'var(--error)' }}>
                {errorMsg}
              </p>
            )}

            <button
              type="submit"
              disabled={status === 'loading' || !email.trim()}
              className="w-full py-3 rounded-xl font-medium text-sm transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ background: 'var(--accent)', color: '#fff' }}
            >
              {status === 'loading' ? 'Sending…' : 'Send magic link'}
            </button>
          </form>
        )}

        <p className="text-xs text-center" style={{ color: 'var(--muted)' }}>
          No password. No tracking. Just your intentions.
        </p>
      </div>
    </main>
  )
}
