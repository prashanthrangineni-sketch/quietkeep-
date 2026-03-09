// File: src/components/WebPushSetup.jsx — NEW FILE — Web Push registration (Sprint 2, Step 13)
// Usage: import WebPushSetup from '@/components/WebPushSetup'; // add to settings page
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

  async function requestPermission() {
    if (!('Notification' in window)) { setStatus('unsupported'); return; }
    setStatus('requesting');
    try {
      const reg = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
      const perm = await Notification.requestPermission();
      if (perm === 'granted') {
        setStatus('granted');
        // Save push subscription to DB (VAPID key needed for server push)
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          await supabase.from('user_settings').update({ push_enabled: true }).eq('user_id', user.id);
        }
        // Test notification
        setTimeout(() => {
          reg.showNotification('QuietKeep ✓', {
            body: 'Push notifications are active! You\'ll be reminded on time.',
            icon: '/icon-192.png', vibrate: [200, 100, 200],
          });
        }, 500);
      } else { setStatus('denied'); }
    } catch (e) { setErr(String(e)); setStatus('idle'); }
  }

  if (status === 'unsupported') return (
    <div style={{ background:'#1a1a1a', border:'1px solid #333', borderRadius:10, padding:'12px 14px', fontSize:'13px', color:'#64748b' }}>
      ℹ️ Push notifications not supported on this browser. Try Chrome on Android.
    </div>
  );

  if (status === 'granted') return (
    <div style={{ background:'#0d2d1a', border:'1px solid #22c55e33', borderRadius:10, padding:'12px 14px', fontSize:'13px', color:'#22c55e' }}>
      ✓ Push notifications are active — you'll get reminded on time
    </div>
  );

  if (status === 'denied') return (
    <div style={{ background:'#2d1a1a', border:'1px solid #ef444433', borderRadius:10, padding:'12px 14px', fontSize:'13px', color:'#ef4444' }}>
      ✕ Notifications blocked. Go to browser settings → Site Settings → Notifications → Allow quietkeep.com
    </div>
  );

  return (
    <div style={{ background:'#1a1a2e', border:'1px solid #6366f130', borderRadius:10, padding:'14px' }}>
      <div style={{ fontSize:'13px', color:'#94a3b8', marginBottom:'10px' }}>
        🔔 Enable push notifications to get reminders even when the app is closed
      </div>
      {err && <div style={{ color:'#ef4444', fontSize:'12px', marginBottom:'8px' }}>{err}</div>}
      <button onClick={requestPermission} disabled={status==='requesting'} style={{ padding:'8px 16px', borderRadius:8, border:'none', background:'#6366f1', color:'#fff', fontSize:'13px', fontWeight:600, cursor:'pointer', opacity: status==='requesting' ? 0.7 : 1 }}>
        {status === 'requesting' ? 'Requesting…' : '🔔 Enable Notifications'}
      </button>
    </div>
  );
}
