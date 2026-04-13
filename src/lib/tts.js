// src/lib/tts.js  v2
// Voice realism upgrade: interrupt handling, contextual responses, latency reduction
// Option A: Browser SpeechSynthesis (free, immediate)
// Option B: ElevenLabs (pro, requires key)
// Deterministic output format — no emotion, no suggestions, no conversation.

const ELEVENLABS_BASE = 'https://api.elevenlabs.io/v1';
const DEFAULT_VOICES = {
  neutral_female: '21m00Tcm4TlvDq8ikWAM', // Rachel
  neutral_male:   'pNInz6obpgDQGcFmaJgB',  // Adam
};

// ── Interrupt handling ──────────────────────────────────────────────────────
// Stop any ongoing TTS immediately (called when user starts speaking)
export function interruptTTS() {
  if (typeof window === 'undefined') return;
  if (window.speechSynthesis && window.speechSynthesis.speaking) {
    window.speechSynthesis.cancel();
  }
  // Also stop any ElevenLabs audio
  if (window.__qkActiveAudio) {
    try { window.__qkActiveAudio.pause(); window.__qkActiveAudio.src = ''; } catch {}
    window.__qkActiveAudio = null;
  }
}

// ── Browser TTS ─────────────────────────────────────────────────────────────
export function speakBrowser(text, { lang = 'en-IN', rate = 1, pitch = 1 } = {}) {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.speechSynthesis) {
      reject(new Error('SpeechSynthesis not available'));
      return;
    }
    window.speechSynthesis.cancel(); // always interrupt previous
    const utt   = new SpeechSynthesisUtterance(text);
    utt.lang    = lang;
    utt.rate    = rate;
    utt.pitch   = pitch;
    utt.onend   = () => resolve();
    utt.onerror = (e) => reject(new Error('TTS error: ' + e.error));
    window.speechSynthesis.speak(utt);
  });
}

// ── ElevenLabs TTS ──────────────────────────────────────────────────────────
export async function speakElevenLabs(text, apiKey, voiceId = DEFAULT_VOICES.neutral_female) {
  if (!apiKey) throw new Error('ElevenLabs API key required');
  const res = await fetch(`${ELEVENLABS_BASE}/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'xi-api-key': apiKey },
    body: JSON.stringify({
      text,
      model_id: 'eleven_multilingual_v2',
      voice_settings: { stability: 0.75, similarity_boost: 0.75, style: 0, use_speaker_boost: false },
    }),
  });
  if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${await res.text()}`);
  return res.arrayBuffer();
}

// ── Audio buffer playback with interrupt support ─────────────────────────────
export function playAudioBuffer(buffer) {
  return new Promise((resolve, reject) => {
    interruptTTS();
    const blob  = new Blob([buffer], { type: 'audio/mpeg' });
    const url   = URL.createObjectURL(blob);
    const audio = new Audio(url);
    window.__qkActiveAudio = audio;
    audio.onended = () => { URL.revokeObjectURL(url); window.__qkActiveAudio = null; resolve(); };
    audio.onerror = () => { URL.revokeObjectURL(url); window.__qkActiveAudio = null; reject(new Error('Playback failed')); };
    audio.play().catch(reject);
  });
}

// ── Primary TTS entry point ──────────────────────────────────────────────────
// Interrupts any current speech before starting new utterance (Part 6: interrupt handling)
export async function speak(text, { elevenlabsKey = null, voiceId = null, lang = 'en-IN' } = {}) {
  interruptTTS(); // Always interrupt before speaking
  if (elevenlabsKey) {
    try {
      const buf = await speakElevenLabs(text, elevenlabsKey, voiceId || DEFAULT_VOICES.neutral_female);
      await playAudioBuffer(buf);
      return;
    } catch {
      // Fall through to browser TTS
    }
  }
  await speakBrowser(text, { lang });
}

// ── Deterministic TTS response formats ──────────────────────────────────────

// Standard response (used by voice/capture API)
export function buildTTSResponse(keep) {
  const content   = (keep.content    || '').slice(0, 80);
  const status    = (keep.status     || 'open').toUpperCase();
  const loopState = (keep.loop_state || 'open');
  return `Intent recorded: ${content}. Status: ${status}. State: ${loopState}. Next step unresolved.`;
}

// Contextual response: includes last intent + context match info
// Called from DashboardClient with the new keep + previous keep context
export function buildContextualTTSResponse(newKeep, prevKeep = null) {
  const content  = (newKeep.content    || '').slice(0, 80);
  const type     = (newKeep.intent_type || 'note');
  const stateMap = {
    START_OF_DAY:   'morning context matched',
    WORKING_HOURS:  'work context matched',
    EVENING:        'evening context matched',
    AT_HOME:        'home context matched',
    AT_WORK:        'work context matched',
    IN_TRANSIT:     'transit context matched',
    OFF_HOURS:      'off-hours context noted',
  };

  // Detect user state from local time
  const now = new Date();
  const istHour = (now.getUTCHours() + 5.5 + now.getUTCMinutes() / 60) % 24;
  const userState = istHour >= 6 && istHour < 9   ? 'START_OF_DAY'
    : istHour >= 9  && istHour < 18 ? 'WORKING_HOURS'
    : istHour >= 18 && istHour < 21 ? 'EVENING'
    : 'OFF_HOURS';

  const contextNote = stateMap[userState] || '';
  const pendingNote = prevKeep
    ? `Previous pending: ${(prevKeep.content || '').slice(0, 40)}.`
    : '';

  // Format: "Intent recorded. Pending action: <type>. Context matched: <state>. Next step unresolved."
  return `Intent recorded: ${content}. Pending action: ${type}. Context: ${contextNote}. ${pendingNote} Next step unresolved.`;
}
