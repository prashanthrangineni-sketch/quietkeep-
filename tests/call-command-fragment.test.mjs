// tests/call-command-fragment.test.mjs - "call Surya" must call, not ask again.
//
// 29 October 2026: the founder said "call Surya" (and similar) and Aaria
// replied "I caught only part of that" each time. The audit log shows why:
// the short-command guard saw 0.2-0.6 s of speech for each turn.
//   14:53:13  "సూర్య."          speech_ms 200  heard_ms 1200
//   14:53:28  "వినయ్."          speech_ms 600  heard_ms 3200
//   14:54:27  "Please Remind."  speech_ms 600  heard_ms 1600
// Two causes, two fixes, both proved here with the same fakes the
// listen-stream tests use:
//   A. the microphone did not count words said before the first quiet frame;
//   B. a call command is short by nature, and the guard treated it like a
//      fragment.
import { isFragment, isCallCommand, FRAGMENT_SPEECH_MS } from '../src/lib/fragment-guard.js';
import { createLoudness, startListenStream, cleanListenEvidence, FRAME_SAMPLES } from '../src/lib/listen-stream.js';
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
function check(name, ok, detail = '') {
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (ok ? '' : '  ' + detail));
  ok ? pass++ : fail++;
}
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

// ── B. the guard lets a call command through ────────────────────────────────
for (const t of ['call Surya', 'Call Surya.', 'Surya ki call cheyyi', 'Surya ko call karo', 'సూర్యకి కాల్ చెయ్యి',
  'సూర్య కి కాల్ చెయ్యి', 'सूर्या को कॉल करो', 'phone Vinay', 'please call Amma now', 'Dial Venu']) {
  for (const ms of [200, 600, 1400]) {
    check('"' + t + '" at ' + ms + ' ms is not a fragment', !isFragment({ listen: { speechMs: ms }, text: t }));
  }
}
// What the guard was built for is still caught.
for (const t of ['Surya Exactly', 'I mean,', 'Please Remind.', 'సూర్య.', 'call', 'కాల్ చెయ్యి', 'call karo', '']) {
  check('"' + t + '" at 600 ms is still asked again', isFragment({ listen: { speechMs: 600 }, text: t }));
}
check('no text passed: same as before (short = fragment)', isFragment({ listen: { speechMs: 600 } }));
check('long speech is never a fragment', !isFragment({ listen: { speechMs: FRAGMENT_SPEECH_MS }, text: 'Surya Exactly' }));
check('answer turns are never a fragment', !isFragment({ listen: { speechMs: 200 }, answering: true, text: 'Ravi' }));
check('isCallCommand needs a name, not just the verb', isCallCommand('call Surya') && !isCallCommand('call') && !isCallCommand('Surya'));

// The capture route passes the sentence to the guard.
const route = readFileSync(new URL('../src/app/api/voice/capture/route.js', import.meta.url), 'utf8');
check('capture route gives the guard the sentence', /isFragment\(\{ listen: listenEvidence, answering: body\.answering === true, text \}\)/.test(route));

// ── A. words said before the first quiet frame are counted ─────────────────
{
  // Voice from the first frame (no quiet lead-in), then a quiet room.
  const l = createLoudness();
  let live = 0;
  const turn = [0.2, 0.25, 0.22, 0.18, 0.24, 0.21, 0.19, 0.23, 0.0004, 0.0003, 0.0004, 0.0003];
  for (const v of turn) if (l.isSpeech(v)) live++;
  check('live count misses the opening words (the bug)', live < 8, 'live=' + live);
  check('hindsight count finds all 8 voiced frames', l.speechFramesInHindsight() === 8, String(l.speechFramesInHindsight()));
}
{
  const l = createLoudness();
  for (let i = 0; i < 20; i++) l.isSpeech(0.0003);
  check('a silent turn has no speech in hindsight either', l.speechFramesInHindsight() === 0);
}
{
  const l = createLoudness();
  for (let i = 0; i < 10; i++) l.isSpeech(0.03);
  l.isSpeech(0.035);
  check('a steady noisy room is not speech in hindsight', l.speechFramesInHindsight() === 0);
}
check('the live count is logged next to the real one', cleanListenEvidence({ path: 'engine', speechMs: 900, liveSpeechMs: 200 }).liveSpeechMs === 200);

