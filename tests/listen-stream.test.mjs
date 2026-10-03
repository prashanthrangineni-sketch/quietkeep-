// tests/listen-stream.test.mjs - one listening turn through the engine, with a
// fake socket, a fake microphone and a hand-driven clock. Plain node.
import {
  downsampleTo16k, floatToPcm16, createFramer, createLoudness, cleanKeyterms,
  listenStreamWanted, setListenStreamWanted, startListenStream, streamingSupported,
  cleanListenEvidence,
  READY_TIMEOUT_MS, FRAME_SAMPLES,
} from '../src/lib/listen-stream.js';

let pass = 0, fail = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  ${detail}`}`);
  ok ? pass++ : fail++;
}
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

// ── pure pieces ──────────────────────────────────────────────────────────────
check('48 kHz becomes 16 kHz (a third as many samples)', downsampleTo16k(new Float32Array(4800), 48000).length === 1600);
check('16 kHz is passed through untouched', downsampleTo16k(new Float32Array(10), 16000).length === 10);
{
  const p = floatToPcm16(new Float32Array([0, 1, -1, 2, -2]));
  check('float → 16-bit, clipped', p[0] === 0 && p[1] === 32767 && p[2] === -32768 && p[3] === 32767 && p[4] === -32768);
}
{
  const f = createFramer(4);
  const a = f.push(new Float32Array(6)), b = f.push(new Float32Array(3));
  check('framer cuts fixed frames and keeps the remainder', a.length === 1 && b.length === 1);
}
{
  const l = createLoudness();
  [0.001, 0.002, 0.001].forEach((v) => l.isSpeech(v));
  check('quiet room is not speech; a voice is', !l.isSpeech(0.003) && l.isSpeech(0.2));
}
{
  // THE BUG OF 2 OCTOBER: tap and speak at once, so there is no quiet lead-in.
  // A sentence is loud syllables with short dips between words. Count the
  // longest run of frames NOT judged speech while the person is talking: it
  // must stay far below the 13-frame (1.3 s) silence wait.
  const l = createLoudness();
  const sentence = [];
  for (let i = 0; i < 35; i++) sentence.push(i % 4 === 3 ? 0.012 : 0.07 + (i % 3) * 0.02);
  let gap = 0, worst = 0;
  for (const v of sentence) { if (l.isSpeech(v)) gap = 0; else { gap++; worst = Math.max(worst, gap); } }
  check('speaking from the first instant is never mistaken for 1.3 s of silence', worst <= 4, `worst gap ${worst} frames`);
  let after = 0;
  for (let i = 0; i < 14; i++) if (l.isSpeech(0.002)) after++;
  check('…and the quiet afterwards is still heard as quiet', after === 0);
}
{
  const l = createLoudness();
  for (let i = 0; i < 10; i++) l.isSpeech(0.002);
  check('a soft voice in a quiet room counts', l.isSpeech(0.012));
  const n = createLoudness();
  for (let i = 0; i < 10; i++) n.isSpeech(0.03);
  check('a steady noisy room is not speech; a voice over it is', !n.isSpeech(0.035) && n.isSpeech(0.12));
}
{
  const e = cleanListenEvidence({ path: 'engine', finaliseMs: 512.4, stopReason: 'silence', junk: { a: 1 }, reason: 'x'.repeat(200) });
  check('listening evidence is trimmed to known small fields', e.path === 'engine' && e.finaliseMs === 512.4 && e.stopReason === 'silence' && !('junk' in e) && e.reason.length === 80);
  check('no path → nothing kept', cleanListenEvidence({ finaliseMs: 3 }) === null && cleanListenEvidence('x') === null);
}
{
  const k = cleanKeyterms(['Surya Kiran', 'surya kiran', ' ', 'Venu', 'x'.repeat(80)]);
  check('names de-duplicated, blanks and junk dropped', k.length === 2 && k[0] === 'Surya Kiran' && k[1] === 'Venu');
}
{
  const store = new Map(); const s = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  const before = listenStreamWanted(s);
  setListenStreamWanted(false, s);
  check('on by default; the switch turns it off', before === true && listenStreamWanted(s) === false);
}
check('no browser → not supported', streamingSupported({}) === false);

