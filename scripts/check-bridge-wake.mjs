// Runs the wake-word part of the JS that MainActivity injects, against a pretend Aaria Edge plugin, and
// checks what it does with the microphone. Guards three promises:
//   1. a bare wake gives the microphone to QuietKeep, and listening starts again when QuietKeep is done;
//   2. a wake that carries a one-breath command hands over the words and does not touch the microphone;
//   3. listening is never restarted after the person turned it off;
//   4. nothing fails silently: when the engine cannot pause, the bridge stops it instead and says so, and a
//      stop that nobody ends is ended after three minutes.
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

// The pretend engine behaves like the real one where it matters:
//  - after a bare wake the real engine reports listening:false (it is waiting for a command, not for the name),
//    although its service is still on and still holds the microphone;
//  - an older engine has no holdMicrophone/releaseMicrophone; 'proxy' gives it the two functions anyway, both
//    refusing, which is what an app-side plugin wrapper does for a method the engine does not have.
async function world({ acceptsText = false, mode = 'counter', on = true, newEngine = false, proxy = false,
                       holdThrows = false, releaseThrows = false, receiver = true } = {}) {
  const st = { on, waiting: on, starts: 0, stops: 0, wakes: [], mode, refuse: '', holds: 0, releases: 0,
               held: false, warns: 0, logs: 0, gate: null, statusGate: null, holdGate: null, holdThrows, releaseThrows,
               stopThrows: false, stopGate: null, statusNever: false, statusEmpty: false, nameThrows: false, timerThrows: false, storageThrows: false, nameGate: null, permGate: null, refuseOnce: '', statusThrows: false, permAsks: 0, enginePaused: false, startsInFlight: 0, maxStartsInFlight: 0 };
  const pluginListeners = {};
  const domListeners = {};
  const timers = [];
  // The real engine takes the app's calls one at a time, in the order they were made. So does this one.
  let queue = Promise.resolve();
  const inTurn = (fn) => () => { const p = queue.then(fn); queue = p.catch(() => {}); return p; };
  const aaria = {
    // statusNever: the question is never answered, and (unlike a gate) the engine goes on taking other calls.
    isBackgroundListening: () => st.statusNever ? new Promise(() => {}) : aaria.statusInTurn(),
    statusInTurn: inTurn(async () => { if (st.statusGate) await st.statusGate; if (st.statusThrows) throw new Error('aaria_unavailable'); if (st.statusEmpty) return st.statusEmpty === true ? null : st.statusEmpty; return { listening: st.on && st.waiting && !st.enginePaused, paused: st.on && st.enginePaused }; }),
    stopBackgroundListening: inTurn(async () => { st.stops++; if (st.stopGate) await st.stopGate; if (st.stopThrows) throw new Error('aaria_unavailable'); st.on = false; st.waiting = false; st.held = false; }),
    startBackgroundListening: () => {
      st.starts++;
      st.startsInFlight++; st.maxStartsInFlight = Math.max(st.maxStartsInFlight, st.startsInFlight);
      return inTurn(async () => {
        try {
          if (st.gate) await st.gate;
          if (st.refuseOnce) { const m = st.refuseOnce; st.refuseOnce = ''; throw new Error(m); }
          if (st.refuse) throw new Error(st.refuse);
          st.on = true; st.waiting = true;
        } finally { st.startsInFlight--; }
      })();
    },
    setWakeName: inTurn(async () => { if (st.nameGate) await st.nameGate; if (st.nameThrows) throw new Error('aaria_unavailable'); }),
    requestPermissions: inTurn(async () => { st.permAsks++; if (st.permGate) await st.permGate; return { microphone: 'granted' }; }),
    addListener: (name, fn) => { pluginListeners[name] = fn; },
  };
  if (newEngine) {
    // The engine that can pause inside its own listening service.
    aaria.holdMicrophone = inTurn(async () => { st.holds++; if (st.holdGate) await st.holdGate; if (st.holdThrows) throw new Error('hold_timer_failed'); st.held = st.on; if (st.on) st.waiting = true; return { held: st.on }; });
    aaria.releaseMicrophone = inTurn(async () => { st.releases++; if (st.releaseThrows) throw new Error('aaria_unavailable'); st.held = false; if (st.on) st.waiting = true; });
  } else if (proxy) {
    aaria.holdMicrophone = inTurn(async () => { st.holds++; throw new Error('"AariaEdge.holdMicrophone()" is not implemented on android'); });
    aaria.releaseMicrophone = inTurn(async () => { st.releases++; throw new Error('"AariaEdge.releaseMicrophone()" is not implemented on android'); });
  }
  const window = {
    Capacitor: { Plugins: { AariaEdge: aaria } },
    localStorage: { getItem: (k) => { if (st.storageThrows) throw new Error('storage is not available'); return k === 'qk_wake_mode_v2' ? st.mode : null; } },
    addEventListener: (name, fn) => { (domListeners[name] = domListeners[name] || []).push(fn); },
    setTimeout: (fn, ms) => { if (st.timerThrows) throw new Error('no timers'); timers.push({ fn, ms, live: true }); return timers.length; },
    clearTimeout: (id) => { if (timers[id - 1]) timers[id - 1].live = false; },
    fetch: () => {},
    location: { href: '' },
    document: { visibilityState: 'visible', addEventListener: (name, fn) => { (domListeners['doc:' + name] = domListeners['doc:' + name] || []).push(fn); } },
  };
  // The receiver also notes whether the engine still had the microphone at the moment QuietKeep was told.
  if (receiver) window.__qkOnWake = function () { st.wakes.push(Array.from(arguments)); st.engineHadMicWhenTold = st.on && !st.held; };
  if (acceptsText) window.__qkOnWakeAcceptsText = true;
  new Function('window', 'console', 'return ' + src)(window, { log() { st.logs++; }, warn() { st.warns++; }, error() {} });
  const fire = async (name) => { (domListeners[name] || []).forEach((fn) => fn()); await tick(); };
  window.dispatch = (name) => { (domListeners[name] || []).forEach((fn) => fn()); };   // two signals in the same instant ("doc:..." for the document's)
  // As in the real engine: a bare wake switches it to "waiting for a command" before the app is told.
  const wake = async (ev) => { if (!ev.hasCommand) st.waiting = false; await pluginListeners.wakeWord(ev); await tick(); };
  // The bridge also sets a time limit on each thing it does (20 seconds; 2 minutes for turning on). Those are
  // kept apart from the safety timers (3 minutes, and half a minute between tries).
  const isLimit = (t) => t.ms === 20000 || t.ms === 120000;
  const liveTimers = () => timers.filter((t) => t.live && !isLimit(t));
  const limitsPass = async () => { for (const t of timers.filter((x) => x.live && isLimit(x))) { t.live = false; t.fn(); } await tick(); };
  // Fires every timer that is still set (whatever its length), as the passing of time would.
  const threeMinutesPass = async () => { for (const t of liveTimers()) { t.live = false; t.fn(); } await tick(); };
  const liveLimits = () => timers.filter((t) => t.live && isLimit(t));
  return { st, window, fire, wake, liveTimers, threeMinutesPass, timePasses: threeMinutesPass, limitsPass, liveLimits };
}

