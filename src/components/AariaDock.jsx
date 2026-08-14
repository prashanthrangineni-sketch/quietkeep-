'use client';
// src/components/AariaDock.jsx
// ─────────────────────────────────────────────────────────────────────────────
// The face Aaria wears on every screen.
//
// Rendered once from the root layout, so it survives navigation — the panel
// does not unmount and remount as the user moves between screens, which is what
// lets "open invoices" flow straight into "add 2000 for Ravi" without losing
// the thread.
//
// DESIGN CONSTRAINTS THAT ARE NOT NEGOTIABLE
//  - It must never cover the bottom navigation. Every screen in this app has a
//    tab bar; an assistant that sits on top of it is a bug wearing a feature's
//    clothes. Hence the bottom offset and the safe-area inset.
//  - It must use theme variables only. 353 hardcoded colours were removed from
//    this codebase in PRs #63-#66 precisely so that dark mode is not a lie.
//    Two colours are hardcoded deliberately below and are commented where they
//    appear: they sit on a filled accent surface, not on the theme surface.
//  - Typing must always be possible. Speech recognition is unavailable in some
//    browsers and behind some corporate proxies, and the keyboard is the only
//    honest fallback.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useRef, useEffect } from 'react';
import { useAaria } from '@/lib/context/aaria';

