// tests/speech-signal.test.mjs
// AARIA 4.1: the "Speaking" state follows the reply's real sound.
//
// Three layers, each tested on its own:
//   1. the signal itself (src/lib/avatar/speech-signal.js)
//   2. the tracker that turns the signal into the dock's state
//   3. the wiring: tts.js with a fake <audio>, and the two files that cannot
//      be imported under plain node (JSX) checked by reading their source.

import { readFileSync } from 'node:fs';
import {
  onSpeechSignal, speechStarted, speechEnded, speechSkipped, activeSpeech,
  createSpeakingTracker, _resetForTests,
} from '../src/lib/avatar/speech-signal.js';

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

// A clock and timers the test controls, so "6 seconds" takes no time.
function fakeClock() {
  let t = 0, seq = 0;
  const timers = new Map();
  return {
    now: () => t,
    setTimer: (fn, ms) => { seq += 1; timers.set(seq, { at: t + ms, fn }); return seq; },
    clearTimer: (id) => { timers.delete(id); },
    advance(ms) {
      const end = t + ms;
      for (;;) {
        let next = null;
        for (const [id, x] of timers) if (x.at <= end && (!next || x.at < next.x.at)) next = { id, x };
        if (!next) break;
        timers.delete(next.id); t = next.x.at; next.x.fn();
      }
      t = end;
    },
    pending: () => timers.size,
  };
}
function tracker(clock, opts = {}) {
  const log = [];
  const tr = createSpeakingTracker({
    onSpeaking: (e) => log.push(`speaking:${e.source}`),
    onIdle: (reason) => log.push(`idle:${reason}`),
    now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer,
    ...opts,
  });
  return { tr, log };
}

// ── 1. the signal ───────────────────────────────────────────────────────────
_resetForTests();
{
  const seen = [];
  const off = onSpeechSignal((e) => seen.push(`${e.type}:${e.id ?? ''}:${e.reason ?? ''}`));
  const a = speechStarted({ source: 'aaria', durationMs: 3000 });
  eq('start is announced', seen, [`start:${a}:`]);
  eq('active speech is reported', activeSpeech()?.id, a);
  eq('end returns true', speechEnded(a, 'ended'), true);
  eq('end is announced with its reason', seen[1], `end:${a}:ended`);
  eq('ending twice does nothing', speechEnded(a, 'ended'), false);
  eq('nothing active after end', activeSpeech(), null);

  const b = speechStarted({ source: 'aaria' });
  const c = speechStarted({ source: 'browser' });
  eq('a new start ends the older speech first', seen.slice(2), [`start:${b}:`, `end:${b}:superseded`, `start:${c}:`]);
  eq('an old id cannot end the newer speech', speechEnded(b, 'ended'), false);
  eq('newer speech still active', activeSpeech()?.id, c);
  speechEnded(c);

  speechSkipped('talkback_off');
  eq('skipped is announced', seen[seen.length - 1], 'skipped::talkback_off');

  off();
  speechStarted({});
  eq('unsubscribed listener hears nothing more', seen[seen.length - 1], 'skipped::talkback_off');
}
_resetForTests();
{
  // One broken listener must not stop the others.
  let heard = 0;
  onSpeechSignal(() => { throw new Error('boom'); });
  onSpeechSignal(() => { heard++; });
  const warn = console.warn; console.warn = () => { };
  const id = speechStarted({}); speechEnded(id);
  console.warn = warn;
  eq('a throwing listener does not block the rest', heard, 2);
}

// ── 2. the tracker ──────────────────────────────────────────────────────────
// Short, medium and long replies: the state ends WITH the sound, whatever the
// length. The old timer capped at 9 s and so ended a 14 s reply 5 s early.
for (const [label, ms] of [['short (1.2 s)', 1200], ['medium (5 s)', 5000], ['long (14 s)', 14000]]) {
  _resetForTests();
  const clock = fakeClock();
  const { tr, log } = tracker(clock);
  tr.expect();
  clock.advance(800);                       // the voice is being fetched
  eq(`${label}: not speaking before the first sound`, log, []);
  const id = speechStarted({ source: 'aaria', durationMs: ms });
  eq(`${label}: speaking at the first sound`, log, ['speaking:aaria']);
  clock.advance(ms - 1);
  eq(`${label}: still speaking 1 ms before the sound ends`, log.length, 1);
  clock.advance(1);
  speechEnded(id, 'ended');
  eq(`${label}: idle the moment the sound ends`, log, ['speaking:aaria', 'idle:ended']);
  clock.advance(60000);
  eq(`${label}: no late second idle from a safety net`, log.length, 2);
  eq(`${label}: no timer left behind`, clock.pending(), 0);
  tr.dispose();
}

