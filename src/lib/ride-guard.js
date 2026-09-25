// src/lib/ride-guard.js
// The bridge between the phone and the crash detector.
//
// crash-detect.js decides WHETHER something was a crash; this file is what
// actually runs during a ride: it listens to the phone's motion sensor, feeds
// it speed from the driving screen, speaks the check-in, shows the countdown,
// takes "I'm okay" as a cancel, listens for "help help help", and finally
// calls /api/ride/crash-alert.
//
// It is a plain module, not a React component, so the driving screen only has
// to start and stop it. It paints its own overlay so a rider on the floor sees
// one enormous CANCEL button and nothing else.
//
// Safety rules kept here on purpose:
//   - Nothing is ever sent without a spoken countdown the rider can cancel.
//   - The countdown is 30 seconds. Long enough to answer, short enough to help.
//   - A drill (test mode) never messages anybody.
//   - If the microphone is unavailable, the big button still cancels; voice is
//     an extra, never the only way out.

import { createCrashDetector } from '@/lib/crash-detect';
import { supabase } from '@/lib/supabase';
import { speak } from '@/components/VoiceTalkback';

const COUNTDOWN_SECONDS = 30;
const CANCEL_WORDS = [
  'im okay', "i'm okay", 'i am okay', 'okay', 'ok', 'fine', 'im fine', "i'm fine",
  'theek', 'theek hu', 'theek hoon', 'main theek hu', 'bagunnanu', 'baagunnanu',
];
const HELP_PHRASE = /help[^a-z]+help/i; // "help help" or "help help help"

let guard = null; // the one live guard; a ride never needs two

function now() { return Date.now(); }

function makeOverlay() {
  const wrap = document.createElement('div');
  wrap.setAttribute('data-ride-guard', 'true');
  wrap.style.cssText = [
    'position:fixed', 'inset:0', 'z-index:99999', 'display:flex',
    'flex-direction:column', 'align-items:center', 'justify-content:center',
    'gap:24px', 'padding:24px', 'background:#7f1d1d', 'color:#fff',
    'font-family:system-ui,-apple-system,sans-serif', 'text-align:center',
  ].join(';');

  const title = document.createElement('div');
  title.style.cssText = 'font-size:30px;font-weight:700;line-height:1.2';
  title.textContent = 'Are you okay?';

  const count = document.createElement('div');
  count.style.cssText = 'font-size:72px;font-weight:800;letter-spacing:-2px';

  const sub = document.createElement('div');
  sub.style.cssText = 'font-size:17px;opacity:.9;max-width:320px;line-height:1.4';
  sub.textContent = 'If you do not answer, your emergency contacts will be sent your location.';

  const cancel = document.createElement('button');
  cancel.style.cssText = [
    'width:100%', 'max-width:340px', 'padding:26px', 'border:none', 'border-radius:18px',
    'background:#fff', 'color:#7f1d1d', 'font-size:26px', 'font-weight:800', 'cursor:pointer',
  ].join(';');
  cancel.textContent = "I'M OKAY";

  const sendNow = document.createElement('button');
  sendNow.style.cssText = [
    'width:100%', 'max-width:340px', 'padding:16px', 'border:2px solid rgba(255,255,255,.7)',
    'border-radius:14px', 'background:transparent', 'color:#fff', 'font-size:17px',
    'font-weight:600', 'cursor:pointer',
  ].join(';');
  sendNow.textContent = 'Send for help now';

  wrap.append(title, count, sub, cancel, sendNow);
  return { wrap, title, count, sub, cancel, sendNow };
}

function makeToast(text) {
  const el = document.createElement('div');
  el.style.cssText = [
    'position:fixed', 'left:50%', 'bottom:96px', 'transform:translateX(-50%)',
    'z-index:99998', 'max-width:86vw', 'padding:14px 18px', 'border-radius:14px',
    'background:rgba(17,24,39,.95)', 'color:#fff', 'font-size:15px', 'line-height:1.35',
    'font-family:system-ui,-apple-system,sans-serif', 'text-align:center',
  ].join(';');
  el.textContent = text;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 7000);
}

