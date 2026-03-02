'use client'

import { useState, useEffect, useCallback } from 'react'

const ACTION_CONFIG = {
  'intent.captured': { icon: '🎙️', label: 'Intent captured', color: 'var(--accent)' },
  'intent.reviewed': { icon: '🔍', label: 'Intent reviewed', color: 'var(--warning)' },
  'intent.confirmed': { icon: '✅', label: 'Intent confirmed', color: 'var(--success)' },
}

const DEFAULT_ACTION = { icon: '📋', label: 'Activity', color: 'var(--muted)' }

export default function ActivityLog() {
  const [entries, setEntries] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [offset, setOffset] = useState(0)
  const LIMIT = 20

  const fetchEntries = useCallback(async (currentOffset, replace) => {
    try {
      const res = await fetch(`/api/audit-log?limit=${LIMIT}&offset=${currentOffset}`)
      if (!res.ok) throw new Error('Failed')
      const data = await res.json()
      setEntries(prev => replace ? data.entries : [...prev, ...data.entries])
      setTotal(data.total)
    } catch {
      // silently fail — not critical
    }
  }, [])

  useEffect(() => {
    setLoading(true)
    fetchEntries(0, true).finally(() => setLoading(false))
  }, [fetchEntries])

  const loadMore = async () => {
    const next = offset + LIMIT
    setLoadingMore(true)
    await fetchEntries(next, false)
    setOffset(next)
    setLoadingMore(false)
  }

  const hasMore = entries.length < total

  if (loading) {
    return (
      <div
        className="rounded-2xl p-6 space-y-3"
        style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
      >
        <div className="h-4 w-24 rounded animate-pulse" style={{ background: 'var(--border)' }} />
        {[...Array(4)].map((_, i) => (
          <div key={i} className="flex gap-3 animate-pulse">
            <div className="w-8 h-8 rounded-full" style={{ background: 'var(--border)' }} />
            <div className="flex-1 space-y-1.5">
              <div className="h-3 rounded w-3/4" style={{ background: 'var(--border)' }} />
              <div className="h-2 rounded w-1/2" style={{ background: 'var(--border)' }} />
            </div>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div
      className="rounded-2xl p-6 space-y-4"
      style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
    >
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-sm" style={{ color: 'var(--foreground)' }}>Activity Log</h2>
        <span className="text-xs" style={{ color: 'var(--muted)' }}>{total} events</span>
      </div>

      {entries.length === 0 ? (
        <div className="text-center py-8 space-y-2">
          <span className="text-2xl block">📭</span>
          <p className="text-sm" style={{ color: 'var(--muted)' }}>No activity yet</p>
        </div>
      ) : (
        <div className="space-y-1">
          {entries.map(entry => {
            const cfg = ACTION_CONFIG[entry.action] ?? DEFAULT_ACTION
            return (
              <div
                key={entry.id}
                className="flex items-start gap-3 rounded-lg px-3 py-2.5 transition-colors"
                style={{ background: 'transparent' }}
              >
                <div
                  className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 text-sm"
                  style={{ background: 'var(--background)' }}
                >
                  {cfg.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium" style={{ color: cfg.color }}>{cfg.label}</p>
                  <p className="text-xs truncate" style={{ color: 'var(--muted)' }}>
                    {entry.entity_type}/{entry.entity_id.slice(0, 8)}
                    {entry.metadata?.confidence !== undefined && (
                      <> · {Math.round(entry.metadata.confidence * 100)}% conf</>
                    )}
                    {entry.metadata?.chosen_suggestion && (
                      <> · &ldquo;{String(entry.metadata.chosen_suggestion).slice(0, 30)}&rdquo;</>
                    )}
                  </p>
                </div>
                <p className="text-xs flex-shrink-0" style={{ color: 'var(--muted)' }}>
                  {new Date(entry.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
            )
          })}
        </div>
      )}

      {hasMore && (
        <button
          onClick={loadMore}
          disabled={loadingMore}
          className="w-full py-2 rounded-lg text-xs font-medium transition-colors disabled:opacity-50"
          style={{ background: 'var(--surface-hover)', color: 'var(--muted)', border: '1px solid var(--border)' }}
        >
          {loadingMore ? 'Loading…' : `Load more (${total - entries.length} remaining)`}
        </button>
      )}
    </div>
  )
}
