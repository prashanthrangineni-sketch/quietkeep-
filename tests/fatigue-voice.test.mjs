// tests/fatigue-voice.test.mjs
// TASK CARD DRV-04: Voice-based fatigue check unit tests & 30-case fixture validation.

import { readFileSync } from 'node:fs';
import {
  CONSTANTS,
  scoreReply,
  classifyReplies,
  createFatigueTracker,
  isFillerOnly,
  isRepeatAsk,
} from '../src/lib/fatigue-voice.js';

let pass = 0;
let fail = 0;

function eq(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) {
    console.log(`      expected: ${JSON.stringify(want)}`);
    console.log(`      got     : ${JSON.stringify(got)}`);
    fail++;
  } else {
    pass++;
  }
}

// ── 1. Constants and exports ────────────────────────────────────────────────
eq('CONSTANTS.MISSED_TIMEOUT_MS is 8000', CONSTANTS.MISSED_TIMEOUT_MS, 8000);
eq('CONSTANTS.SLOW_REPLY_MS is 3000', CONSTANTS.SLOW_REPLY_MS, 3000);
eq('CONSTANTS.LATE_REPLY_MIN_MS is 1800', CONSTANTS.LATE_REPLY_MIN_MS, 1800);
eq('CONSTANTS.SLOW_SPEECH_WORDS_PER_SEC is 1.2', CONSTANTS.SLOW_SPEECH_WORDS_PER_SEC, 1.2);
eq('CONSTANTS.CHECK_QUESTIONS has 3 questions', CONSTANTS.CHECK_QUESTIONS.length, 3);
eq('CONSTANTS.FIRMER_LINES has 2 lines', CONSTANTS.FIRMER_LINES.length, 2);

// ── 2. Unit rules: missed / no_reply ────────────────────────────────────────
{
  const r = scoreReply({ askedAt: 1000, speechStartAt: null, speechEndAt: null, transcript: '' });
  eq('speechStartAt null -> missed is true', r.missed, true);
  eq('speechStartAt null -> points is 3', r.points, 3);
  eq('speechStartAt null -> reasons is [no_reply]', r.reasons, ['no_reply']);
}
{
  const r = scoreReply({ askedAt: 1000, speechStartAt: 9001, speechEndAt: 10000, transcript: 'hi' });
  eq('speechStartAt > 8000ms -> missed is true', r.missed, true);
  eq('speechStartAt > 8000ms -> points is 3', r.points, 3);
  eq('speechStartAt > 8000ms -> reasons is [no_reply]', r.reasons, ['no_reply']);
}

// ── 3. Unit rules: latency edges ───────────────────────────────────────────
{
  // 1790 ms: below 1800ms -> 0 points
  const r = scoreReply({ askedAt: 1000, speechStartAt: 2790, speechEndAt: 4000, transcript: 'all good here' });
  eq('latency 1790ms -> no latency points', r.reasons.includes('late_reply') || r.reasons.includes('slow_reply'), false);
}
{
  // exactly 1800 ms: late_reply (1 pt)
  const r = scoreReply({ askedAt: 1000, speechStartAt: 2800, speechEndAt: 4000, transcript: 'all good here' });
  eq('latency exactly 1800ms -> late_reply', r.reasons.includes('late_reply'), true);
  eq('latency exactly 1800ms -> 1 pt', r.points, 1);
}
{
  // exactly 3000 ms: late_reply (1 pt)
  const r = scoreReply({ askedAt: 1000, speechStartAt: 4000, speechEndAt: 5500, transcript: 'all good here' });
  eq('latency exactly 3000ms -> late_reply', r.reasons.includes('late_reply'), true);
  eq('latency exactly 3000ms -> 1 pt', r.points, 1);
}
{
  // 3001 ms: slow_reply (2 pts)
  const r = scoreReply({ askedAt: 1000, speechStartAt: 4001, speechEndAt: 5500, transcript: 'all good here' });
  eq('latency 3001ms -> slow_reply', r.reasons.includes('slow_reply'), true);
  eq('latency 3001ms -> 2 pts', r.points, 2);
}
{
  // 8000 ms: slow_reply (2 pts)
  const r = scoreReply({ askedAt: 1000, speechStartAt: 9000, speechEndAt: 10500, transcript: 'all good here' });
  eq('latency 8000ms -> slow_reply', r.reasons.includes('slow_reply'), true);
  eq('latency 8000ms -> 2 pts', r.points, 2);
}