// ---- older engine (no pause of its own): the listening service is stopped and started again ----
{
  const w = await world();
  await w.wake({ id: 'asr_wakeword', score: 1, t: 1, hasCommand: false });
  ok(w.st.stops === 1 && !w.st.on, 'bare wake: the microphone is given to QuietKeep (although the engine no longer says "listening")');
  ok(w.st.wakes.length === 1 && w.st.wakes[0][0] === 'aaria_edge' && w.st.wakes[0].length === 1, 'bare wake: QuietKeep is told, with no text');
  ok(w.st.engineHadMicWhenTold === false, 'bare wake: QuietKeep is told only after the engine has given the microphone up');
  await w.fire('qk_mic_release');
  ok(w.st.starts === 1 && w.st.on, 'bare wake: listening starts again when QuietKeep frees the microphone');
  await w.fire('qk_mic_release');
  ok(w.st.starts === 1, 'a second "free" signal does not start it twice');
  ok(w.liveTimers().length === 0, 'no safety timer is left running afterwards');
}
{
  const w = await world({ acceptsText: true });
  await w.wake({ id: 'asr_wakeword', score: 1, t: 1, hasCommand: true, text: 'remind me to call home at five' });
  ok(w.st.stops === 0 && w.st.on, 'one breath: the microphone is not touched');
  ok(w.st.wakes.length === 1 && w.st.wakes[0][1] && w.st.wakes[0][1].text === 'remind me to call home at five', 'one breath: the words are handed to QuietKeep');
}
{
  const w = await world({ acceptsText: false });
  await w.wake({ id: 'asr_wakeword', score: 1, t: 1, hasCommand: true, text: 'remind me' });
  ok(w.st.stops === 1 && w.st.wakes.length === 1 && w.st.wakes[0].length === 1, 'one breath, but QuietKeep has no receiver for words yet: treated as a bare wake');
}
{
  const w = await world();
  await w.wake({ hasCommand: false });
  await w.window.__QK_WAKE__.stopHotword();
  await w.fire('qk_mic_release');
  ok(w.st.starts === 0 && !w.st.on, 'turned off by the person after a wake: not restarted');
  await w.threeMinutesPass();
  ok(w.st.starts === 0 && !w.st.on, 'turned off by the person: the safety timer does not restart it either');
}
{
  const w = await world();
  await w.wake({ hasCommand: false });
  w.st.mode = 'manual';
  await w.fire('qk_mic_release');
  ok(w.st.starts === 0, 'hands-free switched off in settings after a wake: not restarted');
}
{
  const w = await world();
  await w.wake({ hasCommand: false });
  w.st.mode = 'manual';
  await w.threeMinutesPass();
  ok(w.st.starts === 0, 'hands-free switched off in settings: the safety timer does not restart it');
}
{
  const w = await world({ on: false });
  await w.fire('qk_mic_claim');
  await w.fire('qk_mic_release');
  ok(w.st.stops === 0 && w.st.starts === 0, 'listening was off: a "free" signal never turns it on');
  ok(w.liveTimers().length === 0, 'listening was off: no safety timer is set');
}
{
  const w = await world();
  await w.fire('qk_mic_claim');
  ok(w.st.stops === 1 && !w.st.on, 'QuietKeep asks for the microphone (tap on the mic): it is given');
  await w.fire('qk_mic_release');
  ok(w.st.starts === 1 && w.st.on, 'and listening starts again afterwards');
}
{
  const w = await world();
  await w.wake({ hasCommand: false });
  ok(w.liveTimers().length === 1 && w.liveTimers()[0].ms === 180000, 'after a stop, a three-minute safety timer is set');
  await w.fire('qk_mic_claim');
  ok(w.liveTimers().length === 1 && w.st.stops === 1, 'another "I need the microphone" starts the three minutes again; nothing is stopped twice');
  await w.threeMinutesPass();
  ok(w.st.starts === 1 && w.st.on, 'nobody said "free": listening starts again by itself after three minutes');
  await w.fire('qk_mic_release');
  ok(w.st.starts === 1, 'a late "free" signal does not start it twice');
}
{
  const w = await world();
  await w.wake({ hasCommand: false });
  w.st.refuse = 'not_in_foreground';
  w.window.document.visibilityState = 'hidden';
  const logsBefore = w.st.logs;
  await w.fire('qk_mic_release');
  ok(w.st.starts === 1 && !w.st.on, 'QuietKeep is not on screen: Android refuses the restart');
  ok(w.st.logs > logsBefore && w.st.warns === 0, 'and that is noted in the log as something that will be tried again, not as a fault');
  await w.fire('doc:visibilitychange');
  ok(w.st.starts === 1, 'a screen change while still not on screen does not try again');
  w.st.refuse = '';
  w.window.document.visibilityState = 'visible';
  await w.fire('doc:visibilitychange');
  ok(w.st.starts === 2 && w.st.on, 'QuietKeep comes back to the screen: listening starts again');
  await w.fire('doc:visibilitychange');
  ok(w.st.starts === 2, 'coming back to the screen again does not start it twice');
}
{
  const w = await world();
  await w.fire('qk_mic_claim');
  w.window.document.visibilityState = 'hidden';
  await w.fire('doc:visibilitychange');
  w.window.document.visibilityState = 'visible';
  await w.fire('doc:visibilitychange');
  ok(w.st.starts === 0 && !w.st.on, 'leaving and returning in the middle of a conversation does not take the microphone back early');
}
{
  const w = await world();
  await w.wake({ hasCommand: false });
  w.st.refuse = 'aaria_unavailable';
  await w.fire('qk_mic_release');
  ok(w.st.starts === 1 && !w.st.on && w.st.warns >= 1, 'the engine refuses the restart for another reason: it is written to the log');
  ok(w.liveTimers().length === 1 && w.liveTimers()[0].ms === 30000, 'and another try is set for half a minute later');
  await w.fire('doc:visibilitychange');
  ok(w.st.starts === 1, 'coming back to the screen is not what retries this kind of refusal');
  w.st.refuse = '';
  await w.timePasses();
  ok(w.st.starts === 2 && w.st.on && w.liveTimers().length === 0, 'the second try succeeds: listening is back, no timer left');
}
{
  const w = await world();
  await w.wake({ hasCommand: false });
  w.st.refuse = 'aaria_unavailable';
  await w.fire('qk_mic_release');
  await w.timePasses();
  const warnsBeforeLast = w.st.warns;
  await w.timePasses();
  ok(w.st.warns > warnsBeforeLast, 'the third refusal, after which the bridge gives up, is written to the log');
  await w.timePasses();
  await w.timePasses();
  ok(w.st.starts === 3 && !w.st.on && w.liveTimers().length === 0, 'the engine keeps refusing: three tries in all, then no more');
  w.st.refuse = '';
  await w.fire('qk_mic_release');
  ok(w.st.starts === 3, 'after giving up, a "free" signal does not start it');
  await w.window.__QK_WAKE__.startHotword({ word: 'aaria' });
  ok(w.st.on, 'turning listening on (QuietKeep does this when it is opened) brings it back');
}
{
  const w = await world();
  await w.wake({ hasCommand: false });
  w.st.refuse = 'Some other error from Android';
  w.window.document.visibilityState = 'hidden';
  await w.fire('qk_mic_release');
  ok(w.liveTimers().length === 0 && w.st.starts === 1, 'refused while QuietKeep is not on screen, whatever the words of the refusal: no timer');
  w.st.refuse = '';
  w.window.document.visibilityState = 'visible';
  await w.fire('doc:visibilitychange');
  ok(w.st.starts === 2 && w.st.on, 'and it is tried again when QuietKeep comes back to the screen');
}
{
  const w = await world({ on: false });
  await w.fire('doc:visibilitychange');
  ok(w.st.starts === 0, 'listening was off: coming back to the screen never turns it on');
}
{
  const w = await world();
  await w.wake({ hasCommand: false });
  let open; w.st.gate = new Promise((r) => { open = r; });
  await w.fire('qk_mic_release');            // the restart begins and is still in flight...
  await w.fire('qk_mic_claim');              // ...when QuietKeep needs the microphone again
  open(); await tick(); await tick();
  ok(!w.st.on && w.st.stops >= 2 && w.liveTimers().length === 1, 'QuietKeep asks again while listening is being started: it is stopped again, with the safety timer set');
  w.st.gate = null;
  await w.fire('qk_mic_release');
  ok(w.st.on, 'and it comes back at the next "free" signal');
}
{
  const w = await world({ receiver: false });
  await w.wake({ hasCommand: false });
  ok(w.st.stops === 1 && w.liveTimers().length === 1, 'older engine, a page with nobody to take the wake: it is stopped (it could not be told from "off" otherwise), with the safety timer set');
  await w.fire('qk_mic_claim');
  ok(w.st.stops === 1 && !w.st.on, 'and a tap on the mic there finds the microphone free');
  await w.timePasses();
  ok(w.st.starts === 1 && w.st.on, 'and listening is back after three minutes');
}
{
  const w = await world({ receiver: false });
  await w.wake({ hasCommand: false });
  await w.window.__QK_WAKE__.startHotword({ word: 'aaria' });
  ok(w.st.on && w.liveTimers().length === 0, 'older engine, nobody took the wake: QuietKeep turning listening on brings it straight back');
}
{
  const w = await world();
  await w.wake({ hasCommand: false });
  w.st.refuse = 'not_in_foreground';          // Android says "not on screen" although the page believes it is
  const logsBefore = w.st.logs;
  await w.fire('qk_mic_release');
  ok(w.st.logs > logsBefore, 'Android says QuietKeep is not on screen while the page thinks it is: noted in the log');
  ok(w.liveTimers().length === 1 && w.liveTimers()[0].ms === 30000, 'and, because the page cannot be sure, another try is set for half a minute later as well');
  w.st.refuse = '';
  await w.fire('doc:visibilitychange');
  ok(w.st.starts === 2 && w.st.on && w.liveTimers().length === 0, 'it is tried again at the next return to the screen, and the timer is dropped');
}
{
  const w = await world();
  await w.wake({ hasCommand: false });
  w.st.refuse = 'not_in_foreground';
  await w.fire('qk_mic_release');
  await w.timePasses();
  await w.timePasses();
  await w.timePasses();
  ok(w.st.starts === 3 && w.liveTimers().length === 0, 'Android keeps saying "not on screen": three tries, then no more timers');
  w.st.refuse = '';
  await w.fire('doc:visibilitychange');
  ok(w.st.starts === 4 && w.st.on, 'but the return to the screen still starts listening (this kind of refusal is never given up)');
}
// ---- the person's own on or off wins, even over something the bridge is in the middle of ----
{
  const w = await world();
  await w.wake({ hasCommand: false });
  let open; w.st.gate = new Promise((r) => { open = r; });
  await w.fire('qk_mic_release');            // the restart is in flight
  await w.fire('qk_mic_claim');              // QuietKeep needs the microphone again
  const off = w.window.__QK_WAKE__.stopHotword();   // the person turns listening off
  open(); await off; await tick(); await tick();
  w.st.gate = null;
  ok(!w.st.on, 'turned off while a restart was in flight: it is off');
  await w.fire('qk_mic_release');
  await w.timePasses();
  ok(!w.st.on && w.st.starts === 1, 'and neither a "free" signal nor the timer turns it on again');
}
{
  const w = await world();
  let open; w.st.statusGate = new Promise((r) => { open = r; });
  await w.fire('qk_mic_claim');              // the bridge is asking the engine whether it is listening
  w.st.statusGate = null;
  const off = w.window.__QK_WAKE__.stopHotword();   // the person turns listening off before the answer comes
  await tick();
  open(); await off; await tick(); await tick();
  await w.fire('qk_mic_release');
  await w.timePasses();
  ok(!w.st.on && w.st.starts === 0 && w.liveTimers().length === 0, 'turned off while the bridge was asking the engine: nothing turns it on again');
}
{
  const w = await world({ newEngine: true, holdThrows: true });
  let open; w.st.holdGate = new Promise((r) => { open = r; });
  const waking = w.wake({ hasCommand: false });     // the pause is asked for, and will be refused
  await tick();
  w.st.holdGate = null;
  const off = w.window.__QK_WAKE__.stopHotword();    // the person turns listening off at that moment
  await tick();
  open(); await off; await waking; await tick();
  await w.fire('qk_mic_release');
  await w.timePasses();
  ok(!w.st.on && w.st.starts === 0 && w.liveTimers().length === 0, 'turned off while a pause was being refused: nothing turns it on again');
  ok(w.st.wakes.length === 0, 'and QuietKeep is not told of a wake once listening has been turned off');
}
{
  const w = await world();
  await w.window.__QK_WAKE__.stopHotword();          // the person turns listening off
  await w.wake({ hasCommand: false });               // a wake that was still on its way arrives afterwards
  ok(w.st.wakes.length === 0, 'a wake that arrives after listening was turned off is not passed to QuietKeep');
  await w.fire('qk_mic_release');
  await w.timePasses();
  ok(!w.st.on && w.st.starts === 0 && w.liveTimers().length === 0, 'and it never leads to listening being started again');
  await w.wake({ hasCommand: true, text: 'what is the time' });
  ok(w.st.wakes.length === 0, 'a late one-breath wake is dropped as well');
}
{
  const w = await world({ acceptsText: true });
  await w.window.__QK_WAKE__.stopHotword();
  await w.wake({ hasCommand: true, text: 'what is the time' });
  ok(w.st.wakes.length === 0, 'a late one-breath wake, on a page that takes the words, is dropped after off as well');
}
{
  const w = await world({ newEngine: true });
  await w.window.__QK_WAKE__.stopHotword();
  await w.wake({ hasCommand: false });
  ok(w.st.wakes.length === 0 && w.st.holds === 0, 'newer engine: a wake that arrives after listening was turned off is dropped');
}
{
  const w = await world();
  await w.window.__QK_WAKE__.stopHotword();
  await w.window.__QK_WAKE__.startHotword({ word: 'aaria' });
  await w.wake({ hasCommand: false });
  ok(w.st.wakes.length === 1, 'turned off and on again: wakes are passed on again');
}
{
  const w = await world({ proxy: true, receiver: false });
  let open; w.st.stopGate = new Promise((r) => { open = r; });
  const waking = w.wake({ hasCommand: false });      // nobody takes the wake; "back to the name" is refused...
  await tick();
  ok(w.st.stops === 1 && w.st.on && w.liveTimers().length === 1, 'a wake nobody takes is being handled: the engine is in the middle of being stopped');
  const off = w.window.__QK_WAKE__.stopHotword();    // ...and the person turns listening off in that moment
  w.st.stopGate = null; open();
  await off; await waking; await tick();
  await w.fire('qk_mic_release');
  await w.timePasses();
  ok(!w.st.on && w.st.starts === 0 && w.liveTimers().length === 0, 'turned off while a wake nobody takes was being handled: nothing turns it on again');
}
{
  const w = await world({ newEngine: true, holdThrows: true });
  await w.wake({ hasCommand: false });               // the pause fails: the engine is stopped instead
  w.st.holdThrows = false;
  w.window.dispatch('qk_mic_release');               // "free"...
  w.window.dispatch('qk_mic_claim');                 // ...and at once "I need the microphone" again
  await tick(); await tick(); await tick();
  ok(!(w.st.on && !w.st.held), 'free, then needed again at once: the engine does not end up listening while QuietKeep has the microphone');
  await w.fire('qk_mic_release');
  ok(w.st.on && !w.st.held, 'and it comes back at the next "free" signal');
}
{
  const w = await world({ newEngine: true, holdThrows: true });
  await w.wake({ hasCommand: false });               // the pause fails: the engine is stopped instead
  w.st.holdThrows = false;
  w.window.dispatch('qk_mic_release');               // "free"...
  w.window.dispatch('qk_mic_claim');                 // ...needed again...
  w.window.dispatch('qk_mic_release');               // ...and free again, all while the start is in flight
  await tick(); await tick(); await tick();
  ok(w.st.on && !w.st.held && w.liveTimers().length === 0, 'free, needed, free again in one instant: listening is back at once, not after three minutes');
}
{
  const w = await world({ newEngine: true, holdThrows: true });
  await w.wake({ hasCommand: false });               // the pause fails: the engine is stopped instead
  w.st.refuse = 'not_in_foreground';
  w.window.document.visibilityState = 'hidden';
  await w.fire('qk_mic_release');                    // refused: QuietKeep is not on screen
  w.st.refuse = ''; w.st.holdThrows = false;
  await w.fire('qk_mic_claim');                      // QuietKeep needs the microphone again (still off screen)
  w.window.document.visibilityState = 'visible';
  await w.fire('doc:visibilitychange');              // and comes back to the screen while it has the microphone
  ok(!w.st.on, 'back on screen in the middle of a new conversation: listening is not started under it');
  await w.fire('qk_mic_release');
  ok(w.st.on, 'and it is started when that conversation ends');
}
{
  const w = await world();
  await w.fire('qk_mic_claim');
  w.st.refuse = 'not_in_foreground';
  w.window.document.visibilityState = 'hidden';
  await w.fire('qk_mic_release');                    // refused: not on screen
  w.st.refuse = '';
  await w.fire('qk_mic_claim');                      // older engine: a new request while it is still stopped
  w.window.document.visibilityState = 'visible';
  await w.fire('doc:visibilitychange');
  ok(!w.st.on && w.st.starts === 1, 'older engine, back on screen in the middle of a new conversation: listening is not started under it');
}
{
  const w = await world();
  await w.wake({ hasCommand: false });
  w.st.refuse = 'aaria_unavailable';
  await w.fire('qk_mic_release');                    // first refusal
  w.st.refuse = '';
  await w.timePasses();                              // second try succeeds
  await w.wake({ hasCommand: false });               // a new conversation later
  w.st.refuse = 'aaria_unavailable';
  await w.fire('qk_mic_release');
  await w.timePasses();
  ok(w.liveTimers().length === 1, 'after a success the count of tries starts again: a new refusal gets its full three tries');
}
{
  const w = await world();
  await w.wake({ hasCommand: false });
  w.st.refuse = 'aaria_unavailable';
  await w.fire('qk_mic_release');
  await w.timePasses();                              // two refusals so far
  await w.fire('qk_mic_claim');                      // a new request: the count starts again
  await w.fire('qk_mic_release');                    // refused: this is try one of the new count
  ok(w.liveTimers().length === 1 && w.liveTimers()[0].ms === 30000, 'a new "I need the microphone" starts the count of tries again');
}
{
  const w = await world();
  await w.wake({ hasCommand: false });
  w.st.mode = 'manual';
  await w.fire('qk_mic_release');                    // hands-free is off in settings: not restarted, note dropped
  w.st.mode = 'counter';
  await w.fire('qk_mic_release');
  await w.timePasses();
  ok(w.st.starts === 0 && !w.st.on, 'hands-free off in settings at the "free" signal: the bridge forgets its stop for good');
}
// ---- signals that arrive on top of each other are handled one at a time, in order ----
for (const newEngine of [false, true]) {
  const which = newEngine ? 'newer engine' : 'older engine';
  {
    const w = await world({ newEngine, on: false });
    let open; w.st.nameGate = new Promise((r) => { open = r; });
    const turnOn = w.window.__QK_WAKE__.startHotword({ word: 'aaria' });   // on...
    const turnOff = w.window.__QK_WAKE__.stopHotword();                    // ...and off before the engine has answered
    await tick(); open(); await turnOn; await turnOff; await tick();
    ok(!w.st.on, which + ': on, then off before the engine answered: it ends off');
    ok(w.st.starts === 0, which + ': and the overtaken turn-on did nothing (listening does not flick on and off)');
  }
  {
    const w = await world({ newEngine, on: false });
    let open; w.st.nameGate = new Promise((r) => { open = r; });
    const turnOn = w.window.__QK_WAKE__.startHotword({ word: 'aaria' });   // on; the engine is already working on it...
    await tick(); await tick();
    const turnOff = w.window.__QK_WAKE__.stopHotword();                    // ...when the person turns listening off
    await tick(); open(); await turnOn; await turnOff; await tick();
    ok(!w.st.on && w.st.starts === 0, which + ': off while a turn-on was already under way: it ends off, and listening never flicks on');
  }
  {
    const w = await world({ newEngine, on: false });
    w.st.refuseOnce = 'microphone_permission_required';
    let open; w.st.permGate = new Promise((r) => { open = r; });
    const turnOn = w.window.__QK_WAKE__.startHotword({ word: 'aaria' });   // Android asks for the microphone...
    await tick(); await tick();
    const turnOff = w.window.__QK_WAKE__.stopHotword();                    // ...and the person turns listening off meanwhile
    await tick(); open(); await turnOn; await turnOff; await tick();
    ok(!w.st.on, which + ': turned off while Android\'s microphone question was open: it ends off');
    ok(w.st.starts === 1, which + ': and listening is not started after the question is answered');
  }
  {
    const w = await world({ newEngine, on: false });
    const a = w.window.__QK_WAKE__.startHotword({ word: 'aaria' });
    const b = w.window.__QK_WAKE__.stopHotword();
    const c = w.window.__QK_WAKE__.startHotword({ word: 'aaria' });
    await a; await b; await c; await tick();
    ok(w.st.on && w.st.starts === 1, which + ': on, off, on in one instant: it ends on, started once');
  }
}
{
  const w = await world({ on: false });
  w.st.refuseOnce = 'microphone_permission_required';
  let open; w.st.gate = new Promise((r) => { open = r; });
  const turnOn = w.window.__QK_WAKE__.startHotword({ word: 'aaria' });   // the engine is about to say "microphone not allowed"...
  await tick(); await tick();
  const turnOff = w.window.__QK_WAKE__.stopHotword();                    // ...when the person turns listening off
  await tick(); w.st.gate = null; open(); await turnOn; await turnOff; await tick();
  ok(w.st.permAsks === 0 && !w.st.on, 'turned off just before the engine says "microphone not allowed": Android\'s microphone question is not shown');
}
{
  const w = await world({ on: false });
  w.st.refuseOnce = 'microphone_permission_required';
  let open; w.st.permGate = new Promise((r) => { open = r; });
  const turnOn = w.window.__QK_WAKE__.startHotword({ word: 'aaria' });
  await tick(); await tick();
  ok(w.liveLimits().length === 1 && w.liveLimits()[0].ms === 120000, 'while Android\'s microphone question is open, the bridge waits up to two minutes, not twenty seconds');
  w.st.refuse = 'aaria_unavailable';                                     // and after the answer the engine still refuses
  const warnsBefore = w.st.warns;
  open(); await turnOn; await tick();
  ok(w.st.warns > warnsBefore && !w.st.on, 'listening cannot be turned on after the microphone question: it is written to the log');
}
{
  const w = await world({ newEngine: true, receiver: false });
  await w.fire('qk_mic_claim');                      // QuietKeep takes the microphone (a tap on the mic)...
  await w.wake({ hasCommand: false });               // ...and a wake that left the engine just before arrives
  ok(w.st.held && w.st.releases === 0 && w.st.stops === 0, 'newer engine, nobody takes the wake, QuietKeep has the microphone: the late wake does not end the pause');
  await w.fire('qk_mic_release');
  ok(!w.st.held && w.st.releases === 1, 'and the pause ends at the "free" signal as usual');
  await w.wake({ hasCommand: false });
  ok(w.st.releases === 2 && w.st.waiting, 'and after that, a wake nobody takes puts the engine back to waiting for the name again');
}
{
  const w = await world({ receiver: false });
  w.st.waiting = false;                              // the older engine has just heard a bare wake (it now says "not listening")...
  await w.fire('qk_mic_claim');                      // ...QuietKeep asks for the microphone before that wake has arrived...
  ok(w.st.stops === 0, 'older engine that says "not listening" after a bare wake: the request alone cannot tell it is on');
  await w.wake({ hasCommand: false });               // ...and then the wake arrives, on a page where nobody takes it
  ok(w.st.stops === 1 && !w.st.on, 'the wake proves the engine is on while QuietKeep wants the microphone: it is stopped now');
  await w.fire('qk_mic_release');
  ok(w.st.on, 'and listening comes back at the "free" signal');
}
{
  const w = await world();
  w.st.enginePaused = true;                          // the engine is on but paused by the phone (say, unplugged)
  await w.fire('qk_mic_claim');
  ok(w.st.stops === 1 && !w.st.on, 'older engine that is on but paused by the phone: it is still stopped for QuietKeep, so it cannot come back in the middle');
  w.st.enginePaused = false;
  await w.fire('qk_mic_release');
  ok(w.st.on, 'and started again at the "free" signal');
}
for (const newEngine of [false, true]) {
  const which = newEngine ? 'newer engine whose pause fails' : 'older engine';
  const w = await world({ newEngine, holdThrows: newEngine });
  await w.fire('qk_mic_claim');                      // stopped for QuietKeep; the three minutes run
  const timer = w.liveTimers()[0];
  let open; w.st.statusGate = new Promise((r) => { open = r; });
  if (newEngine) w.st.holdGate = w.st.statusGate;
  w.window.dispatch('qk_mic_claim');                 // QuietKeep asks again, and while that is being handled...
  await tick();
  timer.live = false; timer.fn();                    // ...the three minutes of the first request run out
  await tick();
  w.st.statusGate = null; w.st.holdGate = null; open(); await tick(); await tick(); await tick();
  ok(!w.st.on && w.st.starts === 0, which + ': the timer runs out while a new request is being handled: listening is not started under it');
  ok(w.liveTimers().length === 1 && w.liveTimers()[0].ms === 180000, which + ': and the three minutes of the new request are running');
  await w.timePasses();
  ok(w.st.on, which + ': and they still bring listening back');
}
{
  const w = await world();
  await w.fire('qk_mic_claim');
  w.st.refuse = 'not_in_foreground';
  w.window.document.visibilityState = 'hidden';
  await w.fire('qk_mic_release');                    // refused: not on screen; waits for the return
  w.st.refuse = '';
  let open; w.st.statusGate = new Promise((r) => { open = r; });
  w.window.dispatch('qk_mic_claim');                 // QuietKeep asks again, and while that is being handled...
  await tick();
  w.window.document.visibilityState = 'visible';
  w.window.dispatch('doc:visibilitychange');         // ...QuietKeep comes back to the screen
  await tick();
  w.st.statusGate = null; open(); await tick(); await tick(); await tick();
  ok(!w.st.on && w.st.starts === 1, 'back on screen while a new request is being handled: it waits its turn, and listening is not started under the request');
}
{
  const w = await world();
  await w.fire('qk_mic_claim');
  w.window.document.visibilityState = 'hidden';
  let open; w.st.gate = new Promise((r) => { open = r; });
  w.st.refuseOnce = 'not_in_foreground';
  w.window.dispatch('qk_mic_release');               // the restart is under way; Android is about to refuse it...
  await tick();
  w.window.document.visibilityState = 'visible';
  w.window.dispatch('doc:visibilitychange');         // ...and QuietKeep comes back to the screen before the refusal arrives
  await tick();
  w.st.gate = null; open(); await tick(); await tick(); await tick();
  ok(w.st.on && w.st.starts === 2, 'back on screen just before a "not on screen" refusal arrives: the return is still acted on, after the refusal');
}
{
  const w = await world({ on: false });
  const a = w.window.__QK_WAKE__.startHotword({ word: 'aaria' });
  const b = w.window.__QK_WAKE__.startHotword({ word: 'aaria' });
  await a; await b; await tick();
  ok(w.st.on && w.st.starts === 1, 'turned on twice in one instant: started once');
}
{
  const w = await world();
  let open; w.st.statusGate = new Promise((r) => { open = r; });
  w.window.dispatch('qk_mic_claim');                 // needed...
  w.window.dispatch('qk_mic_release');               // ...and free again before the engine has even answered
  await tick(); w.st.statusGate = null; open(); await tick(); await tick(); await tick();
  ok(w.st.on && w.liveTimers().length === 0, 'needed, then free before the engine answered: listening is on at the end, not off for three minutes');
}
{
  const w = await world();
  let open; w.st.statusGate = new Promise((r) => { open = r; });
  w.window.dispatch('qk_mic_claim');
  w.window.dispatch('qk_mic_claim');
  w.window.dispatch('qk_mic_release');               // lands between the two answers
  await tick(); w.st.statusGate = null; open(); await tick(); await tick(); await tick();
  ok(w.st.on && w.liveTimers().length === 0, 'needed twice, then free, all at once: listening is on at the end and nothing is left pending');
  await w.fire('qk_mic_claim');
  await w.fire('qk_mic_release');
  ok(w.st.on, 'and the next conversation still gives the microphone and takes it back');
}
{
  const w = await world({ newEngine: true, holdThrows: true });
  await w.wake({ hasCommand: false });               // the pause fails: the engine is stopped instead
  w.st.refuse = 'not_in_foreground';
  w.window.document.visibilityState = 'hidden';
  w.window.dispatch('qk_mic_release');               // free (refused: not on screen)...
  w.window.dispatch('qk_mic_claim');                 // ...and needed again at once
  await tick(); await tick(); await tick();
  w.st.refuse = '';
  w.window.document.visibilityState = 'visible';
  await w.fire('doc:visibilitychange');
  ok(!w.st.on, 'free then needed at once while off screen: coming back to the screen does not start listening under the conversation');
  await w.fire('qk_mic_release');
  ok(w.st.on, 'and it is started at the next "free" signal');
}
{
  const w = await world();
  w.st.statusGate = new Promise(() => {});            // the engine never answers this question
  w.window.dispatch('qk_mic_claim');
  await tick();
  w.st.statusGate = null;
  const warnsBefore = w.st.warns;
  await w.limitsPass();                               // the time limit for that one thing runs out
  ok(w.st.warns > warnsBefore, 'something the engine never answers: after its time limit that is written to the log');
}
{
  const w = await world();
  await w.wake({ hasCommand: false });
  w.st.refuse = 'turned_off';                        // the engine says: turned off on the notice meanwhile
  const logsBefore = w.st.logs;
  await w.fire('qk_mic_release');
  ok(w.st.starts === 1 && !w.st.on && w.liveTimers().length === 0 && w.st.logs > logsBefore, 'the engine says listening was turned off on the notice: no retry is set, and it is noted in the log');
  w.st.refuse = '';
  await w.fire('qk_mic_release');
  await w.fire('doc:visibilitychange');
  ok(w.st.starts === 1 && !w.st.on, 'and no later "free" signal or return to the screen starts it');
}
// ---- nothing fails silently ----
{
  const w = await world();
  w.st.stopThrows = true;
  await w.fire('qk_mic_claim');
  ok(w.st.warns >= 1, 'the engine cannot be stopped: it is written to the log');
}
{
  const w = await world({ receiver: false });
  w.st.stopThrows = true;
  await w.wake({ hasCommand: false });
  ok(w.st.warns >= 1, 'a wake nobody takes, and the engine cannot be stopped: it is written to the log');
}
{
  const w = await world({ newEngine: true, receiver: false, releaseThrows: true });
  await w.wake({ hasCommand: false });
  ok(w.st.warns >= 1 && w.st.stops === 1, 'newer engine, a wake nobody takes, and it cannot be put back to waiting: written to the log, and stopped instead');
}
{
  const w = await world({ newEngine: true, releaseThrows: true });
  await w.fire('qk_mic_release');                    // no pause was placed from this page, and the engine fails
  ok(w.st.warns >= 1, 'newer engine, "free" fails with no pause from this page: still written to the log');
}
{
  const w = await world();
  w.st.statusThrows = true;
  await w.fire('qk_mic_claim');
  ok(w.st.warns >= 1, 'the engine fails to answer whether it is listening: it is written to the log');
  w.st.statusThrows = false;
  await w.fire('qk_mic_claim');
  ok(w.st.stops === 1 && !w.st.on, 'and the next request is handled as usual');
}
{
  const w = await world({ on: false });
  w.st.refuse = 'not_in_foreground';
  await w.window.__QK_WAKE__.startHotword({ word: 'aaria' });
  ok(w.st.warns >= 1 && !w.st.on, 'turning listening on is refused: it is written to the log');
}
{
  const w = await world();
  w.st.stopThrows = true;
  await w.window.__QK_WAKE__.stopHotword();
  ok(w.st.warns >= 1, 'turning listening off fails: it is written to the log');
}
{
  const w = await world();
  w.st.timerThrows = true;
  await w.wake({ hasCommand: false });
  ok(w.st.warns === 2 && w.st.stops === 1, 'no timer can be set: both the missing time limit and the missing safety timer are written to the log, and the microphone is still given');
}
{
  const w = await world();
  await w.wake({ hasCommand: false });
  w.st.storageThrows = true;
  await w.fire('qk_mic_release');
  ok(w.st.starts === 1 && w.st.on && w.st.warns >= 1, 'the hands-free setting cannot be read: listening is started again, and it is written to the log');
}
{
  const w = await world();
  await w.wake({ hasCommand: false });
  let open; w.st.gate = new Promise((r) => { open = r; });
  const timersThen = w.liveTimers();
  w.window.dispatch('qk_mic_release');
  for (const t of timersThen) { t.live = false; t.fn(); }   // the three minutes run out in the same instant
  w.window.dispatch('qk_mic_release');
  await tick();
  ok(timersThen.length === 1 && w.st.starts === 1 && w.st.startsInFlight === 1, 'a "free" signal, the three minutes running out and another "free" signal in the same instant: one start is under way');
  open(); await tick(); await tick();
  ok(w.st.maxStartsInFlight === 1 && w.st.starts === 1 && w.st.on, 'and when it has finished there has been one start only');
}
{
  const w = await world();
  await w.wake({ hasCommand: false });
  const first = w.liveTimers()[0];
  await w.fire('qk_mic_claim');
  ok(first.live === false && w.liveTimers().length === 1 && w.liveTimers()[0] !== first && w.liveTimers()[0].ms === 180000, 'a new "I need the microphone" really starts the three minutes again (a new three-minute timer, the old one cancelled)');
  await w.window.__QK_WAKE__.stopHotword();
  ok(w.liveTimers().length === 0, 'turning listening off cancels the timer');
}
{
  const w = await world({ newEngine: true, holdThrows: true });
  await w.wake({ hasCommand: false });       // the pause fails: the engine is stopped, timer set
  const first = w.liveTimers()[0];
  w.st.holdThrows = false;
  await w.fire('qk_mic_claim');              // later in the same conversation the pause works
  ok(first && first.live === false && w.liveTimers().length === 1 && w.liveTimers()[0].ms === 180000, 'a pause that works after one that failed: the three minutes of the earlier stop start again too');
  await w.fire('qk_mic_release');
  ok(w.st.on && w.st.releases === 1 && w.liveTimers().length === 0, 'and at "free" the engine is un-paused and started again');
}
// ---- older engine behind an app-side wrapper that has every function name, each refusing ----
{
  const w = await world({ proxy: true });
  await w.wake({ hasCommand: false });
  ok(w.st.holds === 1 && w.st.stops === 1 && !w.st.on, 'older engine behind a wrapper (the pause function exists but says "not implemented"): it is stopped instead');
  ok(w.st.warns === 0, 'and nothing is logged as a fault: for an older engine that is the normal way');
  await w.fire('qk_mic_release');
  ok(w.st.starts === 1 && w.st.on, 'and listening starts again when QuietKeep frees the microphone');
}
// ---- newer engine: it pauses inside its own listening service ----
{
  const w = await world({ newEngine: true });
  await w.wake({ hasCommand: false });
  ok(w.st.holds === 1 && w.st.stops === 0 && w.st.held, 'newer engine, bare wake: the engine is asked to pause; its service is not stopped');
  ok(w.st.wakes.length === 1 && w.st.wakes[0].length === 1, 'newer engine, bare wake: QuietKeep is told, with no text');
  ok(w.st.engineHadMicWhenTold === false, 'newer engine, bare wake: QuietKeep is told only after the engine has paused');
  ok(w.liveTimers().length === 0, 'newer engine: no timer here; the engine has its own three-minute end');
  await w.fire('qk_mic_release');
  ok(w.st.releases === 1 && w.st.starts === 0 && !w.st.held, 'newer engine: the engine is told the microphone is free; no restart from here');
  await w.fire('doc:visibilitychange');
  ok(w.st.releases === 1, 'newer engine: coming back to the screen does not end a pause early');
  await w.fire('qk_mic_claim');
  ok(w.st.holds === 2 && w.st.stops === 0, 'newer engine: every "I need the microphone" reaches the engine');
}
{
  const w = await world({ newEngine: true, acceptsText: true });
  await w.wake({ hasCommand: true, text: 'what is the time' });
  ok(w.st.holds === 0 && w.st.stops === 0, 'newer engine, one breath: the microphone is not touched');
}
{
  const w = await world({ newEngine: true });
  await w.fire('qk_mic_release');
  ok(w.st.releases === 1 && w.st.starts === 0, 'newer engine: a "free" signal with no pause from this page still reaches the engine (a pause placed before a page reload)');
}
{
  const w = await world({ newEngine: true, receiver: false });
  await w.wake({ hasCommand: false });
  ok(w.st.holds === 0 && w.st.stops === 0 && w.liveTimers().length === 0, 'newer engine, a page with nobody to take the wake: no pause is placed and nothing is stopped');
  ok(w.st.releases === 1 && w.st.waiting, 'newer engine, nobody took the wake: the engine is put back to waiting for the wake name');
}
{
  const w = await world({ newEngine: true, holdThrows: true });
  await w.wake({ hasCommand: false });
  ok(w.st.holds === 1 && w.st.stops === 1 && !w.st.on, 'newer engine, the pause fails: the engine is stopped instead, so QuietKeep still gets the microphone');
  ok(w.st.warns >= 1, 'the failed pause is written to the log');
  ok(w.st.wakes.length === 1, 'and QuietKeep is still told of the wake');
  await w.fire('qk_mic_release');
  ok(w.st.starts === 1 && w.st.on, 'and listening starts again afterwards');
}
{
  const w = await world({ newEngine: true, releaseThrows: true });
  await w.wake({ hasCommand: false });
  await w.fire('qk_mic_release');
  ok(w.st.releases === 1 && w.st.warns >= 1, 'newer engine, "free" fails: it is written to the log (the engine ends its own pause within three minutes)');
  await w.fire('qk_mic_claim');
  ok(w.st.holds === 2, 'and the bridge carries on working afterwards');
}
{
  const w = await world({ newEngine: true });
  await w.wake({ hasCommand: false });
  await w.window.__QK_WAKE__.stopHotword();
  ok(w.st.stops === 1 && !w.st.on, 'newer engine: the person turns listening off during a pause; it is off');
  await w.fire('qk_mic_release');
  ok(w.st.starts === 0 && !w.st.on, 'newer engine: and a later "free" signal never turns it on');
}
// ---- gaps found by the independent check of 3 Oct, closed on 4 Oct ----
{
  const w = await world();
  w.st.statusNever = true;                            // the engine never answers this question
  w.window.dispatch('qk_mic_claim');
  await tick();
  w.window.__QK_WAKE__.stopHotword();                 // the person turns listening off; it waits its turn
  await tick();
  ok(w.st.stops === 0 && w.st.on, 'while one thing has not finished, the next one waits its turn');
  await w.limitsPass();                               // the time limit of the first one runs out
  ok(w.st.stops === 1 && !w.st.on, 'after the time limit the next one proceeds: Turn off gets through');
}
{
  const w = await world();
  w.st.stopGate = new Promise(() => {});              // the engine never answers the stop
  w.window.__QK_WAKE__.stopHotword();
  await tick();
  ok(w.liveLimits().length === 1 && w.liveLimits()[0].ms === 20000, 'turning off has a time limit of twenty seconds');
}
{
  const w = await world({ newEngine: true, receiver: false });
  await w.fire('qk_mic_claim');
  await w.window.__QK_WAKE__.stopHotword();
  await w.window.__QK_WAKE__.startHotword({ word: 'aaria' });
  await tick();
  await w.wake({ hasCommand: false });
  ok(w.st.holds === 1 && !w.st.held && w.st.on, 'needed, then off and on again: the old request is forgotten, so a wake nobody takes places no pause');
}
{
  const w = await world();
  await w.wake({ hasCommand: false });
  w.st.refuse = 'not_in_foreground';                  // Android says not on screen although the page says it is
  await w.fire('qk_mic_release');
  await w.timePasses();
  await w.timePasses();
  ok(w.st.starts === 3 && w.liveTimers().length === 0, 'three "not on screen" refusals: no more timed tries; it waits for the return to the screen');
  w.st.refuse = 'aaria_unavailable';
  await w.fire('doc:visibilitychange');
  ok(w.st.starts === 4 && w.liveTimers().length === 1 && w.liveTimers()[0].ms === 30000, 'a different refusal afterwards is tried again half a minute later');
  await w.timePasses();
  ok(w.st.starts === 5 && w.liveTimers().length === 1, 'and once more');
  await w.timePasses();
  ok(w.st.starts === 6 && w.liveTimers().length === 0 && !w.st.on, 'the third refusal of that kind is the last try');
  w.st.refuse = '';
  await w.fire('doc:visibilitychange');
  await w.fire('qk_mic_release');
  ok(w.st.starts === 6 && !w.st.on, 'after giving up, neither the return to the screen nor a "free" signal starts it');
}
{
  const w = await world({ newEngine: true, holdThrows: true, releaseThrows: true });
  await w.wake({ hasCommand: false });                // the pause fails, so the engine is stopped instead
  await w.fire('qk_mic_release');                     // and "free" fails too
  ok(w.st.starts === 1 && w.st.on, 'newer engine, the pause failed and "free" fails as well: listening is still started again');
}
{
  const w = await world();
  await w.fire('qk_mic_claim');                       // stopped; three minutes set
  const first = w.liveTimers()[0];
  w.st.statusThrows = true;
  const warnsBefore = w.st.warns;
  await w.fire('qk_mic_claim');                       // asked again; the engine does not say whether it is listening
  ok(w.st.warns > warnsBefore, 'the engine does not say whether it is listening: it is written to the log');
  ok(w.liveTimers().length === 1 && w.liveTimers()[0] !== first && w.liveTimers()[0].ms === 180000, 'and the three minutes still start again from this latest request');
  ok(w.st.stops === 1, 'and nothing is stopped twice');
}
{
  const w = await world({ on: true });
  w.st.statusThrows = true;
  await w.fire('qk_mic_claim');
  ok(w.st.stops === 0 && w.st.on && w.liveTimers().length === 0, 'no answer and nothing stopped by this bridge: nothing is stopped on a guess, and no timer is set');
}
{
  const w = await world({ receiver: false });
  await w.wake({ hasCommand: true, text: 'remind me to call home' });
  ok(w.st.stops === 0 && w.st.on && w.liveTimers().length === 0, 'one breath on a page with nobody to take it: the engine is left listening');
}
{
  const w = await world({ newEngine: true, receiver: false });
  await w.wake({ hasCommand: true, text: 'remind me to call home' });
  ok(w.st.holds === 0 && w.st.stops === 0 && w.st.releases === 0 && w.st.on, 'newer engine, one breath on a page with nobody to take it: left alone');
}
{
  const w = await world({ receiver: false });
  await w.fire('qk_mic_claim');                       // QuietKeep has the microphone...
  w.st.on = true; w.st.waiting = true;                // ...and the engine turns out to be on after all
  await w.wake({ hasCommand: true, text: 'remind me' });
  ok(w.st.stops === 2 && !w.st.on, 'one breath, nobody to take it, but QuietKeep has asked for the microphone: the engine is stopped');
}
{
  const w = await world();
  w.window.__qkOnWake = function () { throw new Error('the receiver broke'); };
  const warnsBefore = w.st.warns;
  await w.wake({ hasCommand: false });
  ok(w.st.warns > warnsBefore, 'something unexpected goes wrong while a wake is handled: it is written to the log');
  await w.fire('qk_mic_release');
  ok(w.st.starts === 1 && w.st.on, 'and the bridge carries on: listening starts again at the "free" signal');
}
// ---- gaps found by the second independent check of 4 Oct ----
{
  const w = await world();
  await w.wake({ hasCommand: false });
  w.st.refuse = 'not_in_foreground';                  // Android says not on screen although the page says it is
  await w.fire('qk_mic_release');                     // try 1
  await w.timePasses();                               // try 2
  w.st.refuse = 'service_start_failed';
  await w.timePasses();                               // try 3: a different refusal
  ok(w.st.starts === 3 && w.liveTimers().length === 1 && w.liveTimers()[0].ms === 30000, 'two "not on screen" refusals and then a different one: the different one is not the last try');
  await w.timePasses();
  ok(w.st.starts === 4 && w.liveTimers().length === 1, 'it gets a second try');
  await w.timePasses();
  ok(w.st.starts === 5 && w.liveTimers().length === 0, 'and a third, which is the last');
}
{
  const w = await world();
  await w.wake({ hasCommand: false });
  w.st.refuse = 'aaria_unavailable';
  await w.fire('qk_mic_release');                     // other refusal 1
  await w.timePasses();                               // other refusal 2
  w.st.refuse = 'not_in_foreground';
  await w.timePasses();                               // not on screen
  ok(w.st.starts === 3 && w.liveTimers().length === 1, 'two other refusals and then "not on screen": that is not given up');
  w.st.refuse = '';
  await w.fire('doc:visibilitychange');
  ok(w.st.starts === 4 && w.st.on && w.liveTimers().length === 0, 'and the return to the screen starts listening');
}
{
  const w = await world();
  await w.wake({ hasCommand: false });
  w.window.document.visibilityState = 'hidden';
  w.st.refuse = 'aaria_unavailable';
  await w.fire('qk_mic_release');                     // refused while hidden: not one of the three tries
  ok(w.st.starts === 1 && w.liveTimers().length === 0, 'a refusal while QuietKeep is not on screen sets no timed try');
  w.window.document.visibilityState = 'visible';
  await w.fire('doc:visibilitychange');               // try 1
  await w.timePasses();                               // try 2
  ok(w.st.starts === 3 && w.liveTimers().length === 1, 'back on screen, the same refusal still has its three tries: after two, one more is set');
  await w.timePasses();                               // try 3
  ok(w.st.starts === 4 && w.liveTimers().length === 0, 'and the third is the last');
}
{
  const w = await world();
  await w.wake({ hasCommand: false });
  w.window.document.visibilityState = 'hidden';
  w.st.refuse = 'turned_off';
  await w.fire('qk_mic_release');
  w.st.refuse = '';
  w.window.document.visibilityState = 'visible';
  await w.fire('doc:visibilitychange');
  ok(w.st.starts === 1 && !w.st.on && w.liveTimers().length === 0, 'turned off on the notice while QuietKeep was not on screen: the return to the screen does not start it');
}
{
  const w = await world();
  await w.wake({ hasCommand: false });
  w.st.refuse = 'service_start_failed';
  await w.fire('qk_mic_release');
  await w.fire('doc:visibilitychange');
  ok(w.st.starts === 1 && w.liveTimers().length === 1, 'the service could not be started (on screen): that is not a "not on screen" refusal; the return to the screen does not retry it');
}
{
  const w = await world();
  await w.wake({ hasCommand: false });
  w.st.mode = 'tap';                                  // some other setting than hands-free
  await w.fire('qk_mic_release');
  ok(w.st.starts === 0 && !w.st.on, 'only the hands-free setting restarts listening; any other setting does not');
}
{
  const w = await world();
  w.st.statusEmpty = true;
  const warnsBefore = w.st.warns;
  await w.fire('qk_mic_claim');
  ok(w.st.stops === 0 && w.st.on && w.liveTimers().length === 0, 'the engine gives an empty answer about whether it is listening: nothing is stopped on a guess');
  ok(w.st.warns > warnsBefore, 'and the empty answer is written to the log');
}
{
  const w = await world();
  w.st.stopThrows = true;
  await w.fire('qk_mic_claim');                       // the stop fails: the engine is still on
  w.st.stopThrows = false;
  await w.window.__QK_WAKE__.stopHotword();
  ok(w.st.stops === 2 && !w.st.on, 'Turn off always tells the engine to stop, even when this bridge believes it has stopped it already');
}
{
  const w = await world({ on: false });
  w.st.refuse = 'aaria_unavailable';
  await w.window.__QK_WAKE__.startHotword({ word: 'aaria' });
  await w.timePasses();
  await w.fire('doc:visibilitychange');
  ok(w.st.starts === 1 && w.liveTimers().length === 0, 'a turn-on that is refused is not retried by the bridge');
}
{
  // A restart is being refused while the person turns listening on: the turn-on wipes the retry in its own turn.
  const w = await world();
  await w.wake({ hasCommand: false });
  let open; w.st.gate = new Promise((r) => { open = r; });
  w.st.refuseOnce = 'aaria_unavailable';
  w.window.dispatch('qk_mic_release');                // the restart is under way...
  await tick();
  const on = w.window.__QK_WAKE__.startHotword({ word: 'aaria' });   // ...and the person turns listening on
  await tick();
  w.st.gate = null; open();
  await on; await tick();
  ok(w.st.on && w.liveTimers().length === 0, 'a turn-on that comes in while a restart is being refused leaves no retry behind');
  await w.window.__QK_WAKE__.stopHotword();
  await w.timePasses();
  ok(!w.st.on, 'so a later Turn off is not undone by a left-over retry');
}
{
  const w = await world({ acceptsText: true });
  w.st.stopGate = new Promise(() => {});              // a turn-off is still under way...
  w.window.__QK_WAKE__.stopHotword();
  await tick();
  w.window.__QK_WAKE__.startHotword({ word: 'aaria' });   // ...and the turn-on waits its turn behind it
  await tick();
  await w.wake({ hasCommand: true, text: 'what is on my list' });
  ok(w.st.wakes.length === 1, 'wakes are passed on again from the moment listening is turned on, not only when the turn-on has finished');
}
{
  const w = await world({ acceptsText: true });
  w.window.__qkOnWake = function () { throw new Error('the receiver broke'); };
  const warnsBefore = w.st.warns;
  await w.wake({ hasCommand: true, text: 'remind me' });
  ok(w.st.warns > warnsBefore, 'the receiver fails on a one-breath wake: it is written to the log');
}
{
  const w = await world();
  await w.wake({ hasCommand: false });
  w.st.refuse = 'not_in_foreground';                  // Android says not on screen although the page says it is
  const warnsBefore = w.st.warns;
  await w.fire('qk_mic_release');                     // try 1
  ok(w.st.warns > warnsBefore && w.liveTimers().length === 1, 'not on screen according to Android only: the timed retry is written to the log as a warning');
  await w.timePasses();                               // try 2
  await w.timePasses();                               // try 3: no more timed tries
  await w.fire('doc:visibilitychange');               // the return to the screen: refused again
  ok(w.st.starts === 4 && w.liveTimers().length === 1, 'after the return to the screen the timed tries start afresh');
}
{
  const w = await world();
  await w.wake({ hasCommand: false });
  w.window.document.visibilityState = 'hidden';
  w.st.refuse = 'not_in_foreground';
  await w.fire('qk_mic_release');                     // refused while hidden: no timed try
  w.window.document.visibilityState = 'visible';
  await w.fire('doc:visibilitychange');               // timed try 1
  await w.timePasses();                               // timed try 2
  ok(w.st.starts === 3 && w.liveTimers().length === 1, 'the refusal while hidden did not use up one of the timed tries');
  await w.timePasses();                               // timed try 3
  ok(w.st.starts === 4 && w.liveTimers().length === 0, 'three timed tries, then it waits for the return to the screen');
}
// Each thing the bridge does has a time limit of twenty seconds (two minutes only for turning on).
{
  const w = await world();
  w.st.stopGate = new Promise(() => {});
  w.wake({ hasCommand: false });
  await tick();
  ok(w.liveLimits().length === 1 && w.liveLimits()[0].ms === 20000, 'a wake has a time limit of twenty seconds');
}
{
  const w = await world();
  w.st.stopGate = new Promise(() => {});
  w.window.dispatch('qk_mic_claim');
  await tick();
  ok(w.liveLimits().length === 1 && w.liveLimits()[0].ms === 20000, 'giving up the microphone has a time limit of twenty seconds');
}
{
  const w = await world();
  await w.wake({ hasCommand: false });
  w.st.gate = new Promise(() => {});
  w.window.dispatch('qk_mic_release');
  await tick();
  ok(w.liveLimits().length === 1 && w.liveLimits()[0].ms === 20000, 'taking the microphone back has a time limit of twenty seconds');
}
{
  const w = await world();
  await w.wake({ hasCommand: false });
  w.st.gate = new Promise(() => {});
  await w.threeMinutesPass();
  ok(w.liveLimits().length === 1 && w.liveLimits()[0].ms === 20000, 'the safety timer\'s restart has a time limit of twenty seconds');
}
{
  const w = await world();
  await w.wake({ hasCommand: false });
  w.window.document.visibilityState = 'hidden';
  w.st.refuse = 'not_in_foreground';
  await w.fire('qk_mic_release');
  w.st.refuse = '';
  w.st.gate = new Promise(() => {});
  w.window.document.visibilityState = 'visible';
  await w.fire('doc:visibilitychange');
  ok(w.liveLimits().length === 1 && w.liveLimits()[0].ms === 20000, 'the restart on return to the screen has a time limit of twenty seconds');
}
// ---- gaps found by the third independent check of 4 Oct ----
{
  const w = await world();
  await w.wake({ hasCommand: false });
  w.window.document.visibilityState = 'hidden';
  w.st.refuse = 'not_in_foreground';
  await w.fire('qk_mic_release');                     // refused while hidden
  w.window.document.visibilityState = 'visible';
  w.st.refuse = 'service_start_failed';
  await w.fire('doc:visibilitychange');               // back on screen: a different refusal (try 1)
  ok(w.st.starts === 2 && w.liveTimers().length === 1, 'back on screen, the start fails for another reason: a timed retry is set');
  await w.fire('doc:visibilitychange');
  await w.fire('doc:visibilitychange');
  ok(w.st.starts === 2 && w.liveTimers().length === 1, 'switching apps back and forth does not use up the tries');
  w.st.refuse = '';
  await w.timePasses();
  ok(w.st.starts === 3 && w.st.on, 'and the timed retry starts listening');
}
{
  const w = await world();
  await w.wake({ hasCommand: false });
  w.st.refuse = 'not_in_foreground';
  await w.fire('qk_mic_release');                     // visible, refused: 1
  await w.timePasses();                               // visible, refused: 2
  w.window.document.visibilityState = 'hidden';
  await w.timePasses();                               // refused while hidden: no timer
  ok(w.st.starts === 3 && w.liveTimers().length === 0, 'two refusals on screen, then one while hidden: it waits for the return to the screen');
  w.window.document.visibilityState = 'visible';
  await w.fire('doc:visibilitychange');               // refused again on return
  ok(w.st.starts === 4 && w.liveTimers().length === 1, 'refused again on the return to the screen: the timed tries have started afresh');
}
{
  const w = await world();
  w.st.stopThrows = true;
  await w.window.__QK_WAKE__.stopHotword();           // the engine refuses the person's stop: it is still on
  w.st.stopThrows = false;
  await w.fire('qk_mic_claim');                       // the bridge stops it for the microphone
  ok(w.st.stops === 2 && !w.st.on, 'the engine refused Turn off and is still on: a later request for the microphone stops it');
  await w.fire('qk_mic_release');
  await w.timePasses();
  ok(w.st.starts === 0 && !w.st.on && w.liveTimers().length === 0, 'and it is not started again: the person turned listening off');
}
{
  const w = await world({ receiver: false });
  await w.wake({ hasCommand: false });
  w.window.document.visibilityState = 'hidden';
  w.st.refuse = 'not_in_foreground';
  await w.fire('qk_mic_release');                     // refused while hidden: waits for the return to the screen
  w.st.refuse = '';
  w.st.on = true; w.st.waiting = true;                // the web app turned listening on itself meanwhile...
  await w.wake({ hasCommand: false });                // ...and a new wake nobody takes stops it again (three minutes)
  w.window.document.visibilityState = 'visible';
  await w.fire('doc:visibilitychange');
  ok(w.st.starts === 1 && !w.st.on && w.liveTimers().length === 1, 'a new stop forgets an older "start on return to the screen": the return does not start it early');
}
{
  const w = await world();
  w.st.statusEmpty = {};                              // an answer with nothing in it
  const warnsBefore = w.st.warns;
  await w.fire('qk_mic_claim');
  ok(w.st.stops === 0 && w.st.warns > warnsBefore, 'an answer with nothing in it about whether the engine is listening: nothing is stopped, and it is written to the log');
}
{
  const w = await world();
  await w.wake({ hasCommand: false });
  w.st.mode = 'invoke';
  const logsBefore = w.st.logs;
  await w.fire('qk_mic_release');
  ok(w.st.starts === 0 && w.st.logs > logsBefore, 'hands-free switched off in settings: that listening is not started again is noted in the log');
}
{
  const w = await world();
  await w.wake({ hasCommand: false });                // stopped by this bridge
  await w.window.__QK_WAKE__.startHotword({ word: 'aaria' });   // the person turns listening on: the bridge forgets its stop
  await tick();
  ok(w.st.starts === 1 && w.st.on, 'stopped by the bridge, then turned on by the person: it is on');
  w.st.on = false; w.st.waiting = false;              // the person presses Turn off on the notice
  await w.fire('qk_mic_release');
  await w.timePasses();
  ok(w.st.starts === 1 && !w.st.on, 'and the bridge has forgotten its own stop: a later "free" signal or timer starts nothing');
}
{
  const w = await world();
  await w.wake({ hasCommand: false });
  w.st.refuse = 'not_in_foreground';                  // Android says not on screen although the page says it is
  await w.fire('qk_mic_release');
  await w.timePasses();
  await w.timePasses();                               // three refusals: no timer left
  await w.fire('qk_mic_release');                     // another "free" signal: refused again
  ok(w.st.starts === 4 && w.liveTimers().length === 1, 'after three "not on screen" refusals, the next "free" signal has its timed tries again');
}
{
  const w = await world({ acceptsText: true });
  await w.wake({ hasCommand: false, text: 'left over words' });
  ok(w.st.stops === 1 && w.st.wakes.length === 1 && w.st.wakes[0].length === 1, 'a wake that is not marked as carrying a command is a bare wake, whatever else it carries');
}
// ---- gaps found by the fourth independent check of 4 Oct ----
{
  // The two kinds of refusal are counted separately: a "not on screen" one in between does not give the other kind more tries.
  const w = await world();
  await w.wake({ hasCommand: false });
  w.st.refuse = 'service_start_failed';
  await w.fire('qk_mic_release');                     // other: 1
  w.st.refuse = 'not_in_foreground';
  await w.timePasses();                               // not on screen: 1
  w.st.refuse = 'service_start_failed';
  await w.timePasses();                               // other: 2
  w.st.refuse = 'not_in_foreground';
  await w.timePasses();                               // not on screen: 2
  ok(w.st.starts === 4 && w.liveTimers().length === 1, 'refusals of both kinds in turn: still being retried after four');
  w.st.refuse = 'service_start_failed';
  await w.timePasses();                               // other: 3
  ok(w.st.starts === 5 && w.liveTimers().length === 0, 'the third refusal of the other kind is the last try, although "not on screen" refusals came in between');
  w.st.refuse = '';
  await w.fire('doc:visibilitychange');
  await w.fire('qk_mic_release');
  ok(w.st.starts === 5 && !w.st.on, 'and it is given up');
}
{
  // ...and the other kind in between does not give "not on screen" more timed tries.
  const w = await world();
  await w.wake({ hasCommand: false });
  w.st.refuse = 'not_in_foreground';
  await w.fire('qk_mic_release');                     // not on screen: 1
  w.st.refuse = 'service_start_failed';
  await w.timePasses();                               // other: 1
  w.st.refuse = 'not_in_foreground';
  await w.timePasses();                               // not on screen: 2
  w.st.refuse = 'service_start_failed';
  await w.timePasses();                               // other: 2
  w.st.refuse = 'not_in_foreground';
  await w.timePasses();                               // not on screen: 3
  ok(w.st.starts === 5 && w.liveTimers().length === 0, 'the third "not on screen" refusal sets no more timer, although other refusals came in between');
  w.st.refuse = '';
  await w.fire('doc:visibilitychange');
  ok(w.st.starts === 6 && w.st.on, 'and it is not given up: the return to the screen starts listening');
}
{
  const w = await world({ newEngine: true, holdThrows: true });
  await w.wake({ hasCommand: false });                // the pause fails: stopped instead
  w.st.refuse = 'service_start_failed';
  await w.fire('qk_mic_release');
  await w.timePasses();                               // two refusals so far
  w.st.holdThrows = false;
  await w.fire('qk_mic_claim');                       // a new request (this time the pause works)
  await w.fire('qk_mic_release');                     // refused: try one of the new count
  ok(w.liveTimers().length === 1 && w.liveTimers()[0].ms === 30000, 'newer engine: a new "I need the microphone" starts the count of tries again, as on the older one');
}
{
  const w = await world();
  w.st.statusEmpty = { listening: 'true' };           // not a yes-or-no answer
  const warnsBefore = w.st.warns;
  await w.fire('qk_mic_claim');
  ok(w.st.stops === 0 && w.st.warns > warnsBefore, 'an answer that is not a plain yes or no: nothing is stopped on it, and it is written to the log');
}
{
  const w = await world({ on: false });
  w.st.refuse = 'consent_required';
  let asked = 0; w.window.__qkAariaNeedsConsent = () => { asked++; };
  const logsBefore = w.st.logs;
  await w.window.__QK_WAKE__.startHotword({ word: 'aaria' });
  await tick();
  ok(asked === 1 && w.st.logs > logsBefore, 'turning on needs consent first: the person is asked, and it is noted in the log');
}
// ---- gaps named by the fifth independent check of 4 Oct (which passed the bridge itself) ----
{
  const w = await world();
  w.st.waiting = false;                               // older engine after a bare wake: on, but says "not listening"
  await w.fire('qk_mic_claim');                       // QuietKeep asks; nothing can be stopped on that answer
  ok(w.st.stops === 0 && w.st.on, 'older engine that says "not listening": a request stops nothing');
  await w.wake({ hasCommand: false });                // a wake proves it is on
  ok(w.st.stops === 1 && w.st.wakes.length === 1 && w.st.engineHadMicWhenTold === false, 'a wake while QuietKeep has already asked for the microphone: the engine still gives it up before QuietKeep is told');
}
{
  const w = await world({ newEngine: true, holdThrows: true });
  await w.wake({ hasCommand: false });                // the pause fails: stopped instead
  w.st.refuse = 'not_in_foreground';
  await w.fire('qk_mic_release');                     // not on screen: 1
  await w.timePasses();                               // not on screen: 2
  w.st.holdThrows = false;
  await w.fire('qk_mic_claim');                       // a new request (this time the pause works)
  await w.fire('qk_mic_release');                     // refused: 1 of the new count
  await w.timePasses();                               // refused: 2 of the new count
  ok(w.st.starts === 4 && w.liveTimers().length === 1, 'a new "I need the microphone" also starts the "not on screen" count again');
}
{
  const w = await world({ receiver: false });
  await w.wake({ hasCommand: false });                // nobody takes it: stopped, three minutes set
  w.st.refuse = 'service_start_failed';
  await w.timePasses();                               // refused: 1
  await w.timePasses();                               // refused: 2
  w.st.on = true; w.st.waiting = true;                // the engine turns out to be on after all...
  await w.wake({ hasCommand: false });                // ...and another wake nobody takes stops it again
  await w.timePasses();                               // three minutes later: refused, 1 of the new count
  ok(w.liveTimers().length === 1 && w.liveTimers()[0].ms === 30000, 'a wake that the bridge acts on by stopping the engine starts the counts again');
}
{
  const w = await world({ newEngine: true });
  w.st.on = false; w.st.waiting = false;              // the person pressed Turn off on the notice as the wake left
  await w.wake({ hasCommand: false });
  ok(w.st.holds === 1 && w.st.stops === 0, 'newer engine answers "nothing to pause, listening is off": nothing is stopped');
  await w.fire('qk_mic_release');
  await w.timePasses();
  ok(w.st.starts === 0 && !w.st.on, 'so nothing is started again afterwards: Turn off on the notice stands');
}
{
  const w = await world();
  await w.window.__QK_WAKE__.stopHotword();
  await w.window.__QK_WAKE__.stopHotword();
  ok(w.st.stops === 2, 'a second Turn off is passed to the engine as well');
}
{
  const w = await world({ newEngine: true, holdThrows: true, receiver: false });
  await w.fire('qk_mic_claim');                       // the pause fails: stopped instead
  await w.threeMinutesPass();                         // nobody said "free": started again by the timer
  ok(w.st.starts === 1 && w.st.on, 'stop path: the timer starts listening again');
  w.st.holdThrows = false;
  await w.wake({ hasCommand: false });                // a wake nobody takes
  ok(w.st.holds === 1 && !w.st.held && w.st.stops === 1, 'the timer also ends the "QuietKeep asked" note: a later wake nobody takes places no pause');
}
{
  const w = await world({ on: false });
  w.st.nameThrows = true;
  const warnsBefore = w.st.warns;
  await w.window.__QK_WAKE__.startHotword({ word: 'aaria' });
  await tick();
  ok(w.st.starts === 0 && !w.st.on && w.st.warns > warnsBefore, 'the wake name cannot be set: listening is not turned on, and it is written to the log');
}
// ---- the native side (MicGuard.java) uses the same two signals ----
{
  const w = await world();
  ok(w.window.__qkEdgeMicBridge === true, 'the page says it has the bridge, so native voice capture asks it for the microphone instead of turning listening off');
}
if (failed) { console.error(failed + ' check(s) failed'); process.exit(1); }
console.log('All wake-bridge checks passed.');
