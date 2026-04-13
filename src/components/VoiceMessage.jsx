'use client';
/**
 * src/components/VoiceMessage.jsx
 * WhatsApp-style voice message recorder (press & hold) + waveform player.
 *
 * Exports:
 *   VoiceMessageRecorder — press & hold button → MediaRecorder → blob sent via onSend
 *   VoiceMessagePlayer   — animated waveform + playback controls
 *
 * Usage:
 *   <VoiceMessageRecorder onSend={async (blob, durationSec) => { upload... }} />
 *   <VoiceMessagePlayer url={signedUrl} durationSec={12} />
 */
import { useState, useRef, useEffect, useCallback } from 'react';

// ── Recorder ────────────────────────────────────────────────────────────────

export function VoiceMessageRecorder({
  onSend,
  disabled    = false,
  accentColor = '#6366f1',
}) {
  const [state, setState]       = useState('idle'); // idle | recording | processing
  const [duration, setDuration] = useState(0);
  const [error, setError]       = useState('');
  const mrRef      = useRef(null);
  const chunksRef  = useRef([]);
  const timerRef   = useRef(null);
  const t0Ref      = useRef(0);
  const holdingRef = useRef(false);

  useEffect(() => () => { clearInterval(timerRef.current); _cleanup(); }, []);

  function _cleanup() {
    if (mrRef.current) {
      try { mrRef.current.stop(); } catch {}
      mrRef.current.stream?.getTracks().forEach(t => t.stop());
      mrRef.current = null;
    }
  }

  const startRec = useCallback(async (e) => {
    e?.preventDefault();
    if (state !== 'idle' || disabled) return;
    setError(''); holdingRef.current = true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus' : 'audio/webm';
      const mr = new MediaRecorder(stream, { mimeType });
      chunksRef.current = [];
      mr.ondataavailable = e => { if (e.data?.size > 0) chunksRef.current.push(e.data); };
      mr.start(100);
      mrRef.current = mr;
      t0Ref.current = Date.now();
      setDuration(0); setState('recording');
      timerRef.current = setInterval(() =>
        setDuration(Math.floor((Date.now() - t0Ref.current) / 1000)), 500);
    } catch {
      setError('Mic access denied'); setState('idle');
    }
  }, [state, disabled]);

  const stopRec = useCallback(async (e) => {
    e?.preventDefault();
    if (state !== 'recording' || !holdingRef.current) return;
    holdingRef.current = false;
    clearInterval(timerRef.current);
    const dur = Math.floor((Date.now() - t0Ref.current) / 1000);
    if (dur < 1) { _cleanup(); setState('idle'); setError('Hold longer to record'); return; }
    setState('processing');
    const mr = mrRef.current;
    if (!mr) { setState('idle'); return; }
    mr.onstop = async () => {
      const blob = new Blob(chunksRef.current, { type: mr.mimeType || 'audio/webm' });
      mr.stream?.getTracks().forEach(t => t.stop()); mrRef.current = null;
      try { await onSend(blob, dur); } catch { setError('Send failed'); }
      setState('idle'); setDuration(0);
    };
    mr.stop();
  }, [state, onSend]);

  const cancel = () => {
    holdingRef.current = false;
    clearInterval(timerRef.current);
    _cleanup(); setState('idle'); setDuration(0); setError('');
  };

  const fmtDur = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      {state === 'recording' && (
        <button onClick={cancel}
          style={{ width: 34, height: 34, borderRadius: '50%', border: 'none',
            background: 'rgba(239,68,68,0.12)', color: '#ef4444', cursor: 'pointer',
            fontSize: 15, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          ✕
        </button>
      )}
      {state === 'recording' && (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8,
          background: 'rgba(239,68,68,0.06)', borderRadius: 20, padding: '5px 12px' }}>
          <span style={{ width: 7, height: 7, background: '#ef4444', borderRadius: '50%',
            animation: 'pulse 1s infinite', flexShrink: 0 }} />
          <span style={{ fontSize: 12, color: '#ef4444', fontWeight: 600 }}>Recording</span>
          <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 'auto' }}>
            {fmtDur(duration)}
          </span>
        </div>
      )}
      {state === 'processing' && (
        <span style={{ flex: 1, fontSize: 12, color: 'var(--text-muted)' }}>Sending…</span>
      )}
      {error && state === 'idle' && (
        <span style={{ flex: 1, fontSize: 11, color: '#ef4444' }}>{error}</span>
      )}

      <button
        onPointerDown={startRec}
        onPointerUp={stopRec}
        onPointerLeave={state === 'recording' ? stopRec : undefined}
        onTouchStart={startRec}
        onTouchEnd={stopRec}
        disabled={disabled || state === 'processing'}
        style={{
          width: state === 'recording' ? 50 : 42,
          height: state === 'recording' ? 50 : 42,
          borderRadius: '50%', border: 'none', flexShrink: 0,
          background: state === 'recording' ? '#ef4444'
            : state === 'processing' ? 'var(--surface-hover)' : accentColor,
          color: '#fff',
          cursor: disabled || state === 'processing' ? 'not-allowed' : 'pointer',
          fontSize: state === 'recording' ? 20 : 18,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: 'all 0.15s',
          boxShadow: state === 'recording' ? '0 0 0 8px rgba(239,68,68,0.15)' : 'none',
          userSelect: 'none', WebkitUserSelect: 'none', touchAction: 'none',
        }}>
        {state === 'recording' ? '⏹' : state === 'processing' ? '⏳' : '🎙️'}
      </button>

      {state === 'idle' && !error && (
        <span style={{ fontSize: 10, color: 'var(--text-subtle)', whiteSpace: 'nowrap' }}>
          Hold to record
        </span>
      )}
    </div>
  );
}

