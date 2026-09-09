// tests/barge-in.test.mjs
// The four parts of barge-in, tested separately - because shipping two of them
// and believing you are done is the documented failure mode.

import {
  BARGE_IN_REASON, beginSpeech, isCurrent, endSpeech, isSpeaking,
  bargeIn, onBargeIn, registerStopper, registerHistoryTruncator,
  lastBargeIn, _resetForTests,
  setSpokenText, looksLikeSelfEcho, isInterruptCommand, considerUserSpeech,
} from '../src/lib/barge-in.js';

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

// ── part 2: stop ────────────────────────────────────────────────────────────
_resetForTests();
{
  let stopped = 0;
  registerStopper(() => { stopped++; });
  beginSpeech();
  eq('speaking after beginSpeech', isSpeaking(), true);
  eq('bargeIn reports it interrupted', bargeIn(), true);
  eq('stopper ran', stopped, 1);
  eq('no longer speaking', isSpeaking(), false);
}

// nothing to interrupt is not an interruption
_resetForTests();
{
  let stopped = 0;
  registerStopper(() => { stopped++; });
  eq('bargeIn on silence returns false', bargeIn(), false);
  eq('stopper did not run', stopped, 0);
}

// every output path gets stopped, not just the first
_resetForTests();
{
  const ran = [];
  registerStopper(() => ran.push('speechSynthesis'));
  registerStopper(() => ran.push('audioElement'));
  registerStopper(() => ran.push('nativeBridge'));
  beginSpeech();
  bargeIn();
  eq('all three output paths stopped', ran.length, 3);
}

// a throwing stopper must not block the others, or the truncation
_resetForTests();
{
  const ran = [];
  registerStopper(() => { throw new Error('native bridge missing'); });
  registerStopper(() => ran.push('browser'));
  registerHistoryTruncator(() => ran.push('truncated'));
  beginSpeech();
  eq('bargeIn survives a throwing stopper', bargeIn(), true);
  eq('later stopper still ran', ran.includes('browser'), true);
  eq('history still truncated', ran.includes('truncated'), true);
}

// ── part 3: flush - the one that bites ──────────────────────────────────────
// A token taken before the interruption must be invalid after it, so audio
// that arrives late discards itself instead of talking over the user.
_resetForTests();
{
  const token = beginSpeech();           // speak() called, fetch starts
  eq('token valid while speaking', isCurrent(token), true);
  bargeIn(BARGE_IN_REASON.USER_SPEECH);  // user interrupts during the fetch
  eq('late audio is discarded', isCurrent(token), false);
}

// a NEW utterance must not resurrect an old token
_resetForTests();
{
  const first = beginSpeech();
  bargeIn();
  const second = beginSpeech();
  eq('new utterance is current', isCurrent(second), true);
  eq('interrupted utterance stays dead', isCurrent(first), false);
}

// a second utterance supersedes an in-flight first one
_resetForTests();
{
  const first = beginSpeech();
  const second = beginSpeech();
  eq('superseded token is invalid', isCurrent(first), false);
  eq('newest token is valid', isCurrent(second), true);
}

// endSpeech on a stale token must not silence the current utterance
_resetForTests();
{
  const first = beginSpeech();
  const second = beginSpeech();
  endSpeech(first);
  eq('stale endSpeech ignored', isCurrent(second), true);
  endSpeech(second);
  eq('current endSpeech honoured', isSpeaking(), false);
}

// ── part 4: truncate ────────────────────────────────────────────────────────
_resetForTests();
{
  const events = [];
  registerHistoryTruncator((e) => events.push(e.reason));
  beginSpeech();
  bargeIn(BARGE_IN_REASON.USER_SPEECH);
  eq('truncator ran with the reason', events, ['user_speech']);
}

// truncation runs after the stoppers: audio must be silenced before state moves
_resetForTests();
{
  const order = [];
  registerStopper(() => order.push('stop'));
  registerHistoryTruncator(() => order.push('truncate'));
  beginSpeech();
  bargeIn();
  eq('stop happens before truncate', order, ['stop', 'truncate']);
}

// ── subscribers and diagnostics ─────────────────────────────────────────────
_resetForTests();
{
  const seen = [];
  const off = onBargeIn((e) => seen.push(e.reason));
  beginSpeech(); bargeIn(BARGE_IN_REASON.USER_ACTION);
  off();
  beginSpeech(); bargeIn(BARGE_IN_REASON.USER_SPEECH);
  eq('listener fired once, then unsubscribed', seen, ['user_action']);
  eq('lastBargeIn records the latest', lastBargeIn().reason, 'user_speech');
}

_resetForTests();
{
  const off = registerStopper(() => { throw new Error('should be gone'); });
  off();
  beginSpeech();
  eq('unregistered stopper does not run', bargeIn(), true);
}

// non-functions are ignored rather than crashing at wire-up time
_resetForTests();
{
  registerStopper(null);
  registerHistoryTruncator(undefined);
  onBargeIn('not a function');
  beginSpeech();
  eq('bad registrations are harmless', bargeIn(), true);
}

// ── part 1: detection, and the self-echo trap ───────────────────────────────
_resetForTests();
{
  // The assistant is mid-sentence and the open mic hears its own words.
  beginSpeech();
  setSpokenText('You have three reminders today and one invoice due on Friday');
  eq('exact echo detected', looksLikeSelfEcho('you have three reminders today'), true);
  eq('partial echo detected', looksLikeSelfEcho('reminders today and one invoice'), true);
  eq('echo does NOT interrupt', considerUserSpeech('you have three reminders today', false), false);
  eq('still speaking after echo', isSpeaking(), true);
}

_resetForTests();
{
  beginSpeech();
  setSpokenText('You have three reminders today');
  eq('unrelated speech is not echo', looksLikeSelfEcho('call Gautam tomorrow'), false);
  // ...but unrelated speech alone still does not interrupt, because without
  // echo cancellation we cannot trust it. High precision, by design.
  eq('unrelated chatter does not interrupt', considerUserSpeech('call Gautam tomorrow', false), false);
}

_resetForTests();
{
  beginSpeech();
  setSpokenText('You have three reminders today');
  eq('wake word interrupts', considerUserSpeech('Aaria stop', true), true);
  eq('stopped speaking', isSpeaking(), false);
}

_resetForTests();
{
  beginSpeech();
  setSpokenText('You have three reminders today');
  eq('stop command interrupts without wake word', considerUserSpeech('stop', false), true);
}

_resetForTests();
{
  beginSpeech();
  setSpokenText('Okay, stopping now');
  // The assistant said "stop" itself. Echo filtering must win over the stop
  // word, or the assistant talks itself out of finishing its own sentence.
  eq('own stop word is not an interrupt', considerUserSpeech('stopping now', false), false);
}

eq('stop words: hindi', isInterruptCommand('ruko'), true);
eq('stop words: telugu', isInterruptCommand('ఆగు'), true);
eq('stop words: trailing', isInterruptCommand('aaria stop'), true);
eq('stop words: not a substring match', isInterruptCommand('stopwatch reminder'), false);
eq('stop words: ordinary sentence', isInterruptCommand('add two thousand for Ravi'), false);

_resetForTests();
{
  // Nothing is speaking: user speech is an ordinary command, not an interrupt.
  eq('no interrupt when silent', considerUserSpeech('stop', true), false);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
