'use client';
import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';

const KNOCK_PUBLIC_KEY = process.env.NEXT_PUBLIC_KNOCK_PUBLIC_API_KEY;
const FEED_CHANNEL_ID = process.env.NEXT_PUBLIC_KNOCK_FEED_CHANNEL_ID;
const KNOCK_API = 'https://api.knock.app/v1';

async function fetchFeed(userId) {
  const res = await fetch(
    `${KNOCK_API}/users/${userId}/feeds/${FEED_CHANNEL_ID}?page_size=15`,
    { headers: { Authorization: `Bearer ${KNOCK_PUBLIC_KEY}` } }
  );
  if (!res.ok) return null;
  return res.json();
}

async function markAllSeen(userId, feedItems) {
  if (!feedItems.length) return;
  const ids = feedItems.filter(i => !i.seen_at).map(i => i.id);
  if (!ids.length) return;
  await fetch(`${KNOCK_API}/messages/batch/seen`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${KNOCK_PUBLIC_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ message_ids: ids }),
  });
}

function timeAgo(ts) {
  const diff = Math.floor((Date.now() - new Date(ts)) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);
  const [userId, setUserId] = useState(null);
  const panelRef = useRef(null);
  const pollRef = useRef(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user?.id) setUserId(session.user.id);
    });
  }, []);

  useEffect(() => {
    if (!userId) return;
    load();
    pollRef.current = setInterval(load, 30000);
    return () => clearInterval(pollRef.current);
  }, [userId]);

  useEffect(() => {
    if (!open) return;
    function handleOutside(e) {
      if (panelRef.current && !panelRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [open]);

  async function load() {
    if (!userId) return;
    setLoading(true);
    try {
      const data = await fetchFeed(userId);
      if (data?.entries) {
        setItems(data.entries);
        setUnread(data.entries.filter(e => !e.seen_at).length);
      }
    } catch (e) {
      console.error('[NotificationBell]', e);
    }
    setLoading(false);
  }

  async function handleToggle() {
    const next = !open;
    setOpen(next);
    if (next && unread > 0) {
      await markAllSeen(userId, items);
      setUnread(0);
      setItems(prev => prev.map(i => ({ ...i, seen_at: i.seen_at || new Date().toISOString() })));
    }
  }

  return (
    <div ref={panelRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        onClick={handleToggle}
        aria-label="Notifications"
        style={{
          background: 'none', border: 'none', cursor: 'pointer',
          padding: '6px 8px', position: 'relative',
          WebkitTapHighlightColor: 'transparent',
        }}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: '#94a3b8' }}>
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unread > 0 && (
          <span style={{
            position: 'absolute', top: 2, right: 2,
            background: '#6366f1', color: '#fff',
            borderRadius: '50%', minWidth: 16, height: 16,
            fontSize: 9, fontWeight: 800,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '0 3px',
            border: '2px solid #0a0a0f',
            lineHeight: 1,
          }}>
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div style={{
          position: 'fixed', top: 58, right: 12,
          width: 320, maxWidth: 'calc(100vw - 24px)',
          background: '#0f0f1a',
          border: '1px solid rgba(99,102,241,0.25)',
          borderRadius: 14, zIndex: 9999,
          boxShadow: '0 12px 40px rgba(0,0,0,0.7)',
          overflow: 'hidden',
        }}>
          <div style={{
            padding: '13px 16px',
            borderBottom: '1px solid rgba(255,255,255,0.06)',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <span style={{ color: '#f1f5f9', fontWeight: 700, fontSize: 14 }}>
              Notifications
            </span>
            {loading && <span style={{ fontSize: 11, color: '#475569' }}>refreshing…</span>}
          </div>

          <div style={{ maxHeight: 380, overflowY: 'auto' }}>
            {items.length === 0 ? (
              <div style={{
                padding: '32px 16px', textAlign: 'center',
                color: '#475569', fontSize: 13,
              }}>
                No notifications yet
              </div>
            ) : items.map(item => {
              const body = item.blocks?.find(b => b.type === 'markdown')?.rendered
                || item.blocks?.find(b => b.type === 'body')?.content
                || item.data?.message
                || 'New notification';
              const url = item.data?.url;
              return (
                <div
                  key={item.id}
                  onClick={() => url && (window.location.href = url)}
                  style={{
                    padding: '12px 16px',
                    borderBottom: '1px solid rgba(255,255,255,0.04)',
                    cursor: url ? 'pointer' : 'default',
                    background: item.seen_at ? 'transparent' : 'rgba(99,102,241,0.07)',
                  }}
                >
                  <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{
                        fontSize: 13, color: '#e2e8f0', lineHeight: 1.5,
                        // Strip markdown bold markers for display
                        whiteSpace: 'pre-wrap',
                      }}>
                        {body.replace(/\*\*/g, '')}
                      </div>
                      <div style={{ fontSize: 11, color: '#475569', marginTop: 4 }}>
                        {timeAgo(item.inserted_at)}
                      </div>
                    </div>
                    {!item.seen_at && (
                      <div style={{
                        width: 7, height: 7, borderRadius: '50%',
                        background: '#6366f1', flexShrink: 0, marginTop: 6,
                      }} />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
          }
