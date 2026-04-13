'use client';
/**
 * src/app/messages/[conversationId]/page.jsx
 *
 * QK Chat Thread — Full messaging UI for a single conversation.
 *
 * Features:
 *   - Auth guard
 *   - Fetch messages with cursor-based pagination (scroll up to load older)
 *   - Chat bubble UI (own = right/primary, other = left/surface)
 *   - Voice messages with waveform + play + transcript
 *   - Context cards for keep/reminder/health/finance shares
 *   - Fixed message input bar at bottom (text + send + voice record)
 *   - Reply-to: tap a message to set reply context
 *   - Auto-scroll to bottom on new messages
 *   - Supabase realtime subscription for new messages
 */
import { useAuth } from '@/lib/context/auth';
import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import NavbarClient from '@/components/NavbarClient';
import { apiGet, apiPost } from '@/lib/safeFetch';
import { supabase } from '@/lib/supabase';
import MessageBubble from '@/components/MessageBubble';
import { VoiceMessageRecorder } from '@/components/VoiceMessage';

const G = '#6366f1';

export default function ChatThreadPage() {
  const router = useRouter();
  const params = useParams();
  const conversationId = params?.conversationId;
  const { user, accessToken, loading: authLoading } = useAuth();

  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState(null);
  const [otherName, setOtherName] = useState('');

  const messagesEndRef = useRef(null);
  const scrollContainerRef = useRef(null);
  const chanRef = useRef(null);
  const initialScrollDone = useRef(false);

  // ── Auth guard ──
  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.replace('/login'); return; }
    if (conversationId) {
      loadMessages();
      loadConversationInfo();
    }
  }, [authLoading, user, conversationId]);

  // ── Realtime subscription ──
  useEffect(() => {
    if (!user || !conversationId) return;
    chanRef.current?.unsubscribe();
    chanRef.current = supabase
      .channel('qk-chat-' + conversationId)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'qk_messages',
        filter: `conversation_id=eq.${conversationId}`,
      }, (payload) => {
        const newMsg = payload.new;
        if (newMsg && newMsg.sender_id !== user.id) {
          setMessages(prev => [...prev, newMsg]);
          scrollToBottom();
        }
      })
      .subscribe();
    return () => { chanRef.current?.unsubscribe(); };
  }, [user, conversationId]);

  // ── Auto-scroll on initial load ──
  useEffect(() => {
    if (!loading && messages.length > 0 && !initialScrollDone.current) {
      initialScrollDone.current = true;
      setTimeout(scrollToBottom, 100);
    }
  }, [loading, messages.length]);

  function scrollToBottom() {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }

  async function loadConversationInfo() {
    const { data } = await apiGet('/api/qk-conversations', accessToken);
    if (data?.conversations) {
      const convo = data.conversations.find(c => c.id === conversationId);
      if (convo?.participants?.[0]) {
        setOtherName(convo.participants[0].full_name || convo.participants[0].qk_handle || 'QK User');
      }
    }
  }

  async function loadMessages(cursor) {
    if (cursor) {
      setLoadingMore(true);
    } else {
      setLoading(true);
    }

    const url = cursor
      ? `/api/qk-messages/${conversationId}?before=${encodeURIComponent(cursor)}`
      : `/api/qk-messages/${conversationId}`;

    const { data, error } = await apiGet(url, accessToken);

    if (!error && data?.messages) {
      const sorted = data.messages.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
      if (cursor) {
        // Prepend older messages
        setMessages(prev => [...sorted, ...prev]);
      } else {
        setMessages(sorted);
      }
      setHasMore(!!data.next_cursor);
      setNextCursor(data.next_cursor || null);
    }

    setLoading(false);
    setLoadingMore(false);
  }

  async function loadOlder() {
    if (loadingMore || !hasMore || !nextCursor) return;
    await loadMessages(nextCursor);
  }

  // ── Send text message ──
  async function sendText() {
    const content = text.trim();
    if (!content || sending) return;
    setSending(true);

    const payload = {
      conversation_id: conversationId,
      message_type: 'text',
      content,
      ...(replyTo ? { reply_to_id: replyTo.id } : {}),
    };

    const { data, error } = await apiPost('/api/qk-messages/send', payload, accessToken);
    setSending(false);

    if (!error && data?.message) {
      setMessages(prev => [...prev, data.message]);
      setText('');
      setReplyTo(null);
      scrollToBottom();
    }
  }

  // ── Send voice message ──
  async function sendVoice(blob, durationSec) {
    if (!blob || sending) return;
    setSending(true);

    // Upload to storage
    const path = `qk-direct/${user.id}/${conversationId}/${Date.now()}.webm`;
    const { error: upErr } = await supabase.storage
      .from('voice-messages').upload(path, blob, { upsert: false });

    if (upErr) {
      setSending(false);
      return;
    }

    const { data: urlData } = await supabase.storage
      .from('voice-messages').createSignedUrl(path, 60 * 60 * 24 * 365);

    if (!urlData?.signedUrl) {
      setSending(false);
      return;
    }

    const payload = {
      conversation_id: conversationId,
      message_type: 'voice',
      voice_url: urlData.signedUrl,
      ...(replyTo ? { reply_to_id: replyTo.id } : {}),
    };

    const { data, error } = await apiPost('/api/qk-messages/send', payload, accessToken);
    setSending(false);

    if (!error && data?.message) {
      setMessages(prev => [...prev, data.message]);
      setReplyTo(null);
      scrollToBottom();
    }
  }

  // ── Reply previews ──
  function getReplyPreview(replyToId) {
    if (!replyToId) return null;
    const m = messages.find(msg => msg.id === replyToId);
    if (!m) return null;
    if (m.message_type === 'voice') return 'Voice message';
    if (m.message_type === 'context') return 'Shared context';
    return m.content ? m.content.substring(0, 60) : null;
  }

  // ── Scroll detection for load-more ──
  function handleScroll(e) {
    if (e.target.scrollTop < 40 && hasMore && !loadingMore) {
      loadOlder();
    }
  }

  // ── Styles ──
  const inp = {
    flex: 1, background: 'var(--surface)', border: '1px solid var(--border)',
    borderRadius: 20, padding: '10px 16px', color: 'var(--text)',
    fontSize: 14, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box',
    resize: 'none',
  };

  if (authLoading) return null;

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--bg)', color: 'var(--text)', fontFamily: 'system-ui,sans-serif', display: 'flex', flexDirection: 'column' }}>
      <NavbarClient />

      <div style={{ maxWidth: 540, margin: '0 auto', width: '100%', flex: 1, display: 'flex', flexDirection: 'column', paddingTop: '4rem' }}>
        {/* Chat header */}
        <div style={{
          padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 10,
          borderBottom: '1px solid var(--border)', background: 'var(--bg)',
          position: 'sticky', top: '4rem', zIndex: 10,
        }}>
          <button
            onClick={() => router.push('/messages')}
            style={{
              background: 'none', border: 'none', color: '#a5b4fc',
              fontSize: 18, cursor: 'pointer', padding: 0, lineHeight: 1,
            }}
          >
            &larr;
          </button>
          <div style={{
            width: 34, height: 34, borderRadius: '50%',
            background: 'rgba(99,102,241,0.2)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 14, fontWeight: 700, color: '#a5b4fc',
          }}>
            {otherName.charAt(0).toUpperCase() || '?'}
          </div>
          <div style={{ fontSize: 15, fontWeight: 700 }}>{otherName || 'Chat'}</div>
        </div>

        {/* Messages area */}
        <div
          ref={scrollContainerRef}
          onScroll={handleScroll}
          style={{
            flex: 1, overflowY: 'auto', padding: '12px 16px',
            display: 'flex', flexDirection: 'column',
            paddingBottom: replyTo ? 130 : 90,
          }}
        >
          {/* Load more */}
          {hasMore && (
            <div style={{ textAlign: 'center', padding: '8px 0' }}>
              <button
                onClick={loadOlder}
                disabled={loadingMore}
                style={{
                  background: 'rgba(255,255,255,0.06)', border: '1px solid var(--border)',
                  borderRadius: 8, padding: '6px 14px', color: 'var(--text-muted)',
                  fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                {loadingMore ? 'Loading...' : 'Load older messages'}
              </button>
            </div>
          )}

          {loading ? (
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>Loading...</div>
          ) : messages.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-subtle)' }}>
              <div style={{ fontSize: 48, marginBottom: 12, opacity: 0.5 }}>👋</div>
              <div style={{ fontSize: 14 }}>Start the conversation!</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                Send a message to begin chatting.
              </div>
            </div>
          ) : (
            messages.map(m => (
              <MessageBubble
                key={m.id}
                message={m}
                isOwn={m.sender_id === user?.id}
                onReply={setReplyTo}
                replyPreview={getReplyPreview(m.reply_to_id)}
              />
            ))
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* ── Fixed input bar ── */}
        <div style={{
          position: 'fixed', bottom: 0, left: 0, right: 0,
          background: 'var(--bg)', borderTop: '1px solid var(--border)',
          padding: '0 16px', zIndex: 20,
        }}>
          <div style={{ maxWidth: 540, margin: '0 auto' }}>
            {/* Reply context */}
            {replyTo && (
              <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '6px 12px', background: 'rgba(99,102,241,0.08)',
                borderRadius: '10px 10px 0 0', borderLeft: `3px solid ${G}`,
                marginTop: 8,
              }}>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                  Replying to: {replyTo.content?.substring(0, 50) || replyTo.message_type}
                </div>
                <button
                  onClick={() => setReplyTo(null)}
                  style={{
                    background: 'none', border: 'none', color: 'var(--text-muted)',
                    fontSize: 14, cursor: 'pointer', padding: '0 4px',
                  }}
                >
                  x
                </button>
              </div>
            )}

            {/* Input row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 0 12px' }}>
              <input
                style={inp}
                placeholder="Type a message..."
                value={text}
                onChange={e => setText(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendText(); } }}
              />
              <VoiceMessageRecorder
                onSend={sendVoice}
                disabled={sending}
                accentColor={G}
              />
              <button
                onClick={sendText}
                disabled={!text.trim() || sending}
                style={{
                  width: 40, height: 40, borderRadius: '50%',
                  border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: text.trim() ? G : 'rgba(255,255,255,0.06)',
                  color: text.trim() ? '#fff' : '#475569',
                  fontSize: 16, cursor: text.trim() ? 'pointer' : 'default',
                  flexShrink: 0,
                }}
              >
                {sending ? '...' : '↑'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
