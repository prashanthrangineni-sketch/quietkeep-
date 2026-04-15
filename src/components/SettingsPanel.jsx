'use client'
import { useAuth } from '@/lib/context/auth';
import { safeFetch, apiPost, apiGet } from '@/lib/safeFetch';

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'

const LANGUAGES = [
  { value:'en-IN', label:'English (India)' },
  { value:'hi-IN', label:'Hindi — हिंदी' },
  { value:'te-IN', label:'Telugu — తెలుగు' },
  { value:'ta-IN', label:'Tamil — தமிழ்' },
  { value:'kn-IN', label:'Kannada — ಕನ್ನಡ' },
  { value:'ml-IN', label:'Malayalam — മലയാളം' },
  { value:'gu-IN', label:'Gujarati — ગુજરાતી' },
  { value:'bn-IN', label:'Bengali — বাংলা' },
  { value:'mr-IN', label:'Marathi — मराठी' },
  { value:'en-US', label:'English (US)' },
]

function Toggle({ on, onChange }) {
  return (
    <button onClick={() => onChange(!on)}
      style={{ width:40, height:24, borderRadius:12, border:'none',
        cursor:'pointer', position:'relative', flexShrink:0,
        background: on ? 'var(--accent)' : 'var(--border)', transition:'background 0.2s' }}>
      <span style={{ position:'absolute', top:2, width:20, height:20, borderRadius:'50%',
        background:'#fff', transition:'left 0.2s', left: on ? 18 : 2 }} />
    </button>
  )
}

// ── Step 9: BiometricToggle ──────────────────────────────────────────────
// Isolated component — only visible on native APK. Safe no-op on web/PWA.
// Uses dynamic import of biometricLock to avoid SSR failures.
function BiometricToggle() {
  const [supported, setSupported] = React.useState(false);
  const [enabled,   setEnabled]   = React.useState(false);
  const [loading,   setLoading]   = React.useState(false);
  const [msg,       setMsg]       = React.useState('');

  React.useEffect(() => {
    // Dynamic import — avoids bundling Capacitor types on web
    import('@/lib/biometricLock').then(m => {
      setSupported(m.isBiometricSupported());
      setEnabled(m.isBiometricEnabled());
    }).catch(() => {});
  }, []);

  if (!supported) return null; // invisible on web/PWA

  async function toggle(newVal) {
    setLoading(true);
    setMsg('');
    try {
      const { setBiometricEnabled } = await import('@/lib/biometricLock');
      const result = await setBiometricEnabled(newVal);
      if (result.ok) {
        setEnabled(newVal);
        setMsg(newVal ? 'Fingerprint lock enabled.' : 'Fingerprint lock disabled.');
      } else {
        setMsg(result.message ?? 'Failed to update.');
      }
    } catch (e) {
      setMsg('Error: ' + (e?.message ?? 'Unknown'));
    }
    setLoading(false);
  }

  return (
    <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, marginTop: 4 }}>
      <p className="text-sm font-medium" style={{ color: 'var(--foreground)', marginBottom: 8 }}>
        🔐 Security
      </p>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: 'var(--background)', border: '1px solid var(--border)',
        borderRadius: 10, padding: '10px 12px',
      }}>
        <div>
          <p style={{ fontSize: 13, color: 'var(--foreground)', fontWeight: 500 }}>
            Fingerprint Lock
          </p>
          <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
            Require fingerprint when opening app
          </p>
        </div>
        <button
          disabled={loading}
          onClick={() => toggle(!enabled)}
          style={{
            width: 44, height: 24, borderRadius: 12,
            background: enabled ? 'var(--accent)' : 'var(--border)',
            border: 'none', cursor: loading ? 'not-allowed' : 'pointer',
            position: 'relative', flexShrink: 0,
          }}
        >
          <span style={{
            display: 'block', width: 18, height: 18, borderRadius: '50%',
            background: '#fff', position: 'absolute', top: 3,
            left: enabled ? 23 : 3, transition: 'left 0.2s',
          }} />
        </button>
      </div>
      {msg && (
        <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>{msg}</p>
      )}
    </div>
  );
}

