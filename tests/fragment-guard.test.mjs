// Plan item 5: a fragment is asked again, never saved. Pure checks, plus
// source-text checks that the capture route and the microphone use it.
import { readFileSync } from 'node:fs';
import { isFragment, measuredSpeechMs, caughtPartReply, FRAGMENT_SPEECH_MS, CAUGHT_PART } from '../src/lib/fragment-guard.js';

let pass = 0, fail = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  ${detail}`}`);
  ok ? pass++ : fail++;
}

// The 3 Oct turns: 1.4 s and below were mostly wrong, 1.9 s and above right.
check('1.4 s of speech is a fragment', isFragment({ listen: { speechMs: 1400 } }));
check('0.3 s of speech is a fragment', isFragment({ listen: { speechMs: 300 } }));
check('1.9 s of speech is not', !isFragment({ listen: { speechMs: 1900 } }));
check('the threshold sits in the 1.4-1.9 s gap', FRAGMENT_SPEECH_MS > 1400 && FRAGMENT_SPEECH_MS < 1900);

// Unknown is not short.
check('no listen evidence: not refused', !isFragment({}));
check('phone path (no speechMs): not refused', !isFragment({ listen: { path: 'phone', reason: 'x' } }));
check('speechMs 0 / NaN / string: unknown', [0, NaN, '900', null].every((v) => measuredSpeechMs({ speechMs: v }) === null));

// Answer turns are never held to it - so a person is asked again at most once.
check('a short answer turn is not refused', !isFragment({ listen: { speechMs: 400 }, answering: true }));

// The reply asks, in the language spoken, and ends in a question so the dock
// reopens the microphone as an answer turn.
for (const [lang, line] of Object.entries(CAUGHT_PART)) {
  check(`reply in ${lang} ends in a question`, /[?？]\s*$/.test(line), line);
}
check('Telugu speaker hears Telugu', caughtPartReply('te-IN') === CAUGHT_PART.te);
check('unknown language falls back to English', caughtPartReply('xx') === CAUGHT_PART.en);

// The capture route refuses a fragment before any write.
const route = readFileSync(new URL('../src/app/api/voice/capture/route.js', import.meta.url), 'utf8');
const guard = route.indexOf('isFragment({ listen: listenEvidence');
check('capture route checks for a fragment', guard > 0);
const firstKeepsTouch = route.search(/\.from\('keeps'\)/);
const keepInsert = route.search(/\.from\('keeps'\)\s*\.insert/);
check('...before the idempotency key and every write',
  guard > 0 && firstKeepsTouch > 0 && keepInsert > 0 &&
  guard < route.indexOf('resolvedIdempotencyKey') && guard < firstKeepsTouch && guard < keepInsert,
  `guard=${guard} idem=${route.indexOf('resolvedIdempotencyKey')} keeps=${firstKeepsTouch} insert=${keepInsert}`);
check('...and returns not_saved with the asking reply',
  /reason:\s*'speech_fragment'/.test(route) && /not_saved:\s*true/.test(route.slice(guard, guard + 2000)));
check('...and logs the speech length for the before/after rate',
  /transcript_rejected_as_fragment/.test(route) && /speech_ms/.test(route.slice(guard, guard + 2000)));

// The microphone delivers its first audio sooner.
const ls = readFileSync(new URL('../src/lib/listen-stream.js', import.meta.url), 'utf8');
const m = ls.match(/createScriptProcessor\((\d+)/);
check('mic buffer is 1024 samples or less (first audio in ~64 ms, not ~256 ms)', m && Number(m[1]) <= 1024, m && m[1]);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
