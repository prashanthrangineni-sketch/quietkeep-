// src/lib/voice-loop-engine.js
// Phase 12 — Voice Loop Engine (Client-side)
//
// Manages the continuous voice listening loop in the browser.
// Uses Web Speech API (no vendor lock-in) with a VAD (voice activity detection)
// fallback via silence detection. Designed to be vendor-swappable:
// drop in OpenAI Realtime API or any streaming LLM by replacing the
// transcribeChunk() and streamResponse() hooks.
//
// STATE MACHINE:
//   idle → listening → processing → responding → listening (loop)
//                                 → idle (on stop command)
//
// Exports (client-side only — not for server-side use):
//   createVoiceLoop(options) → VoiceLoopController
//
// VoiceLoopController:
//   start(sessionId, token)
//   stop()
//   pause()
//   resume()
//   onTranscript(fn)   — called with partial + final transcripts
//   onResponse(fn)     — called with TTS text to speak
//   onStateChange(fn)  — called on state transitions

export const LOOP_STATES = {
  IDLE:        'idle',
  LISTENING:   'listening',
  PROCESSING:  'processing',
  RESPONDING:  'responding',
  PAUSED:      'paused',
  ERROR:       'error',
};

const MAX_LISTEN_MS = 15000; // force-process after 15s

// ── ENDPOINTING (W5) ────────────────────────────────────────────────────────
// The thresholds moved to src/lib/endpointing.js. They lived here, and this
// module is imported by nothing - so the dial was correct code that changed
// nothing for any user. It now lives where the live capture path
// (src/lib/context/aaria.jsx) can import it, and is re-exported here so there
// is one source of truth rather than two copies drifting apart.
export { ENDPOINT_SILENCE_MS, endpointSilenceMsFor } from './endpointing.js';
import { endpointSilenceMsFor } from './endpointing.js';

/**
 * Creates a voice loop controller.
 *
 * @param {{
 *   onTranscript?:  (text: string, isFinal: boolean) => void,
 *   onResponse?:    (text: string) => void,
 *   onStateChange?: (state: string) => void,
 *   onError?:       (err: Error) => void,
 *   lang?:          string,    — default 'en-IN'
 *   continuous?:    boolean,   — default true
 * }} options
 */
export function createVoiceLoop(options = {}) {
  const {
    onTranscript  = () => {},
    onResponse    = () => {},
    onStateChange = () => {},
    onError       = () => {},
    lang          = 'en-IN',
    continuous    = true,
    silenceMs     = null,   // W5: explicit override, for sweeping during tuning
  } = options;

  // W5: the endpointing dial for this loop instance. Language-aware by default
  // (Indic pauses are longer than English), overridable per call so the
  // measurement harness can sweep values against real recordings.
  const silenceThresholdMs = Number.isFinite(silenceMs)
    ? silenceMs
    : endpointSilenceMsFor(lang);

  let recognition   = null;
  let state         = LOOP_STATES.IDLE;
  let sessionId     = null;
  let accessToken   = null;
  let silenceTimer  = null;
  let maxTimer      = null;
  let currentText   = '';
  let stopped       = false;

  function setState(newState) {
    state = newState;
    onStateChange(newState);
  }

  function clearTimers() {
    if (silenceTimer) { clearTimeout(silenceTimer); silenceTimer = null; }
    if (maxTimer)     { clearTimeout(maxTimer);     maxTimer     = null; }
  }

  async function processTranscript(text) {
    if (!text.trim() || state === LOOP_STATES.IDLE) return;
    setState(LOOP_STATES.PROCESSING);
    try {
      // FIX: Route through protocol/decide first so the full agent signal-merge
      // and governor layer runs before the keep is saved. This aligns continuous
      // voice mode with the single-shot capture path.
      // protocol/decide is non-blocking here — if it fails we still proceed to
      // voice/capture so the keep is never lost.
      let decisionContext = null;
      try {
        const decideRes = await fetch('/api/protocol/decide', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            context: {
              text,
              source: 'voice_loop',
              session_id: sessionId,
              language: lang,
            },
          }),
        });
        if (decideRes.ok) {
          decisionContext = await decideRes.json();
        }
      } catch { /* non-blocking — continue to capture regardless */ }

      const res = await fetch('/api/voice/capture', {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          transcript:       text,
          source:           'voice_loop',
          session_id:       sessionId,
          language:         lang,
          // Pass decision context so voice/capture can skip re-running agents
          decision_id:      decisionContext?.decision_id || null,
          protocol_version: decisionContext?.protocol_version || null,
        }),
      });
      const data = await res.json();
      if (data.tts_response) {
        setState(LOOP_STATES.RESPONDING);
        onResponse(data.tts_response);
        // Speak the response (browser TTS)
        if (typeof window !== 'undefined' && window.speechSynthesis && continuous) {
          const utt = new SpeechSynthesisUtterance(data.tts_response);
          utt.lang  = lang;
          utt.onend = () => {
            if (!stopped) restartListening();
          };
          window.speechSynthesis.speak(utt);
        } else {
          if (!stopped) restartListening();
        }
      } else {
        if (!stopped) restartListening();
      }
    } catch(e) {
      onError(e);
      if (!stopped) restartListening();
    }
  }

  function restartListening() {
    if (stopped || !recognition) return;
    currentText = '';
    setState(LOOP_STATES.LISTENING);
    try { recognition.start(); } catch { /* already started */ }
  }

  function startRecognition() {
    if (typeof window === 'undefined') return;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { onError(new Error('Speech recognition not supported')); return; }

    recognition = new SR();
    recognition.lang        = lang;
    recognition.continuous  = true;
    recognition.interimResults = true;

    recognition.onresult = (event) => {
      clearTimers();
      let interim = '';
      let final   = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) final   += event.results[i][0].transcript;
        else                           interim += event.results[i][0].transcript;
      }
      if (final) {
        currentText += ' ' + final;
        onTranscript(currentText.trim(), false);
      } else {
        onTranscript((currentText + ' ' + interim).trim(), false);
      }
      // Reset silence timer after each speech fragment
      silenceTimer = setTimeout(() => {
        if (currentText.trim()) {
          recognition.stop();
          processTranscript(currentText.trim());
        }
      }, silenceThresholdMs);
    };

    recognition.onend = () => {
      if (state === LOOP_STATES.LISTENING && !stopped) {
        // Restart if we're still supposed to be listening
        setTimeout(() => { if (!stopped) restartListening(); }, 200);
      }
    };

    recognition.onerror = (event) => {
      if (event.error !== 'no-speech') {
        onError(new Error(`Speech recognition: ${event.error}`));
      }
    };

    // Max listen timer — force-process after MAX_LISTEN_MS
    maxTimer = setTimeout(() => {
      if (currentText.trim()) {
        recognition.stop();
        processTranscript(currentText.trim());
      }
    }, MAX_LISTEN_MS);

    setState(LOOP_STATES.LISTENING);
    recognition.start();
  }

  return {
    start(sid, token) {
      sessionId   = sid;
      accessToken = token;
      stopped     = false;
      currentText = '';
      startRecognition();
    },
    stop() {
      stopped = true;
      clearTimers();
      if (recognition) { try { recognition.stop(); } catch {} recognition = null; }
      if (typeof window !== 'undefined') window.speechSynthesis?.cancel();
      setState(LOOP_STATES.IDLE);
    },
    pause() {
      if (recognition) { try { recognition.stop(); } catch {} }
      clearTimers();
      setState(LOOP_STATES.PAUSED);
    },
    resume() {
      if (state === LOOP_STATES.PAUSED) restartListening();
    },
    getState() { return state; },
  };
}
