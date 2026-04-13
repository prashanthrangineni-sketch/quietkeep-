'use client';
/**
 * src/app/messages/page.jsx
 *
 * QK Messaging Hub — Conversation List + Connection Requests
 *
 * Tabs: Messages | Requests
 * - Messages: List conversations with participant name, last message preview, timestamp, unread badge
 * - Requests: Incoming pending connection requests with Accept/Decline
 * - "New Message" FAB navigates to /messages/new
 */
import { useAuth } from '@/lib/context/auth';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import NavbarClient from '@/components/NavbarClient';
import { apiGet, apiPost } from '@/lib/safeFetch';

const G = '#6366f1';

function timeAgo(ts) {
  if (!ts) return '';
  const diff = Date.now() - new Date(ts).getTime();
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
  if (diff < 86400000) return new Date(ts).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  return new Date(ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

export default function MessagesPage() {
  const router = useRouter();
  const { user, accessToken, loading: authLoading } = useAuth();
  const [tab, setTab] = useState('messages'); // 'messages' | 'requests'
  const [conversations, setConversations] = useState([]);
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [reqLoading, setReqLoading] = useState(true);
  const [respondingId, setRespondingId] = useState(null);

  // Read timestamps from localStorage for unread tracking
  const [readMap, setReadMap] = useState({});

  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.replace('/login'); return; }
    loadConversations();
    loadRequests();
    // Load read timestamps
    try {
      const stored = localStorage.getItem('qk_read_map');
      if (stored) setReadMap(JSON.parse(stored));
    } catch {}
  }, [authLoading, user]);

  async function loadConversations() {
    setLoading(true);
    const { data, error } = await apiGet('/api/qk-conversations', accessToken);
    if (!error && data?.conversations) {
      setConversations(data.conversations);
    }
    setLoading(false);
  }

  async function loadRequests() {
    setReqLoading(true);
    const { data, error } = await apiGet('/api/qk-connect/pending', accessToken);
    if (!error && data?.requests) {
      setRequests(data.requests);
    }
    setReqLoading(false);
  }

  function markRead(convoId) {
    const next = { ...readMap, [convoId]: new Date().toISOString() };
    setReadMap(next);
    try { localStorage.setItem('qk_read_map', JSON.stringify(next)); } catch {}
  }

  function isUnread(convo) {
    if (!convo.last_message_at) return false;
    const readAt = readMap[convo.id];
    if (!readAt) return true;
    return new Date(convo.last_message_at) > new Date(readAt);
  }

  async function respondToRequest(connectionId, action) {
    setRespondingId(connectionId);
    const { error } = await apiPost('/api/qk-connect/respond', {
      connection_id: connectionId,
      action,
    }, accessToken);
    setRespondingId(null);
    if (!error) {
      setRequests(prev => prev.filter(r => r.id !== connectionId));
      if (action === 'accept') loadConversations();
    }
  }

  const pendingCount = requests.length;

  // ── Styles ──
  const tabBtn = (active) => ({
    flex: 1, padding: '10px 0', border: 'none', fontFamily: 'inherit',
    background: active ? G : 'transparent',
    color: active ? '#fff' : 'var(--text-muted)',
    fontWeight: active ? 700 : 400, fontSize: 13, cursor: 'pointer',
    borderRadius: 10, position: 'relative',
  });

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--bg)', color: 'var(--text)', fontFamily: 'system-ui,sans-serif' }}>
      <NavbarClient />
      <div style={{ maxWidth: 540, margin: '0 auto', padding: '5rem 16px 6rem', paddingBottom: 100 }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>Messages</h1>
          <button
            onClick={() => router.push('/messages/new')}
            style={{
              padding: '8px 16px', borderRadius: 10, border: 'none',
              background: G, color: '#fff', fontSize: 13, fontWeight: 700,
              cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            + New Message
          </button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 20, background: 'var(--surface)', borderRadius: 12, padding: 4 }}>
          <button onClick={() => setTab('messages')} style={tabBtn(tab === 'messages')}>
            Messages
          </button>
          <button onClick={() => setTab('requests')} style={tabBtn(tab === 'requests')}>
            Requests{pendingCount > 0 ? ` (${pendingCount})` : ''}
          </button>
        </div>

        {/* ── Messages Tab ── */}
        {tab === 'messages' && (
          loading
            ? <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>Loading...</div>
            : conversations.length === 0
              ? (
                <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-subtle)' }}>
                  <div style={{ fontSize: 48, marginBottom: 12, opacity: 0.5 }}>💬</div>
                  <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>No conversations yet</div>
                  <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                    Connect with a QK user to start.
                  </div>
                  <button
                    onClick={() => router.push('/messages/new')}
                    style={{
                      marginTop: 16, padding: '10px 24px', borderRadius: 10, border: 'none',
                      background: G, color: '#fff', fontSize: 13, fontWeight: 700,
                      cursor: 'pointer', fontFamily: 'inherit',
                    }}
                  >
                    Find Someone
                  </button>
                </div>
              )
              : conversations.map(convo => {
                const other = convo.participants?.[0];
                const name = other?.full_name || other?.qk_handle || 'QK User';
                const initial = name.charAt(0).toUpperCase();
                const unread = isUnread(convo);

                return (
                  <div
                    key={convo.id}
                    onClick={() => { markRead(convo.id); router.push(`/messages/${convo.id}`); }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12,
                      padding: '12px 14px', marginBottom: 6,
                      background: unread ? 'rgba(99,102,241,0.06)' : 'var(--surface)',
                      border: '1px solid var(--border)',
                      borderLeft: unread ? `3px solid ${G}` : '3px solid transparent',
                      borderRadius: 12, cursor: 'pointer',
                      transition: 'background 0.15s',
                    }}
                  >
                    {/* Avatar */}
                    <div style={{
                      width: 42, height: 42, borderRadius: '50%',
                      background: other?.avatar_url ? 'transparent' : 'rgba(99,102,241,0.2)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 16, fontWeight: 700, color: '#a5b4fc', flexShrink: 0,
                      overflow: 'hidden',
                    }}>
                      {other?.avatar_url
                        ? <img src={other.avatar_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        : initial
                      }
                    </div>

                    {/* Info */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
                        <span style={{ fontSize: 14, fontWeight: unread ? 700 : 500, color: 'var(--text)' }}>
                          {name}
                        </span>
                        <span style={{ fontSize: 11, color: unread ? '#a5b4fc' : 'var(--text-subtle)', flexShrink: 0 }}>
                          {timeAgo(convo.last_message_at)}
                        </span>
                      </div>
                      <div style={{
                        fontSize: 12, color: 'var(--text-muted)',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        fontWeight: unread ? 600 : 400,
                      }}>
                        {convo.last_message_preview || 'No messages yet'}
                      </div>
                    </div>

                    {/* Unread dot */}
                    {unread && (
                      <div style={{
                        width: 8, height: 8, borderRadius: '50%',
                        background: G, flexShrink: 0,
                      }} />
                    )}
                  </div>
                );
              })
        )}

        {/* ── Requests Tab ── */}
        {tab === 'requests' && (
          reqLoading
            ? <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>Loading...</div>
            : requests.length === 0
              ? (
                <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-subtle)' }}>
                  <div style={{ fontSize: 48, marginBottom: 12, opacity: 0.5 }}>🤝</div>
                  <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>No pending requests</div>
                  <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                    Connection requests from other QK users will appear here.
                  </div>
                </div>
              )
              : requests.map(req => {
                const name = req.sender_name || req.sender_handle || req.sender_email || 'QK User';
                const initial = name.charAt(0).toUpperCase();
                const isResponding = respondingId === req.id;

                return (
                  <div key={req.id} style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '12px 14px', marginBottom: 6,
                    background: 'var(--surface)', border: '1px solid var(--border)',
                    borderRadius: 12,
                  }}>
                    <div style={{
                      width: 42, height: 42, borderRadius: '50%',
                      background: 'rgba(99,102,241,0.2)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 16, fontWeight: 700, color: '#a5b4fc', flexShrink: 0,
                    }}>
                      {initial}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 600 }}>{name}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        wants to connect
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                      <button
                        onClick={() => respondToRequest(req.id, 'accept')}
                        disabled={isResponding}
                        style={{
                          padding: '6px 14px', borderRadius: 8, border: 'none',
                          background: '#10b981', color: '#fff', fontSize: 12,
                          fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                          opacity: isResponding ? 0.6 : 1,
                        }}
                      >
                        Accept
                      </button>
                      <button
                        onClick={() => respondToRequest(req.id, 'decline')}
                        disabled={isResponding}
                        style={{
                          padding: '6px 14px', borderRadius: 8,
                          border: '1px solid var(--border)', background: 'transparent',
                          color: 'var(--text-muted)', fontSize: 12,
                          fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                          opacity: isResponding ? 0.6 : 1,
                        }}
                      >
                        Decline
                      </button>
                    </div>
                  </div>
                );
              })
        )}
      </div>
    </div>
  );
}
