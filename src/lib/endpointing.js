// src/lib/endpointing.js
// How long we wait in silence before deciding the person has finished.
//
// WHY THIS FILE EXISTS, AND WHY IT IS NOT IN voice-loop-engine.js ANY MORE
// These values were added to src/lib/voice-loop-engine.js on 8 September and
// reported as shipped. They were not shipped in any sense that matters:
// nothing in the application imports that module. The code was correct and
// changed nothing for a single user, because the live capture path is the
// recogniser in src/lib/context/aaria.jsx, which had no endpointing setting at
// all - it let the browser decide, and the browser is tuned for English.
//
// Moving the dial here, into a module the live path actually imports, is what
// makes it real. voice-loop-engine.js re-exports it so there is one source of
// truth rather than two copies drifting apart.
//
// WHY THE NUMBER MATTERS
// NVIDIA's streaming-pipeline session:
//   "The largest single number in the loop is a silence threshold, and it is
//    set in a configuration file."
// Their reference default is 800ms, and then the part that is about us:
//   "In Indic conversational speech, natural pauses are longer, so this fails
//    sooner than English tuning suggests."
//
// Too short and we cut people off mid-sentence. Too long and the person has
// finished and we are still waiting - which they name as "the single most
// common cause of a pipeline that measures well and feels slow". Our users
// pause mid-utterance to switch between Telugu and English, which puts us
// squarely in the first failure mode.
//
// THESE VALUES ARE STARTING POINTS, NOT FINDINGS. They have not been tuned
// against real recordings. NVIDIA's prescribed step two is "tune endpointing
// on your audio" - one day of work, the largest latency recovery available -
// and that requires a dial rather than a constant, which is the whole point.

export const ENDPOINT_SILENCE_MS = {
  default: 1200, // for any tag we do not recognise
  en: 900,       // closer to NVIDIA's 800ms reference; English pauses are shorter
  hi: 1400,
  te: 1400,
  ta: 1400,
  kn: 1400,
  ml: 1400,
  mr: 1400,
};

// A hard cap so a stuck recogniser cannot listen forever. If someone genuinely
// talks for longer than this we take what we have rather than dropping it.
export const MAX_LISTEN_MS = 15000;

/**
 * Resolve the silence threshold for a language tag.
 * Accepts 'te-IN', 'te', 'en-US' etc. Unknown tags fall back to the default.
 */
export function endpointSilenceMsFor(langTag) {
  const base = String(langTag || '').split('-')[0].toLowerCase();
  return ENDPOINT_SILENCE_MS[base] ?? ENDPOINT_SILENCE_MS.default;
}
