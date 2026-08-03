// src/lib/tts.js  v3
// Voice realism: interrupt handling, contextual responses, latency reduction.
//   Option A: Browser SpeechSynthesis (free, immediate, weak on Indic)
//   Option B: ElevenLabs direct (own/preset cloned voice, requires key + consent)
//   Option C: Pranix Aaria (shared voice engine — natural Indic reply voice)  <- v3 (new)
//
// Aaria is the shared voice engine across ALL Pranix projects. Its /api/health
// reports sarvam:bulbul:v3 (Indic TTS) and elevenlabs as healthy providers, so
// QuietKeep asks Aaria to speak and never talks to a TTS vendor directly.
// Indic replies (te/hi/ta/kn/ml/mr/gu/bn/pa/od) now speak in a real Indian voice
// instead of the broken OS voice. Deterministic output — no emotion, no suggestions.

const ELEVENLABS_BASE = 'https://api.elevenlabs.io/v1';
const DEFAULT_VOICES = {
  neutral_female: '21m00Tcm4TlvDq8ikWAM', // Rachel
  neutral_male:   'pNInz6obpgDQGcFmaJgB',  // Adam
};

// A language is "Indic" for reply purposes when it isn't English.
export function isIndicLang(lang) {
  if (!lang) return false;
  return !/^en/i.test(String(lang).trim());
}

// ── Interrupt handling ──────────────────────────────────────────────────────
// Stop any ongoing TTS immediately (called when user starts speaking)
export function interruptTTS() {
  if (typeof window === 'undefined') return;
  if (window.speechSynthesis && window.speechSynthesis.speaking) {
    window.speechSynthesis.cancel();
  }
  // Also stop any ElevenLabs / Aaria audio
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

// ── ElevenLabs TTS (direct — used only for the user's own/preset cloned voice) ──
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

// ── Aaria TTS (shared voice engine; Sarvam Bulbul v3 for Indic lives behind it) ──
// Calls our server route /api/voice/tts, which proxies Aaria. No vendor key here.
// Throws on any failure so speak() falls through to the next option.
function base64ToArrayBuffer(b64) {
  const bin = atob(b64);
  const len = bin.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

export async function speakAaria(text, { lang = 'hi-IN', authToken = null, qualityTier = 'standard' } = {}) {
  if (!authToken) throw new Error('Aaria requires an auth token');
  const res = await fetch('/api/voice/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
    body: JSON.stringify({ text, lang, quality_tier: qualityTier }),
  });
  if (!res.ok) throw new Error(`Aaria route ${res.status}`);
  const json = await res.json();

  // Expose the visual companion (expression + caption timing) for the Aaria orb.
  if (typeof window !== 'undefined' && json?.visual_companion) {
    window.__qkVisualCompanion = json.visual_companion;
  }

  if (json?.audio) { await playAudioBuffer(base64ToArrayBuffer(json.audio)); return; }
  if (json?.audio_url) { await playAudioUrl(json.audio_url); return; }
  throw new Error(`Aaria unavailable: ${json?.reason || 'no_audio'}`);
}

// ── Playback with interrupt support ─────────────────────────────────────────
export function playAudioBuffer(buffer) {
  const blob = new Blob([buffer], { type: 'audio/mpeg' });
  return playAudioUrl(URL.createObjectURL(blob), true);
}

export function playAudioUrl(url, revoke = false) {
  return new Promise((resolve, reject) => {
    interruptTTS();
    const audio = new Audio(url);
    window.__qkActiveAudio = audio;
    const cleanup = () => { if (revoke) URL.revokeObjectURL(url); window.__qkActiveAudio = null; };
    audio.onended = () => { cleanup(); resolve(); };
    audio.onerror = () => { cleanup(); reject(new Error('Playback failed')); };
    audio.play().catch(reject);
  });
}

// ── Primary TTS entry point ──────────────────────────────────────────────────
// Priority:
//   1. Explicit ElevenLabs own/preset voice — the user's own recorded voice wins.
//   2. Aaria (Indic replies → Sarvam Bulbul v3 behind Aaria).
//   3. Any ElevenLabs key (legacy English preset default).
//   4. Browser SpeechSynthesis (last resort).
// Every step falls through on failure — the user always hears *something*.
export async function speak(
  text,
  { elevenlabsKey = null, voiceId = null, lang = 'en-IN', provider = null, authToken = null, qualityTier = 'standard' } = {}
) {
  interruptTTS(); // Always interrupt before speaking

  // 1. User explicitly chose their own / a preset ElevenLabs voice
  if (elevenlabsKey && (provider === 'own' || provider === 'preset')) {
    try {
      const buf = await speakElevenLabs(text, elevenlabsKey, voiceId || DEFAULT_VOICES.neutral_female);
      await playAudioBuffer(buf);
      return;
    } catch { /* fall through */ }
  }

  // 2. Aaria — required for Indic, also fine for English when no key is present
  if (authToken && (isIndicLang(lang) || !elevenlabsKey)) {
    try {
      await speakAaria(text, { lang, authToken, qualityTier });
      return;
    } catch { /* fall through */ }
  }

  // 3. Legacy: any ElevenLabs key (English preset)
  if (elevenlabsKey) {
    try {
      const buf = await speakElevenLabs(text, elevenlabsKey, voiceId || DEFAULT_VOICES.neutral_female);
      await playAudioBuffer(buf);
      return;
    } catch { /* fall through */ }
  }

  // 4. Native Android TTS bridge
  if (typeof window !== 'undefined' && typeof window.__QK_TTS__ === 'function') {
    try {
      if (typeof window.__QK_SET_LANG__ === 'function') {
        window.__QK_SET_LANG__(lang);
      }
      window.__QK_TTS__(text);
      return;
    } catch { /* fall through */ }
  }

  // 5. Browser last resort
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