// ── 4. Unit rules: word count ───────────────────────────────────────────────
{
  const r0 = scoreReply({ askedAt: 1000, speechStartAt: 2000, speechEndAt: 2500, transcript: '' });
  eq('0 words -> one_word', r0.reasons.includes('one_word'), true);

  const r1 = scoreReply({ askedAt: 1000, speechStartAt: 2000, speechEndAt: 2500, transcript: 'fine' });
  eq('1 word -> one_word', r1.reasons.includes('one_word'), true);

  const r2 = scoreReply({ askedAt: 1000, speechStartAt: 2000, speechEndAt: 3000, transcript: 'feeling fine' });
  eq('2 words -> NOT one_word', r2.reasons.includes('one_word'), false);

  const rTelugu = scoreReply({ askedAt: 1000, speechStartAt: 2000, speechEndAt: 2500, transcript: 'బాగున్నాను' });
  eq('1 word Telugu script -> one_word', rTelugu.words, 1);
  eq('1 word Telugu script -> reason one_word', rTelugu.reasons.includes('one_word'), true);
}

// ── 5. Unit rules: speech rate (wordsPerSec < 1.2 on 2+ words) ─────────────
{
  // 2 words in 2.0s = 1.0 wps < 1.2 -> slow_speech (1 pt)
  const r = scoreReply({ askedAt: 1000, speechStartAt: 2000, speechEndAt: 4000, transcript: 'feeling okay' });
  eq('2 words in 2.0s -> wps 1.0', r.wordsPerSec, 1.0);
  eq('wps 1.0 < 1.2 -> slow_speech', r.reasons.includes('slow_speech'), true);
}
{
  // 2 words in 1.6s = 1.25 wps >= 1.2 -> no slow_speech
  const r = scoreReply({ askedAt: 1000, speechStartAt: 2000, speechEndAt: 3600, transcript: 'sab theek' });
  eq('2 words in 1.6s -> wps 1.25', r.wordsPerSec, 1.25);
  eq('wps 1.25 >= 1.2 -> no slow_speech', r.reasons.includes('slow_speech'), false);
}
{
  // 1 word in 2.0s -> slow_speech does NOT trigger for 1 word
  const r = scoreReply({ askedAt: 1000, speechStartAt: 2000, speechEndAt: 4000, transcript: 'fine' });
  eq('1 word does not trigger slow_speech', r.reasons.includes('slow_speech'), false);
}

// ── 6. Unit rules: fillers ──────────────────────────────────────────────────
eq('umm is filler only', isFillerOnly('umm'), true);
eq('umm hmm uh is filler only', isFillerOnly('umm hmm uh'), true);
eq('haan is filler only', isFillerOnly('haan'), true);
eq('ok is filler only', isFillerOnly('ok'), true);
eq('achha is filler only', isFillerOnly('achha'), true);
eq('Telugu emo is filler only', isFillerOnly('emo'), true);
eq('Telugu script ఉమ్ is filler only', isFillerOnly('ఉమ్'), true);
eq('Hindi script हम्म is filler only', isFillerOnly('हम्म'), true);
eq('umm ginger tea is NOT filler only', isFillerOnly('umm ginger tea'), false);
eq('feeling good is NOT filler only', isFillerOnly('feeling good'), false);

{
  const r = scoreReply({ askedAt: 1000, speechStartAt: 2000, speechEndAt: 3000, transcript: 'umm hmm' });
  eq('filler reply gets filler_only reason', r.reasons.includes('filler_only'), true);
  eq('filler reply fillers boolean is true', r.fillers, true);
}

