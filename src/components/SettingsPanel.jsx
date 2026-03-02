'use client'

import { useState, useEffect } from 'react'

const LANGUAGES = [
  { value: 'en-US', label: 'English (US)' },
  { value: 'en-GB', label: 'English (UK)' },
  { value: 'en-IN', label: 'English (India)' },
  { value: 'hi-IN', label: 'Hindi' },
  { value: 'es-ES', label: 'Spanish' },
]

export default function SettingsPanel() {
  const [settings, setSettings] = useState(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/api/settings')
      .then(r => r.json())
      .then(d => setSettings(d.settings))
      .catch(() => setError('Failed to load settings'))
  }, [])

  const update = (key, value) => {
    if (!settings) return
    setSettings({ ...settings, [key]: value })
    setSaved(false)
  }

  const handleSave = async () => {
    if (!settings) return
    setSaving(true)
    setError('')
    setSaved(false)
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      })
      if (!res.ok) throw new Error('Save failed')
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch {
      setError('Failed to save settings')
    } finally {
      setSaving(false)
    }
  }

  if (!settings) {
    return (
      <div className="rounded-2xl p-6 animate-pulse" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <div className="h-4 rounded w-1/3" style={{ background: 'var(--border)' }} />
      </div>
    )
  }

  return (
    <div
      className="rounded-2xl p-6 space-y-6"
      style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
    >
      <h2 className="font-semibold text-sm" style={{ color: 'var(--foreground)' }}>Settings</h2>

      <div className="space-y-2">
        <label className="text-xs font-medium block" style={{ color: 'var(--muted)' }}>
          Voice Language
        </label>
        <select
          value={settings.voice_language}
          onChange={e => update('voice_language', e.target.value)}
          className="w-full rounded-lg px-3 py-2 text-sm outline-none"
          style={{ background: 'var(--background)', border: '1px solid var(--border)', color: 'var(--foreground)' }}
        >
          {LANGUAGES.map(l => (
            <option key={l.value} value={l.value}>{l.label}</option>
          ))}
        </select>
      </div>

      <div className="space-y-2">
        <div className="flex justify-between">
          <label className="text-xs font-medium" style={{ color: 'var(--muted)' }}>
            Min Confidence Threshold
          </label>
          <span className="text-xs font-medium" style={{ color: 'var(--accent)' }}>
            {Math.round(settings.confidence_threshold * 100)}%
          </span>
        </div>
        <input
          type="range"
          min="0.1"
          max="1"
          step="0.05"
          value={settings.confidence_threshold}
          onChange={e => update('confidence_threshold', parseFloat(e.target.value))}
          className="w-full accent-purple-500"
        />
        <p className="text-xs" style={{ color: 'var(--muted)' }}>
          Intents below this threshold will be flagged for review.
        </p>
      </div>

      {[
        { key: 'auto_confirm_high_confidence', label: 'Auto-confirm high confidence intents', desc: 'Automatically confirm intents ≥ 90% confidence' },
        { key: 'notifications_enabled', label: 'Notifications', desc: 'Receive alerts for new intent suggestions' },
      ].map(({ key, label, desc }) => (
        <div key={key} className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium" style={{ color: 'var(--foreground)' }}>{label}</p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>{desc}</p>
          </div>
          <button
            onClick={() => update(key, !settings[key])}
            className="flex-shrink-0 w-10 h-6 rounded-full transition-all duration-200 relative"
            style={{ background: settings[key] ? 'var(--accent)' : 'var(--border)' }}
          >
            <span
              className="absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all duration-200"
              style={{ left: settings[key] ? '18px' : '2px' }}
            />
          </button>
        </div>
      ))}

      {error && (
        <p className="text-xs rounded-lg px-3 py-2" style={{ background: 'rgba(248,113,113,0.1)', color: 'var(--error)' }}>
          {error}
        </p>
      )}

      <button
        onClick={handleSave}
        disabled={saving}
        className="w-full py-2.5 rounded-lg text-sm font-medium transition-all disabled:opacity-50"
        style={{ background: saved ? 'var(--success)' : 'var(--accent)', color: '#fff' }}
      >
        {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save Settings'}
      </button>
    </div>
  )
}
