// src/lib/transcript-clean.js
// ─────────────────────────────────────────────────────────────────────────────
// THE RECOGNISER DOES NOT STUTTER. IT RESTARTS.
//
// I got this wrong the first time and it is worth writing down why, because the
// wrong model of a bug produces a fix that passes review and changes nothing.
//
// My first version folded back-to-back repeats — "ఐదు ఐదు ఐదు" into "ఐదు". Then
// the real saved text arrived. Keep 60d0e354-ebe5-4846-ac9f-b2ef52cf3555,
// 26 September 2026 at 18:44:02, exactly as stored:
//
//   "please remind
//    please remind me
//    please remind me to call
//    please remind me to call Surya
//    please remind me to call Surya after
//    please remind me to call Surya after 5
//    please remind me to call Surya after 5 minutes"
//
// Nothing there repeats back to back. Every piece RESTARTS FROM THE BEGINNING
// and is one word longer than the last. The old function looked for something
// that was not there, found nothing, and the corrupted sentence went through
// untouched — which is exactly what the founder saw on screen afterwards.
//
// WHY IT LOOKS LIKE THIS
//
// android/.../services/VoiceService.java states its own pipeline:
//
//   mic -> 3s WAV chunk -> POST /api/groq-stt -> transcript
//       -> POST /api/voice/capture
//
// CHUNK_MS = 3000. Each chunk carries the speech so far, is transcribed on its
// own, and the answers are concatenated. So the transcript is the sentence's
// own growing prefixes, strung end to end.
//
// THE GOOD NEWS BURIED IN IT
//
// The complete sentence is always present. It is the LAST and LONGEST segment.
// Nothing was lost — it was buried under seven drafts of itself.
//
// THIS IS STILL NOT THE FIX. The fix is step 11: QuietKeep streams to the Aaria
// engine and there are no chunks to overlap. This keeps the product honest and
// usable until that lands, in one deliberate place.
// ─────────────────────────────────────────────────────────────────────────────

// Longest phrase the back-to-back pass will fold, in words.
const MAX_PHRASE = 6;

// Below this, a "restart" is far more likely to be ordinary speech than a
// chunk boundary, and deleting a short sentence's words is unforgivable.
const MIN_WORDS_TO_REPAIR = 4;

/**
 * Repair a transcript that arrived as overlapping chunks.
 *
 * Two passes, in order:
 *   1. growing prefixes  — the chunker's real signature
 *   2. back-to-back runs — leftovers, and genuine recogniser hiccups
 *
 * Returns the input unchanged when there is nothing safe to do, so it costs
 * nothing to run on every transcript.
 */
export function collapseRepeats(text) {
  const original = String(text || '');
  const words = original.trim().split(/\s+/).filter(Boolean);
  if (words.length < MIN_WORDS_TO_REPAIR) return original;

  const deprefixed = dropGrowingPrefixes(words);
  const folded = foldAdjacentRuns(deprefixed);
  const cleaned = folded.join(' ');
  return cleaned.length ? cleaned : original;
}

/**
 * When the utterance restarts from its first word over and over, and every
 * restart is a prefix of the longest one, keep only the longest.
 *
 * THE GUARD IS THE IMPORTANT PART. If the segments are NOT prefixes of one
 * another then the speaker simply used the same opening word twice — "call me
 * when you call Surya" — and this returns the words untouched. It is better to
 * leave a stutter in than to delete something a person actually said.
 */
function dropGrowingPrefixes(words) {
  const head = norm(words[0]);
  if (!head) return words;

  const restarts = [];
  for (let i = 0; i < words.length; i++) {
    if (norm(words[i]) === head) restarts.push(i);
  }
  if (restarts.length < 2) return words;

  const segments = restarts.map((from, k) =>
    words.slice(from, k + 1 < restarts.length ? restarts[k + 1] : words.length)
  );

  let longest = segments[0];
  for (const s of segments) if (s.length > longest.length) longest = s;

  const everySegmentIsADraft = segments.every((s) => isPrefixOf(s, longest));
  return everySegmentIsADraft ? longest : words;
}

/** Fold immediately repeated words and phrases, longest phrase first. */
function foldAdjacentRuns(input) {
  let words = input;
  for (let size = MAX_PHRASE; size >= 1; size--) {
    const out = [];
    let i = 0;
    while (i < words.length) {
      if (i + size > words.length) { out.push(words[i]); i++; continue; }
      const phrase = words.slice(i, i + size);
      let repeats = 1;
      while (
        i + size * (repeats + 1) <= words.length &&
        samePhrase(words, i + size * repeats, phrase)
      ) repeats++;
      if (repeats > 1) {
        // Keep one copy, step past all of them.
        out.push(...phrase);
        i += size * repeats;
      } else {
        // NOTHING REPEATED HERE. Emit ONE word and step ONE word, so a repeat
        // that does not begin on a multiple of `size` is still found on a later
        // pass. Emitting the whole lookahead phrase here — which is what the
        // first version did — writes every word `size` times over and turns a
        // stutter repair into a stutter generator. It was caught by running the
        // function against the two real transcripts before this shipped.
        out.push(words[i]);
        i += 1;
      }
    }
    words = out;
  }
  return words;
}

function isPrefixOf(candidate, whole) {
  if (candidate.length > whole.length) return false;
  for (let i = 0; i < candidate.length; i++) {
    if (norm(candidate[i]) !== norm(whole[i])) return false;
  }
  return true;
}

function samePhrase(words, at, phrase) {
  for (let k = 0; k < phrase.length; k++) {
    if (norm(words[at + k]) !== norm(phrase[k])) return false;
  }
  return true;
}

// Compared without case or trailing punctuation, so "five," and "five" match.
// Indic scripts have no case and toLowerCase leaves them alone.
function norm(word) {
  return String(word || '').toLowerCase().replace(/[.,!?;:]+$/, '');
}

export default collapseRepeats;
