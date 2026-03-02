'use client'

import { useState } from 'react'

export interface Intent {
  id: string
  raw_text: string
  intent_type: string
  subject: string
  action: string
  confidence: number
  status: 'pending' | 'confirmed'
  suggestions?: string[]
  chosen_suggestion?: string
  created_at: string
  confirmed_at?: string
}

interface IntentCardProps {
  intent: Intent
  onReview: (id: string) => Promise<void>
  onConfirm: (id: string, chosenSuggestion?: string) => Promise<void>
}

const INTENT_ICONS: Record<string, string> = {
  task: '✅',
  reminder: '⏰',
  note: '📝',
  meeting: '📅',
  purchase: '🛒',
  communication: '💬',
  goal: '🎯',
  unknown: '💡',
}

const CONFIDENCE_COLOR = (score: number) => {
  if (score >= 0.8) return 'var(--success)'
  if (score >= 0.6) return 'var(--warning)'
  return 'var(--error)'
}

export default function IntentCard({ intent, onReview, onConfirm }: IntentCardProps) {
  const [expanded, setExpanded] = useState(false)
  const [reviewing, setReviewing] = useState(false)
  const [confirming, setConfirming] = useState<string | null>(null)
  const [suggestions, setSuggestions] = useState<string[]>(intent.suggestions ?? [])
  const [showSuggestions, setShowSuggestions] = useState(false)

  const handleReview = async () => {
    setReviewing(true)
    try {
      await onReview(intent.id)
      setShowSuggestions(true)
    } finally {
      setReviewing(false)
    }
  }

  const handleConfirm = async (suggestion?: string) => {
    setConfirming(suggestion ?? '__direct__')
    try {
      await onConfirm(intent.id, suggestion)
    } finally {
      setConfirming(null)
    }
  }

  const icon = INTENT_ICONS[intent.intent_type] ?? INTENT_ICONS.unknown
  const isConfirmed = intent.status === 'confirmed'
  const pct = Math.round(intent.confidence * 100)

  return (
    <div
      className="rounded-xl p-4 space-y-3 transition-all duration-200 animate-fade-in"
      style={{
        background: 'var(--surface)',
        border: `1px solid ${isConfirmed ? 'rgba(52,211,153,0.3)' : 'var(--border)'}`,
        opacity: isConfirmed ? 0.8 : 1,
      }}
    >
      {/* Header row */}
      <div className="flex items-start gap-3">
        <span className="text-xl flex-shrink-0 mt-0.5">{icon}</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium leading-snug truncate" style={{ color: 'var(--foreground)' }}>
            {intent.subject || intent.raw_text}
          </p>
          <div className="flex items-center gap-2 mt-1">
            <span
              className="text-xs px-2 py-0.5 rounded-full font-medium"
              style={{ background: 'var(--accent-dim)', color: 'var(--accent)' }}
            >
              {intent.intent_type}
            </span>
            <span className="text-xs" style={{ color: CONFIDENCE_COLOR(intent.confidence) }}>
              {pct}% confidence
            </span>
            {isConfirmed && (
              <span className="text-xs" style={{ color: 'var(--success)' }}>✓ confirmed</span>
            )}
          </div>
        </div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-xs transition-colors flex-shrink-0"
          style={{ color: 'var(--muted)' }}
        >
          {expanded ? '↑' : '↓'}
        </button>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="space-y-2 pt-2" style={{ borderTop: '1px solid var(--border)' }}>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <span style={{ color: 'var(--muted)' }}>Raw: </span>
              <span style={{ color: 'var(--foreground)' }}>&ldquo;{intent.raw_text}&rdquo;</span>
            </div>
            <div>
              <span style={{ color: 'var(--muted)' }}>Action: </span>
              <span style={{ color: 'var(--foreground)' }}>{intent.action}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex-1 rounded-full h-1.5" style={{ background: 'var(--border)' }}>
              <div
                className="h-1.5 rounded-full transition-all"
                style={{ width: `${pct}%`, background: CONFIDENCE_COLOR(intent.confidence) }}
              />
            </div>
            <span className="text-xs" style={{ color: 'var(--muted)' }}>{pct}%</span>
          </div>
        </div>
      )}

      {/* Suggestions */}
      {showSuggestions && suggestions.length > 0 && !isConfirmed && (
        <div className="space-y-2 pt-2" style={{ borderTop: '1px solid var(--border)' }}>
          <p className="text-xs font-medium" style={{ color: 'var(--muted)' }}>Suggestions</p>
          {suggestions.map((s, i) => (
            <button
              key={i}
              onClick={() => handleConfirm(s)}
              disabled={confirming !== null}
              className="w-full text-left rounded-lg px-3 py-2 text-xs transition-colors disabled:opacity-50"
              style={{
                background: 'var(--background)',
                border: '1px solid var(--border)',
                color: 'var(--foreground)',
              }}
            >
              {confirming === s ? 'Confirming…' : s}
            </button>
          ))}
        </div>
      )}

      {/* Actions */}
      {!isConfirmed && (
        <div className="flex gap-2 pt-1">
          {suggestions.length === 0 && (
            <button
              onClick={handleReview}
              disabled={reviewing}
              className="flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-50"
              style={{ background: 'var(--surface-hover)', color: 'var(--foreground)', border: '1px solid var(--border)' }}
            >
              {reviewing ? 'Loading…' : '🔍 Review'}
            </button>
          )}
          <button
            onClick={() => handleConfirm()}
            disabled={confirming !== null}
            className="flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-50"
            style={{ background: 'var(--accent)', color: '#fff' }}
          >
            {confirming === '__direct__' ? 'Confirming…' : '✓ Confirm'}
          </button>
        </div>
      )}

      <p className="text-xs" style={{ color: 'var(--muted)' }}>
        {new Date(intent.created_at).toLocaleString()}
      </p>
    </div>
  )
}
