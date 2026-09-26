// src/lib/transcript-clean.js
// ─────────────────────────────────────────────────────────────────────────────
// THE RECOGNISER STUTTERS. THIS UNSTUTTERS IT.
//
// Two captures on 26 September 2026, saved exactly like this:
//
//   "remind remind me remind me to remind me to remind me to call remind me"
//   "ఐదు ఐదు ఐదు ఐదు ఐదు నిమిషాల్లో ఐదు నిమిషాల్లో ఐదు నిమిషాల్లో …"
//
// Both are a growing partial result being APPENDED to itself instead of
// replacing the previous one. The speaker said "remind me to call Venu in five
// minutes" once.
//
// THIS IS NOT THE FIX FOR THAT.
//
// The fault is in whatever hands transcripts to /api/voice/capture — the native
// Android voice service or the recogniser wrapper — and it has to be fixed
// there. This module exists because the damage has consequences that cannot
// wait: the time parser could not find "five minutes" inside "ఐదు ఐదు ఐదు ఐదు
// ఐదు నిమిషాల్లో", so no reminder was created, while Aaria said out loud that
// she had set one. A stuttered sentence must still parse, and the note the user
// keeps must still read like something a person said.
//
// WHY THIS IS SAFE
//
// It only collapses IMMEDIATELY REPEATED runs of the same words. Natural speech
// repeats a word twice for emphasis ("no, no") and this keeps one of them —
// which is a change, and a small one. It does not touch words that recur later
// in the sentence, only back-to-back repeats, which is the exact shape the
// accumulation bug produces.
// ─────────────────────────────────────────────────────────────────────────────

// Longest repeated phrase we will collapse, in words. Six covers
// "remind me to remind me to", which is the longest seen in the wild.
const MAX_PHRASE = 6;

/**
 * Collapse back-to-back repeated words and phrases.
 *
 * "ఐదు ఐదు ఐదు నిమిషాల్లో"                 -> "ఐదు నిమిషాల్లో"
 * "remind me to remind me to call"          -> "remind me to call"
 *
 * Returns the input unchanged when there is nothing to collapse, so it is safe
 * to run on every transcript.
 */
export function collapseRepeats(text) {
  const original = String(text || '');
  if (!original.trim()) return original;

  let words = original.trim().split(/\s+/);

  // Longest phrases first. Collapsing "remind me to" before "remind" avoids
  // leaving a half-collapsed "remind me to me to" behind.
  for (let size = MAX_PHRASE; size >= 1; size--) {
    let i = 0;
    const out = [];
    while (i < words.length) {
      const phrase = words.slice(i, i + size);
      if (phrase.length < size) { out.push(words[i]); i++; continue; }

      let repeats = 1;
      while (
        i + size * (repeats + 1) <= words.length &&
        equalPhrase(words, i + size * repeats, phrase)
      ) repeats++;

      out.push(...phrase);
      i += size * repeats;     // skip every repeat after the first
    }
    words = out;
  }

  const cleaned = words.join(' ');
  return cleaned.length ? cleaned : original;
}

function equalPhrase(words, at, phrase) {
  for (let k = 0; k < phrase.length; k++) {
    if (norm(words[at + k]) !== norm(phrase[k])) return false;
  }
  return true;
}

// Compared without case or trailing punctuation, so "five," and "five" count as
// the same word. Indic scripts have no case, and toLowerCase leaves them alone.
function norm(word) {
  return String(word || '').toLowerCase().replace(/[.,!?;:]+$/, '');
}

export default collapseRepeats;
