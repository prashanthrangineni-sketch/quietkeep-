'use client';
/**
 * src/components/PermissionOnboarding.jsx
 *
 * Guided Android permission flow. Shown once on first launch after login.
 * Uses onPermissionChange() from voice.ts to stay synced with OS state.
 *
 * Steps: Microphone → Notifications → Battery optimization → Location
 * OEM-specific battery instructions for Oppo/Realme/Vivo/Xiaomi/Samsung.
 * Stored in localStorage('qk_perm_done') — shows once per install.
 */
import { useState, useEffect, useCallback } from 'react';
import { syncPermissions } from '@/lib/capacitor/voice';

function pluginCall(method, opts = {}) {
  return new Promise((resolve, reject) => {
    const cap = typeof window !== 'undefined' ? window?.Capacitor : null;
    if (!cap?.toNative) { reject(new Error('no bridge')); return; }
    cap.toNative('VoicePlugin', method, opts, {
      resolve: v => resolve(v),
      reject:  e => reject(new Error(typeof e === 'string' ? e : e?.message || 'err')),
    });
  });
}

function isAndroid() {
  return typeof window !== 'undefined' &&
    window?.Capacitor?.isNativePlatform?.() &&
    window?.Capacitor?.getPlatform?.() === 'android';
}

function detectOEM() {
  if (typeof navigator === 'undefined') return 'stock';
  const ua = navigator.userAgent;
  if (/OPPO|Realme|OnePlus|CPH\d|RMX\d/i.test(ua)) return 'coloros';
  if (/vivo|PD\d/i.test(ua)) return 'vivo';
  if (/Xiaomi|Redmi|M\d{4}/i.test(ua)) return 'xiaomi';
  if (/SM-|Samsung/i.test(ua)) return 'samsung';
  return 'stock';
}

const OEM_BATTERY = {
  coloros: 'Settings → Battery → App Launch → QuietKeep → Disable Auto-manage → enable all 3',
  vivo:    'Settings → Battery → High background power consumption → add QuietKeep',
  xiaomi:  'Settings → Battery & Performance → App battery saver → QuietKeep → No restrictions',
  samsung: 'Settings → Battery → Background usage limits → Never sleeping apps → add QuietKeep',
  stock:   'Settings → Apps → QuietKeep → Battery → Unrestricted',
};

const STEPS = [
  { id: 'mic',           icon: '🎙️', title: 'Microphone',           required: true,
    sub: 'Powers voice capture and always-on listening',
    why: 'QuietKeep uses your mic to save keeps by voice. Without this, voice input is disabled.' },
  { id: 'notifications', icon: '🔔', title: 'Notifications',         required: true,
    sub: 'Delivers reminders and alerts',
    why: 'Scheduled reminders and geo-triggered nudges need notification permission to reach you.' },
  { id: 'battery',       icon: '⚡', title: 'Battery Optimization',  required: false,
    sub: 'Prevents Android from killing always-on voice',
    why: 'Android stops background apps to save battery. Exempting QuietKeep keeps voice alive.' },
  { id: 'location',      icon: '📍', title: 'Location (optional)',   required: false,
    sub: 'Enables geo-triggered keeps',
    why: '"Remind me when I reach office" requires location access.' },
];