export default function SettingsPanel() {
  const { user } = useAuth();
  const [appSettings, setAppSettings]   = useState(null)
  const [userSettings, setUserSettings] = useState(null)
  const [workspaces, setWorkspaces]     = useState([])
  const [saving, setSaving]             = useState(false)
  const [saved, setSaved]               = useState(false)
  const [error, setError]               = useState('')

  useEffect(() => {
    const supabase = createClient()

    // Load app settings (confidence, toggles)
    fetch('/api/settings')
      .then(r => r.json())
      .then(d => setAppSettings({ ...(d.settings || {}), voice_language: d.voice_language || 'en-IN' }))
      .catch(() => setError('Failed to load settings'))

    // Load integration fields from user_settings directly
    if (!user) return;
    supabase
      supabase.from('user_settings')
        .select('phone_number,whatsapp_enabled,email_address,email_enabled,calendar_enabled,calendar_refresh_token')
        .eq('user_id', user.id).maybeSingle()
        .then(({ data }) => setUserSettings(data || {}))
      supabase.from('business_workspaces')
        .select('id,name,plan').eq('owner_user_id', user.id)
        .then(({ data }) => setWorkspaces(data || []))
    })
  }, [])

  const updateApp = (key, val) => { setAppSettings(p => ({ ...p, [key]: val })); setSaved(false) }
  const updateUser = (key, val) => { setUserSettings(p => ({ ...p, [key]: val })); setSaved(false) }

  const handleSave = async () => {
    if (!appSettings) return
    setSaving(true); setError(''); setSaved(false)
    try {
      const supabase = createClient()
      if (!user) throw new Error('Not authenticated')

            // Save app settings + voice_language via API (cookie auth)
      const { voice_language, ...settingsBlob } = appSettings
      const { data: r, error: rErr } = await apiPost('/api/settings', { settings: settingsBlob, voice_language });
      if (rErr || !r) throw new Error('Save failed')

      // Save integration settings directly
      if (userSettings) {
        await supabase.from('user_settings').upsert({
          user_id:          user.id,
          phone_number:     userSettings.phone_number  || null,
          whatsapp_enabled: !!userSettings.whatsapp_enabled,
          email_address:    userSettings.email_address || null,
          email_enabled:    !!userSettings.email_enabled,
          calendar_enabled: !!userSettings.calendar_enabled,
        }, { onConflict: 'user_id' })
      }

      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (e) {
      setError(e.message || 'Save failed')
    } finally { setSaving(false) }
  }

  if (!appSettings || !userSettings) {
    return (
      <div className="rounded-2xl p-6 animate-pulse" style={{ background:'var(--surface)', border:'1px solid var(--border)' }}>
        <div className="h-4 rounded w-1/3" style={{ background:'var(--border)' }} />
      </div>
    )
  }

  return (
    <div className="rounded-2xl p-6 space-y-5" style={{ background:'var(--surface)', border:'1px solid var(--border)' }}>
      <h2 className="font-semibold text-sm" style={{ color:'var(--foreground)' }}>Settings</h2>

      {/* Voice Language */}
      <div className="space-y-1">
        <label className="text-xs font-medium block" style={{ color:'var(--muted)' }}>Voice Language</label>
        <select value={appSettings.voice_language || 'en-IN'} onChange={e => updateApp('voice_language', e.target.value)}
          className="w-full rounded-lg px-3 py-2 text-sm outline-none"
          style={{ background:'var(--background)', border:'1px solid var(--border)', color:'var(--foreground)' }}>
          {LANGUAGES.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
        </select>
      </div>

      {/* Confidence threshold */}
      <div className="space-y-1">
        <div className="flex justify-between">
          <label className="text-xs font-medium" style={{ color:'var(--muted)' }}>Min Confidence</label>
          <span className="text-xs font-medium" style={{ color:'var(--accent)' }}>
            {Math.round((appSettings.confidence_threshold || 0.5) * 100)}%
          </span>
        </div>
        <input type="range" min="0.1" max="1" step="0.05"
          value={appSettings.confidence_threshold || 0.5}
          onChange={e => updateApp('confidence_threshold', parseFloat(e.target.value))}
          className="w-full accent-purple-500" />
      </div>

      {/* App toggles */}
      {[
        { key:'auto_confirm_high_confidence', label:'Auto-confirm high confidence', desc:'Confirm keeps ≥ 90% automatically' },
        { key:'notifications_enabled', label:'In-app notifications', desc:'Show nudge banners in dashboard' },
      ].map(({ key, label, desc }) => (
        <div key={key} className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium" style={{ color:'var(--foreground)' }}>{label}</p>
            <p className="text-xs mt-0.5" style={{ color:'var(--muted)' }}>{desc}</p>
          </div>
          <Toggle on={!!appSettings[key]} onChange={v => updateApp(key, v)} />
        </div>
      ))}

      <hr style={{ border:'none', borderTop:'1px solid var(--border)' }} />

      {/* WhatsApp */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium" style={{ color:'var(--foreground)' }}>WhatsApp Notifications</p>
          <Toggle on={!!userSettings.whatsapp_enabled} onChange={v => updateUser('whatsapp_enabled', v)} />
        </div>
        <input type="tel" value={userSettings.phone_number || ''}
          onChange={e => updateUser('phone_number', e.target.value)}
          placeholder="+91XXXXXXXXXX" className="w-full rounded-lg px-3 py-2 text-sm outline-none"
          style={{ background:'var(--background)', border:'1px solid var(--border)', color:'var(--foreground)' }} />
        <p className="text-xs" style={{ color:'var(--muted)' }}>E.164 format. Requires Twilio setup.</p>
      </div>

      {/* Email */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium" style={{ color:'var(--foreground)' }}>Email Notifications</p>
          <Toggle on={!!userSettings.email_enabled} onChange={v => updateUser('email_enabled', v)} />
        </div>
        <input type="email" value={userSettings.email_address || ''}
          onChange={e => updateUser('email_address', e.target.value)}
          placeholder="you@example.com" className="w-full rounded-lg px-3 py-2 text-sm outline-none"
          style={{ background:'var(--background)', border:'1px solid var(--border)', color:'var(--foreground)' }} />
      </div>

      {/* Google Calendar */}
      <div className="space-y-2">
        <p className="text-sm font-medium" style={{ color:'var(--foreground)' }}>Google Calendar</p>
        {userSettings.calendar_refresh_token ? (
          <p className="text-xs" style={{ color:'#22c55e' }}>✅ Connected</p>
        ) : (
          <a href="/api/calendar/oauth?action=init"
            style={{ display:'inline-block', padding:'8px 14px', borderRadius:8,
              background:'var(--background)', border:'1px solid var(--border)',
              color:'var(--foreground)', fontSize:13, textDecoration:'none', cursor:'pointer' }}>
            🗓️ Connect Google Calendar
          </a>
        )}
      </div>

      {/* Business Workspaces */}
      {workspaces.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium" style={{ color:'var(--foreground)' }}>Business Workspaces</p>
          {workspaces.map(ws => (
            <div key={ws.id} className="flex items-center justify-between rounded-lg px-3 py-2"
              style={{ background:'var(--background)', border:'1px solid var(--border)' }}>
              <div>
                <p className="text-sm font-medium" style={{ color:'var(--foreground)' }}>{ws.name}</p>
                <p className="text-xs" style={{ color:'var(--muted)' }}>{ws.plan}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {error && (
        <p className="text-xs rounded-lg px-3 py-2" style={{ background:'rgba(248,113,113,0.1)', color:'var(--error)' }}>
          {error}
        </p>
      )}

      {/* Step 9: Biometric / Fingerprint Lock toggle (APK only) */}
      <BiometricToggle />

      <button onClick={handleSave} disabled={saving}
        className="w-full py-2.5 rounded-lg text-sm font-medium transition-all disabled:opacity-50"
        style={{ background: saved ? 'var(--success)' : 'var(--accent)', color:'#fff' }}>
        {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save Settings'}
      </button>
    </div>
  )
}