// ── A + B end to end: "call Surya" spoken the moment the mic opens ──────────
function makeClock() {
  let t = 0, id = 0; const q = new Map();
  return {
    now: () => t,
    setTimeout: (fn, ms) => { q.set(++id, { at: t + ms, fn }); return id; },
    clearTimeout: (h) => q.delete(h),
    advance(ms) {
      const end = t + ms;
      for (;;) {
        let next = null;
        for (const [h, e] of q) if (e.at <= end && (!next || e.at < next[1].at)) next = [h, e];
        if (!next) break;
        q.delete(next[0]); t = next[1].at; next[1].fn();
      }
      t = end;
    },
  };
}
function makeWorld() {
  const clock = makeClock();
  let sock = null, proc = null;
  class FakeWS {
    constructor() { this.readyState = 0; sock = this; setTimeout(() => { this.readyState = 1; this.onopen?.(); }, 0); }
    send() {}
    close() { this.readyState = 3; }
  }
  class FakeAC {
    constructor() { this.sampleRate = 16000; this.destination = {}; }
    createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
    createScriptProcessor() { proc = { connect() {}, disconnect() {}, onaudioprocess: null }; return proc; }
    close() {}
  }
  const deps = {
    WebSocket: FakeWS, AudioContext: FakeAC, url: 'wss://test',
    getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }),
    setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout, now: clock.now,
  };
  const frame = (level) => proc.onaudioprocess?.({ inputBuffer: { getChannelData: () => new Float32Array(FRAME_SAMPLES).fill(level) } });
  return { clock, deps, frame, engine: (m) => sock.onmessage?.({ data: JSON.stringify(m) }) };
}
{
  const w = makeWorld();
  const s = startListenStream({ lang: 'te-IN', silenceMs: 1200, deps: w.deps });
  const res = s.result.then((v) => ({ ok: true, v }), (e) => ({ ok: false, e }));
  await new Promise((r) => setTimeout(r, 5)); await flush();
  w.engine({ event: 'ready' });
  // "సూర్యకి కాల్ చెయ్యి": 0.9 s of voice from the very first frame, then quiet.
  for (let i = 0; i < 9; i++) { w.frame(i === 4 ? 0.06 : 0.2); w.clock.advance(100); }
  for (let i = 0; i < 14; i++) { w.frame(0.0003); w.clock.advance(100); }
  w.clock.advance(400);
  w.engine({ event: 'done', text: 'సూర్యకి కాల్ చెయ్యి' });
  w.clock.advance(3000);
  const r = await res;
  check('turn finishes with the sentence', r.ok && r.v.text === 'సూర్యకి కాల్ చెయ్యి', JSON.stringify(r.e || r.v));
  check('speech counted is the 0.9 s actually spoken', r.ok && r.v.speechMs === 900, r.ok && 'speechMs=' + r.v.speechMs + ' live=' + r.v.liveSpeechMs);
  check('…where the old count saw less', r.ok && r.v.liveSpeechMs < r.v.speechMs, r.ok && 'live=' + r.v.liveSpeechMs);
  const listen = r.ok ? cleanListenEvidence({ path: 'engine', ...r.v }) : null;
  check('the capture guard lets this turn through', r.ok && !isFragment({ listen, text: r.v.text }));
}

// ── "I did not hear anything" (31 Oct): voice from the first frame, then quiet,
// and the engine answers only after it is told the person stopped ──────────
{
  const w = makeWorld();
  const sent = [];
  const s = startListenStream({ lang: 'te-IN', silenceMs: 1200, deps: { ...w.deps, WebSocket: class extends w.deps.WebSocket { send(d) { sent.push(d); } } } });
  const res = s.result.then((v) => ({ ok: true, v }), (e) => ({ ok: false, e }));
  await new Promise((r) => setTimeout(r, 5)); await flush();
  w.engine({ event: 'ready' });
  const stopped = () => sent.some((d) => typeof d === 'string' && d.indexOf('"stop"') >= 0);
  for (let i = 0; i < 10; i++) { w.frame(0.2); w.clock.advance(100); }
  let stopAfterMs = null;
  for (let i = 1; i <= 90; i++) {
    w.frame(0.0003); w.clock.advance(100);
    if (stopped()) { stopAfterMs = i * 100; w.engine({ event: 'done', text: 'call Surya' }); break; }
  }
  w.clock.advance(3000);
  const r = await res;
  check('a command said the moment the mic opens ends the turn (not 8 s of waiting)', stopAfterMs !== null && stopAfterMs <= 1500, 'stopAfterMs=' + stopAfterMs);
  check('…and the words come back instead of "I did not hear anything"', r.ok && r.v.text === 'call Surya', JSON.stringify(r.e && r.e.reason));
  check('…with the whole second of voice counted', r.ok && r.v.speechMs === 1000, r.ok && 'speechMs=' + r.v.speechMs);
}
{
  // A silent turn still says "nothing heard" - the look-back never invents speech.
  const w = makeWorld();
  const s = startListenStream({ lang: 'te-IN', silenceMs: 1200, deps: w.deps });
  const res = s.result.then((v) => ({ ok: true, v }), (e) => ({ ok: false, e }));
  await new Promise((r) => setTimeout(r, 5)); await flush();
  w.engine({ event: 'ready' });
  for (let i = 0; i < 90; i++) { w.frame(0.0003); w.clock.advance(100); }
  const r = await res;
  check('a silent turn still ends as "nothing heard"', !r.ok && r.e && r.e.reason === 'nothing heard', JSON.stringify(r));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail) process.exit(1);
