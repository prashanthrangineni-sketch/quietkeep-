'use client';
/**
 * src/components/MessageBubble.jsx
 *
 * Chat bubble for QK Messaging threads.
 *
 * Props:
 *   message  — { id, sender_id, message_type, content, voice_url, context_payload, reply_to_id, created_at }
 *   isOwn    — boolean, true if current user sent this message
 *   onReply  — (message) => void, callback when user taps to reply
 *   replyPreview — optional string preview of the replied-to message
 */
import { useState, useRef } from 'react';
import ContextShareCard from '@/components/ContextShareCard';

const G = '#6366f1';

function fmtTime(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

// Simple waveform placeholder bars
function WaveformBars({ playing }) {
  const bars = [3, 5, 8, 4, 7, 5, 9, 6, 4, 7, 3, 6, 8, 5, 3];
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 2, height: 24 }}>
      {bars.map((h, i) => (
        <div key={i} style={{
          width: 3, borderRadius: 2,
          height: h * 2.5,
          background: playing ? G : 'rgba(255,255,255,0.25)',
          transition: 'background 0.2s',
          animation: playing ? `qk-wave 0.8s ease-in-out ${i * 0.05}s infinite alternate` : 'none',
        }} />
      ))}
    </div>
  );
}

export default function MessageBubble({ message, isOwn, onReply, replyPreview }) {
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef(null);
  const longPressRef = useRef(null);

  const m = message;
  if (!m) return null;

  const bubbleStyle = {
    maxWidth: '80%',
    padding: '8px 12px',
    borderRadius: isOwn ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
    background: isOwn ? G : 'var(--surface)',
    color: isOwn ? '#fff' : 'var(--text)',
    alignSelf: isOwn ? 'flex-end' : 'flex-start',
    position: 'relative',
    wordBreak: 'break-word',
  };

  const wrapStyle = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: isOwn ? 'flex-end' : 'flex-start',
    marginBottom: 6,
  };

  // Long press / tap to reply
  function handlePointerDown() {
    longPressRef.current = setTimeout(() => {
      if (onReply) onReply(m);
    }, 500);
  }
  function handlePointerUp() {
    clearTimeout(longPressRef.current);
  }
  function handleTap() {
    if (onReply) onReply(m);
  }

  // Voice playback
  function togglePlay() {
    if (!audioRef.current) {
      audioRef.current = new Audio(m.voice_url);
      audioRef.current.onended = () => setPlaying(false);
    }
    if (playing) {
      audioRef.current.pause();
      setPlaying(false);
    } else {
      audioRef.current.play().catch(() => {});
      setPlaying(true);
    }
  }

  return (
    <div style={wrapStyle}>
      {/* Reply-to reference */}
      {m.reply_to_id && replyPreview && (
        <div style={{
          fontSize: 11, color: 'var(--text-muted)', borderLeft: `2px solid ${G}`,
          paddingLeft: 6, marginBottom: 4, maxWidth: '75%',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {replyPreview}
        </div>
      )}

      <div
        style={bubbleStyle}
        onClick={handleTap}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
      >
        {/* ── Text message ── */}
        {m.message_type === 'text' && (
          <div style={{ fontSize: 14, lineHeight: 1.5 }}>{m.content}</div>
        )}

        {/* ── Voice message ── */}
        {m.message_type === 'voice' && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button
                onClick={(e) => { e.stopPropagation(); togglePlay(); }}
                style={{
                  width: 32, height: 32, borderRadius: '50%',
                  border: 'none', background: isOwn ? 'rgba(255,255,255,0.2)' : 'rgba(99,102,241,0.2)',
                  color: isOwn ? '#fff' : G, fontSize: 14, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                {playing ? '⏸' : '▶'}
              </button>
              <WaveformBars playing={playing} />
            </div>
            {m.content && (
              <div style={{
                fontSize: 11, color: isOwn ? 'rgba(255,255,255,0.7)' : 'var(--text-muted)',
                marginTop: 6, fontStyle: 'italic', lineHeight: 1.4,
              }}>
                {m.content}
              </div>
            )}
          </div>
        )}

        {/* ── Context card ── */}
        {m.message_type === 'context' && m.context_payload && (
          <ContextShareCard
            type={m.context_payload.type || 'keep'}
            payload={m.context_payload}
          />
        )}

        {/* Timestamp */}
        <div style={{
          fontSize: 10, marginTop: 4,
          color: isOwn ? 'rgba(255,255,255,0.6)' : 'var(--text-subtle)',
          textAlign: 'right',
        }}>
          {fmtTime(m.created_at)}
        </div>
      </div>
    </div>
  );
}
