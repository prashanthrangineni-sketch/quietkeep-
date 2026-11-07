'use client';
// src/app/settings/voice/teach/page.jsx — "Teach Aaria your voice"
// Enables personalized wake name training through the on-device Aaria Edge plugin.
// Pure on-device processing. No network or upload calls are ever made.
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { getWakeWord } from '@/lib/wake-word-engine';
import {
  DEFAULT_SAMPLES_COUNT,
  CONSENT_SWITCH_LABEL,
  getTeachConsent,
  setTeachConsent,
  getTeachVoiceClips,
  formatProgressText,
  enrollVoiceSession,
  getAariaEdgePlugin,
} from '@/lib/teach-voice';

const P = '#6366f1';

export default function TeachVoicePage() {
  const router = useRouter();
  const [edgeAvailable, setEdgeAvailable] = useState(false);
  const [checkedEngine, setCheckedEngine] = useState(false);
  const [wakeName, setWakeName] = useState('Aaria');
  const [consent, setConsent] = useState(false);
  const [status, setStatus] = useState('idle'); // idle | recording | done | error | cancelled
  const [currentSample, setCurrentSample] = useState(1);
  const [totalSamples] = useState(DEFAULT_SAMPLES_COUNT);
  const [lastHeard, setLastHeard] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [resultData, setResultData] = useState(null);
  const [savedClipsCount, setSavedClipsCount] = useState(0);

  const abortControllerRef = useRef(null);

  useEffect(() => {
    try {
      const w = String(getWakeWord() || 'aaria').trim();
      setWakeName(w ? w.charAt(0).toUpperCase() + w.slice(1) : 'Aaria');
    } catch {
      setWakeName('Aaria');
    }

    const plugin = getAariaEdgePlugin();
    setEdgeAvailable(Boolean(plugin && typeof plugin.enrollWakeName === 'function'));
    setCheckedEngine(true);

    const initialConsent = getTeachConsent();
    setConsent(initialConsent);
    setSavedClipsCount(getTeachVoiceClips().length);
  }, []);

  function handleConsentToggle(checked) {
    setConsent(checked);
    setTeachConsent(checked);
    if (!checked) {
      setSavedClipsCount(0);
    }
  }

  async function handleStartEnrollment() {
    setStatus('recording');
    setCurrentSample(1);
    setLastHeard('');
    setErrorMessage('');
    setResultData(null);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const outcome = await enrollVoiceSession({
        samples: totalSamples,
        wakeName,
        consent,
        signal: controller.signal,
        onProgress: (prog) => {
          if (controller.signal.aborted) return;
          setCurrentSample(prog.sample);
          if (prog.heard) setLastHeard(prog.heard);
        },
      });

      if (controller.signal.aborted) {
        setStatus('cancelled');
        return;
      }

      if (outcome.ok) {
        setResultData(outcome.result || null);
        setStatus('done');
        if (consent) {
          setSavedClipsCount(getTeachVoiceClips().length);
        }
      } else if (outcome.reason === 'cancelled') {
        setStatus('cancelled');
      } else {
        setStatus('error');
        setErrorMessage(
          outcome.message === 'microphone_permission_required'
            ? 'Microphone permission is required to listen to your voice. Please enable it in Android app settings.'
            : outcome.message === 'consent_required'
              ? 'Please finish the hands-free setup first before teaching Aaria your voice.'
              : outcome.message === 'wake_name_required'
                ? 'Please select or enter your wake name first.'
                : outcome.message === 'mic_busy'
                  ? 'Microphone is currently busy with another app. Please try again.'
                  : `Could not finish teaching: ${outcome.message || 'unknown error'}`
        );
      }
    } catch (err) {
      if (controller.signal.aborted) {
        setStatus('cancelled');
        return;
      }
      setStatus('error');
      setErrorMessage(err?.message || 'An unexpected error occurred while teaching your voice.');
    } finally {
      abortControllerRef.current = null;
    }
  }

  function handleCancelEnrollment() {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setStatus('cancelled');
  }

  return (
    <div style={wrap}>
      {/* Decorative gradient blobs */}
      <div style={{ position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none', overflow: 'hidden' }}>
        <span style={blob('#a5b4fc', '-120px', 'auto', 'auto', '-80px')} />
        <span style={blob('#a7f3d0', 'auto', '-100px', '-100px', 'auto')} />
      </div>

      <div style={{ position: 'relative', zIndex: 1 }}>
        {/* Navigation */}
        <Link href="/settings/voice" style={{ color: P, textDecoration: 'none', fontWeight: 700, fontSize: 14 }}>
          ← Voice &amp; Language
        </Link>

        <h1 style={{ fontSize: 24, fontWeight: 900, letterSpacing: '-.6px', margin: '6px 0 2px' }}>
          Teach Aaria your voice
        </h1>
        <p style={{ color: '#64748b', fontSize: 14, margin: '0 0 18px', lineHeight: 1.5 }}>
          Help Aaria recognize your accent and pronunciation. Everything is processed directly on your phone — no audio is ever sent to any server.
        </p>

        {/* Web Build Graceful Fallback (Plugin Missing) */}
        {checkedEngine && !edgeAvailable && (
          <div style={{ ...card, borderLeft: '4px solid #6366f1' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <span style={{ fontSize: 24 }}>📱</span>
              <h3 style={{ ...h3, margin: 0 }}>Available on the phone app</h3>
            </div>
            <p style={{ color: '#475569', fontSize: 13.5, lineHeight: 1.5, margin: '0 0 14px' }}>
              Teaching Aaria your voice uses the on-device neural voice engine inside the QuietKeep Android app. It is available on your phone and works completely offline.
            </p>
            <Link
              href="/settings/voice"
              style={{ ...btn, display: 'inline-block', textDecoration: 'none', textAlign: 'center', fontSize: 13, padding: '9px 16px' }}
            >
              Back to Voice Settings
            </Link>
          </div>
        )}

        {/* Native Plugin Available */}
        {checkedEngine && edgeAvailable && (
          <>
            {/* Status & Progress Cards */}
            {status === 'idle' && (
              <div style={card}>
                <h3 style={h3}>🎯 How it works</h3>
                <p style={{ color: '#334155', fontSize: 13.5, lineHeight: 1.5, margin: '0 0 12px' }}>
                  You will say your wake name <b>&ldquo;{wakeName}&rdquo;</b> {totalSamples} times in your normal speaking tone.
                  Aaria will learn the distinct pitch and cadence of your voice.
                </p>

                <div style={{ display: 'flex', gap: 8, margin: '14px 0 18px' }}>
                  {[1, 2, 3, 4, 5].map((num) => (
                    <div
                      key={num}
                      style={{
                        flex: 1,
                        padding: '10px 0',
                        textAlign: 'center',
                        borderRadius: 10,
                        background: '#f1f5f9',
                        color: '#64748b',
                        fontSize: 13,
                        fontWeight: 700,
                      }}
                    >
                      {num}
                    </div>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={handleStartEnrollment}
                  style={{ ...btn, width: '100%', fontSize: 15, padding: '13px 18px' }}
                >
                  🎙️ Start teaching Aaria
                </button>
              </div>
            )}

            {/* Recording / Enrolling in progress */}
            {status === 'recording' && (
              <div style={{ ...card, textAlign: 'center', padding: '24px 18px' }}>
                <div
                  style={{
                    width: 72,
                    height: 72,
                    margin: '0 auto 16px',
                    borderRadius: '50%',
                    background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    boxShadow: '0 0 0 10px rgba(99, 102, 241, 0.15)',
                  }}
                >
                  <span style={{ fontSize: 32 }}>🎙️</span>
                </div>

                <div style={{ fontSize: 13, fontWeight: 700, color: P, textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 4 }}>
                  Listening on phone
                </div>

                <h2 style={{ fontSize: 22, fontWeight: 900, margin: '0 0 6px', color: '#0f172a' }}>
                  {formatProgressText(currentSample, totalSamples)}
                </h2>

                <p style={{ color: '#475569', fontSize: 14, margin: '0 0 18px' }}>
                  Say <b>&ldquo;{wakeName}&rdquo;</b> clearly now.
                </p>

                {/* Step indicator pills */}
                <div style={{ display: 'flex', gap: 8, maxWidth: 280, margin: '0 auto 18px' }}>
                  {[1, 2, 3, 4, 5].map((num) => {
                    const isDone = num < currentSample;
                    const isCurrent = num === currentSample;
                    return (
                      <div
                        key={num}
                        style={{
                          flex: 1,
                          height: 8,
                          borderRadius: 4,
                          background: isDone ? '#10b981' : isCurrent ? P : '#e2e8f0',
                          transition: 'all .25s ease',
                        }}
                      />
                    );
                  })}
                </div>

                {lastHeard && (
                  <div style={{ background: '#f8fafc', padding: '8px 14px', borderRadius: 10, display: 'inline-block', fontSize: 13, color: '#334155', marginBottom: 16 }}>
                    Heard: <b>&ldquo;{lastHeard}&rdquo;</b>
                  </div>
                )}

                <div>
                  <button
                    type="button"
                    onClick={handleCancelEnrollment}
                    style={{
                      padding: '8px 18px',
                      borderRadius: 10,
                      border: '1px solid #cbd5e1',
                      background: '#fff',
                      color: '#475569',
                      fontWeight: 600,
                      fontSize: 13,
                      cursor: 'pointer',
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Done state */}
            {status === 'done' && (
              <div style={{ ...card, textAlign: 'center', padding: '24px 18px' }}>
                <div
                  style={{
                    width: 64,
                    height: 64,
                    margin: '0 auto 14px',
                    borderRadius: '50%',
                    background: '#ecfdf5',
                    color: '#059669',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 32,
                  }}
                >
                  ✓
                </div>

                <h2 style={{ fontSize: 22, fontWeight: 900, margin: '0 0 6px', color: '#0f172a' }}>
                  Aaria learned your voice!
                </h2>

                <p style={{ color: '#475569', fontSize: 14, margin: '0 0 16px', lineHeight: 1.5 }}>
                  Completed {totalSamples} of {totalSamples} samples. Aaria is now tuned to recognize &ldquo;{wakeName}&rdquo; when you speak.
                </p>

                {resultData?.aliases && resultData.aliases.length > 0 && (
                  <div style={{ background: '#f8fafc', padding: '10px 14px', borderRadius: 10, fontSize: 13, color: '#475569', margin: '0 auto 16px', maxWidth: 360, textAlign: 'left' }}>
                    <b style={{ color: '#0f172a' }}>Learned variations:</b>
                    <div style={{ marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {resultData.aliases.map((alias, i) => (
                        <span key={i} style={{ background: '#e0e7ff', color: '#4338ca', padding: '2px 8px', borderRadius: 6, fontSize: 12, fontWeight: 600 }}>
                          {alias}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                <div style={{ margin: '14px 0 18px', fontSize: 13, color: consent ? '#166534' : '#64748b' }}>
                  {consent
                    ? `✓ Recordings are kept locally on this phone (${savedClipsCount || totalSamples} clips saved).`
                    : '🔒 Recordings were discarded immediately (consent switch was off).'}
                </div>

                <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
                  <button
                    type="button"
                    onClick={handleStartEnrollment}
                    style={{ ...btn, background: '#64748b', fontSize: 13.5, padding: '10px 16px' }}
                  >
                    Teach again
                  </button>
                  <Link
                    href="/settings/voice"
                    style={{ ...btn, textDecoration: 'none', fontSize: 13.5, padding: '10px 18px' }}
                  >
                    Done
                  </Link>
                </div>
              </div>
            )}

            {/* Error state */}
            {status === 'error' && (
              <div style={{ ...card, borderLeft: '4px solid #ef4444' }}>
                <h3 style={{ ...h3, color: '#b91c1c' }}>Could not complete voice enrollment</h3>
                <p style={{ color: '#334155', fontSize: 13.5, lineHeight: 1.5, margin: '0 0 16px' }}>
                  {errorMessage || 'Something went wrong while recording. Please try again.'}
                </p>
                <div style={{ display: 'flex', gap: 10 }}>
                  <button
                    type="button"
                    onClick={handleStartEnrollment}
                    style={{ ...btn, fontSize: 13.5 }}
                  >
                    Try again
                  </button>
                  <Link
                    href="/settings/voice"
                    style={{
                      ...btn,
                      background: '#fff',
                      color: '#475569',
                      border: '1px solid #cbd5e1',
                      textDecoration: 'none',
                      fontSize: 13.5,
                    }}
                  >
                    Cancel
                  </Link>
                </div>
              </div>
            )}

            {/* Cancelled state */}
            {status === 'cancelled' && (
              <div style={card}>
                <h3 style={h3}>Enrollment cancelled</h3>
                <p style={{ color: '#64748b', fontSize: 13.5, margin: '0 0 16px' }}>
                  You stopped the voice teaching process. No changes were saved.
                </p>
                <button
                  type="button"
                  onClick={handleStartEnrollment}
                  style={{ ...btn, fontSize: 13.5 }}
                >
                  Start over
                </button>
              </div>
            )}

            {/* Separate Consent Switch (Requirement 3: OFF by default) */}
            <div style={{ ...card, marginTop: 14 }}>
              <h3 style={h3}>🔒 Privacy &amp; Phone Storage</h3>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14 }}>
                <div style={{ minWidth: 0 }}>
                  <b style={{ fontSize: 14, color: '#1e293b' }}>
                    {CONSENT_SWITCH_LABEL}
                  </b>
                  <small style={{ display: 'block', color: '#64748b', fontSize: 12, lineHeight: 1.5, marginTop: 4 }}>
                    When enabled, audio clips of your spoken wake name are stored securely on this phone to help improve on-device recognition.
                    When disabled, recordings are deleted as soon as enrollment finishes.
                    Nothing is ever uploaded — no network calls are ever made.
                  </small>
                </div>

                <button
                  type="button"
                  role="switch"
                  aria-label={CONSENT_SWITCH_LABEL}
                  aria-checked={consent}
                  onClick={() => handleConsentToggle(!consent)}
                  style={{
                    ...toggle,
                    background: consent ? P : '#cbd5e1',
                    flexShrink: 0,
                    marginTop: 2,
                  }}
                >
                  <span
                    style={{
                      ...knob,
                      transform: consent ? 'translateX(20px)' : 'translateX(0)',
                    }}
                  />
                </button>
              </div>

              {consent && (
                <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid rgba(0,0,0,0.06)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 12, color: '#166534', fontWeight: 600 }}>
                    ✓ Storing clips locally on this device ({savedClipsCount} saved)
                  </span>
                  {savedClipsCount > 0 && (
                    <button
                      type="button"
                      onClick={() => handleConsentToggle(false)}
                      style={{ background: 'none', border: 'none', color: '#ef4444', fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: 0 }}
                    >
                      Delete stored clips
                    </button>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const wrap = {
  minHeight: '100dvh',
  maxWidth: 560,
  margin: '0 auto',
  padding: 16,
  paddingBottom: 120,
  fontFamily: "'Inter',-apple-system,sans-serif",
  position: 'relative',
  background: 'radial-gradient(900px 500px at 90% -10%,#eef1ff 0,transparent 55%),linear-gradient(180deg,#f7f8ff,#f1f3fb)',
};

function blob(c, top, bottom, b2, right) {
  return {
    position: 'absolute',
    width: 340,
    height: 340,
    borderRadius: '50%',
    filter: 'blur(60px)',
    opacity: 0.45,
    background: `radial-gradient(circle,${c},transparent 65%)`,
    top,
    bottom,
    right,
  };
}

const card = {
  background: 'rgba(255,255,255,.85)',
  backdropFilter: 'blur(8px)',
  border: '1px solid #fff',
  borderRadius: 18,
  padding: 16,
  marginBottom: 14,
  boxShadow: '0 10px 26px rgba(80,90,160,.1)',
};

const h3 = { fontSize: 15, fontWeight: 800, margin: '0 0 10px' };
const btn = {
  padding: '11px 16px',
  border: 0,
  borderRadius: 11,
  background: P,
  color: '#fff',
  fontWeight: 700,
  fontSize: 14,
  cursor: 'pointer',
};
const toggle = {
  width: 44,
  height: 24,
  borderRadius: 999,
  border: 0,
  position: 'relative',
  cursor: 'pointer',
  flex: 'none',
};
const knob = {
  position: 'absolute',
  top: 2,
  left: 2,
  width: 20,
  height: 20,
  borderRadius: '50%',
  background: '#fff',
  transition: 'transform .2s',
  boxShadow: '0 1px 3px rgba(0,0,0,.3)',
};
