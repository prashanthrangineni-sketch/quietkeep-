// File: src/components/WebPushSetup.jsx
'use client';
import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';

export default function WebPushSetup() {
  const [status, setStatus] = useState('idle'); // idle | requesting | granted | denied | unsupported
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!('Notification' in window) || !('serviceWorker' in navigator)) { setStatus('unsupported'); return; }
    if (Notification.permission === 'granted') setStatus('granted');
    else if (Notification.permission === 'denied') setStatus('denied');
  }, []);

  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
  }

  async function requestPermission() {
    if (!('Notification' in window)) { setStatus('unsupported'); return; }
    setStatus('requesting');
    setErr('');
    try {
      const reg = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { setStatus('denied'); return; }
      setStatus('granted');

      // Subscribe to push with VAPID public key
      const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!vapidPublicKey) { setErr('VAPID key not configured'); return; }

      const subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
      });

      // Save subscription object + push_enabled to user_settings
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await supabase.from('user_settings').upsert({
          user_id: user.id,
          push_enabled: true,
          push_subscription: subscription.toJSON(),
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id' });
      }
    } catch (e) {
      console.error('[WebPush]', e);
      setErr(String(e));
      setStatus('idle');
    }
  }

  async function disablePush() {
    try {
      const reg = await navigator.serviceWorker.getRegistration('/sw.js');
      const sub = await reg?.pushManager?.getSubscription();
      await sub?.unsubscribe();
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await supabase.from('user_settings').upsert({
          user_id: user.id,
          push_enabled: false,
          push_subscription: null,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id' });
      }
      setStatus('idle');
    } catch (e) { setErr(String(e)); }
  }

  const btnBase = { padding: '10px 20px', borderRadius: '10px', border: 'none', fontSize: '13px', fontWeight: 600, cursor: 'pointer', minHeight: '44px' };

  if (status === 'unsupported') return (
    <div style={{ fontSize: '12px', color: '#64748b', padding: '8px 12px', background: 'rgba(100,116,139,0.08)', borderRadius: '8px' }}>
      Push notifications not supported on this browser.
    </div>
  );

  if (status === 'denied') return (
    <div style={{ fontSize: '12px', color: '#f59e0b', padding: '8px 12px', background: 'rgba(245,158,11,0.08)', borderRadius: '8px', border: '1px solid rgba(245,158,11,0.2)' }}>
      Notifications blocked. Enable in browser settings → Site Settings → Notifications.
    </div>
  );

  if (status === 'granted') return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: err ? '8px' : 0 }}>
        <span style={{ fontSize: '13px', color: '#22c55e' }}>✓ Push notifications active</span>
        <button onClick={disablePush} style={{ ...btnBase, background: 'rgba(239,68,68,0.1)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.3)', padding: '6px 12px' }}>
          Disable
        </button>
      </div>
      {err && <div style={{ fontSize: '11px', color: '#ef4444' }}>{err}</div>}
    </div>
  );

  return (
    <div>
      <button
        onClick={requestPermission}
        disabled={status === 'requesting'}
        style={{ ...btnBase, background: status === 'requesting' ? 'rgba(99,102,241,0.3)' : '#6366f1', color: '#fff' }}
      >
        {status === 'requesting' ? 'Enabling...' : '🔔 Enable Push Notifications'}
      </button>
      {err && <div style={{ fontSize: '11px', color: '#ef4444', marginTop: '6px' }}>{err}</div>}
    </div>
  );
}