// ── Player ────────────────────────────────────────────────────────────────────

export function VoiceMessagePlayer({
  url,
  durationSec = 0,
  accentColor = '#6366f1',
  compact     = false,
}) {
  const audioRef                = useRef(null);
  const [playing, setPlaying]   = useState(false);
  const [progress, setProgress] = useState(0);
  const [current, setCurrent]   = useState(0);

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const h = {
      play:       () => setPlaying(true),
      pause:      () => setPlaying(false),
      ended:      () => { setPlaying(false); setProgress(0); setCurrent(0); },
      timeupdate: () => {
        if (!a.duration) return;
        setProgress(a.currentTime / a.duration);
        setCurrent(Math.floor(a.currentTime));
      },
    };
    Object.entries(h).forEach(([ev, fn]) => a.addEventListener(ev, fn));
    return () => Object.entries(h).forEach(([ev, fn]) => a.removeEventListener(ev, fn));
  }, []);

  const toggle = () => {
    const a = audioRef.current;
    if (!a) return;
    if (playing) a.pause(); else a.play().catch(() => {});
  };

  const seek = e => {
    const a = audioRef.current;
    if (!a?.duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct  = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    a.currentTime = pct * a.duration;
    setProgress(pct);
  };

  const fmtDur = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  const bars   = compact ? 20 : 28;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: compact ? 6 : 8,
      minWidth: compact ? 140 : 180, maxWidth: compact ? 220 : 280 }}>
      <audio ref={audioRef} src={url} preload="metadata" />
      <button onClick={toggle}
        style={{ width: 34, height: 34, borderRadius: '50%', border: 'none',
          background: accentColor, color: '#fff', cursor: 'pointer', flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13 }}>
        {playing ? '⏸' : '▶'}
      </button>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 3 }}>
        <div onClick={seek}
          style={{ display: 'flex', alignItems: 'center', gap: 1.5, height: 22, cursor: 'pointer' }}>
          {Array.from({ length: bars }).map((_, i) => {
            const h      = 3 + Math.abs(Math.sin(i * 0.9) * 3 + Math.cos(i * 1.4) * 4);
            const filled = progress * bars > i;
            return (
              <div key={i} style={{ width: 2.5, height: Math.max(3, h) + 2,
                borderRadius: 2, flexShrink: 0,
                background: filled ? accentColor : 'var(--border)',
                transition: 'background 0.1s' }} />
            );
          })}
        </div>
        <div style={{ fontSize: 10, color: 'var(--text-subtle)' }}>
          {fmtDur(playing ? current : durationSec)}
        </div>
      </div>
    </div>
  );
}
