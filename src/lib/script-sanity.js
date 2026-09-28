// src/lib/script-sanity.js
// ─────────────────────────────────────────────────────────────────────────────
// IS THIS WRITING, OR IS IT THE MICROPHONE HALLUCINATING?
//
// On 28 September 2026 three notes were saved into the founder's own account:
//
//     ాకంగడండు
//     ప్ిరా నగటాయారాగిడిా.
//     ప్ని పగానామారాిరాం ండు గ్ామారాం చిలామ్రాిండాా.
//
// They are not words. They are not sentences. They are not even misspellings.
// An always-on microphone heard room noise, the recogniser returned its best
// guess at it, and the app filed each guess as one of his notes. His open keeps
// went from 69 to 71 while he was not speaking, and the "stale, unresolved"
// warning on his home screen counted them as work he had left undone.
//
// WHAT THIS DELIBERATELY DOES NOT DO
// It does not judge whether text is meaningful, sensible, or on-topic. That is
// a losing game: a shopping list looks like nonsense, a name looks like a typo,
// and a guard built on plausibility eventually throws away a real note. Doing
// that to someone's own words would be far worse than the problem it solves.
//
// WHAT IT CHECKS INSTEAD
// Three sequences that cannot occur in written Telugu or Devanagari at all:
//
//   1. A word beginning with a dependent vowel sign, a virama, or an anusvara.
//      These attach to a preceding consonant. Nothing can start with one, in
//      the way no English word starts with an apostrophe-s.
//   2. A dependent vowel sign directly after a virama. The virama removes a
//      vowel; a vowel sign adds one. Together they are a contradiction.
//   3. Two dependent vowel signs in a row. A syllable carries one vowel.
//
// These are properties of the writing system, not opinions about the content.
// Real speech - however rambling, ungrammatical, code-mixed or badly recognised
// - does not produce them. Noise does, constantly.
//
// THIS FILE IMPORTS NOTHING, so tests/script-sanity.test.mjs can load it under
// plain node. An '@/lib/...' import here would take the whole suite down before
// a single assertion ran, which has already cost this project one CI failure.
// ─────────────────────────────────────────────────────────────────────────────

/** Telugu. Dependent signs U+0C3E–U+0C56, virama U+0C4D, marks U+0C00–U+0C03. */
const TELUGU = {
  lo: 0x0C00, hi: 0x0C7F,
  signs: [[0x0C3E, 0x0C56]],
  virama: 0x0C4D,
  marks: [0x0C00, 0x0C01, 0x0C02, 0x0C03],
};

/** Devanagari — Hindi and Marathi. Same shape, different block. */
const DEVANAGARI = {
  lo: 0x0900, hi: 0x097F,
  signs: [[0x093E, 0x094C]],
  virama: 0x094D,
  marks: [0x0900, 0x0901, 0x0902, 0x0903],
};

const BLOCKS = [TELUGU, DEVANAGARI];

function blockOf(cp) {
  return BLOCKS.find((b) => cp >= b.lo && cp <= b.hi) || null;
}

function isVowelSign(cp, block) {
  return block.signs.some(([from, to]) => cp >= from && cp <= to);
}

function isMark(cp, block) {
  return block.marks.includes(cp);
}

/**
 * Every impossible sequence found, as plain-English reasons.
 *
 * Returns [] for anything that could be writing — including English, digits,
 * punctuation, empty input, and any script this does not know about. Silence
 * on unknown input is deliberate: refusing to save something we cannot judge
 * would be the worse failure.
 */
export function impossibleSequences(text) {
  const reasons = [];
  const words = String(text || '').split(/\s+/).filter(Boolean);

  for (const word of words) {
    const cps = [...word].map((c) => c.codePointAt(0));

    for (let i = 0; i < cps.length; i++) {
      const block = blockOf(cps[i]);
      if (!block) continue;

      // 1. Nothing can begin with a mark that attaches to what came before it.
      if (i === 0 && (isVowelSign(cps[i], block)
                      || cps[i] === block.virama
                      || isMark(cps[i], block))) {
        reasons.push(`"${word}" begins with a mark that cannot start a word`);
        break;
      }

      // 2. A virama removes a vowel. A vowel sign adds one. Not both.
      if (cps[i] === block.virama && i + 1 < cps.length) {
        const next = blockOf(cps[i + 1]);
        if (next && isVowelSign(cps[i + 1], next)) {
          reasons.push(`"${word}" has a vowel sign directly after a virama`);
          break;
        }
      }

      // 3. One syllable, one vowel.
      if (isVowelSign(cps[i], block) && i + 1 < cps.length) {
        const next = blockOf(cps[i + 1]);
        if (next && isVowelSign(cps[i + 1], next)) {
          reasons.push(`"${word}" has two vowel signs in a row`);
          break;
        }
      }
    }
  }

  return reasons;
}

/** True when the text contains something no writer could have written. */
export function looksLikeTranscriptionNoise(text) {
  return impossibleSequences(text).length > 0;
}

export default looksLikeTranscriptionNoise;
