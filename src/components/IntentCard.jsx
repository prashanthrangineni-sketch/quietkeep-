'use client'
import { safeFetch, apiPost, apiGet } from '@/lib/safeFetch';

import { useState } from 'react'
import { executeClientAction, getExecuteLabel, EXECUTABLE_TYPES, openWhatsApp } from '@/lib/intent-executor'

const INTENT_ICONS = {
  task: '✅', reminder: '⏰', note: '📝', meeting: '📅',
  purchase: '🛒', contact: '📞', expense: '💰', trip: '🗺️',
  document: '📄', invoice: '🧾', compliance: '⚖️', health: '🏥',
  communication: '💬', goal: '🎯', unknown: '💡',
}

const CONFIDENCE_COLOR = (score) => {
  if (!score) return 'var(--muted)'
  if (score >= 0.8) return 'var(--success)'
  if (score >= 0.6) return 'var(--warning)'
  return 'var(--error)'
}

export default function IntentCard({ intent, onReview, onConfirm }) {
  const [expanded, setExpanded]           = useState(false)
  const [reviewing, setReviewing]         = useState(false)
  const [confirming, setConfirming]       = useState(null)
  const [suggestions, setSuggestions]     = useState(intent.suggestions ?? [])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [aiSummary, setAiSummary]         = useState(intent.ai_summary || null)
  const [summarizing, setSummarizing]     = useState(false)
  const [execResult, setExecResult]       = useState(null)
  const [showDisambig, setShowDisambig]   = useState(false)

  // Field mapping: works with both intents table (raw_text/subject) and keeps table (content)
  const displayText = intent.content || intent.subject || intent.raw_text || '(no content)'
  const confidence  = intent.confidence || 0
  const pct         = Math.round(confidence * 100)
  const icon        = INTENT_ICONS[intent.intent_type] ?? INTENT_ICONS.unknown
  const isConfirmed = ['confirmed','done','closed'].includes(intent.status) || intent.loop_state === 'closed'
  const isExecutable = EXECUTABLE_TYPES.has(intent.intent_type) && !isConfirmed
  const execLabel   = getExecuteLabel(intent)
  const followUp    = intent.follow_up

  const handleReview = async () => {
    setReviewing(true)
    try { await onReview(intent.id); setShowSuggestions(true) }
    finally { setReviewing(false) }
  }

  const handleConfirm = async (suggestion) => {
    setConfirming(suggestion ?? '__direct__')
    try { await onConfirm(intent.id, suggestion) }
    finally { setConfirming(null) }
  }

  const handleExecute = () => {
    // If follow_up has disambiguation candidates, show picker first
    if (followUp?.action_hint === 'disambiguate' && followUp.candidates?.length > 1) {
      setShowDisambig(true)
      return
    }
    const result = executeClientAction(intent)
    if (result.action_taken) {
      setExecResult(result.action_taken)
      setTimeout(() => setExecResult(null), 3000)
    }
  }

  const handleDisambigSelect = (candidate) => {
    setShowDisambig(false)
    // Execute with selected contact's phone
    const synthetic = { ...intent, contact_phone: candidate.phone, contact_name: candidate.name }
    const result = executeClientAction(synthetic)
    if (result.action_taken) {
      setExecResult(result.action_taken)
      setTimeout(() => setExecResult(null), 3000)
    }
  }

  const handleWhatsApp = () => {
    if (!intent.contact_phone) return
    const msg = `Hi ${intent.contact_name || ''}`.trim()
    openWhatsApp(intent.contact_phone, msg)
    setExecResult('Opened WhatsApp')
    setTimeout(() => setExecResult(null), 3000)
  }

  const handleAISummary = async () => {
    if (aiSummary || summarizing) return
    setSummarizing(true)
    try {
      const { data: r, error: rErr } = await apiPost('/api/ai/summary', { intent_id: intent.id, content: displayText, mode: 'keep' });
      if (!rErr && r) {
        const d = r
        setAiSummary(d.summary?.summary || d.result || null)
      }
    } catch {}
    finally { setSummarizing(false) }
  }

  return (
    <div className="rounded-xl p-4 space-y-3 transition-all duration-200"
      style={{
        background: 'var(--surface)',
        border: `1px solid ${isConfirmed ? 'rgba(52,211,153,0.3)' : 'var(--border)'}`,
        opacity: isConfirmed ? 0.85 : 1,
      }}>

      {/* ── HEADER ── */}
      <div className="flex items-start gap-3">
        <span className="text-xl flex-shrink-0 mt-0.5">{icon}</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium leading-snug"
            style={{ color: 'var(--foreground)', wordBreak: 'break-word' }}>
            {displayText}
          </p>

          {/* ── BADGES ── */}
          <div className="flex flex-wrap items-center gap-2 mt-1.5">
            <span className="text-xs px-2 py-0.5 rounded-full font-medium"
              style={{ background: 'var(--accent-dim)', color: 'var(--accent)' }}>
              {intent.intent_type || 'note'}
            </span>
            {confidence > 0 && (
              <span className="text-xs" style={{ color: CONFIDENCE_COLOR(confidence) }}>{pct}%</span>
            )}
            {intent.reminder_at && (
              <span className="text-xs" style={{ color: '#f59e0b' }}>
                ⏰ {new Date(intent.reminder_at).toLocaleString('en-IN', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' })}
              </span>
            )}
            {intent.contact_phone && (
              <span className="text-xs" style={{ color: '#22c55e' }}>📞 {intent.contact_phone}</span>
            )}
            {intent.geo_trigger_enabled && intent.location_name && (
              <span className="text-xs" style={{ color: '#10b981' }}>📍 {intent.location_name}</span>
            )}
            {(intent.space_type === 'business' || intent.metadata?.workspace_id) && (
              <span className="text-xs px-1.5 py-0.5 rounded"
                style={{ background: 'rgba(99,102,241,0.12)', color: '#6366f1', fontSize: 10 }}>biz</span>
            )}
            {isConfirmed && <span className="text-xs" style={{ color: 'var(--success)' }}>✓ done</span>}
          </div>

          {/* ── AI SUMMARY ── */}
          {aiSummary && (
            <p className="text-xs mt-2 px-2 py-1.5 rounded"
              style={{ background: 'rgba(99,102,241,0.07)', color: 'var(--muted)', fontStyle: 'italic' }}>
              💡 {aiSummary}
            </p>
          )}

          {/* ── FOLLOW-UP PROMPT ── */}
          {followUp && !isConfirmed && (
            <div className="mt-2 px-3 py-2 rounded-lg text-xs"
              style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)', color: '#f59e0b' }}>
              🤔 {followUp.follow_up}
            </div>
          )}

          {/* ── EXEC FEEDBACK ── */}
          {execResult && (
            <p className="text-xs mt-1.5 font-medium" style={{ color: '#22c55e' }}>✓ {execResult}</p>
          )}
        </div>
        <button onClick={() => setExpanded(!expanded)}
          className="text-xs flex-shrink-0" style={{ color: 'var(--muted)' }}>
          {expanded ? '↑' : '↓'}
        </button>
      </div>

      {/* ── DISAMBIGUATION PICKER ── */}
      {showDisambig && followUp?.candidates && (
        <div className="rounded-lg p-3 space-y-2"
          style={{ background: 'var(--background)', border: '1px solid var(--border)' }}>
          <p className="text-xs font-semibold" style={{ color: 'var(--foreground)' }}>
            {followUp.follow_up}
          </p>
          {followUp.candidates.map((c) => (
            <button key={c.id} onClick={() => handleDisambigSelect(c)}
              className="w-full text-left rounded-lg px-3 py-2 text-xs flex items-center justify-between"
              style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--foreground)' }}>
              <span>{c.name} {c.relation ? `(${c.relation})` : ''}</span>
              <span style={{ color: '#22c55e' }}>{c.phone || 'no phone'}</span>
            </button>
          ))}
          <button onClick={() => setShowDisambig(false)}
            className="w-full py-1.5 text-xs rounded-lg"
            style={{ color: 'var(--muted)', background: 'transparent' }}>Cancel</button>
        </div>
      )}

      {/* ── EXPANDED DETAILS ── */}
      {expanded && (
        <div className="space-y-2 pt-2" style={{ borderTop: '1px solid var(--border)' }}>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <span style={{ color: 'var(--muted)' }}>Created: </span>
              <span style={{ color: 'var(--foreground)' }}>
                {intent.created_at
                  ? new Date(intent.created_at).toLocaleString('en-IN', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' })
                  : '—'}
              </span>
            </div>
            {intent.contact_name && (
              <div>
                <span style={{ color: 'var(--muted)' }}>Contact: </span>
                <span style={{ color: 'var(--foreground)' }}>{intent.contact_name}</span>
              </div>
            )}
          </div>
          {confidence > 0 && (
            <div className="flex items-center gap-2">
              <div className="flex-1 rounded-full h-1.5" style={{ background: 'var(--border)' }}>
                <div className="h-1.5 rounded-full" style={{ width:`${pct}%`, background: CONFIDENCE_COLOR(confidence) }} />
              </div>
              <span className="text-xs" style={{ color: 'var(--muted)' }}>{pct}%</span>
            </div>
          )}
        </div>
      )}

      {/* ── SUGGESTIONS ── */}
      {showSuggestions && suggestions.length > 0 && !isConfirmed && (
        <div className="space-y-2 pt-2" style={{ borderTop: '1px solid var(--border)' }}>
          <p className="text-xs font-medium" style={{ color: 'var(--muted)' }}>Suggestions</p>
          {suggestions.map((s, i) => (
            <button key={i} onClick={() => handleConfirm(s)} disabled={confirming !== null}
              className="w-full text-left rounded-lg px-3 py-2 text-xs disabled:opacity-50"
              style={{ background: 'var(--background)', border: '1px solid var(--border)', color: 'var(--foreground)' }}>
              {confirming === s ? 'Confirming…' : s}
            </button>
          ))}
        </div>
      )}

      {/* ── ACTION BUTTONS ── */}
      {!isConfirmed && (
        <div className="flex gap-2 pt-1">
          {/* Execute action button */}
          {isExecutable && execLabel && (
            <button onClick={handleExecute}
              className="py-1.5 px-3 rounded-lg text-xs font-semibold flex-shrink-0"
              style={{ background: 'rgba(34,197,94,0.12)', color: '#22c55e', border: '1px solid rgba(34,197,94,0.25)' }}>
              {execLabel}
            </button>
          )}

          {/* WhatsApp button — shown when phone is available */}
          {intent.contact_phone && (
            <button onClick={handleWhatsApp}
              className="py-1.5 px-3 rounded-lg text-xs font-semibold flex-shrink-0"
              style={{ background: 'rgba(37,211,102,0.12)', color: '#25d366', border: '1px solid rgba(37,211,102,0.3)' }}>
              💬 WA
            </button>
          )}

          {suggestions.length === 0 && (
            <button onClick={handleReview} disabled={reviewing}
              className="flex-1 py-1.5 rounded-lg text-xs font-medium disabled:opacity-50"
              style={{ background: 'var(--surface-hover)', color: 'var(--foreground)', border: '1px solid var(--border)' }}>
              {reviewing ? 'Loading…' : '🔍 Review'}
            </button>
          )}

          {/* AI summary button */}
          <button onClick={handleAISummary} disabled={summarizing || !!aiSummary}
            title="AI summary" className="py-1.5 px-3 rounded-lg text-xs disabled:opacity-40 flex-shrink-0"
            style={{ background: 'rgba(99,102,241,0.1)', color: '#6366f1', border: '1px solid rgba(99,102,241,0.2)' }}>
            {summarizing ? '…' : aiSummary ? '✓' : '💡'}
          </button>

          <button onClick={() => handleConfirm()} disabled={confirming !== null}
            className="flex-1 py-1.5 rounded-lg text-xs font-medium disabled:opacity-50"
            style={{ background: 'var(--accent)', color: '#fff' }}>
            {confirming === '__direct__' ? 'Confirming…' : '✓ Done'}
          </button>
        </div>
      )}
    </div>
  )
          }
