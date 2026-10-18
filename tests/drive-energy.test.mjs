// tests/drive-energy.test.mjs - DRV-11b page half: the energy envelope for the
// indicator detector, the microphone hand-off, and that only numbers arrive.
import { listenEnergy, ENERGY_HZ, MAX_SECONDS } from '../src/lib/drive-energy.js';
import { detectIndicatorSound } from '../src/lib/indicator-sound.js';

let pass = 0, fail = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  ${detail}`}`);
  ok ? pass++ : fail++;
}

class FakeWin {
  constructor() { this.l = {}; this.sent = []; }
  addEventListener(n, f) { (this.l[n] ||= []).push(f); }
  removeEventListener(n, f) { this.l[n] = (this.l[n] || []).filter((x) => x !== f); }
  dispatchEvent(e) { this.sent.push(e.type); (this.l[e.type] || []).slice().forEach((f) => f(e)); return true; }
}
globalThis.CustomEvent ||= class { constructor(t) { this.type = t; } };

// A fake IndicatorEar that plays back a given envelope in 100 ms events.
function fakeEar(envelope, { endReason = 'done', failStart = false } = {}) {
  const ls = {};
  const ear = {
    started: null, stopped: false,
    async addListener(n, f) { ls[n] = f; return { remove: async () => { delete ls[n]; } }; },
    async start({ seconds }) {
      if (failStart) throw new Error('microphone_permission_missing');
      ear.started = seconds;
      setTimeout(() => {
        for (let i = 0; i < envelope.length; i += 10) {
          if (ear.stopped) break;
          ls.energy?.({ frames: envelope.slice(i, i + 10), hz: 100, t: i });
        }
        ls.ended?.({ reason: ear.stopped ? 'stopped' : endReason });
      }, 5);
      return { seconds, hz: 100 };
    },
    stop() { ear.stopped = true; },
  };
  return ear;
}

// 5 s of a 1.5 Hz click at 100 frames/s: quiet floor, short loud clicks.
const clicks = Array.from({ length: 500 }, (_, i) => (i % 67 < 3 ? 0.5 : 0.01));

{
  const w = new FakeWin();
  const ear = fakeEar(clicks);
  const r = await listenEnergy({ seconds: 5, plugin: ear, win: w, settleMs: 0 });
  check('energies arrive at 100 per second', r.ok && r.hz === ENERGY_HZ && r.energies.length === 500, JSON.stringify({ ok: r.ok, n: r.energies.length, reason: r.reason }));
  check('only numbers arrive', r.energies.every((v) => typeof v === 'number' && v >= 0));
  check('the indicator detector hears the 1.5 Hz click from them', detectIndicatorSound(r.energies, { frameRate: r.hz }).on === true);
  check('wake listener told to give the mic up, then given it back', w.sent[0] === 'qk_mic_claim' && w.sent.at(-1) === 'qk_mic_release', JSON.stringify(w.sent));
  check('asked for the seconds requested', ear.started === 5);
}
{
  const ear = fakeEar(clicks);
  await listenEnergy({ seconds: 60, plugin: ear, win: new FakeWin(), settleMs: 0 });
  check(`never more than ${MAX_SECONDS} s`, ear.started === MAX_SECONDS);
}
{
  const w = new FakeWin();
  const ear = fakeEar(Array(500).fill(0.01));
  const p = listenEnergy({ seconds: 5, plugin: ear, win: w, settleMs: 0 });
  await new Promise((r) => setTimeout(r, 1));
  w.dispatchEvent(new CustomEvent('qk_mic_claim'));   // a voice command needs the mic
  const r = await p;
  check('a voice command claiming the mic stops the listen and wins', r.ok === false && r.reason === 'mic_needed_elsewhere' && ear.stopped === true, JSON.stringify(r));
  check('...and the mic is still released afterwards', w.sent.at(-1) === 'qk_mic_release');
}
{
  const w = new FakeWin();
  const r = await listenEnergy({ seconds: 5, plugin: fakeEar([], { failStart: true }), win: w, settleMs: 0 });
  check('no microphone permission: an honest reason, nothing heard', r.ok === false && r.reason === 'microphone_permission_missing');
  check('...and the wake listener gets the mic back', w.sent.at(-1) === 'qk_mic_release');
}
{
  const r = await listenEnergy({ seconds: 5, plugin: fakeEar([], { endReason: 'microphone_unavailable' }), win: new FakeWin(), settleMs: 0 });
  check('microphone busy/unavailable is reported, not hidden', r.ok === false && r.reason === 'microphone_unavailable');
}
{
  // with the real settle wait: a claim during the wait cancels before the mic opens
  const w = new FakeWin(); const ear = fakeEar(clicks);
  const p = listenEnergy({ seconds: 5, plugin: ear, win: w, settleMs: 50 });
  await new Promise((r) => setTimeout(r, 10));
  w.dispatchEvent(new CustomEvent('qk_mic_claim'));
  const r = await p;
  check('a claim during the settle wait means the mic is never opened', r.ok === false && ear.started === null, JSON.stringify(r));
}
{
  const r = await listenEnergy({ seconds: 5, win: new FakeWin() });
  check('in a browser (no native plugin): not_on_phone', r.ok === false && r.reason === 'not_on_phone');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
