// src/lib/fillers.js
//
// THE SOUND A PERSON MAKES WHILE THEY ARE STILL THINKING. (Plan item 10,
// step 15.) Ported from the engine's src/fillers.py, whose four rules hold here
// unchanged. Agreed 3 Oct (Master Plan v10.9, A18): QuietKeep plays these
// itself, because this dock is the one place that already decides when Aaria
// speaks and keeps the microphone from hearing her.
//
// Why: after a spoken command the dock goes quiet while the brain works. A
// person asked to do something does not go silent; they say "okay" and then
// do it.
//
// THE FOUR RULES
// 1. Fast turns get nothing. Only after SILENCE_TOLERANCE_MS of silence.
// 2. Never the same phrase twice in a row.
// 3. A language with no phrases gets silence - never an English stand-in.
// 4. It never delays the real answer. Clips are made ONCE per language ahead
//    of time and played from memory; a clip that is not ready yet means
//    silence, never a wait. The moment the reply arrives the filler stops.
//
// The phrases are a first draft. Telugu needs the founder's ear; Tamil,
// Kannada and Malayalam need a native speaker. The Hindi ones are in the
// feminine (Aaria is "she" - the capture route already says "समझ नहीं पाई"),
// which corrects the engine's draft (it had "देख रहा हूँ").

export const SILENCE_TOLERANCE_MS = 700;

// Before the reply arrives the dock does not know what kind of request this
// was, so only the generic phrases are used here.
export const GENERIC_PHRASES = {
  te: ['సరే', 'ఒక్క నిమిషం'],
  hi: ['ठीक है', 'एक मिनट'],
  ta: ['சரி', 'ஒரு நிமிடம்'],
  kn: ['ಸರಿ', 'ಒಂದು ನಿಮಿಷ'],
  ml: ['ശരി', 'ഒരു നിമിഷം'],
  en: ['okay', 'one moment'],
};

const CODE_MIXED = { 'te-en': 'te', 'en-te': 'te', 'hi-en': 'hi', 'en-hi': 'hi', 'ta-en': 'ta', 'kn-en': 'kn', 'ml-en': 'ml' };

/** The language a filler is spoken in, or null when we have none for it. */
export function baseLanguage(lang) {
  if (!lang) return null;
  const tag = String(lang).trim().toLowerCase();
  if (CODE_MIXED[tag]) return CODE_MIXED[tag];
  if (GENERIC_PHRASES[tag]) return tag;
  const head = tag.split('-')[0];
  return GENERIC_PHRASES[head] ? head : null;
}

/** The phrase to say, or null for silence (rules 2 and 3). */
export function choosePhrase(lang, lastSpoken = null) {
  const base = baseLanguage(lang);
  if (!base) return null;
  const fresh = GENERIC_PHRASES[base].filter((p) => p !== lastSpoken);
  return fresh.length ? fresh[0] : null;
}

/**
 * One player for the dock's lifetime.
 *
 * deps:
 *   synth(text, lang) -> Promise<clip>   make a clip (called only from warm())
 *   play(clip)        -> { stop() }      start playing; must not block
 *   now(), setTimer(fn, ms), clearTimer(id)
 */
export function createFillerPlayer(deps) {
  const now = deps.now || (() => Date.now());
  const setTimer = deps.setTimer || ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer || ((id) => clearTimeout(id));
  const clips = new Map();      // `${lang}|${phrase}` -> clip
  const warming = new Set();    // languages being prepared
  let lastSpoken = null;

  async function warm(lang) {
    const base = baseLanguage(lang);
    if (!base || warming.has(base)) return;
    warming.add(base);
    for (const phrase of GENERIC_PHRASES[base]) {
      const key = `${base}|${phrase}`;
      if (clips.has(key)) continue;
      try {
        const clip = await deps.synth(phrase, base);
        if (clip) clips.set(key, clip);
      } catch { /* no clip: that phrase stays silent (rule 4) */ }
    }
    // A language left without all its clips (offline, signed out) may be
    // tried again on a later turn.
    if (GENERIC_PHRASES[base].some((p) => !clips.has(`${base}|${p}`))) warming.delete(base);
  }

  /** Start waiting for a reply. Returns end(), called when it arrives. */
  function begin(lang) {
    const t0 = now();
    let timer = null;
    let playing = null;
    let startedMs = null;
    let phraseUsed = null;
    let ended = false;
    const base = baseLanguage(lang);

    if (base) {
      timer = setTimer(() => {
        timer = null;
        if (ended) return;
        const phrase = choosePhrase(base, lastSpoken);
        const clip = phrase && clips.get(`${base}|${phrase}`);
        if (!clip) return;                      // not ready: silence, never a wait
        try {
          playing = deps.play(clip);
          startedMs = now() - t0;
          phraseUsed = phrase;
          lastSpoken = phrase;
        } catch { playing = null; }
      }, SILENCE_TOLERANCE_MS);
    }

    return function end() {
      if (ended) return null;
      ended = true;
      if (timer !== null) { clearTimer(timer); timer = null; }
      if (playing) { try { playing.stop(); } catch {} playing = null; }
      return { reply_ms: now() - t0, filler_ms: startedMs, filler_phrase: phraseUsed, filler_lang: base };
    };
  }

  return { warm, begin, _clips: clips };
}

/**
 * The previous turn's timing as the dock reports it, trimmed to known fields
 * (the server stores it in audit_log as voice_turn_timing). Null when absent
 * or unusable. This is how "timing measured" is read from real phones.
 */
export function cleanTurnTiming(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const ms = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 120000 ? Math.round(v) : null);
  const reply = ms(raw.reply_ms);
  if (reply === null) return null;
  const str = (v, n) => (typeof v === 'string' && v.length <= n ? v : null);
  return {
    reply_ms: reply,
    filler_ms: ms(raw.filler_ms),
    filler_phrase: str(raw.filler_phrase, 40),
    filler_lang: str(raw.filler_lang, 5),
  };
}
