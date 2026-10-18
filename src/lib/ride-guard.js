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
import { createHazardWarner, metresBetween } from '@/lib/hazard-alerts';
import { createStayAwakeCompanion } from '@/lib/ride-care';
import { createFatigueTracker } from '@/lib/fatigue-voice';
import { setDriveSpeed } from '@/lib/drive-speed';
import { yawRateFrom, createManoeuvreDetector, createIndicatorAssist } from '@/lib/indicator-assist';
import { detectIndicatorSound } from '@/lib/indicator-sound';
import { listenEnergy, stopEnergy } from '@/lib/drive-energy';
import { supabase } from '@/lib/supabase';
import { speak } from '@/components/VoiceTalkback';

const COUNTDOWN_SECONDS = 30;
const CANCEL_WORDS = [
  'im okay', "i'm okay", 'i am okay', 'okay', 'ok', 'fine', 'im fine', "i'm fine",
  'theek', 'theek hu', 'theek hoon', 'main theek hu', 'bagunnanu', 'baagunnanu',
];
const HELP_PHRASE = /help[^a-z]+help/i; // "help help" or "help help help"

// Typical delay between the end of speech and the recogniser's final
// result (end-of-speech silence). An estimate, used only by the fatigue check.
const RECOGNISER_FINAL_DELAY_MS = 800;

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