export default function AariaDock() {
  const {
    status, open, setOpen, interim, transcript, reply, error, hotwordOn, notice,
    here, silent, signedIn, submit, toggleListening, stopAll, setError,
  } = useAaria();

  const [typed, setTyped] = useState('');
  const inputRef = useRef(null);

  // Focus the box when the panel opens by keyboard, not when it opens by voice —
  // stealing focus mid-utterance pops the on-screen keyboard over the transcript.
  useEffect(() => {
    if (open && status === 'idle' && inputRef.current) inputRef.current.focus();
  }, [open, status]);

  if (silent || !signedIn) return null;

  const listening = status === 'listening';
  const thinking  = status === 'thinking';
  const speaking  = status === 'speaking';
  const busy      = listening || thinking || speaking;

  const orbColour = listening ? 'var(--red, #ef4444)'
    : thinking    ? 'var(--amber, #f59e0b)'
    : speaking    ? 'var(--green, #10b981)'
    : 'var(--primary)';

  const statusLine = listening ? 'Listening…'
    : thinking     ? 'Thinking…'
    : speaking     ? 'Speaking…'
    : here         ? `On ${here}. Say "open invoices", or ask me anything.`
    : 'Tap the mic, or type below.';

  function sendTyped(e) {
    e?.preventDefault?.();
    const t = typed.trim();
    if (!t) return;
    setTyped('');
    submit(t);
  }

  return (
    <>
      <style>{`
        @keyframes qkAariaPulse {
          0%,100% { box-shadow: 0 0 0 0 rgba(91,94,244,.42); }
          50%     { box-shadow: 0 0 0 14px rgba(91,94,244,0); }
        }
        @keyframes qkAariaRise {
          from { opacity: 0; transform: translateY(12px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .qk-aaria-panel { animation: qkAariaRise .18s ease-out; }
        .qk-aaria-orb:focus-visible { outline: 3px solid var(--primary); outline-offset: 3px; }
        @media (prefers-reduced-motion: reduce) {
          .qk-aaria-orb, .qk-aaria-panel { animation: none !important; }
        }
      `}</style>

      {/* ── panel ────────────────────────────────────────────────────────── */}
      {open && (
        <div
          className="qk-aaria-panel"
          role="dialog"
          aria-label="Aaria assistant"
          style={{
            position: 'fixed',
            right: 16,
            bottom: 'calc(150px + env(safe-area-inset-bottom, 0px))',
            width: 'min(370px, calc(100vw - 32px))',
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 16,
            boxShadow: '0 18px 44px rgba(0,0,0,.17)',
            padding: 16,
            zIndex: 9998,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <span style={{
              width: 8, height: 8, borderRadius: '50%', background: orbColour,
              flexShrink: 0,
            }} />
            <strong style={{ fontSize: 14, color: 'var(--text)' }}>Aaria</strong>
            <span style={{ flex: 1 }} />
            <button
              onClick={() => { stopAll(); setOpen(false); setError(''); }}
              aria-label="Close Aaria"
              style={{
                border: 'none', background: 'transparent', cursor: 'pointer',
                color: 'var(--text-muted)', fontSize: 20, lineHeight: 1, padding: 4,
              }}
            >×</button>
          </div>

          <p style={{
            margin: '0 0 10px', fontSize: 12.5, color: 'var(--text-subtle)', lineHeight: 1.5,
          }}>{statusLine}</p>

          {interim && (
            <p style={{
              margin: '0 0 8px', fontSize: 14, color: 'var(--text-muted)',
              fontStyle: 'italic', lineHeight: 1.5,
            }}>{interim}</p>
          )}

          {transcript && (
            <p style={{
              margin: '0 0 8px', fontSize: 14.5, color: 'var(--text)', lineHeight: 1.5,
            }}>{transcript}</p>
          )}

          {reply && (
            <div style={{
              background: 'var(--bg)', border: '1px solid var(--border)',
              borderRadius: 10, padding: '10px 12px', marginBottom: 10,
            }}>
              <p style={{ margin: 0, fontSize: 14, color: 'var(--text)', lineHeight: 1.55 }}>
                {reply}
              </p>
            </div>
          )}

          {error && (
            <div style={{
              background: 'var(--red-dim, rgba(220,38,38,.08))',
              border: '1px solid rgba(220,38,38,.22)',
              borderRadius: 10, padding: '8px 11px', marginBottom: 10,
            }}>
              <p style={{ margin: 0, fontSize: 12.5, color: 'var(--red, #c0392b)' }}>{error}</p>
            </div>
          )}

          <form onSubmit={sendTyped} style={{ display: 'flex', gap: 8 }}>
            <input
              ref={inputRef}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder="Type instead…"
              aria-label="Type a message to Aaria"
              style={{
                flex: 1, minWidth: 0, background: 'var(--bg)',
                border: '1.5px solid var(--border)', borderRadius: 10,
                color: 'var(--text)', padding: '9px 11px', fontSize: 14,
                fontFamily: 'inherit', outline: 'none',
              }}
            />
            <button
              type="submit"
              disabled={!typed.trim()}
              style={{
                border: 'none', borderRadius: 10, padding: '9px 15px',
                background: typed.trim() ? 'var(--primary)' : 'var(--surface-hover, var(--border))',
                // #fff is deliberate: this sits on the filled accent colour, not
                // on the theme surface, so it must stay light in both themes.
                color: typed.trim() ? '#fff' : 'var(--text-subtle)',
                fontSize: 14, fontWeight: 600, fontFamily: 'inherit',
                cursor: typed.trim() ? 'pointer' : 'not-allowed',
              }}
            >Send</button>
          </form>

          <p style={{
            margin: '10px 0 0', fontSize: 11, color: 'var(--text-subtle)', lineHeight: 1.5,
          }}>
            Ctrl+Space to talk from anywhere · Esc to stop
          </p>

          {/* An always-open microphone must always be visible. This line is the
              only honest way to ship a wake word in a browser. */}
          {hotwordOn && (
            <p style={{
              margin: '6px 0 0', fontSize: 11, color: 'var(--text-subtle)',
              display: 'flex', alignItems: 'center', gap: 5,
            }}>
              <span style={{
                width: 6, height: 6, borderRadius: '50%',
                background: 'var(--green, #10b981)', flexShrink: 0,
              }} />
              Wake word on — this tab is listening for your wake word.
            </p>
          )}
        </div>
      )}

      {/* ── orb ──────────────────────────────────────────────────────────── */}
      <button
        className="qk-aaria-orb"
        onClick={() => { if (busy) { stopAll(); } else { setOpen(true); toggleListening(); } }}
        onContextMenu={(e) => { e.preventDefault(); setOpen((v) => !v); }}
        aria-label={busy ? 'Stop Aaria' : 'Talk to Aaria'}
        title={busy ? 'Stop (Esc)' : 'Talk to Aaria (Ctrl+Space)'}
        style={{
          position: 'fixed',
          right: 16,
          bottom: 'calc(86px + env(safe-area-inset-bottom, 0px))',
          width: 56, height: 56, borderRadius: '50%', border: 'none',
          background: orbColour,
          // #fff on a filled accent circle — same reasoning as the Send button.
          color: '#fff',
          fontSize: 23, cursor: 'pointer', zIndex: 9999,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 6px 20px rgba(0,0,0,.22)',
          animation: listening ? 'qkAariaPulse 1.5s infinite' : 'none',
          transition: 'background .2s',
        }}
      >
        {listening ? '⏹' : thinking ? '…' : speaking ? '🔊' : '🎙️'}

        {/* Aaria noticed something. A dot, not a sound — she tells you when you
            open her, never on her own. See rule 1 in src/lib/aaria-watch.js. */}
        {notice && !open && (
          <span
            aria-hidden="true"
            style={{
              position: 'absolute', top: 2, right: 2,
              minWidth: 18, height: 18, padding: '0 4px',
              borderRadius: 9, background: 'var(--red, #ef4444)',
              // On a filled badge, not on the theme surface.
              color: '#fff',
              fontSize: 11, fontWeight: 700, lineHeight: '18px',
              border: '2px solid var(--surface)',
            }}
          >{notice.count > 9 ? '9+' : notice.count}</span>
        )}
      </button>
    </>
  );
}
