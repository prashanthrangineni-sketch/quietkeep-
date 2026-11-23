// tests/avatar-mouth-volume.test.mjs
// 23 Nov 2026: with the face on, Aaria's reply was quiet on the founder's
// Android phone at full volume. On the Android app the face must not route her
// voice through Web Audio; on the web it still may.
import { register } from 'node:module';
register('./loader.mjs', import.meta.url);

let pass = 0, fail = 0;
function check(name, ok, details = '') {
  if (ok) { console.log(`PASS  ${name}`); pass++; }
  else { console.error(`FAIL  ${name} ${details ? '- ' + details : ''}`); fail++; }
}

let routed = 0;
class FakeCtx {
  constructor() { this.state = 'running'; this.sampleRate = 48000; this.destination = {}; }
  async resume() {}
  createMediaElementSource() { routed++; return { connect() {} }; }
  createAnalyser() { return { fftSize: 0, frequencyBinCount: 4, connect() {}, getByteFrequencyData() {} }; }
}

globalThis.window = { AudioContext: FakeCtx, Capacitor: { isNativePlatform: () => true, getPlatform: () => 'android' } };
const { attachMouth } = await import('../src/lib/avatar/mouth.js');

const onApp = await attachMouth({ id: 'a1' });
check('1: on the Android app the voice is NOT routed through the face', onApp === null && routed === 0, `routed=${routed}`);

globalThis.window.Capacitor = { isNativePlatform: () => false, getPlatform: () => 'web' };
const onWeb = await attachMouth({ id: 'a2' });
check('2: on the web the face can still read the voice', !!onWeb && routed === 1, `routed=${routed}`);

delete globalThis.window.Capacitor;
const plain = await attachMouth({ id: 'a3' });
check('3: a browser without the app bridge behaves like the web', !!plain);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