_resetForTests();
{
  // Speech nobody asked the dock to show (a greeting, a reminder) is ignored.
  const clock = fakeClock(); const { tr, log } = tracker(clock);
  const id = speechStarted({ source: 'aaria' }); speechEnded(id);
  eq('speech without expect() changes nothing', log, []);
  tr.dispose();
}
_resetForTests();
{
  // Voice replies switched off: speak() reports "skipped" at once.
  const clock = fakeClock(); const { tr, log } = tracker(clock);
  tr.expect(); speechSkipped('talkback_off');
  eq('skipped reply goes idle at once', log, ['idle:talkback_off']);
  clock.advance(60000);
  eq('skipped reply leaves no timer', [log.length, clock.pending()], [1, 0]);
  tr.dispose();
}
_resetForTests();
{
  // The same sentence twice within 1.5 s: the second is skipped while the
  // first is still audible. The dock must keep showing the first.
  const clock = fakeClock(); const { tr, log } = tracker(clock);
  tr.expect(); const id = speechStarted({ source: 'aaria', durationMs: 4000 });
  tr.expect(); speechSkipped('duplicate');
  eq('duplicate does not go idle under a reply still audible', log, ['speaking:aaria']);
  speechEnded(id, 'ended');
  eq('and it still ends with that reply', log, ['speaking:aaria', 'idle:ended']);
  tr.dispose();
}
_resetForTests();
{
  // Reply B replaces reply A. A's ending must not switch B's state off - the
  // old timer did exactly that.
  const clock = fakeClock(); const { tr, log } = tracker(clock);
  tr.expect(); const a = speechStarted({ source: 'aaria', durationMs: 8000 });
  clock.advance(1000);
  tr.expect();                                 // say(B)
  speechEnded(a, 'interrupted');               // A's audio is paused
  eq('old reply ending while a new one is awaited is not idle', log, ['speaking:aaria']);
  const b = speechStarted({ source: 'aaria', durationMs: 2000 });
  clock.advance(2000); speechEnded(b, 'ended');
  eq('new reply runs start to end', log, ['speaking:aaria', 'speaking:aaria', 'idle:ended']);
  clock.advance(60000);
  eq("A's safety net never fires on B", log.length, 3);
  tr.dispose();
}
_resetForTests();
{
  // Safety net 1: nothing ever sounds.
  const clock = fakeClock(); const { tr, log } = tracker(clock);
  tr.expect(); clock.advance(5999);
  eq('no idle before 6 s of silence', log, []);
  clock.advance(1);
  eq('idle after 6 s with no sound', log, ['idle:no_sound']);
  // ...but a slow voice that arrives later is still shown.
  clock.advance(4000);
  const id = speechStarted({ source: 'aaria', durationMs: 1000 });
  eq('a late voice is still shown', log, ['idle:no_sound', 'speaking:aaria']);
  speechEnded(id); tr.dispose();
}
_resetForTests();
{
  // ...and a start long after that belongs to something else.
  const clock = fakeClock(); const { tr, log } = tracker(clock);
  tr.expect(); clock.advance(6000 + 30001);
  const id = speechStarted({ source: 'aaria' });
  eq('a start 36 s later is not this reply', log, ['idle:no_sound']);
  speechEnded(id); tr.dispose();
}
_resetForTests();
{
  // Safety net 2: the sound's "ended" never arrives.
  const clock = fakeClock(); const { tr, log } = tracker(clock);
  tr.expect(); speechStarted({ source: 'aaria', durationMs: 3000 });
  clock.advance(4999);
  eq('no overrun before length + 2 s', log, ['speaking:aaria']);
  clock.advance(1);
  eq('idle at length + 2 s when no end arrives', log, ['speaking:aaria', 'idle:overrun']);
  tr.dispose();
}
_resetForTests();
{
  // The phone's system voice: the end is an estimate and arrives by itself;
  // the tracker adds no second timer on top of it.
  const clock = fakeClock(); const { tr, log } = tracker(clock);
  tr.expect(); const id = speechStarted({ source: 'native', estimated: true, durationMs: 3000 });
  eq('system voice shows speaking', log, ['speaking:native']);
  eq('no overrun timer for an estimated end', clock.pending(), 0);
  speechEnded(id, 'estimated');
  eq('system voice ends on its estimate', log, ['speaking:native', 'idle:estimated']);
  tr.dispose();
}
_resetForTests();
{
  // Stopped by hand.
  const clock = fakeClock(); const { tr, log } = tracker(clock);
  tr.expect(); const id = speechStarted({ source: 'aaria', durationMs: 9000 });
  speechEnded(id, 'interrupted');
  eq('an interruption ends the state at once', log, ['speaking:aaria', 'idle:interrupted']);
  tr.expect(); tr.cancel(); clock.advance(60000);
  eq('cancel() forgets an awaited reply silently', log.length, 2);
  tr.dispose();
  const after = speechStarted({}); speechEnded(after);
  eq('a disposed tracker hears nothing', log.length, 2);
}