// ── 7. Unit rules: asks to repeat ───────────────────────────────────────────
eq('what is asked_repeat', isRepeatAsk('what?'), true);
eq('sorry is asked_repeat', isRepeatAsk('sorry'), true);
eq('again is asked_repeat', isRepeatAsk('again'), true);
eq('kya is asked_repeat', isRepeatAsk('kya?'), true);
eq('enti is asked_repeat', isRepeatAsk('enti?'), true);
eq('em annav is asked_repeat', isRepeatAsk('em annav'), true);
eq('phir se is asked_repeat', isRepeatAsk('phir se'), true);
eq('malli is asked_repeat', isRepeatAsk('malli'), true);
eq('Telugu script ఏంటి is asked_repeat', isRepeatAsk('ఏంటి'), true);
eq('Hindi script क्या is asked_repeat', isRepeatAsk('क्या बोला'), true);
eq('feeling fine is NOT asked_repeat', isRepeatAsk('feeling fine'), false);

{
  const r = scoreReply({ askedAt: 1000, speechStartAt: 2000, speechEndAt: 3000, transcript: 'what?' });
  eq('repeat query gets asked_repeat reason', r.reasons.includes('asked_repeat'), true);
  eq('repeat query gets 2 points for repeat', r.points >= 2, true);
}

// ── 8. Unit rules: classifyReplies ──────────────────────────────────────────
{
  eq('empty replies -> alert', classifyReplies([]).level, 'alert');
  eq('score 0 -> alert', classifyReplies([{ points: 0, reasons: [] }]).level, 'alert');
  eq('score 1 -> alert', classifyReplies([{ points: 1, reasons: ['late_reply'] }]).level, 'alert');
  eq('score 2 -> watch', classifyReplies([{ points: 2, reasons: ['slow_reply'] }]).level, 'watch');
  eq('score 3 -> watch', classifyReplies([{ points: 3, reasons: ['slow_reply', 'one_word'] }]).level, 'watch');
  eq('score 4 -> drowsy', classifyReplies([{ points: 4, reasons: ['slow_reply', 'asked_repeat'] }]).level, 'drowsy');
  eq('score 5 -> drowsy', classifyReplies([{ points: 5, reasons: [] }]).level, 'drowsy');

  // Any 2 no_reply in last 3 -> drowsy
  const twoMissed = [
    { points: 3, reasons: ['no_reply'], missed: true },
    { points: 0, reasons: [], missed: false },
    { points: 3, reasons: ['no_reply'], missed: true },
  ];
  eq('two missed replies in last 3 -> drowsy', classifyReplies(twoMissed).level, 'drowsy');

  // Only last 3 considered
  const fourReplies = [
    { points: 3, reasons: ['no_reply'], missed: true }, // 4th ago: discarded
    { points: 0, reasons: [] },
    { points: 0, reasons: [] },
    { points: 0, reasons: [] },
  ];
  eq('older reply discarded in 3-window -> alert', classifyReplies(fourReplies).level, 'alert');
}

// ── 9. createFatigueTracker ─────────────────────────────────────────────────
{
  const tracker = createFatigueTracker();
  eq('initial tracker level is alert', tracker.level(), 'alert');

  tracker.recordQuestion(1000);
  const r1 = tracker.recordReply({ at: 2000, startAt: 2000, endAt: 3000, transcript: 'I am doing great' });
  eq('recordReply scored', r1.points, 0);
  eq('tracker level remains alert', tracker.level(), 'alert');

  tracker.recordQuestion(10000);
  tracker.recordNoReply(18000);
  eq('tracker level after 1 no_reply is watch', tracker.level(), 'watch');

  tracker.recordQuestion(20000);
  tracker.recordNoReply(28000);
  eq('tracker level after 2 no_reply is drowsy', tracker.level(), 'drowsy');

  tracker.reset();
  eq('reset clears tracker back to alert', tracker.level(), 'alert');
  eq('replies cleared after reset', tracker.getReplies().length, 0);
}