// ── fakes ────────────────────────────────────────────────────────────────────
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

function makeWorld({ micFails = false } = {}) {
  const clock = makeClock();
  const sent = [];
  let sock = null, proc = null;
  class FakeWS {
    constructor(url) { this.url = url; this.readyState = 0; sock = this; setTimeout(() => { this.readyState = 1; this.onopen?.(); }, 0); }
    send(d) { sent.push(d); }
    close() { this.readyState = 3; }
  }
  class FakeAC {
    constructor() { this.sampleRate = 16000; this.destination = {}; }
    createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
    createScriptProcessor() { proc = { connect() {}, disconnect() {}, onaudioprocess: null }; return proc; }
    close() {}
  }
  const tracks = [{ stopped: false, stop() { this.stopped = true; } }];
  const deps = {
    WebSocket: FakeWS, AudioContext: FakeAC, url: 'wss://test',
    getUserMedia: async () => { if (micFails) { const e = new Error('no'); e.name = 'NotAllowedError'; throw e; } return { getTracks: () => tracks }; },
    setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout, now: clock.now,
  };
  return {
    clock, sent, deps, tracks,
    engine: (msg) => sock.onmessage?.({ data: JSON.stringify(msg) }),
    closeSocket: () => sock.onclose?.(),
    speak: (level = 0.3) => proc.onaudioprocess?.({ inputBuffer: { getChannelData: () => new Float32Array(FRAME_SAMPLES).fill(level) } }),
    hush: () => proc.onaudioprocess?.({ inputBuffer: { getChannelData: () => new Float32Array(FRAME_SAMPLES).fill(0.001) } }),
    json: () => sent.filter((d) => typeof d === 'string').map((d) => JSON.parse(d)),
    audioFrames: () => sent.filter((d) => typeof d !== 'string').length,
  };
}
const outcome = (p) => p.then((v) => ({ ok: true, v }), (e) => ({ ok: false, e }));

// ── a whole turn ─────────────────────────────────────────────────────────────
{
  const w = makeWorld();
  const partials = [];
  let live = 0;
  const s = startListenStream({ lang: 'te-IN', keyterms: ['Surya Kiran'], silenceMs: 1300, onPartial: (t) => partials.push(t), onLive: () => { live++; }, deps: w.deps });
  const res = outcome(s.result);
  await new Promise((r) => setTimeout(r, 5)); await flush();
  const start = w.json()[0];
  check('start says Telugu, manual stop, with the names', start?.event === 'start' && start.lang === 'te' && start.endpointing === 'manual' && start.keyterms?.[0] === 'Surya Kiran');
  w.hush(); w.hush(); w.hush(); // learn the room
  w.speak(); w.speak();          // spoken BEFORE the engine is ready
  check('audio before "ready" is held, not sent', w.audioFrames() === 0);
  check('"the mic is open" is announced once, on the first audio', live === 1);
  w.engine({ event: 'ready' });
  check('held audio goes out the moment the engine is ready', w.audioFrames() === 5);
  w.clock.advance(300);
  w.engine({ event: 'partial', text: 'Surya Kiran ki' });
  w.engine({ event: 'final', text: 'Surya Kiran ki call cheyyi' });
  w.speak();
  w.clock.advance(1299);
  check('still listening inside the silence wait', !w.json().some((m) => m.event === 'stop'));
  w.clock.advance(2);
  check('silence wait over → "stop" sent', w.json().some((m) => m.event === 'stop'));
  check('microphone released when the person stops', w.tracks[0].stopped);
  w.clock.advance(500);
  w.engine({ event: 'done', text: 'Surya Kiran ki call cheyyi' });
  const r = await res;
  check('turn returns the finished sentence', r.ok && r.v.text === 'Surya Kiran ki call cheyyi', JSON.stringify(r));
  check('finalise time measured from "stop"', r.ok && r.v.finaliseMs === 501);
  check('words shown while speaking', partials[0] === 'Surya Kiran ki');
}

