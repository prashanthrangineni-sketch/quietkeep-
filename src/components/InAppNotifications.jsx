'use client';
// InAppNotifications.jsx
// Alternative to Web Push (VAPID not configured).
// Polls proactive_nudges + reminders tables every 60s when app is open.
// Shows in-app toast + speaks via VoiceTalkback.
// Zero external dependencies. No VAPID required.

import { useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { speak } from '@/components/VoiceTalkback';

const POLL_INTERVAL = 60 * 1000; // 60 seconds
const SHOWN_KEY = 'qk_shown_notifs'; // localStorage set of shown notification ids

function getShown() {
  try { return new Set(JSON.parse(localStorage.getItem(SHOWN_KEY) || '[]')); } catch { return new Set(); }
}
function markShown(id) {
  try {
    const s = getShown(); s.add(id);
    // Keep only last 200 to avoid bloat
    const arr = [...s].slice(-200);
    localStorage.setItem(SHOWN_KEY, JSON.stringify(arr));
  } catch {}
}

function showToast(message, type = 'info') {
  // Create a temporary toast div — works without React state
  const existing = document.getElementById('qk-inapp-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.id = 'qk-inapp-toast';
  toast.style.cssText = `
    position:fixed;top:108px;left:50%;transform:translateX(-50%);
    background:var(--bg-raised);border:1.5px solid var(--border-strong);
    border-radius:999px;padding:10px 20px;font-size:13px;font-weight:600;
    color:var(--text);z-index:9999;backdrop-filter:blur(16px);
    box-shadow:0 4px 24px rgba(0,0,0,0.12),0 0 0 1px var(--primary-glow);
    white-space:nowrap;max-width:90vw;overflow:hidden;text-overflow:ellipsis;
    animation:qk-toast-in 0.2s cubic-bezier(0.34,1.56,0.64,1);
  `;
  toast.textContent = message;
  document.body.appendChild(toast);

  // Auto-dismiss after 4s
  setTimeout(() => { try { toast.remove(); } catch {} }, 4000);
}

export default function InAppNotifications({ userId }) {
  const timerRef = useRef(null);

  const poll = useCallback(async () => {
    if (!userId) return;
    const shown = getShown();
    const now = new Date();
    const windowStart = new Date(now.getTime() - POLL_INTERVAL - 5000).toISOString();
    const windowEnd = now.toISOString();

    try {
      // Check due reminders (active, scheduled in last poll window)
      const { data: dueReminders } = await supabase
        .from('reminders')
        .select('id, reminder_text, scheduled_for')
        .eq('user_id', userId)
        .eq('is_active', true)
        .gte('scheduled_for', windowStart)
        .lte('scheduled_for', windowEnd)
        .limit(3);

      for (const r of dueReminders || []) {
        const key = `rem_${r.id}`;
        if (shown.has(key)) continue;
        markShown(key);
        const msg = `⏰ Reminder: ${r.reminder_text}`;
        showToast(msg);
        speak(`Reminder: ${r.reminder_text}`);
      }

      // Check new proactive nudges (unread)
      const { data: nudges } = await supabase
        .from('proactive_nudges')
        .select('id, message')
        .eq('user_id', userId)
        .is('read_at', null)
        .order('created_at', { ascending: false })
        .limit(2);

      for (const n of nudges || []) {
        const key = `nudge_${n.id}`;
        if (shown.has(key)) continue;
        markShown(key);
        showToast(`💡 ${n.message}`);
        // Mark as read in DB so it doesn't show again
        await supabase.from('proactive_nudges').update({ read_at: now.toISOString() }).eq('id', n.id);
      }
    } catch {
      // Silent fail — never crash the app for notifications
    }
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    // Initial poll on mount (slight delay to not block render)
    const initialTimer = setTimeout(poll, 5000);
    // Recurring poll
    timerRef.current = setInterval(poll, POLL_INTERVAL);
    return () => {
      clearTimeout(initialTimer);
      clearInterval(timerRef.current);
    };
  }, [userId, poll]);

  // This component renders nothing — it only manages polling side effects
  return null;
}