// ── 10. Verify 30 Scripted Fixtures ─────────────────────────────────────────
const fixtures = JSON.parse(readFileSync(new URL('./fixtures/fatigue-replies.json', import.meta.url), 'utf8'));

eq('fixtures contains exactly 30 cases', fixtures.length, 30);

let alertCount = 0;
let drowsyCount = 0;
let watchCount = 0;

for (const tc of fixtures) {
  const scored = tc.replies.map((r) => scoreReply(r));
  const classified = classifyReplies(scored);

  const matched = classified.level === tc.designed;
  eq(`Fixture ${tc.id}: ${tc.note} (${classified.level} === ${tc.designed})`, matched, true);

  if (classified.level === 'alert') alertCount++;
  else if (classified.level === 'drowsy') drowsyCount++;
  else if (classified.level === 'watch') watchCount++;
}

eq('exactly 15 alert cases', alertCount, 15);
eq('exactly 15 drowsy cases', drowsyCount, 15);
eq('zero watch cases in designed test set', watchCount, 0);

// ── 11. Ride-care companion integration ────────────────────────────────────
import { createStayAwakeCompanion } from '../src/lib/ride-care.js';

{
  let fakeTime = new Date('2026-10-17T14:00:00Z'); // 2pm: daytime
  const companion = createStayAwakeCompanion({ clock: () => fakeTime });

  let nudge45 = null;
  let nudge60 = null;
  let nudge75 = null;
  let nudge85 = null;
  let nudge90 = null;

  for (let m = 0; m <= 90; m += 1) {
    const at = m * 60 * 1000;
    const isDrowsy = m > 75; // becomes drowsy after 75 min check
    const res = companion.update({ at, speedKmh: 40, drowsy: isDrowsy });
    if (m === 45) nudge45 = res;
    if (m === 60) nudge60 = res;
    if (m === 75) nudge75 = res;
    if (m === 85) nudge85 = res;
    if (m === 90) nudge90 = res;
  }

  eq('nudge45 returns askedCheck true', nudge45?.askedCheck, true);
  eq('nudge45 contains check question 0', nudge45?.phrase.includes('Quick check: say how you are feeling.'), true);

  eq('nudge at 60min is null (before 30min repeat)', nudge60, null);

  eq('nudge75 is not null', !!nudge75, true);
  eq('nudge75 contains check question 1 (rotated)', nudge75?.phrase.includes('Quick check: what is the next town?'), true);

  eq('drowsy nudge at 85min is null (only 10min after last)', nudge85, null);

  eq('drowsy nudge at 90min succeeds (15min repeat = half interval)', !!nudge90, true);
  eq('drowsy nudge uses firmer line', nudge90?.phrase.includes('You sound tired.') || nudge90?.phrase.includes('Your replies are slow.'), true);
  eq('drowsy nudge contains check question 2 (rotated)', nudge90?.phrase.includes('Quick check: say your favourite tea.'), true);
}

// ── Live wiring guards (review fixes, 17 Oct 2026) ────────────────────────────
// ride-guard.js imports the app (@/...) so it cannot run in plain node; these
// read its source to pin the three behaviours that stop false "drowsy" results.
{
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../src/lib/ride-guard.js', import.meta.url), 'utf8');
  const handle = src.slice(src.indexOf('function handle('), src.indexOf('function start()'));
  const replyAt = handle.indexOf('onAnyReply');
  const cancelAt = handle.indexOf('CANCEL_WORDS');
  const check = (n, ok) => eq(n, !!ok, true);
  check('"I am fine" (a cancel word) still counts as an answer: reply is recorded before the cancel-word check',
    replyAt > 0 && cancelAt > 0 && replyAt < cancelAt);
  check('no question is asked (so no "no reply" can be scored) when the mic is not listening',
    /if \(!listener\.isListening\(\)\) return;\s*tracker\.recordQuestion/.test(src));
  check('our own spoken question echoing into the mic is ignored',
    /quick check/i.test(src.slice(src.indexOf('onAnyReply: (said, at)'), src.indexOf('onAnyReply: (said, at)') + 900)));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

