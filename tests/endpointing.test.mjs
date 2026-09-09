// tests/endpointing.test.mjs
// The silence dial, and the accumulate-across-pauses behaviour it exists for.

import { endpointSilenceMsFor, ENDPOINT_SILENCE_MS, MAX_LISTEN_MS } from '../src/lib/endpointing.js';
import { endpointSilenceMsFor as reExported } from '../src/lib/voice-loop-engine.js';

let pass = 0, fail = 0;
function eq(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) {
    console.log(`      expected: ${JSON.stringify(want)}`);
    console.log(`      got     : ${JSON.stringify(got)}`);
    fail++;
  } else pass++;
}

// ── the dial ────────────────────────────────────────────────────────────────
eq('telugu waits longer than english', endpointSilenceMsFor('te-IN') > endpointSilenceMsFor('en-IN'), true);
eq('telugu', endpointSilenceMsFor('te-IN'), 1400);
eq('hindi', endpointSilenceMsFor('hi-IN'), 1400);
eq('english', endpointSilenceMsFor('en-IN'), 900);
eq('bare tag works', endpointSilenceMsFor('te'), 1400);
eq('case insensitive', endpointSilenceMsFor('TE-in'), 1400);
eq('unknown tag falls back', endpointSilenceMsFor('xx-YY'), ENDPOINT_SILENCE_MS.default);
eq('empty falls back', endpointSilenceMsFor(''), ENDPOINT_SILENCE_MS.default);
eq('null falls back', endpointSilenceMsFor(null), ENDPOINT_SILENCE_MS.default);

// Every Indic language we support must wait longer than English, or we have
// reintroduced exactly the defect NVIDIA warned about.
for (const tag of ['hi', 'te', 'ta', 'kn', 'ml', 'mr']) {
  eq(`${tag} waits longer than english`, endpointSilenceMsFor(tag) > endpointSilenceMsFor('en'), true);
}

eq('there is a hard cap on listening', MAX_LISTEN_MS > 0, true);
eq('the cap is far longer than any silence threshold',
   MAX_LISTEN_MS > Math.max(...Object.values(ENDPOINT_SILENCE_MS)) * 5, true);

// One source of truth: voice-loop-engine.js re-exports rather than keeping a
// second copy. Two copies drifting apart is how the dial ended up living in a
// file nothing imported.
eq('voice-loop-engine re-exports the same function', reExported('te-IN'), endpointSilenceMsFor('te-IN'));
eq('re-export is the same identity', reExported === endpointSilenceMsFor, true);

// ── the behaviour the dial enables ──────────────────────────────────────────
// A faithful model of the live capture loop: finals accumulate, any speech
// restarts the clock, and only silence ends the turn. The old behaviour
// submitted on the first final, which is what cut people off mid-sentence.
function simulate(events, silenceMs) {
  let heard = '', lastPartial = '', now = 0, submitted = null, lastSpeechAt = 0;
  for (const e of events) {
    now = e.at;
    if (lastSpeechAt && now - lastSpeechAt >= silenceMs && submitted === null) {
      submitted = (heard + ' ' + lastPartial).trim();
      break;
    }
    if (e.final) { heard = (heard + ' ' + e.final).trim(); lastPartial = ''; }
    if (e.partial) lastPartial = e.partial;
    lastSpeechAt = now;
  }
  if (submitted === null) submitted = (heard + ' ' + lastPartial).trim();
  return submitted;
}

// A Telugu speaker pausing 1.1s mid-sentence to switch to English. Under the
// old behaviour the first final ended the turn and "remind cheyi" was lost.
const codeSwitch = [
  { at: 0,    partial: 'Gautam ki' },
  { at: 600,  final: 'Gautam ki call cheyyamani' },
  { at: 1700, partial: 'remind' },
  { at: 2100, final: 'remind cheyi' },
  { at: 3600 },
];
eq('telugu pause does not end the turn',
   simulate(codeSwitch, endpointSilenceMsFor('te-IN')),
   'Gautam ki call cheyyamani remind cheyi');

// The same pause under English tuning is long enough to end the turn early -
// which is precisely why the threshold is per-language and not one constant.
eq('the same pause under english tuning would cut it off',
   simulate(codeSwitch, endpointSilenceMsFor('en-IN')),
   'Gautam ki call cheyyamani');

// A genuine end-of-speech still ends the turn promptly.
eq('real silence ends the turn',
   simulate([{ at: 0, final: 'call Ravi' }, { at: 2000 }], endpointSilenceMsFor('en-IN')),
   'call Ravi');

// An interim never finalised is still submitted rather than dropped.
eq('unfinalised speech is not lost',
   simulate([{ at: 0, partial: 'buy milk' }], endpointSilenceMsFor('en-IN')),
   'buy milk');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