// ── the founder's sentence, spoken the moment the mic opens ──────────────────
{
  const w = makeWorld();
  const s = startListenStream({ lang: 'te-IN', silenceMs: 1400, deps: w.deps });
  const res = outcome(s.result);
  await new Promise((r) => setTimeout(r, 5)); await flush();
  w.engine({ event: 'ready' });
  // 3.6 s of speech, no quiet lead-in, one frame every 100 ms.
  for (let i = 0; i < 36; i++) { (i % 4 === 3) ? w.speak(0.012) : w.speak(0.08); w.clock.advance(100); }
  check('a 3.6 s sentence is not cut off part-way', !w.json().some((m) => m.event === 'stop'));
  for (let i = 0; i < 11; i++) { w.hush(); w.clock.advance(100); }
  check('…still waiting just inside the silence wait', !w.json().some((m) => m.event === 'stop'));
  for (let i = 0; i < 3; i++) { w.hush(); w.clock.advance(100); }
  check('…and stops once the person really has stopped', w.json().some((m) => m.event === 'stop'));
  w.engine({ event: 'done', text: 'Remind me to buy milk when I reach Mansoorabad' });
  const r = await res;
  check('the whole sentence comes back, with why the turn ended', r.ok && /Mansoorabad/.test(r.v.text) && r.v.stopReason === 'silence' && r.v.heardMs >= 3600, JSON.stringify(r.v));
}

// ── the engine is asleep: fall back ──────────────────────────────────────────
{
  const w = makeWorld();
  const s = startListenStream({ lang: 'en', silenceMs: 900, deps: w.deps });
  const res = outcome(s.result);
  await new Promise((r) => setTimeout(r, 5)); await flush();
  w.clock.advance(READY_TIMEOUT_MS + 1);
  const r = await res;
  check('no "ready" in time → fall back to the phone listener', !r.ok && r.e.fallback === true && r.e.lostSpeech === false, JSON.stringify(r.e));
}

// ── spoke, but the engine never got ready: fall back AND ask again ───────────
{
  const w = makeWorld();
  const s = startListenStream({ lang: 'en', silenceMs: 900, deps: w.deps });
  const res = outcome(s.result);
  await new Promise((r) => setTimeout(r, 5)); await flush();
  w.hush(); w.hush(); w.hush(); w.speak();
  w.clock.advance(READY_TIMEOUT_MS + 1);
  const r = await res;
  check('words were lost → fall back and say "say that again"', !r.ok && r.e.fallback === true && r.e.lostSpeech === true);
}

// ── the engine refuses ───────────────────────────────────────────────────────
{
  const w = makeWorld();
  const s = startListenStream({ lang: 'hi', silenceMs: 1400, deps: w.deps });
  const res = outcome(s.result);
  await new Promise((r) => setTimeout(r, 5)); await flush();
  w.engine({ event: 'error', fatal: true, detail: 'this origin may not open a listening socket' });
  const r = await res;
  check('engine refusal → fall back', !r.ok && r.e.fallback === true && /origin/.test(r.e.reason));
}

// ── words heard, then the line drops: keep the words ─────────────────────────
{
  const w = makeWorld();
  const s = startListenStream({ lang: 'te', silenceMs: 1300, deps: w.deps });
  const res = outcome(s.result);
  await new Promise((r) => setTimeout(r, 5)); await flush();
  w.engine({ event: 'ready' });
  w.engine({ event: 'final', text: 'remind me at 9' });
  w.closeSocket();
  const r = await res;
  check('dropped line after words → the words are kept', r.ok && r.v.text === 'remind me at 9');
}

// ── tapped stop before saying anything ───────────────────────────────────────
{
  const w = makeWorld();
  const s = startListenStream({ lang: 'en', silenceMs: 900, deps: w.deps });
  const res = outcome(s.result);
  await new Promise((r) => setTimeout(r, 5)); await flush();
  w.engine({ event: 'ready' });
  s.stop();
  const r = await res;
  check('stop before speaking → just stops (no fallback listening)', !r.ok && r.e.fallback === false);
}

// ── microphone blocked ───────────────────────────────────────────────────────
{
  const w = makeWorld({ micFails: true });
  const s = startListenStream({ lang: 'en', silenceMs: 900, deps: w.deps });
  const r = await outcome(s.result);
  check('microphone blocked → fall back', !r.ok && r.e.fallback === true && r.e.reason === 'microphone blocked');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
