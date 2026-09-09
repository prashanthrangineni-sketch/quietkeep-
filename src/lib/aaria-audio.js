// src/lib/aaria-audio.js
// Reading Aaria's speak response, and deciding when to use her voice at all.
//
// WHY THIS FILE EXISTS
// QuietKeep has never once spoken in Aaria's voice, and it took three
// independent breaks stacked on top of each other:
//
//   1. src/lib/tts.js - a complete Aaria-first speech cascade - is imported by
//      nothing. Dead since it was written.
//   2. The /api/voice/tts proxy did not recognise the field Aaria actually
//      returns. Aaria's speak contract returns `audio_ref`; the proxy looked
//      for audio_base64, audioBase64, audio_content, audio, audios[0],
//      audio_url, audioUrl and url - every plausible name except the real one.
//      So it always answered "aaria_no_audio" and the client fell back to the
//      phone's built-in voice.
//   3. Nothing on the client called the proxy anyway.
//
// The result users actually got: they speak, Aaria transcribes it correctly,
// the app asks Aaria to say the reply, Aaria synthesises real Indic speech
// with Sarvam Bulbul v3 - and the app throws that audio away and reads the
// words out in the operating system's voice instead. We were paying for
// Indian speech and playing the broken OS voice over it.
//
// Extracting this into its own module is what makes it testable: a Next.js
// route imports next/server and cannot run under plain node, so the parsing
// lived somewhere no test could reach it. That is how it stayed wrong.

/**
 * Pull playable audio out of whatever shape Aaria's speak contract returns.
 *
 * Aaria today returns:
 *   { audio_ref: "data:audio/wav;base64,...", engine_used, cache_hit, language }
 *
 * Other shapes are kept because the provider behind Aaria can change and a
 * parser that accepts only today's shape is how this broke the first time.
 *
 * @returns {{audio: string|null, audio_url: string|null}}
 *   `audio` is bare base64; `audio_url` is anything an <audio> element can
 *   load directly, which includes a data: URI.
 */
export function extractAudio(d) {
  if (!d || typeof d !== 'object') return { audio: null, audio_url: null };

  // The field Aaria actually returns. A data: URI is playable as-is, so it
  // belongs in audio_url - handing it to atob() as if it were bare base64
  // throws, which would look like "Aaria is broken" rather than "we read the
  // wrong field".
  const ref = typeof d.audio_ref === 'string' ? d.audio_ref.trim() : '';
  if (ref) {
    if (ref.startsWith('data:') || ref.startsWith('http://') || ref.startsWith('https://')) {
      return { audio: null, audio_url: ref };
    }
    return { audio: ref, audio_url: null };
  }

  const raw =
    d.audio_base64 ||
    d.audioBase64 ||
    d.audio_content ||
    (typeof d.audio === 'string' ? d.audio : null) ||
    (Array.isArray(d.audios) ? d.audios[0] : null) ||
    null;

  // Any of the above may also arrive as a data: URI.
  if (typeof raw === 'string' && raw.trim().startsWith('data:')) {
    return { audio: null, audio_url: raw.trim() };
  }

  const audio_url = d.audio_url || d.audioUrl || d.url || null;
  return { audio: raw, audio_url };
}

// ── When to use Aaria's voice ───────────────────────────────────────────────
//
// Indic first, and English left alone for now. Two reasons, both deliberate:
//
//   * Indic is where the phone's voice is genuinely broken. On the Eka Care
//     benchmark NVIDIA presented, the gap between a real Indic voice and a
//     generic one is not cosmetic. Sarvam Bulbul v3 behind Aaria is the fix.
//   * English already works acceptably through the OS voice, and it is
//     instant, offline and free. Routing it through a network round trip to a
//     free-tier host that sleeps would make the most common case slower and
//     less reliable to fix a problem it does not have.
//
// Set localStorage qk_voice_aaria to "all" to include English, or "off" to
// disable Aaria's voice entirely. Default is Indic only.

export function isIndicLang(lang) {
  if (!lang) return false;
  return !/^en/i.test(String(lang).trim());
}

/**
 * @param {string} lang       BCP-47 tag, e.g. 'te-IN'
 * @param {boolean} hasToken  whether we have a signed-in user's token
 * @param {string} [mode]     'indic' (default) | 'all' | 'off'
 */
export function shouldUseAaria(lang, hasToken, mode = 'indic') {
  if (!hasToken) return false;          // the proxy requires a signed-in user
  if (mode === 'off') return false;
  if (mode === 'all') return true;
  return isIndicLang(lang);
}