function createListener({ onCancelWord, onHelpWord }) {
  const SR = typeof window !== 'undefined'
    ? (window.SpeechRecognition || window.webkitSpeechRecognition)
    : null;
  if (!SR) return { start() {}, stop() {} };

  let rec = null;
  let wanted = false;
  let failures = 0;

  function handle(event) {
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const said = (event.results[i][0]?.transcript || '').toLowerCase().trim();
      if (!said) continue;
      if (HELP_PHRASE.test(said)) { onHelpWord(said); return; }
      const clean = said.replace(/[^a-z\s']/g, ' ').replace(/\s+/g, ' ').trim();
      if (CANCEL_WORDS.some(w => clean === w || clean.endsWith(' ' + w) || clean.startsWith(w + ' '))) {
        onCancelWord(said);
        return;
      }
    }
  }

  function start() {
    wanted = true;
    if (rec) return;
    try {
      rec = new SR();
      rec.continuous = true;
      rec.interimResults = false;
      rec.lang = 'en-IN';
      rec.onresult = handle;
      rec.onerror = () => { failures += 1; };
      rec.onend = () => {
        rec = null;
        // The microphone may be busy with Aaria. Back off rather than fight it.
        if (wanted && failures < 6) setTimeout(() => { if (wanted) start(); }, 1200 + failures * 800);
      };
      rec.start();
    } catch {
      rec = null; // No microphone permission: the big button still works.
    }
  }

  function stop() {
    wanted = false;
    try { rec?.stop(); } catch { /* already stopped */ }
    rec = null;
  }

  return { start, stop };
}

/**
 * Start watching a ride.
 * @param {() => (string|null)} getAccessToken  the signed-in user's token
 * @param {(state: string, detail: object) => void} [onState]  for the screen's status line
 */
export function startRideGuard({ getAccessToken, onState } = {}) {
  stopRideGuard();

  let detector = createCrashDetector();
  const ui = makeOverlay();
  let overlayShown = false;
  let countdownTimer = null;
  let secondsLeft = COUNTDOWN_SECONDS;
  let lastFix = { lat: null, lng: null, accuracy: null, at: 0 };
  let lastCrash = null;
  let armedAt = now();

  const listener = createListener({
    onCancelWord: () => { if (overlayShown) cancel('voice'); },
    onHelpWord: () => { if (!overlayShown) trigger({ manual: true }); },
  });

  function hide() {
    if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
    if (overlayShown) { ui.wrap.remove(); overlayShown = false; }
  }

  function cancel(reason) {
    hide();
    // A cancelled crash leaves the detector in its 'crash' state, which would
    // make it deaf for the rest of the ride. Start it afresh so the next fall
    // is still caught, and give the sensors a moment before arming again.
    detector = createCrashDetector();
    armedAt = now();
    lastCrash = null;
    onState?.('dismissed', { reason });
    speak("Good. I'll keep watching.");
  }

  async function send({ test = false } = {}) {
    const token = getAccessToken?.();
    const payload = {
      test,
      lat: lastFix.lat,
      lng: lastFix.lng,
      accuracy: lastFix.accuracy,
      impactG: lastCrash?.impactG ?? null,
      speedBeforeKmh: lastCrash?.speedBeforeKmh ?? null,
    };
    try {
      const res = await fetch('/api/ride/crash-alert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token || ''}` },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (test) {
        makeToast(json.contacts_found
          ? `Drill recorded. ${json.contacts_found} emergency contact(s) found. Nobody was messaged.`
          : 'Drill recorded, but you have no emergency contacts saved yet.');
        speak('Test finished. Nobody was contacted.');
        return json;
      }
      if (json.delivery === 'sent') {
        speak('Help has been asked for. Your location was sent.');
        makeToast('Crash recorded and your contacts were messaged.');
      } else if (json.delivery === 'not_configured') {
        speak('I have recorded this. Please call for help.');
        makeToast('Crash recorded. Automatic messaging is not switched on, so nobody was messaged.');
      } else {
        speak('I have recorded this. Please call for help.');
        makeToast('Crash recorded. The messages could not be delivered.');
      }
      onState?.('alerted', json);
      return json;
    } catch (e) {
      makeToast('Crash recorded on this phone, but the alert could not be sent (no internet?).');
      onState?.('alert_failed', { error: String(e) });
      return null;
    }
  }

  function trigger(detail = {}) {
    if (overlayShown) return;
    lastCrash = detail;
    secondsLeft = COUNTDOWN_SECONDS;
    ui.title.textContent = detail.manual ? 'Asking for help' : 'Are you okay?';
    ui.count.textContent = String(secondsLeft);
    document.body.appendChild(ui.wrap);
    overlayShown = true;
    onState?.('suspected_crash', detail);

    speak(detail.manual
      ? 'I heard you ask for help. Sending your location in thirty seconds. Tap I am okay to stop.'
      : 'I think you may have had an accident. Are you okay? Say I am okay, or tap the button. Otherwise I will alert your family in thirty seconds.');

    listener.start();
    countdownTimer = setInterval(() => {
      secondsLeft -= 1;
      ui.count.textContent = String(Math.max(secondsLeft, 0));
      if (secondsLeft === 10) speak('Ten seconds.');
      if (secondsLeft <= 0) {
        hide();
        send({ test: false });
      }
    }, 1000);
  }

  ui.cancel.addEventListener('click', () => cancel('button'));
  ui.sendNow.addEventListener('click', () => { hide(); send({ test: false }); });

  function onMotion(event) {
    const a = event.accelerationIncludingGravity;
    if (!a || a.x == null) return;
    const g = Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z) / 9.80665;
    const state = detector.feedMotion({ magnitudeG: g, at: now() });
    if (state === 'crash' && !overlayShown && now() - armedAt > 4000) {
      trigger(detector.lastCrashDetail?.() || { impactG: g, speedBeforeKmh: null });
    }
  }

  detector.onStateChange?.((state, detail) => {
    if (state === 'crash' && !overlayShown) trigger(detail || {});
  });

  if (typeof window !== 'undefined') window.addEventListener('devicemotion', onMotion);
  listener.start(); // so "help help help" works before any crash
  onState?.('watching', {});

  // A small strip the rider can see and test with, without the driving screen
  // needing to know anything about how crash watching works.
  const panel = document.createElement('div');
  panel.setAttribute('data-ride-guard-panel', 'true');
  panel.style.cssText = [
    'position:fixed', 'left:12px', 'right:12px', 'bottom:12px', 'z-index:9998',
    'display:flex', 'align-items:center', 'justify-content:space-between', 'gap:12px',
    'padding:12px 14px', 'border-radius:14px', 'background:rgba(6,78,59,.96)',
    'color:#fff', 'font-family:system-ui,-apple-system,sans-serif', 'font-size:14px',
  ].join(';');
  const panelText = document.createElement('span');
  panelText.textContent = 'Crash watch on. Say "help help help" any time.';
  const panelBtn = document.createElement('button');
  panelBtn.style.cssText = [
    'flex:none', 'padding:10px 14px', 'border:1px solid rgba(255,255,255,.6)',
    'border-radius:10px', 'background:transparent', 'color:#fff', 'font-size:13px',
    'font-weight:600', 'cursor:pointer',
  ].join(';');
  panelBtn.textContent = 'Test';
  panelBtn.addEventListener('click', () => { guard?.runTest(); });
  // Crash alerts are worthless with nobody to send them to, so the screen that
  // adds contacts is reachable from here instead of being buried in the menu.
  const panelContacts = document.createElement('button');
  panelContacts.style.cssText = panelBtn.style.cssText;
  panelContacts.textContent = 'Contacts';
  panelContacts.addEventListener('click', () => { window.location.href = '/emergency'; });
  panel.append(panelText, panelContacts, panelBtn);
  document.body.appendChild(panel);

  // Tell the rider plainly if a crash alert would reach nobody.
  (async () => {
    try {
      const { count } = await supabase
        .from('emergency_contacts')
        .select('id', { count: 'exact', head: true });
      if (!count) {
        panel.style.background = 'rgba(146,64,14,.96)';
        panelText.textContent = 'Crash watch on, but no emergency contact is saved. Tap Contacts.';
      }
    } catch { /* offline: leave the strip as it is */ }
  })();

  guard = {
    stop() {
      hide();
      listener.stop();
      panel.remove();
      if (typeof window !== 'undefined') window.removeEventListener('devicemotion', onMotion);
      onState?.('stopped', {});
    },
    feedSpeed(kmh, fix) {
      if (fix && typeof fix.lat === 'number') lastFix = { ...fix, at: now() };
      if (typeof kmh === 'number') detector.feedSpeed({ kmh, at: now() });
    },
    runTest() {
      lastCrash = { impactG: 3.2, speedBeforeKmh: null, test: true };
      speak('This is a test. Nobody will be contacted.');
      send({ test: true });
    },
  };
  return guard;
}

export function stopRideGuard() {
  try { guard?.stop(); } catch { /* nothing to stop */ }
  guard = null;
}

/** The driving screen calls this from its GPS watcher. */
export function feedRideSpeed(kmh, fix) {
  guard?.feedSpeed(kmh, fix);
}

/** The "test my crash detection" button. Records a drill, messages nobody. */
export function runRideGuardTest() {
  if (!guard) { makeToast('Start driving mode first, then run the test.'); return; }
  guard.runTest();
}

export function isRideGuardActive() { return !!guard; }