// ── 3a. tts.js with a fake <audio> ──────────────────────────────────────────
_resetForTests();
{
  const made = [];
  class FakeAudio {
    constructor(url) { this.url = url; this.duration = 2.5; this.ended = false; this.h = {}; made.push(this); }
    addEventListener(type, fn) { (this.h[type] ||= []).push(fn); }
    fire(type) { (this.h[type] || []).forEach((fn) => fn()); if (type === 'ended') this.onended?.(); if (type === 'error') this.onerror?.(); }
    play() { return Promise.resolve(); }
    pause() { }
  }
  globalThis.window = globalThis.window || {};
  globalThis.Audio = FakeAudio;
  const { playAudioUrl, interruptTTS } = await import('../src/lib/tts.js');

  const seen = [];
  onSpeechSignal((e) => seen.push(`${e.type}:${e.source ?? ''}:${e.reason ?? ''}:${e.durationMs ?? ''}`));

  const p1 = playAudioUrl('blob:one');
  await Promise.resolve();
  eq('asking to play is not yet "started"', seen, []);
  made[0].fire('playing');
  eq('first audible frame announces start with the real length', seen, ['start:aaria::2500']);
  made[0].fire('playing');
  eq('a second "playing" (after buffering) is not a second start', seen.length, 1);
  made[0].ended = true; made[0].fire('pause'); made[0].fire('ended');
  await p1;
  eq('natural end announces end once', seen.slice(1), ['end:aaria:ended:']);

  const p2 = playAudioUrl('blob:two'); p2.catch(() => { });
  made[1].fire('playing');
  interruptTTS(); made[1].fire('pause');      // what the browser does on pause()
  eq('an interrupted reply announces end as interrupted', seen.slice(2), ['start:aaria::2500', 'end:aaria:interrupted:']);

  const p3 = playAudioUrl('blob:three'); p3.catch(() => { });
  made[2].fire('playing'); made[2].fire('error');
  eq('a playback error announces end', seen[seen.length - 1], 'end:aaria:error:');

  const before = seen.length;
  const p4 = playAudioUrl('blob:four'); p4.catch(() => { });
  made[3].fire('error');
  eq('audio that never became audible announces nothing', seen.length, before);
}

// ── 3b. wiring that cannot be imported under plain node (JSX) ───────────────
{
  const aaria = readFileSync(new URL('../src/lib/context/aaria.jsx', import.meta.url), 'utf8');
  const say = aaria.slice(aaria.indexOf('const say = useCallback('), aaria.indexOf('const stopAll = useCallback('));
  eq('say(): the length-guess timer is gone', /length \* 55/.test(aaria), false);
  eq('say(): no setTimeout left inside it', /setTimeout\(/.test(say), false);
  eq("say(): never sets 'speaking' itself", /setStatus\('speaking'\)/.test(say), false);
  eq('say(): expect() comes before speak()', say.indexOf('speakingTracker.expect()') > 0
    && say.indexOf('speakingTracker.expect()') < say.indexOf('speak(String(text)'), true);
  eq('say(): still tells the microphone hand-over she is about to speak', /holdForSpeech\(text\)/.test(say), true);
  // Thread 1's microphone hand-over: untouched by this change.
  eq('hand-over estimate unchanged', aaria.includes('const est = Math.min(20000, 1200 + String(text || \'\').length * 75);'), true);
  eq('follow-up wait unchanged', aaria.includes('if (isSpeaking() && waited < 25000) return;'), true);

  const vt = readFileSync(new URL('../src/components/VoiceTalkback.jsx', import.meta.url), 'utf8');
  eq('talkback off reports skipped', vt.includes("if (!voiceEnabled) { speechSkipped('talkback_off'); return; }"), true);
  eq('duplicate reports skipped', vt.includes("speechSkipped('duplicate')"), true);
  eq('browser voice reports its real start', vt.includes("utter.onstart = () => { signalId = speechStarted({ source: 'browser' }); };"), true);
  eq('browser voice reports its real end', vt.includes("utter.onend = () => { signalEnd('ended'); endSpeech(token); };"), true);
  eq('system voice still speaks through the bridge', vt.includes('window.__QK_TTS__(String(text));'), true);
  eq('system voice end is marked as an estimate', vt.includes("speechStarted({ source: 'native', estimated: true, durationMs: est })"), true);
  eq('stop ends the system voice state', vt.includes("endNativeSignal('interrupted');"), true);

  const fillers = readFileSync(new URL('../src/lib/fillers.js', import.meta.url), 'utf8');
  eq('thinking sounds do not announce speech', /speech-signal/.test(fillers), false);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