function createListener({ onCancelWord, onHelpWord, onAnyReply }) {
  const SR = typeof window !== 'undefined'
    ? (window.SpeechRecognition || window.webkitSpeechRecognition)
    : null;
  if (!SR) return { start() {}, stop() {}, isListening() { return false; } };

  let rec = null;
  let wanted = false;
  let failures = 0;

  function handle(event) {
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const said = (event.results[i][0]?.transcript || '').toLowerCase().trim();
      if (!said) continue;
      if (HELP_PHRASE.test(said)) { onHelpWord(said); return; }
      // DRV-04: any spoken answer counts for the fatigue check — including
      // "I'm fine" / "okay", which are also cancel words. Without this the
      // most likely answer to "how are you feeling?" was dropped and then
      // scored as NO reply (3 points), pushing an alert rider to 'drowsy'.
      onAnyReply?.(said, now());
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

  // DRV-04: the fatigue check only asks when the mic is really listening;
  // a busy or denied mic must never be scored as "the rider did not answer".
  function isListening() { return !!rec; }

  return { start, stop, isListening };
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
  let currentSpeedKmh = null;

  // DRV-11: 'off' | 'reminders' | 'listen'. Storage can throw in some
  // WebViews / private modes; an unknown value falls back to the default.
  let indicatorMode = 'reminders';
  try {
    const m = typeof window !== 'undefined' ? window.localStorage.getItem('qk_indicator_mode') : null;
    if (m === 'off' || m === 'reminders' || m === 'listen') indicatorMode = m;
  } catch { /* keep the default */ }
  const manoeuvreDetector = createManoeuvreDetector();
  const indicatorAssist = createIndicatorAssist({ mode: indicatorMode });

  // DRV-11c: listen for the indicator's tick/beep for a few seconds after a
  // turn or lane change - ONLY when the driver turned "Also listen for the
  // indicator sound" on (default OFF). The microphone half is the voice
  // thread's IndicatorEar (DRV-11b): energy numbers only, never audio, and it
  // pauses Aaria's wake word for just the listen. At most one listen a minute.
  const INDICATOR_LISTEN_SECONDS = 5;
  const INDICATOR_LISTEN_DELAY_MS = 1500;   // let the manoeuvre finish first
  const INDICATOR_LISTEN_GAP_MS = 60_000;
  let indicatorListening = false;
  let lastIndicatorListenAt = -Infinity;
  let indicatorListenTimer = null;
  let guardStopped = false;

  function maybeListenForIndicator(events) {
    if (indicatorMode !== 'listen' || guardStopped) return;
    if (!events || !events.some((e) => e.type === 'turn_done' || e.type === 'lane_change')) return;
    const at = now();
    if (indicatorListening || indicatorListenTimer || at - lastIndicatorListenAt < INDICATOR_LISTEN_GAP_MS) return;
    // Never during a crash check-in, or while a fatigue question waits for
    // the rider's spoken answer (the ride listener must hear it).
    if (overlayShown || tracker.hasPendingQuestion()) return;
    indicatorListenTimer = setTimeout(async () => {
      indicatorListenTimer = null;
      if (guardStopped || overlayShown || tracker.hasPendingQuestion()) return;
      indicatorListening = true;
      lastIndicatorListenAt = now();
      listener.stop();   // the ride listener gives the mic up for these seconds
      try {
        const r = await listenEnergy({ seconds: INDICATOR_LISTEN_SECONDS });
        if (r.ok && !guardStopped) {
          const sound = detectIndicatorSound(r.energies, { frameRate: r.hz });
          indicatorAssist.indicatorOn(sound.on, now());
          onState?.('indicator_heard', { on: sound.on, rateHz: sound.rateHz, confidence: sound.confidence });
        }
      } catch { /* no reading: the assist falls back to the plain reminder */ }
      finally {
        indicatorListening = false;
        if (!guardStopped) listener.start();
      }
    }, INDICATOR_LISTEN_DELAY_MS);
  }

  const tracker = createFatigueTracker();
  let noReplyTimer = null;
  let questionAskedAtMs = 0;
  let lastFatigueLevel = tracker.level();

  function checkFatigueLevelChange() {
    const current = tracker.classify?.() || { level: tracker.level(), reasons: [] };
    if (current.level !== lastFatigueLevel) {
      lastFatigueLevel = current.level;
      onState?.('fatigue', { level: current.level, reasons: current.reasons });
    }
  }

  const listener = createListener({
    onCancelWord: () => { if (overlayShown) cancel('voice'); },
    onHelpWord: () => { if (!overlayShown) trigger({ manual: true }); },
    onAnyReply: (said, at) => {
      if (overlayShown) return;
      if (!tracker.hasPendingQuestion()) return;
      // Ignore what the mic hears while our own question is still being
      // spoken (the phone's speaker echoing Aaria), so an echo can never
      // count as the rider answering.
      if (at < questionAskedAtMs || /quick check/i.test(String(said))) return;
      if (noReplyTimer) { clearTimeout(noReplyTimer); noReplyTimer = null; }
      // The recogniser only reports when the answer is FINISHED (after its
      // end-of-speech silence). Estimate when speaking started so the reply
      // time is not inflated by the length of the answer itself. Speaking
      // speed is therefore not measurable live (slow_speech never fires
      // from this path) — documented in docs/fatigue-voice-v1.md.
      const words = String(said).trim().split(/\s+/).filter(Boolean).length;
      const endAt = at - RECOGNISER_FINAL_DELAY_MS;
      const startAt = endAt - Math.round((words / 2.5) * 1000);
      tracker.recordReply({ transcript: said, at, startAt, endAt: null });
      checkFatigueLevelChange();
    },
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

  // ── Hard braking ───────────────────────────────────────────────────────
  // A braking spot is worth remembering only if the rider was actually moving
  // and lost real speed quickly. The thresholds below (was doing at least
  // 25 km/h, shed at least 18 km/h within two seconds) sit above ordinary
  // town riding, so a normal slow-down for a turn is not recorded. A spot is
  // logged at most once every 20 seconds, so one long braking event does not
  // become twenty rows.
  const BRAKE_MIN_SPEED_KMH = 25;
  const BRAKE_MIN_DROP_KMH_PER_S = 9;   // ~18 km/h shed in two seconds
  const BRAKE_COOLDOWN_MS = 20000;
  let lastSpeedSample = null;
  let lastBrakeLoggedAt = 0;

  function noteBraking(kmh) {
    const at = now();
    const previous = lastSpeedSample;
    lastSpeedSample = { kmh, at };
    if (!previous) return;

    const seconds = (at - previous.at) / 1000;
    if (seconds <= 0.4 || seconds > 4) return;      // too close together, or a gap in the signal
    if (previous.kmh < BRAKE_MIN_SPEED_KMH) return; // not really travelling
    const dropPerSecond = (previous.kmh - kmh) / seconds;
    if (dropPerSecond < BRAKE_MIN_DROP_KMH_PER_S) return;
    if (at - lastBrakeLoggedAt < BRAKE_COOLDOWN_MS) return;
    if (typeof lastFix.lat !== 'number' || typeof lastFix.lng !== 'number') return;

    lastBrakeLoggedAt = at;
    const token = getAccessToken?.();
    fetch('/api/ride/road-event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token || ''}` },
      body: JSON.stringify({
        kind: 'hard_brake',
        lat: lastFix.lat,
        lng: lastFix.lng,
        accuracy: lastFix.accuracy ?? null,
        speedBeforeKmh: Math.round(previous.kmh),
        speedAfterKmh: Math.round(kmh),
        decelKmhPerS: Math.round(dropPerSecond * 10) / 10,
      }),
      keepalive: true, // the ride may end moments later
    }).catch(() => { /* offline: the spot is simply not recorded */ });

    onState?.('hard_brake', { speedBeforeKmh: previous.kmh, decelKmhPerS: dropPerSecond });
  }

  // ── Warnings about spots ahead ─────────────────────────────────────────
  // The braking spots collected above are only worth collecting if they come
  // back out as a warning in time to matter. The quiet rules live in
  // hazard-alerts.js; this part only fetches the spots near the rider and
  // speaks what comes back. Spots are refetched when the rider has moved a
  // kilometre, or every five minutes, so one ride is a handful of requests.
  const SPOTS_REFRESH_MS = 5 * 60 * 1000;
  const SPOTS_REFRESH_METRES = 1000;
  const warner = createHazardWarner();
  let spots = [];
  let spotsFetchedAt = 0;
  let spotsFetchedNear = null;
  let fetchingSpots = false;
  let lastHeadingDeg = null;

  async function refreshSpots(at) {
    if (fetchingSpots) return;
    if (typeof lastFix.lat !== 'number') return;
    const stale = at - spotsFetchedAt > SPOTS_REFRESH_MS;
    const moved = !spotsFetchedNear || metresBetween(lastFix, spotsFetchedNear) > SPOTS_REFRESH_METRES;
    if (!stale && !moved) return;

    fetchingSpots = true;
    try {
      const token = getAccessToken?.();
      const res = await fetch('/api/ride/hazards-near', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token || ''}` },
        body: JSON.stringify({ lat: lastFix.lat, lng: lastFix.lng, radiusMetres: 3000 }),
      });
      const data = await res.json();
      if (Array.isArray(data?.spots)) {
        spots = data.spots;
        spotsFetchedAt = at;
        spotsFetchedNear = { lat: lastFix.lat, lng: lastFix.lng };
      }
    } catch { /* offline: the ride simply goes unwarned */ }
    fetchingSpots = false;
  }

  // Everything that speaks during a ride records when it did, so the others
  // can stay out of the way. One voice, one thing at a time.
  let lastSpokeAt = 0;

  function checkForHazardAhead(kmh) {
    const at = now();
    refreshSpots(at);
    if (!spots.length || typeof lastFix.lat !== 'number') return;
    if (overlayShown) return; // a crash check-in is on screen; nothing else speaks
    const warning = warner.update(
      { lat: lastFix.lat, lng: lastFix.lng, headingDeg: lastHeadingDeg, speedKmh: kmh, at },
      spots
    );
    if (!warning) return;
    speak(warning.phrase);
    lastSpokeAt = at;
    onState?.('hazard_warning', warning);
  }

  // ── Staying awake on a long or late ride ───────────────────────────────
  // A hazard warning is about the road ahead; this is about the rider. It
  // speaks rarely, and every line points at stopping rather than at talking.
  const companion = createStayAwakeCompanion();

  function checkStayAwake(kmh) {
    if (overlayShown) return;
    const at = now();
    const nudge = companion.update({
      at,
      speedKmh: kmh,
      somethingElseSpokeAt: lastSpokeAt,
      drowsy: tracker.level() === 'drowsy',
    });
    if (!nudge) return;
    speak(nudge.phrase);
    lastSpokeAt = at;
    onState?.('stay_awake', nudge);

    const words = nudge.phrase.trim().split(/\s+/).length;
    const speechDurationMs = Math.round((words / 2.5) * 1000);
    const questionAskedAt = at + speechDurationMs;
    // Ask only when the mic is really listening (see isListening above).
    if (!listener.isListening()) return;
    tracker.recordQuestion(questionAskedAt);
    questionAskedAtMs = questionAskedAt;

    if (noReplyTimer) clearTimeout(noReplyTimer);
    noReplyTimer = setTimeout(() => {
      noReplyTimer = null;
      tracker.recordNoReply(questionAskedAt + 8000);
      checkFatigueLevelChange();
    }, speechDurationMs + 8000);
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

    // DRV-01: Call into blackbox plugin when existing crash detector fires (without changing its logic)
    if (typeof window !== 'undefined' && window.Capacitor?.Plugins?.QkBlackbox) {
      try { window.Capacitor.Plugins.QkBlackbox.saveLast60s({ trigger: 'crash_detector' }); } catch {}
    }

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

    if (event.rotationRate && typeof currentSpeedKmh === 'number') {
      const yawDps = yawRateFrom(event.rotationRate, a);
      const atMs = now();
      const events = manoeuvreDetector.feed({
        at: atMs,
        yawDps,
        speedKmh: currentSpeedKmh,
        headingDeg: lastHeadingDeg,
      });
      maybeListenForIndicator(events);

      if (!overlayShown) {
        const phrase = indicatorAssist.update(events, {
          somethingElseSpokeAt: lastSpokeAt,
          speedKmh: currentSpeedKmh,
          at: atMs,
        });
        if (phrase) {
          speak(phrase);
          lastSpokeAt = atMs;
          const primaryEvent = (events && events.length > 0) ? events[0] : null;
          onState?.('indicator', { phrase, event: primaryEvent });
        }
      }
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

  // ── Distance, service and fuel ─────────────────────────────────────────
  // Rides were timed but never measured, so nothing could say how far the
  // vehicle had gone since its last service. Distance is added up from the
  // same location fixes the rest of this file already uses: no extra sensor,
  // no extra permission, no second trail of where the rider went.
  let distanceMetres = 0;
  let lastDistanceFix = null;

  function addDistance(fix) {
    if (!fix || typeof fix.lat !== 'number') return;
    if (lastDistanceFix) {
      const step = metresBetween(lastDistanceFix, fix);
      // Ignore jumps: a parked phone drifts a few metres, and a lost signal
      // comes back hundreds of metres away. Neither is distance ridden.
      if (step > 8 && step < 400) distanceMetres += step;
    }
    lastDistanceFix = { lat: fix.lat, lng: fix.lng };
  }

  async function reportRideDistance() {
    const km = Math.round((distanceMetres / 1000) * 100) / 100;
    if (km < 0.3) return; // too short to be a ride
    try {
      const token = getAccessToken?.();
      await fetch('/api/ride/upkeep', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token || ''}` },
        body: JSON.stringify({ event: 'ride', distanceKm: km }),
        keepalive: true, // the screen is closing as this is sent
      });
    } catch { /* offline: the ride's distance is simply not counted */ }
  }

  // At the start of a ride, say at most ONE thing, and only when it is worth
  // hearing: fuel running low, or a service due. Said once, at a standstill,
  // before the rider has pulled away — never mid-ride competing with a
  // hazard warning or a crash check-in.
  (async () => {
    try {
      const token = getAccessToken?.();
      const res = await fetch('/api/ride/upkeep', {
        headers: { Authorization: `Bearer ${token || ''}` },
      });
      const status = await res.json();
      if (status?.spoken && !overlayShown) {
        setTimeout(() => { if (!overlayShown) speak(status.spoken); }, 2500);
        onState?.('upkeep', status);
      }
    } catch { /* offline: no reminder this ride */ }
  })();

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
      if (noReplyTimer) { clearTimeout(noReplyTimer); noReplyTimer = null; }
      tracker.reset();
      listener.stop();
      panel.remove();
      if (typeof window !== 'undefined') window.removeEventListener('devicemotion', onMotion);
      guardStopped = true;
      if (indicatorListenTimer) { clearTimeout(indicatorListenTimer); indicatorListenTimer = null; }
      if (indicatorListening) stopEnergy();
      manoeuvreDetector.reset();
      indicatorAssist.reset();
      reportRideDistance();
      onState?.('stopped', {});
    },
    feedSpeed(kmh, fix) {
      if (fix && typeof fix.lat === 'number') { addDistance(fix); lastFix = { ...fix, at: now() }; }
      if (fix && typeof fix.headingDeg === 'number') lastHeadingDeg = fix.headingDeg;
      else if (fix && typeof fix.heading === 'number') lastHeadingDeg = fix.heading;
      if (typeof kmh === 'number') {
        currentSpeedKmh = kmh;
        detector.feedSpeed({ kmh, at: now() });
        noteBraking(kmh);
        checkForHazardAhead(kmh);
        checkStayAwake(kmh);
      }
    },
    lastKnownFix() {
      return typeof lastFix.lat === 'number' ? { lat: lastFix.lat, lng: lastFix.lng } : null;
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
  setDriveSpeed(kmh); // DRV-02: Aaria sends this to the server's speed gate
  guard?.feedSpeed(kmh, fix);
}

