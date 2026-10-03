// Runs the wake-word part of the JS that MainActivity injects, against a pretend Aaria Edge plugin, and
// checks what it does with the microphone. Guards three promises:
//   1. a bare wake gives the microphone to QuietKeep, and listening starts again when QuietKeep is done;
//   2. a wake that carries a one-breath command hands over the words and does not touch the microphone;
//   3. listening is never restarted after the person turned it off.
import fs from 'fs';
import path from 'path';

const file = path.join('android', 'app', 'src', 'main', 'java', 'com', 'pranix', 'quietkeep', 'MainActivity.java');
const content = fs.readFileSync(file, 'utf8');
const start = content.indexOf('String js = "javascript:(function() {');
const end = content.indexOf('view.evaluateJavascript(js, null);', start);
if (start === -1 || end === -1) { console.error('Could not find the injected JS.'); process.exit(1); }
let src = '';
for (let line of content.substring(start, end).split('\n')) {
  line = line.trim();
  if (line.startsWith('+ "') || line.startsWith('String js = "')) {
    let str = line.substring(line.indexOf('"') + 1);
    str = str.substring(0, str.lastIndexOf('"'));
    str = str.replace(/\\"/g, '"');
    try { str = JSON.parse('"' + str.replace(/"/g, '\\"') + '"'); } catch (e) {}
    src += str;
  }
}
src = src.replace(/^javascript:/, '').replace(/;\s*$/, '');

const tick = () => new Promise((r) => setTimeout(r, 5));
let failed = 0;
const ok = (cond, what) => { if (!cond) { failed++; console.error('FAILED: ' + what); } else { console.log('ok   ' + what); } };

async function world({ acceptsText = false, mode = 'counter', listening = true } = {}) {
  const st = { listening, starts: 0, stops: 0, wakes: [], mode };
  const pluginListeners = {};
  const domListeners = {};
  const aaria = {
    isBackgroundListening: async () => ({ listening: st.listening, paused: false }),
    stopBackgroundListening: async () => { st.stops++; st.listening = false; },
    startBackgroundListening: async () => { st.starts++; st.listening = true; },
    setWakeName: async () => {},
    requestPermissions: async () => ({ microphone: 'granted' }),
    addListener: (name, fn) => { pluginListeners[name] = fn; },
  };
  const window = {
    Capacitor: { Plugins: { AariaEdge: aaria } },
    localStorage: { getItem: (k) => (k === 'qk_wake_mode_v2' ? st.mode : null) },
    addEventListener: (name, fn) => { (domListeners[name] = domListeners[name] || []).push(fn); },
    fetch: () => {},
    location: { href: '' },
    __qkOnWake: function () { st.wakes.push(Array.from(arguments)); },
  };
  if (acceptsText) window.__qkOnWakeAcceptsText = true;
  new Function('window', 'console', 'return ' + src)(window, { log() {}, warn() {}, error() {} });
  const fire = async (name) => { (domListeners[name] || []).forEach((fn) => fn()); await tick(); };
  const wake = async (ev) => { await pluginListeners.wakeWord(ev); await tick(); };
  return { st, window, fire, wake };
}

{
  const w = await world();
  await w.wake({ id: 'asr_wakeword', score: 1, t: 1, hasCommand: false });
  ok(w.st.stops === 1 && !w.st.listening, 'bare wake: the microphone is given to QuietKeep');
  ok(w.st.wakes.length === 1 && w.st.wakes[0][0] === 'aaria_edge' && w.st.wakes[0].length === 1, 'bare wake: QuietKeep is told, with no text');
  await w.fire('qk_mic_release');
  ok(w.st.starts === 1 && w.st.listening, 'bare wake: listening starts again when QuietKeep frees the microphone');
  await w.fire('qk_mic_release');
  ok(w.st.starts === 1, 'a second "free" signal does not start it twice');
}
{
  const w = await world({ acceptsText: true });
  await w.wake({ id: 'asr_wakeword', score: 1, t: 1, hasCommand: true, text: 'remind me to call home at five' });
  ok(w.st.stops === 0 && w.st.listening, 'one breath: the microphone is not touched');
  ok(w.st.wakes.length === 1 && w.st.wakes[0][1] && w.st.wakes[0][1].text === 'remind me to call home at five', 'one breath: the words are handed to QuietKeep');
}
{
  const w = await world({ acceptsText: false });
  await w.wake({ id: 'asr_wakeword', score: 1, t: 1, hasCommand: true, text: 'remind me' });
  ok(w.st.stops === 1 && w.st.wakes.length === 1 && w.st.wakes[0].length === 1, 'one breath, but QuietKeep has no receiver yet: treated as a bare wake');
}
{
  const w = await world();
  await w.wake({ hasCommand: false });
  await w.window.__QK_WAKE__.stopHotword();
  await w.fire('qk_mic_release');
  ok(w.st.starts === 0 && !w.st.listening, 'turned off by the person after a wake: not restarted');
}
{
  const w = await world();
  await w.wake({ hasCommand: false });
  w.st.mode = 'manual';
  await w.fire('qk_mic_release');
  ok(w.st.starts === 0, 'hands-free switched off in settings after a wake: not restarted');
}
{
  const w = await world({ listening: false });
  await w.fire('qk_mic_claim');
  await w.fire('qk_mic_release');
  ok(w.st.stops === 0 && w.st.starts === 0, 'listening was off: a "free" signal never turns it on');
}
{
  const w = await world();
  await w.fire('qk_mic_claim');
  ok(w.st.stops === 1 && !w.st.listening, 'QuietKeep asks for the microphone (tap on the mic): it is given');
  await w.fire('qk_mic_release');
  ok(w.st.starts === 1 && w.st.listening, 'and listening starts again afterwards');
}
if (failed) { console.error(failed + ' check(s) failed'); process.exit(1); }
console.log('All wake-bridge checks passed.');
