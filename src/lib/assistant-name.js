// src/lib/assistant-name.js
//
// The assistant's name, in one place. It is Aaria.
//
// WHY THIS EXISTS
// QuietKeep's first voice prototype called the assistant "Lotus". The engine,
// the brand and every new screen say Aaria, but the old default survived in
// VoiceTalkback.jsx ('lotus') - so Settings showed "Current wake word: Lotus",
// spoken help told people to "Say Lotus help", and because both wake-word
// modules share one stored value (localStorage 'qk_wake_word'), a phone that
// had ever saved the old default kept saying Lotus everywhere.
//
// WHAT THIS DOES
//   * one default, 'aaria', imported by both wake-word modules
//   * a stored 'lotus' is the retired default, not a choice anyone made on
//     purpose (it was the only value offered), so it is rewritten to 'aaria'
//     the first time it is read
//   * a wake word the person typed themselves is left exactly as they set it
//   * while the default is in use, "lotus" is still ACCEPTED when spoken, so
//     anyone with the old habit is not suddenly ignored - it is just never
//     shown or suggested again

export const ASSISTANT_NAME = 'Aaria'
export const DEFAULT_WAKE_WORD = 'aaria'
export const RETIRED_WAKE_WORDS = ['lotus']
export const WAKE_WORD_KEY = 'qk_wake_word'

function storage(given) {
  if (given) return given
  try { return typeof localStorage !== 'undefined' ? localStorage : null } catch { return null }
}

/** The wake word in use, lower-case. Rewrites the retired default once. */
export function readWakeWord(store) {
  const s = storage(store)
  let raw = null
  try { raw = s ? s.getItem(WAKE_WORD_KEY) : null } catch { raw = null }
  const word = String(raw || '').toLowerCase().trim()
  if (!word) return DEFAULT_WAKE_WORD
  if (RETIRED_WAKE_WORDS.includes(word)) {
    try { s && s.setItem(WAKE_WORD_KEY, DEFAULT_WAKE_WORD) } catch { /* private mode */ }
    return DEFAULT_WAKE_WORD
  }
  return word
}

/** Every spoken form that should count as the wake word right now. */
export function acceptedWakeWords(word = DEFAULT_WAKE_WORD) {
  const w = String(word || DEFAULT_WAKE_WORD).toLowerCase().trim()
  return w === DEFAULT_WAKE_WORD ? [w, ...RETIRED_WAKE_WORDS] : [w]
}

/** "Aaria" for display; a custom word capitalised as typed. */
export function displayWakeWord(word = DEFAULT_WAKE_WORD) {
  const w = String(word || DEFAULT_WAKE_WORD).trim()
  return w.charAt(0).toUpperCase() + w.slice(1)
}
