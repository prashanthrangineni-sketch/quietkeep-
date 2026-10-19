// tests/indicator-assist.test.mjs
// Unit tests for indicator-assist: yaw projection, manoeuvre detection, assist reminders, rate limits.

import {
  CONSTANTS,
  PHRASES,
  yawRateFrom,
  createManoeuvreDetector,
  createIndicatorAssist,
} from '../src/lib/indicator-assist.js';

let pass = 0;
let fail = 0;

function eq(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) {
    console.log(`      expected: ${JSON.stringify(want)}`);
    console.log(`      got     : ${JSON.stringify(got)}`);
    fail++;
  } else {
    pass++;
  }
}

function approxEq(name, got, want, tolerance = 0.05) {
  const diff = Math.abs(got - want);
  const ok = diff <= tolerance;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} (got ${got}, want ${want})`);
  if (!ok) {
    fail++;
  } else {
    pass++;
  }
}

// ── 1. Constants ─────────────────────────────────────────────────────────────
eq('CONSTANTS.MIN_SPEED_KMH is 8', CONSTANTS.MIN_SPEED_KMH, 8);
eq('CONSTANTS.LANE_CHANGE_MIN_SPEED_KMH is 25', CONSTANTS.LANE_CHANGE_MIN_SPEED_KMH, 25);
eq('CONSTANTS.LANE_CHANGE_YAW_EXCURSION_DPS is 3', CONSTANTS.LANE_CHANGE_YAW_EXCURSION_DPS, 3);
eq('CONSTANTS.LANE_CHANGE_MAX_NET_HEADING_DEG is 12', CONSTANTS.LANE_CHANGE_MAX_NET_HEADING_DEG, 12);
eq('CONSTANTS.TURN_MIN_HEADING_DEG is 45', CONSTANTS.TURN_MIN_HEADING_DEG, 45);
eq('CONSTANTS.TURN_STEADY_YAW_DPS is 2', CONSTANTS.TURN_STEADY_YAW_DPS, 2);
eq('CONSTANTS.TURN_STEADY_TIME_S is 3', CONSTANTS.TURN_STEADY_TIME_S, 3);
eq('CONSTANTS.INDICATOR_STILL_ON_DELAY_S is 6', CONSTANTS.INDICATOR_STILL_ON_DELAY_S, 6);
eq('CONSTANTS.LANE_CHANGE_PRE_CHECK_S is 4', CONSTANTS.LANE_CHANGE_PRE_CHECK_S, 4);
eq('CONSTANTS.REMINDERS_COOLDOWN_MS is 300000', CONSTANTS.REMINDERS_COOLDOWN_MS, 300000);
eq('CONSTANTS.SPEECH_QUIET_AFTER_OTHER_MS is 120000', CONSTANTS.SPEECH_QUIET_AFTER_OTHER_MS, 120000);
eq('CONSTANTS.SPEECH_MIN_INTERVAL_MS is 120000', CONSTANTS.SPEECH_MIN_INTERVAL_MS, 120000);
eq('CONSTANTS.MAX_PHRASES_PER_HOUR is 6', CONSTANTS.MAX_PHRASES_PER_HOUR, 6);

// ── 2. yawRateFrom orientations ──────────────────────────────────────────────
// Target true yaw rate: 10 deg/s counter-clockwise around Earth vertical
{
  // Phone flat, screen up: gravity reaction vector is +z
  const flat = yawRateFrom({ alpha: 10, beta: 0, gamma: 0 }, { x: 0, y: 0, z: 9.8 });
  approxEq('yawRateFrom: phone flat screen-up', flat, 10);

  // Phone upright in portrait mount (facing driver): gravity reaction is +y
  const upright = yawRateFrom({ alpha: 0, beta: 0, gamma: 10 }, { x: 0, y: 9.8, z: 0 });
  approxEq('yawRateFrom: phone upright portrait', upright, 10);

  // Phone in landscape mount (turned 90 deg): gravity reaction is +x
  const landscape = yawRateFrom({ alpha: 0, beta: 10, gamma: 0 }, { x: 9.8, y: 0, z: 0 });
  approxEq('yawRateFrom: phone landscape', landscape, 10);

  // Phone tilted 30 deg back from upright (tilted dashboard mount)
  const rad30 = (30 * Math.PI) / 180;
  const tilted = yawRateFrom(
    { alpha: 10 * Math.sin(rad30), beta: 0, gamma: 10 * Math.cos(rad30) },
    { x: 0, y: 9.8 * Math.cos(rad30), z: 9.8 * Math.sin(rad30) }
  );
  approxEq('yawRateFrom: phone tilted 30 deg', tilted, 10);

  // Compare all four orientations: all within 0.05 tolerance of each other
  approxEq('all 4 mount orientations match flat reference', Math.abs(flat - tilted), 0);
  approxEq('upright matches flat', Math.abs(flat - upright), 0);
  approxEq('landscape matches flat', Math.abs(flat - landscape), 0);
}

// ── 3. Manoeuvre detector: Lane changes ───────────────────────────────────────
{
  // Left lane change at 40 km/h: yaw +4 deg/s for 1.5s, then -4 deg/s for 1.5s, net heading < 12 deg
  const detector = createManoeuvreDetector();
  let t = 1000;
  const dt = 100; // 10 Hz feed
  const detectedEvents = [];

  // Excursion 1: 1.5s at +4 dps (yaw left)
  for (let i = 0; i < 15; i++) {
    t += dt;
    const evts = detector.feed({ at: t, yawDps: 4.0, speedKmh: 40 });
    detectedEvents.push(...evts);
  }

  // Excursion 2: 1.5s at -4 dps (counter-steer right, 1.5s after excursion 1)
  for (let i = 0; i < 15; i++) {
    t += dt;
    const evts = detector.feed({ at: t, yawDps: -4.0, speedKmh: 40 });
    detectedEvents.push(...evts);
  }

  // Settle straight
  for (let i = 0; i < 10; i++) {
    t += dt;
    const evts = detector.feed({ at: t, yawDps: 0.0, speedKmh: 40 });
    detectedEvents.push(...evts);
  }

  const lcLeft = detectedEvents.find((e) => e.type === 'lane_change');
  eq('lane change left at 40 km/h detected', Boolean(lcLeft), true);
  eq('lane change left direction is left', lcLeft?.direction, 'left');
}

{
  // Right lane change at 80 km/h
  const detector = createManoeuvreDetector();
  let t = 1000;
  const dt = 100;
  const detectedEvents = [];

  // Excursion 1: 1.2s at -5 dps (steer right)
  for (let i = 0; i < 12; i++) {
    t += dt;
    const evts = detector.feed({ at: t, yawDps: -5.0, speedKmh: 80 });
    detectedEvents.push(...evts);
  }

  // Excursion 2: 1.2s at +5 dps (counter-steer left)
  for (let i = 0; i < 12; i++) {
    t += dt;
    const evts = detector.feed({ at: t, yawDps: 5.0, speedKmh: 80 });
    detectedEvents.push(...evts);
  }

  // Settle straight
  for (let i = 0; i < 10; i++) {
    t += dt;
    const evts = detector.feed({ at: t, yawDps: 0.0, speedKmh: 80 });
    detectedEvents.push(...evts);
  }

  const lcRight = detectedEvents.find((e) => e.type === 'lane_change');
  eq('lane change right at 80 km/h detected', Boolean(lcRight), true);
  eq('lane change right direction is right', lcRight?.direction, 'right');
}

// ── 4. Manoeuvre detector: Gentle curve NOT a lane change ─────────────────────
{
  // A gentle curve: one-way yaw, heading change 25 deg
  const detector = createManoeuvreDetector();
  let t = 1000;
  const dt = 100;
  const detectedEvents = [];

  // Turning curve: yaw +3.5 dps for 7 seconds = 24.5 deg heading change (one direction only)
  for (let i = 0; i < 70; i++) {
    t += dt;
    const evts = detector.feed({ at: t, yawDps: 3.5, speedKmh: 50 });
    detectedEvents.push(...evts);
  }

  // Straighten out
  for (let i = 0; i < 20; i++) {
    t += dt;
    const evts = detector.feed({ at: t, yawDps: 0.0, speedKmh: 50 });
    detectedEvents.push(...evts);
  }

  const lc = detectedEvents.find((e) => e.type === 'lane_change');
  eq('gentle curve is NOT a lane change', Boolean(lc), false);
}

// ── 5. Manoeuvre detector: 90 deg turn + turn_done ───────────────────────────
{
  const detector = createManoeuvreDetector();
  let t = 1000;
  const dt = 100;
  const detectedEvents = [];

  // Turn left: 15 dps for 6 seconds = 90 deg turn at 20 km/h
  for (let i = 0; i < 60; i++) {
    t += dt;
    const evts = detector.feed({ at: t, yawDps: 15.0, speedKmh: 20 });
    detectedEvents.push(...evts);
  }

  const turn = detectedEvents.find((e) => e.type === 'turn');
  eq('90 deg turn detected', Boolean(turn), true);
  eq('turn direction is left', turn?.direction, 'left');

  // Straighten: yaw 0.0 dps (|yaw| < 2 dps) for 3.5 seconds = turn_done
  for (let i = 0; i < 35; i++) {
    t += dt;
    const evts = detector.feed({ at: t, yawDps: 0.0, speedKmh: 20 });
    detectedEvents.push(...evts);
  }

  const turnDone = detectedEvents.find((e) => e.type === 'turn_done');
  eq('turn_done detected after 3s steady heading', Boolean(turnDone), true);
  eq('turn_done direction is left', turnDone?.direction, 'left');
}

// ── 6. Ignore everything below 8 km/h ────────────────────────────────────────
{
  const detector = createManoeuvreDetector();
  let t = 1000;
  const dt = 100;
  const detectedEvents = [];

  // Strong turning motion at 5 km/h (walking/crawling pace)
  for (let i = 0; i < 60; i++) {
    t += dt;
    const evts = detector.feed({ at: t, yawDps: 15.0, speedKmh: 5 });
    detectedEvents.push(...evts);
  }
  for (let i = 0; i < 40; i++) {
    t += dt;
    const evts = detector.feed({ at: t, yawDps: 0.0, speedKmh: 5 });
    detectedEvents.push(...evts);
  }

  eq('speed < 8 km/h produces no turn events', detectedEvents.length, 0);
}

// ── 7. Bumpy road noise produces no events ───────────────────────────────────
{
  const detector = createManoeuvreDetector();
  let t = 1000;
  const dt = 100;
  const detectedEvents = [];

  // Random vibration yaw between -2.0 and +2.0 dps at 45 km/h
  for (let i = 0; i < 200; i++) {
    t += dt;
    // deterministic pseudo-noise
    const noise = Math.sin(i * 0.7) * 1.8;
    const evts = detector.feed({ at: t, yawDps: noise, speedKmh: 45 });
    detectedEvents.push(...evts);
  }

  eq('bumpy road noise yaw (random +/-2 deg/s) produces no events', detectedEvents.length, 0);
}

// ── 8. Indicator Assist: 'reminders' mode ─────────────────────────────────────
{
  const assist = createIndicatorAssist({ mode: 'reminders' });

  // Turn done event
  const turnDoneEvt = [{ type: 'turn_done', at: 10000, direction: 'left', speedKmh: 30 }];
  const phrase = assist.update(turnDoneEvt, { at: 10000, speedKmh: 30 });
  eq('reminders mode: turn_done -> "Check your indicator is off."', phrase, 'Check your indicator is off.');

  // Immediate subsequent turn_done within 5 minutes -> rate limited
  const phrase2 = assist.update(turnDoneEvt, { at: 15000, speedKmh: 30 });
  eq('reminders mode: turn_done within 5 min cooldown returns null', phrase2, null);

  // Lane change in reminders mode -> never nags
  const lcEvt = [{ type: 'lane_change', at: 1000000, direction: 'left', speedKmh: 40 }];
  const phraseLc = assist.update(lcEvt, { at: 1000000, speedKmh: 40 });
  eq('reminders mode: lane change never nags', phraseLc, null);
}

// ── 9. Indicator Assist: 'listen' mode with sound known ───────────────────────
{
  // A CONTINUOUS sound source (future) can know whether the driver indicated
  // before a lane change; the phone's on-demand listens cannot (DRV-11c).
  const assist = createIndicatorAssist({ mode: 'listen', soundCoverage: 'continuous' });

  // Indicator sound known (signal fed)
  assist.indicatorOn(false, 1000);

  // 1) Lane change with NO ticking in 4s before it -> "Indicate before changing lanes."
  const lcEvt = [{ type: 'lane_change', at: 10000, startAt: 8000, direction: 'left', speedKmh: 40 }];
  const phraseNoTick = assist.update(lcEvt, { at: 10000, speedKmh: 40 });
  eq('listen mode: lane change without ticking -> "Indicate before changing lanes."',
    phraseNoTick, 'Indicate before changing lanes.');
}

{
  const assist = createIndicatorAssist({ mode: 'listen', soundCoverage: 'continuous' });
  // Indicator WAS ticking in the 4s before the lane change
  assist.indicatorOn(true, 7000); // 1s before startAt (8000)
  const lcEvt = [{ type: 'lane_change', at: 10000, startAt: 8000, direction: 'left', speedKmh: 40 }];
  const phraseTicked = assist.update(lcEvt, { at: 10000, speedKmh: 40 });
  eq('listen mode: lane change with ticking -> no nag', phraseTicked, null);
}

{
  // 2) After turn_done, if indicator is still ticking 6s later -> "Your indicator is still on."
  const assist = createIndicatorAssist({ mode: 'listen' });
  assist.indicatorOn(true, 1000); // signal active

  const turnDoneEvt = [{ type: 'turn_done', at: 10000, direction: 'left', speedKmh: 30 }];
  const immediate = assist.update(turnDoneEvt, { at: 10000, speedKmh: 30 });
  eq('listen mode: turn_done immediate response is null (scheduled for 6s)', immediate, null);

  // At 5s: still not 6s
  const at5s = assist.update([], { at: 15000, speedKmh: 30 });
  eq('listen mode: at 5s after turn_done returns null', at5s, null);

  // At 6s (16000ms): indicator is STILL ticking
  assist.indicatorOn(true, 16000);
  const at6s = assist.update([], { at: 16000, speedKmh: 30 });
  eq('listen mode: at 6s with indicator still on -> "Your indicator is still on."',
    at6s, 'Your indicator is still on.');
}

// ── 10. Global rate limits ───────────────────────────────────────────────────
{
  const assist = createIndicatorAssist({ mode: 'reminders' });

  // 1) never within 2 minutes of other speech (somethingElseSpokeAt)
  const turnDone = [{ type: 'turn_done', at: 10000, speedKmh: 30 }];
  const phraseOtherSpeech = assist.update(turnDone, {
    at: 10000,
    speedKmh: 30,
    somethingElseSpokeAt: 9000, // spoken 1s ago
  });
  eq('never within 2 minutes of other speech', phraseOtherSpeech, null);

  // 2) speed < 8 km/h -> silent
  const phraseSlow = assist.update(turnDone, {
    at: 150000, // 2+ min later
    speedKmh: 6,  // below 8 km/h
  });
  eq('nothing while speed < 8 km/h', phraseSlow, null);

  // 3) exactly 1 phrase spoken successfully
  const phraseOk = assist.update(turnDone, {
    at: 200000,
    speedKmh: 30,
  });
  eq('speech permitted when limits pass', phraseOk, 'Check your indicator is off.');

  // 4) never more than 1 indicator phrase per 2 minutes
  const phraseTooSoon = assist.update(turnDone, {
    at: 250000, // only 50s after previous phrase
    speedKmh: 30,
  });
  eq('never more than 1 indicator phrase per 2 minutes', phraseTooSoon, null);
}

{
  // 5) at most 6 phrases per hour
  const assist = createIndicatorAssist({ mode: 'reminders' });
  let t = 1000000;
  let count = 0;

  for (let i = 0; i < 10; i++) {
    t += 6 * 60 * 1000; // 6 min step (passes 5 min reminder cooldown and 2 min interval)
    const turnDone = [{ type: 'turn_done', at: t, speedKmh: 30 }];
    const p = assist.update(turnDone, { at: t, speedKmh: 30 });
    if (p) count++;
  }
  eq('at most 6 indicator phrases per hour', count, 6);
}

// ── 11. Mode 'off' ───────────────────────────────────────────────────────────
{
  const assist = createIndicatorAssist({ mode: 'off' });
  assist.indicatorOn(true, 1000);
  const turnDone = [{ type: 'turn_done', at: 10000, speedKmh: 30 }];
  const lc = [{ type: 'lane_change', at: 10000, startAt: 8000, speedKmh: 40 }];

  eq('off mode returns null for turn_done', assist.update(turnDone, { at: 10000, speedKmh: 30 }), null);
  eq('off mode returns null for lane_change', assist.update(lc, { at: 10000, speedKmh: 40 }), null);
  eq('off mode returns null at 6s check', assist.update([], { at: 16000, speedKmh: 30 }), null);
}

// ── 12. Multilingual phrases (en / hi / te) ──────────────────────────────────
{
  eq('PHRASES has en, hi, te', Object.keys(PHRASES).sort(), ['en', 'hi', 'te']);
  eq('en phrases correct', PHRASES.en.indicator_still_on, 'Your indicator is still on.');
  eq('hi phrases correct', PHRASES.hi.indicator_still_on, 'आपका इंडिकेटर अभी भी चालू है।');
  eq('te phrases correct', PHRASES.te.indicator_still_on, 'మీ ఇండికేటర్ ఇంకా ఆన్‌లో ఉంది.');

  const assistHi = createIndicatorAssist({ mode: 'reminders', lang: 'hi' });
  const turnDone = [{ type: 'turn_done', at: 10000, speedKmh: 30 }];
  const phraseHi = assistHi.update(turnDone, { at: 10000, speedKmh: 30 });
  eq('reminders in Hindi produces natural Hindi line', phraseHi, 'चेक करें कि इंडिकेटर बंद है।');

  const assistTe = createIndicatorAssist({ mode: 'reminders', lang: 'te' });
  const phraseTe = assistTe.update(turnDone, { at: 10000, speedKmh: 30 });
  eq('reminders in Telugu produces natural Telugu line', phraseTe, 'ఇండికేటర్ ఆఫ్ చేశారో లేదో చూడండి.');
}

// ── DRV-11c: on-demand listening (the phone's real mode) ─────────────────────
{
  // Default coverage is on-demand: a lane change NEVER produces the
  // "indicate before" nag, because nothing was listening before it.
  const a1 = createIndicatorAssist({ mode: 'listen' });
  a1.indicatorOn(false, 1000);
  const lc = a1.update([{ type: 'lane_change', at: 10000, startAt: 8000, direction: 'left', speedKmh: 40 }], { at: 10000, speedKmh: 40 });
  eq('on-demand: lane change never nags "indicate before"', lc, null);

  // A stale "on" from an EARLIER listen must not trigger "still on".
  const a2 = createIndicatorAssist({ mode: 'listen' });
  a2.indicatorOn(true, 1000);                       // old reading, before the turn
  a2.update([{ type: 'turn_done', at: 200000, direction: 'left', speedKmh: 30 }], { at: 200000, speedKmh: 30 });
  eq('on-demand: stale reading ignored at the check point', a2.update([], { at: 206500, speedKmh: 30 }), null);
  eq('on-demand: no fresh reading within the grace -> falls back to the plain reminder',
    a2.update([], { at: 213000, speedKmh: 30 }), 'Check your indicator is off.');
  a2.indicatorOn(true, 213500);                     // too late for that turn
  eq('on-demand: a late reading after the check was dropped says nothing', a2.update([], { at: 213600, speedKmh: 30 }), null);

  // A fresh reading taken after the turn, landing ~7.7 s later (listen + settle) -> "still on".
  const a3 = createIndicatorAssist({ mode: 'listen' });
  a3.update([{ type: 'turn_done', at: 300000, direction: 'right', speedKmh: 30 }], { at: 300000, speedKmh: 30 });
  a3.indicatorOn(true, 307700);
  eq('on-demand: fresh "on" after the turn -> "Your indicator is still on."',
    a3.update([], { at: 307700, speedKmh: 30 }), 'Your indicator is still on.');

  // A fresh "off" -> nothing.
  const a4 = createIndicatorAssist({ mode: 'listen' });
  a4.update([{ type: 'turn_done', at: 400000, direction: 'right', speedKmh: 30 }], { at: 400000, speedKmh: 30 });
  a4.indicatorOn(false, 407700);
  eq('on-demand: fresh "off" after the turn -> silent', a4.update([], { at: 407700, speedKmh: 30 }), null);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