export default function PermissionOnboarding({ onComplete, onSkip }) {
  const [step, setStep]       = useState(0);
  const [status, setStatus]   = useState({}); // { mic: 'granted'|'denied'|'pending' }
  const [requesting, setReq]  = useState(false);
  const oem                   = detectOEM();

  // Pre-check which permissions are already granted
  useEffect(() => {
    if (!isAndroid()) { onComplete?.(); return; }
    syncPermissions().then(perms => {
      const s = {};
      if (perms.mic)           s.mic           = 'granted';
      if (perms.notifications) s.notifications = 'granted';
      if (perms.battery)       s.battery       = 'granted';
      setStatus(s);
    });
  }, [onComplete]);

  const request = useCallback(async () => {
    const id = STEPS[step].id;
    setReq(true);
    let granted = false;

    try {
      if (id === 'mic') {
        const r = await pluginCall('requestMicPermission');
        if (r?.granted) { granted = true; }
        else {
          // Poll up to 3× (replaces fixed delay hack)
          for (let i = 0; i < 3 && !granted; i++) {
            await new Promise(r => setTimeout(r, 300));
            const c = await pluginCall('checkMicPermission');
            granted = c?.granted === true;
          }
        }
      } else if (id === 'notifications') {
        if (typeof Notification !== 'undefined') {
          granted = (await Notification.requestPermission()) === 'granted';
        } else { granted = true; }
      } else if (id === 'battery') {
        try {
          await pluginCall('requestBatteryOptimizationExemption');
          await new Promise(r => setTimeout(r, 1800));
          granted = (await pluginCall('isBatteryOptimizationExempt'))?.exempt === true;
        } catch { granted = false; }
      } else if (id === 'location') {
        try {
          const cap = window?.Capacitor;
          if (cap?.Plugins?.Geolocation) {
            await cap.Plugins.Geolocation.requestPermissions();
            granted = true;
          } else if (navigator.geolocation) {
            await new Promise((res, rej) =>
              navigator.geolocation.getCurrentPosition(() => res(true), rej, { timeout: 6000 })
            );
            granted = true;
          }
        } catch { granted = false; }
      }
    } catch { granted = false; }

    setStatus(s => ({ ...s, [id]: granted ? 'granted' : 'denied' }));
    setReq(false);
  }, [step]);

  function advance() {
    if (step < STEPS.length - 1) setStep(s => s + 1);
    else onComplete?.();
  }

  if (!isAndroid()) return null;

  const cur       = STEPS[step];
  const curStatus = status[cur.id];
  const done      = curStatus === 'granted' || curStatus === 'denied';
  const pct       = Math.round((step / STEPS.length) * 100);

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 2000,
      background: 'rgba(0,0,0,0.9)', backdropFilter: 'blur(10px)',
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
      fontFamily: "'Inter',-apple-system,sans-serif" }}>
      <div style={{ background: 'var(--bg)', width: '100%', maxWidth: 480,
        borderRadius: '24px 24px 0 0', padding: '28px 24px 52px',
        border: '1px solid var(--border)' }}>

        {/* Progress bar */}
        <div style={{ height: 3, background: 'rgba(255,255,255,0.1)',
          borderRadius: 2, marginBottom: 26, overflow: 'hidden' }}>
          <div style={{ height: '100%', background: 'var(--primary)', borderRadius: 2,
            width: `${pct}%`, transition: 'width 0.4s' }} />
        </div>

        <div style={{ fontSize: 11, color: 'var(--text-subtle)', fontWeight: 700,
          textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 18 }}>
          Step {step + 1} of {STEPS.length}
        </div>

        <div style={{ fontSize: 50, marginBottom: 12, lineHeight: 1 }}>{cur.icon}</div>
        <h2 style={{ fontSize: 23, fontWeight: 900, color: 'var(--text)',
          margin: '0 0 5px', letterSpacing: '-0.5px' }}>{cur.title}</h2>
        <p style={{ fontSize: 14, color: 'var(--primary)', fontWeight: 600, margin: '0 0 14px' }}>
          {cur.sub}
        </p>

        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 12, padding: '11px 14px', marginBottom: 14,
          fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6 }}>
          {cur.why}
        </div>

        {cur.id === 'battery' && (
          <div style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)',
            borderRadius: 10, padding: '10px 14px', marginBottom: 14,
            fontSize: 12, color: '#f59e0b', lineHeight: 1.7 }}>
            <strong>On your device:</strong><br />
            {OEM_BATTERY[oem] || OEM_BATTERY.stock}
          </div>
        )}

        {curStatus === 'granted' && (
          <div style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.3)',
            borderRadius: 10, padding: '9px 14px', marginBottom: 14,
            fontSize: 13, color: '#10b981', fontWeight: 600 }}>
            ✓ {cur.title} granted
          </div>
        )}
        {curStatus === 'denied' && (
          <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)',
            borderRadius: 10, padding: '9px 14px', marginBottom: 14,
            fontSize: 12, color: '#f87171', lineHeight: 1.6 }}>
            Denied — enable later: Settings → Apps → QuietKeep → Permissions
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {!done ? (
            <button onClick={request} disabled={requesting}
              style={{ width: '100%', padding: '15px', borderRadius: 14, border: 'none',
                background: requesting ? 'var(--surface-hover)' : 'var(--primary)',
                color: requesting ? 'var(--text-subtle)' : '#fff',
                fontSize: 15, fontWeight: 700,
                cursor: requesting ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}>
              {requesting ? '⏳ Requesting…' : `Allow ${cur.title}`}
            </button>
          ) : (
            <button onClick={advance}
              style={{ width: '100%', padding: '15px', borderRadius: 14, border: 'none',
                background: 'var(--primary)', color: '#fff', fontSize: 15, fontWeight: 700,
                cursor: 'pointer', fontFamily: 'inherit' }}>
              {step < STEPS.length - 1 ? 'Continue →' : 'Start using QuietKeep →'}
            </button>
          )}
          {!cur.required && !done && (
            <button onClick={advance}
              style={{ width: '100%', padding: '12px', borderRadius: 14,
                border: '1px solid var(--border)', background: 'transparent',
                color: 'var(--text-muted)', fontSize: 14, cursor: 'pointer', fontFamily: 'inherit' }}>
              Skip for now
            </button>
          )}
          {step === 0 && (
            <button onClick={onSkip}
              style={{ width: '100%', padding: '8px', borderRadius: 12, border: 'none',
                background: 'transparent', color: 'var(--text-subtle)',
                fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>
              Set up later
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