/**
 * Nearest hospital to where the rider is now. Speaks it and hands back the
 * place, so the caller can open it in maps. Used by the voice command and,
 * later, by the crash alert so the family knows where to go.
 */
function currentPosition() {
  // Used when the ride guard is not running — the Drive Mode screen can ask
  // for a hospital without a ride having been started.
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
    );
  });
}

export async function nearestHospitalNow() {
  let fix = guard?.lastKnownFix?.();
  if (!fix || typeof fix.lat !== 'number') fix = await currentPosition();
  if (!fix || typeof fix.lat !== 'number') {
    speak('I cannot get your location. Please allow location and try again.');
    return null;
  }
  try {
    const res = await fetch('/api/ride/nearest-hospital', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lat: fix.lat, lng: fix.lng }),
    });
    const data = await res.json();
    if (!data?.hospital) {
      speak('I could not find a hospital nearby right now.');
      return null;
    }
    const km = Math.round(data.hospital.metres / 100) / 10;
    speak(`Nearest hospital is ${data.hospital.name}, about ${km} kilometres away.`);
    return data.hospital;
  } catch {
    speak('I could not look that up right now.');
    return null;
  }
}

/** The "test my crash detection" button. Records a drill, messages nobody. */
export function runRideGuardTest() {
  if (!guard) { makeToast('Start driving mode first, then run the test.'); return; }
  guard.runTest();
}

export function isRideGuardActive() { return !!guard; }
