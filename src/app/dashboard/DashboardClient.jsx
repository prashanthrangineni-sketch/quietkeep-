'use client'

import { useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import VoiceCapture from '@/components/VoiceCapture'
import IntentCard from '@/components/IntentCard'
import SettingsPanel from '@/components/SettingsPanel'
import ActivityLog from '@/components/ActivityLog'

export default function DashboardClient({ user, initialIntents }) {
  const [intents, setIntents] = useState(initialIntents)
  const [activeTab, setActiveTab] = useState('intents')
  const [signingOut, setSigningOut] = useState(false)
  const router = useRouter()

  const handleCapture = useCallback(async (transcript, source) => {
    const res = await fetch('/api/voice/capture', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transcript, source }),
    })
    if (!res.ok) throw new Error('Capture failed')
    const { intent } = await res.json()
    setIntents(prev => [intent, ...prev])
  }, [])

  const handleReview = useCallback(async (id) => {
    const res = await fetch(`/api/intents/${id}/review`)
    if (!res.ok) throw new Error('Review failed')
    const { intent } = await res.json()
    setIntents(prev => prev.map(i => i.id === id ? intent : i))
  }, [])

  const handleConfirm = useCallback(async (id, chosenSuggestion) => {
    const res = await fetch(`/api/intents/${id}/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chosen_suggestion: chosenSuggestion }),
    })
    if (!res.ok) throw new Error('Confirm failed')
    const { intent } = await res.json()
    setIntents(prev => prev.map(i => i.id === id ? intent : i))
  }, [])

  const handleSignOut = async () => {
    setSigningOut(true)
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/')
  }

  const pendingCount = intents.filter(i => i.status === 'pending').length
  const confirmedCount = intents.filter(i => i.status === 'confirmed').length

  const TABS = [
    { id: 'intents', label: `Intents${pendingCount > 0 ? ` (${pendingCount})` : ''}` },
    { id: 'activity', label: 'Activity' },
    { id: 'settings', label: 'Settings' },
  ]

  return (
    <div className="min-h-screen" style={{ background: 'var(--background)' }}>
      <header
        className="sticky top-0 z-10 flex items-center justify-between px-6 py-3"
        style={{ background: 'rgba(15,15,17,0.9)', backdropFilter: 'blur(12px)', borderBottom: '1px solid var(--border)' }}
      >
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'var(--accent)' }}>
            <svg width="14" height="14" viewBox="0 0 20 20" fill="none">
              <circle cx="10" cy="10" r="3" fill="white" />
            </svg>
          </div>
          <span className="font-semibold text-sm" style={{ color: 'var(--foreground)' }}>QuietKeep</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-xs hidden sm:block" style={{ color: 'var(--muted)' }}>{user.email}</span>
          <button
            onClick={handleSignOut}
            disabled={signingOut}
            className="text-xs px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
            style={{ background: 'var(--surface)', color: 'var(--muted)', border: '1px solid var(--border)' }}
          >
            {signingOut ? '…' : 'Sign out'}
          </button>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'Total', value: intents.length },
            { label: 'Pending', value: pendingCount, color: 'var(--warning)' },
            { label: 'Confirmed', value: confirmedCount, color: 'var(--success)' },
          ].map(s => (
            <div
              key={s.label}
              className="rounded-xl p-3 text-center"
              style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
            >
              <p className="text-xl font-bold" style={{ color: s.color ?? 'var(--foreground)' }}>{s.value}</p>
              <p className="text-xs" style={{ color: 'var(--muted)' }}>{s.label}</p>
            </div>
          ))}
        </div>

        <VoiceCapture onCapture={handleCapture} />

        <div className="flex gap-1 rounded-xl p-1" style={{ background: 'var(--surface)' }}>
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className="flex-1 py-2 rounded-lg text-xs font-medium transition-colors"
              style={{
                background: activeTab === t.id ? 'var(--accent)' : 'transparent',
                color: activeTab === t.id ? '#fff' : 'var(--muted)',
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {activeTab === 'intents' && (
          <div className="space-y-3">
            {intents.length === 0 ? (
              <div
                className="rounded-2xl p-12 text-center space-y-3"
                style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
              >
                <span className="text-4xl block">🎙️</span>
                <p className="font-medium" style={{ color: 'var(--foreground)' }}>No intents yet</p>
                <p className="text-sm" style={{ color: 'var(--muted)' }}>Speak or type your first intention above</p>
              </div>
            ) : (
              intents.map(intent => (
                <IntentCard
                  key={intent.id}
                  intent={intent}
                  onReview={handleReview}
                  onConfirm={handleConfirm}
                />
              ))
            )}
          </div>
        )}

        {activeTab === 'activity' && <ActivityLog />}
        {activeTab === 'settings' && <SettingsPanel />}
      </div>
    </div>
  )
}
