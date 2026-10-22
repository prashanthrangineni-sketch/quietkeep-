// tests/anomaly-watch.test.mjs
// Tests for anomaly-watch: routeDeviation, phoneSnatch, longUnexpectedStop, and normal commute false-alarm guard.

import {
  CONSTANTS,
  metresBetween,
  corridorDistance,
  routeDeviation,
  phoneSnatch,
  longUnexpectedStop,
  createAnomalyWatcher,
} from '../src/lib/anomaly-watch.js';

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

function approxEq(name, got, want, tol = 1.0) {
  const ok = Math.abs(got - want) <= tol;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} (got ${got}, want ${want})`);
  if (!ok) {
    fail++;
  } else {
    pass++;
  }
}

// ── 1. Constants & Distance Math ─────────────────────────────────────────────
eq('CONSTANTS.DEVIATION_WATCH_MS is 3 minutes', CONSTANTS.DEVIATION_WATCH_MS, 180000);
eq('CONSTANTS.DEVIATION_HIGH_MS is 6 minutes', CONSTANTS.DEVIATION_HIGH_MS, 360000);
eq('CONSTANTS.SNATCH_JERK_MIN_G is 2.5', CONSTANTS.SNATCH_JERK_MIN_G, 2.5);
eq('CONSTANTS.SNATCH_JERK_MAX_MS is 300', CONSTANTS.SNATCH_JERK_MAX_MS, 300);
eq('CONSTANTS.SNATCH_WINDOW_MS is 20000', CONSTANTS.SNATCH_WINDOW_MS, 20000);
eq('CONSTANTS.STOP_MIN_DURATION_MS is 10 minutes', CONSTANTS.STOP_MIN_DURATION_MS, 600000);
eq('CONSTANTS.NIGHT_START_HOUR is 23', CONSTANTS.NIGHT_START_HOUR, 23);
eq('CONSTANTS.NIGHT_END_HOUR is 5', CONSTANTS.NIGHT_END_HOUR, 5);

// Math checks
{
  const a = { lat: 17.3850, lng: 78.4867 }; // Hyderabad
  const b = { lat: 17.3950, lng: 78.4867 }; // ~1110 m north
  const dist = metresBetween(a, b);
  approxEq('metresBetween latitude span', dist, 1112, 15);

  // Point on line AB has 0 corridor distance
  const mid = { lat: 17.3900, lng: 78.4867 };
  approxEq('corridorDistance on line is ~0', corridorDistance(mid, a, b), 0, 0.5);

  // Point offset 0.001 deg longitude east (~106 m)
  const offset = { lat: 17.3900, lng: 78.4877 };
  const dCorr = corridorDistance(offset, a, b);
  approxEq('corridorDistance off line is ~106 m', dCorr, 106, 5);
}

// ── 2. Scorer 1: routeDeviation ──────────────────────────────────────────────
// Origin: Hyderabad Charminar (17.3616, 78.4747), Destination: Secunderabad (17.4399, 78.4983)
const origin = { lat: 17.3616, lng: 78.4747 };
const destination = { lat: 17.4399, lng: 78.4983 };

// Scenario 1: Diverging from corridor for 3.5 minutes while moving away from destination -> watch
{
  const t0 = 1000000;
  const fixes = [
    { lat: 17.3616, lng: 78.4747, at: t0, speedKmh: 40 },
    { lat: 17.3800, lng: 78.4800, at: t0 + 60000, speedKmh: 40 }, // en route
    // Starts turning away sharply east-south (increasing corridor distance & destination distance)
    { lat: 17.3750, lng: 78.5000, at: t0 + 120000, speedKmh: 40 }, // +1 min into divergence
    { lat: 17.3700, lng: 78.5200, at: t0 + 180000, speedKmh: 40 }, // +2 min
    { lat: 17.3650, lng: 78.5400, at: t0 + 240000, speedKmh: 40 }, // +3 min
    { lat: 17.3600, lng: 78.5600, at: t0 + 270000, speedKmh: 40 }, // +3.5 min into divergence
  ];
  const r = routeDeviation({ destination, fixes, origin });
  eq('routeDeviation Scenario 1: 3.5 minutes divergence -> watch', r.level, 'watch');
  eq('routeDeviation Scenario 1: reasons has 1 item', r.reasons.length, 1);
  eq('routeDeviation Scenario 1: kind is route_deviation', r.kind, 'route_deviation');
}

// Scenario 2: Diverging from corridor for 6.5 minutes while moving away from destination -> high
{
  const t0 = 1000000;
  const fixes = [
    { lat: 17.3616, lng: 78.4747, at: t0, speedKmh: 40 },
    { lat: 17.3800, lng: 78.4800, at: t0 + 60000, speedKmh: 40 },
    // Sustained 6.5-minute diversion moving away
    { lat: 17.3750, lng: 78.5000, at: t0 + 120000, speedKmh: 40 },
    { lat: 17.3700, lng: 78.5200, at: t0 + 180000, speedKmh: 40 },
    { lat: 17.3650, lng: 78.5400, at: t0 + 240000, speedKmh: 40 },
    { lat: 17.3600, lng: 78.5600, at: t0 + 300000, speedKmh: 40 },
    { lat: 17.3550, lng: 78.5800, at: t0 + 360000, speedKmh: 40 },
    { lat: 17.3500, lng: 78.6000, at: t0 + 420000, speedKmh: 40 },
    { lat: 17.3450, lng: 78.6200, at: t0 + 510000, speedKmh: 40 }, // 6.5 min from t0+120000
  ];
  const r = routeDeviation({ destination, fixes, origin });
  eq('routeDeviation Scenario 2: 6.5 minutes divergence -> high', r.level, 'high');
  eq('routeDeviation Scenario 2: reasons has 1 item', r.reasons.length, 1);
}

// Scenario 3: U-turn and heading opposite direction for 4 minutes -> watch
{
  const t0 = 1000000;
  const fixes = [
    { lat: 17.3616, lng: 78.4747, at: t0, speedKmh: 40 },
    { lat: 17.3900, lng: 78.4820, at: t0 + 100000, speedKmh: 40 },
    // Turns back and drives away south-west for 4 minutes
    { lat: 17.3800, lng: 78.4700, at: t0 + 160000, speedKmh: 40 },
    { lat: 17.3600, lng: 78.4500, at: t0 + 220000, speedKmh: 40 },
    { lat: 17.3400, lng: 78.4300, at: t0 + 280000, speedKmh: 40 },
    { lat: 17.3200, lng: 78.4100, at: t0 + 340000, speedKmh: 40 },
    { lat: 17.3000, lng: 78.3900, at: t0 + 400000, speedKmh: 40 }, // 4 min since t0+160000
  ];
  const r = routeDeviation({ destination, fixes, origin });
  eq('routeDeviation Scenario 3: 4 minutes driving away -> watch', r.level, 'watch');
}

// Non-firing routeDeviation cases
{
  // No destination provided -> none
  const rNoDest = routeDeviation({ fixes: [{ lat: 17.36, lng: 78.47, at: 0 }, { lat: 17.37, lng: 78.48, at: 60000 }] });
  eq('routeDeviation: no destination -> none', rNoDest.level, 'none');

  // Direct normal commute along corridor towards destination -> none
  const normalFixes = [
    { lat: 17.3616, lng: 78.4747, at: 0, speedKmh: 40 },
    { lat: 17.3800, lng: 78.4800, at: 60000, speedKmh: 40 },
    { lat: 17.4000, lng: 78.4860, at: 120000, speedKmh: 40 },
    { lat: 17.4200, lng: 78.4920, at: 180000, speedKmh: 40 },
    { lat: 17.4350, lng: 78.4970, at: 240000, speedKmh: 40 },
  ];
  const rNormal = routeDeviation({ destination, fixes: normalFixes, origin });
  eq('routeDeviation: moving towards destination -> none', rNormal.level, 'none');

  // Short detour (< 3 minutes) before returning -> none
  const shortDetour = [
    { lat: 17.3616, lng: 78.4747, at: 0, speedKmh: 40 },
    { lat: 17.3800, lng: 78.4800, at: 60000, speedKmh: 40 },
    { lat: 17.3750, lng: 78.5000, at: 120000, speedKmh: 40 },
    { lat: 17.3700, lng: 78.5100, at: 180000, speedKmh: 40 }, // only 1 minute of moving away
  ];
  const rShort = routeDeviation({ destination, fixes: shortDetour, origin });
  eq('routeDeviation: short detour (<3m) -> none', rShort.level, 'none');
}

// ── 3. Scorer 2: phoneSnatch ─────────────────────────────────────────────────
// Scenario 1: Stationary (speed 0 km/h), sharp jerk 3.2 g for 120 ms, followed by running speed 12 km/h within 10 s -> watch
{
  const tJerk = 10000;
  const now = 20000; // 10 s after jerk
  const r = phoneSnatch({
    motion: { peakG: 3.2, durationMs: 120, at: tJerk, speedBeforeKmh: 0 },
    speedKmh: 12,
    now,
  });
  eq('phoneSnatch Scenario 1: stationary -> jerk 3.2g 120ms -> 12 km/h at 10s -> watch', r.level, 'watch');
  eq('phoneSnatch Scenario 1: reasons has 1 item', r.reasons.length, 1);
  eq('phoneSnatch Scenario 1: kind is phone_snatch', r.kind, 'phone_snatch');
}

// Scenario 2: Walking (speed 4 km/h), sharp jerk 2.8 g for 180 ms, followed by running speed 15 km/h within 18 s -> watch
{
  const tJerk = 50000;
  const now = 68000; // 18 s after jerk (within 20s window)
  const r = phoneSnatch({
    motion: { peakG: 2.8, durationMs: 180, at: tJerk, speedBeforeKmh: 4 },
    speedKmh: 15,
    now,
  });
  eq('phoneSnatch Scenario 2: walking 4 km/h -> jerk 2.8g -> 15 km/h at 18s -> watch', r.level, 'watch');
}

// Scenario 3: Stationary with raw motion samples array: sharp jerk > 2.5g for 150ms -> 9 km/h running pace -> watch
{
  const samples = [
    { g: 1.0, at: 1000, speedKmh: 2 },
    { g: 3.5, at: 1100, speedKmh: 2 },
    { g: 3.8, at: 1180, speedKmh: 2 },
    { g: 1.1, at: 1250, speedKmh: 2 }, // spike duration: 150 ms (< 300 ms)
  ];
  const now = 6000; // 5 seconds later
  const r = phoneSnatch({
    motion: samples,
    speedKmh: 9, // running pace (8-20 km/h)
    speedBeforeKmh: 2,
    now,
  });
  eq('phoneSnatch Scenario 3: sample array jerk -> 9 km/h at 5s -> watch', r.level, 'watch');
}

// Non-firing phoneSnatch cases & safety limit (never high in v1)
{
  // In vehicle before jerk (speed 30 km/h >= 8 km/h) -> none
  const rInVehicle = phoneSnatch({
    motion: { peakG: 3.5, durationMs: 100, at: 10000, speedBeforeKmh: 30 },
    speedKmh: 15,
    now: 15000,
  });
  eq('phoneSnatch: was in vehicle before jerk (30 km/h) -> none', rInVehicle.level, 'none');

  // Walking pace after jerk (5 km/h < 8 km/h) -> none
  const rSlow = phoneSnatch({
    motion: { peakG: 3.5, durationMs: 100, at: 10000, speedBeforeKmh: 0 },
    speedKmh: 5,
    now: 15000,
  });
  eq('phoneSnatch: post-jerk speed 5 km/h (walking pace) -> none', rSlow.level, 'none');

  // Vehicle speed after jerk (45 km/h > 20 km/h) -> none
  const rCar = phoneSnatch({
    motion: { peakG: 3.5, durationMs: 100, at: 10000, speedBeforeKmh: 0 },
    speedKmh: 45,
    now: 15000,
  });
  eq('phoneSnatch: post-jerk speed 45 km/h (vehicle speed) -> none', rCar.level, 'none');

  // Prolonged bump (400 ms >= 300 ms) -> none
  const rSlowBump = phoneSnatch({
    motion: { peakG: 3.5, durationMs: 400, at: 10000, speedBeforeKmh: 0 },
    speedKmh: 12,
    now: 15000,
  });
  eq('phoneSnatch: jerk duration 400 ms (>= 300 ms) -> none', rSlowBump.level, 'none');

  // Jerk too low (2.2 g <= 2.5 g) -> none
  const rWeak = phoneSnatch({
    motion: { peakG: 2.2, durationMs: 100, at: 10000, speedBeforeKmh: 0 },
    speedKmh: 12,
    now: 15000,
  });
  eq('phoneSnatch: jerk 2.2 g (<= 2.5 g) -> none', rWeak.level, 'none');

  // Expired window (25 s > 20 s) -> none
  const rExpired = phoneSnatch({
    motion: { peakG: 3.5, durationMs: 100, at: 10000, speedBeforeKmh: 0 },
    speedKmh: 12,
    now: 35000, // 25 s later
  });
  eq('phoneSnatch: running speed after 25 s (> 20 s window) -> none', rExpired.level, 'none');

  // Never returns high in v1
  const rHighCheck = phoneSnatch({
    motion: { peakG: 6.0, durationMs: 50, at: 10000, speedBeforeKmh: 0 },
    speedKmh: 18,
    now: 12000,
  });
  eq('phoneSnatch: never returns high in v1 (max level is watch)', rHighCheck.level === 'high', false);
  eq('phoneSnatch: returns watch for strong jerk', rHighCheck.level, 'watch');
}

// ── 4. Scorer 3: longUnexpectedStop ──────────────────────────────────────────
// Helper to construct Date at specific hour
function dateAt(hour, minute = 0) {
  const d = new Date(2026, 9, 22, hour, minute, 0, 0);
  return d;
}

// Scenario 1: Stopped 15 minutes at 01:00 AM (night) in unfamiliar spot during a ride -> watch
{
  const tStopStart = dateAt(1, 0).getTime();
  const tNow = tStopStart + 15 * 60 * 1000; // 01:15 AM (15 minutes stopped)
  const fixes = [
    // Prior ride activity
    { lat: 17.3800, lng: 78.4800, at: tStopStart - 10 * 60 * 1000, speedKmh: 35 },
    { lat: 17.3900, lng: 78.4850, at: tStopStart - 5 * 60 * 1000, speedKmh: 40 },
    { lat: 17.4000, lng: 78.4900, at: tStopStart - 1 * 60 * 1000, speedKmh: 15 },
    // Stopped at unvisited spot
    { lat: 17.4010, lng: 78.4905, at: tStopStart, speedKmh: 0 },
    { lat: 17.4010, lng: 78.4906, at: tStopStart + 5 * 60 * 1000, speedKmh: 0 },
    { lat: 17.4011, lng: 78.4905, at: tNow, speedKmh: 0 },
  ];
  const r = longUnexpectedStop({ fixes, now: tNow, knownStops: [] });
  eq('longUnexpectedStop Scenario 1: 01:15 AM stopped 15m -> watch', r.level, 'watch');
  eq('longUnexpectedStop Scenario 1: reasons has 1 item', r.reasons.length, 1);
  eq('longUnexpectedStop Scenario 1: kind is unexpected_stop', r.kind, 'unexpected_stop');
}

// Scenario 2: Stopped 12 minutes at 23:45 (11:45 PM night) on highway shoulder -> watch
{
  const tStopStart = dateAt(23, 33).getTime();
  const tNow = dateAt(23, 45).getTime(); // 12 min stopped
  const fixes = [
    { lat: 17.5000, lng: 78.3000, at: tStopStart - 15 * 60 * 1000, speedKmh: 60 },
    { lat: 17.5500, lng: 78.3200, at: tStopStart - 5 * 60 * 1000, speedKmh: 55 },
    { lat: 17.5800, lng: 78.3300, at: tStopStart, speedKmh: 0 },
    { lat: 17.5800, lng: 78.3301, at: tNow, speedKmh: 0 },
  ];
  const r = longUnexpectedStop({ fixes, now: tNow });
  eq('longUnexpectedStop Scenario 2: 23:45 stopped 12m -> watch', r.level, 'watch');
}

// Scenario 3: Stopped 25 minutes at 04:30 AM (early morning night window) -> watch
{
  const tStopStart = dateAt(4, 5).getTime();
  const tNow = dateAt(4, 30).getTime(); // 25 min stopped
  const fixes = [
    { lat: 17.4100, lng: 78.4200, at: tStopStart - 20 * 60 * 1000, speedKmh: 30 },
    { lat: 17.4300, lng: 78.4300, at: tStopStart, speedKmh: 0 },
    { lat: 17.4300, lng: 78.4300, at: tNow, speedKmh: 0 },
  ];
  const r = longUnexpectedStop({ fixes, now: tNow });
  eq('longUnexpectedStop Scenario 3: 04:30 AM stopped 25m -> watch', r.level, 'watch');
}

// Non-firing longUnexpectedStop cases
{
  const tStopStart = dateAt(14, 0).getTime(); // 2:00 PM (daytime)
  const tNow = tStopStart + 15 * 60 * 1000;
  const dayFixes = [
    { lat: 17.3800, lng: 78.4800, at: tStopStart - 10 * 60 * 1000, speedKmh: 35 },
    { lat: 17.4010, lng: 78.4905, at: tStopStart, speedKmh: 0 },
    { lat: 17.4010, lng: 78.4905, at: tNow, speedKmh: 0 },
  ];
  const rDay = longUnexpectedStop({ fixes: dayFixes, now: tNow });
  eq('longUnexpectedStop: daytime 14:00 stop -> none', rDay.level, 'none');

  // Stopped at night at a known place (e.g. home in knownStops) -> none
  const tNight = dateAt(2, 0).getTime();
  const homeLoc = { lat: 17.4010, lng: 78.4905 };
  const rKnown = longUnexpectedStop({
    fixes: [
      { lat: 17.3800, lng: 78.4800, at: tNight - 15 * 60 * 1000, speedKmh: 35 },
      { lat: homeLoc.lat, lng: homeLoc.lng, at: tNight - 12 * 60 * 1000, speedKmh: 0 },
      { lat: homeLoc.lat, lng: homeLoc.lng, at: tNight, speedKmh: 0 },
    ],
    now: tNight,
    knownStops: [homeLoc],
  });
  eq('longUnexpectedStop: stopped at familiar location (knownStops) -> none', rKnown.level, 'none');

  // Stopped at night for only 3 minutes (e.g. signal or brief pause) -> none
  const tSignal = dateAt(2, 0).getTime();
  const rSignal = longUnexpectedStop({
    fixes: [
      { lat: 17.3800, lng: 78.4800, at: tSignal - 10 * 60 * 1000, speedKmh: 35 },
      { lat: 17.3900, lng: 78.4850, at: tSignal - 3 * 60 * 1000, speedKmh: 0 },
      { lat: 17.3900, lng: 78.4850, at: tSignal, speedKmh: 0 },
    ],
    now: tSignal,
  });
  eq('longUnexpectedStop: stopped only 3 minutes (< 10 min) -> none', rSignal.level, 'none');

  // Not during a ride (phone stationary in bedroom, never started a ride) -> none
  const tBed = dateAt(2, 0).getTime();
  const rNoRide = longUnexpectedStop({
    fixes: [
      { lat: 17.4000, lng: 78.4900, at: tBed - 20 * 60 * 1000, speedKmh: 0 },
      { lat: 17.4000, lng: 78.4900, at: tBed, speedKmh: 0 },
    ],
    now: tBed,
  });
  eq('longUnexpectedStop: not during a ride (stationary without prior motion) -> none', rNoRide.level, 'none');

  // Night boundary tests with injected clock
  const t22_59 = dateAt(22, 59).getTime();
  const t23_01 = dateAt(23, 1).getTime();
  const t04_59 = dateAt(4, 59).getTime();
  const t05_01 = dateAt(5, 1).getTime();

  function make15mStop(nowMs) {
    return [
      { lat: 17.38, lng: 78.48, at: nowMs - 25 * 60 * 1000, speedKmh: 40 },
      { lat: 17.40, lng: 78.49, at: nowMs - 15 * 60 * 1000, speedKmh: 0 },
      { lat: 17.40, lng: 78.49, at: nowMs, speedKmh: 0 },
    ];
  }

  eq('longUnexpectedStop night boundary: 22:59 -> none', longUnexpectedStop({ fixes: make15mStop(t22_59), now: t22_59 }).level, 'none');
  eq('longUnexpectedStop night boundary: 23:01 -> watch', longUnexpectedStop({ fixes: make15mStop(t23_01), now: t23_01 }).level, 'watch');
  eq('longUnexpectedStop night boundary: 04:59 -> watch', longUnexpectedStop({ fixes: make15mStop(t04_59), now: t04_59 }).level, 'watch');
  eq('longUnexpectedStop night boundary: 05:01 -> none', longUnexpectedStop({ fixes: make15mStop(t05_01), now: t05_01 }).level, 'none');
}

// ── 5. Normal 30-Minute Commute (False-Alarm Guard) ──────────────────────────
// Scripted 30-minute daytime commute (09:00 - 09:30 AM):
//   - Origin: Hyderabad Gachibowli, Destination: Hitec City (5 km away)
//   - Stops at 2 traffic signals (each 90s)
//   - A tea stall stop (8 minutes at 09:12 AM)
//   - A missed turn leading to a safe U-turn (moving away for 45 s then resuming)
// Must produce NO watch / high on ANY scorer.
{
  const tStart = dateAt(9, 0).getTime(); // 09:00 AM
  const commuteOrigin = { lat: 17.4400, lng: 78.3480 };
  const commuteDest = { lat: 17.4500, lng: 78.3800 };

  let simulatedTime = tStart;
  const watcher = createAnomalyWatcher({
    destination: commuteDest,
    clock: () => simulatedTime,
  });

  let lat = commuteOrigin.lat;
  let lng = commuteOrigin.lng;
  let speedKmh = 0;
  let falseAlarms = 0;

  // Total forward driving steps: 60 (Phase 1) + 54 (Phase 3) + 60 (Phase 7) = 174 steps
  const fwdLat = 0.0100 / 174;
  const fwdLng = 0.0320 / 174;

  function step(seconds, newSpeedKmh, deltaLat = 0, deltaLng = 0) {
    for (let s = 0; s < seconds; s += 5) {
      simulatedTime += 5000;
      lat += deltaLat;
      lng += deltaLng;
      speedKmh = newSpeedKmh;

      const fix = { lat, lng, at: simulatedTime, speedKmh };
      watcher.feedFix(fix);

      // Normal motion while riding: minor road vibrations (0.8 - 1.4 g, duration 500ms+)
      watcher.feedMotion({ g: 1.1, at: simulatedTime });

      // Check all 3 scorers directly
      const rDev = routeDeviation({ destination: commuteDest, fixes: [commuteOrigin, fix] });
      const rSnatch = phoneSnatch({ speedKmh, now: simulatedTime });
      const rStop = longUnexpectedStop({ fixes: [commuteOrigin, fix], now: simulatedTime });

      if (rDev.level !== 'none' || rSnatch.level !== 'none' || rStop.level !== 'none') {
        falseAlarms++;
      }
    }
  }

  // Phase 1: 0 to 5 min — Riding at 35 km/h towards destination
  step(300, 35, fwdLat, fwdLng);

  // Phase 2: 5 to 6.5 min — Stopped at Signal 1 for 90 seconds (speed 0)
  step(90, 0, 0, 0);

  // Phase 3: 6.5 to 11 min — Riding at 40 km/h towards destination
  step(270, 40, fwdLat, fwdLng);

  // Phase 4: 11 to 12 min — Missed turn, U-turn! Moving slightly away for 45 seconds, then resumes
  step(45, 25, -fwdLat, -fwdLng); // moving slightly away for 45 s
  step(45, 25, fwdLat, fwdLng);   // turned back towards destination

  // Phase 5: 12.5 to 20.5 min — Tea stall stop for 8 minutes (daytime, 09:12 AM, speed 0)
  step(480, 0, 0, 0);

  // Phase 6: 20.5 to 22 min — Stopped at Signal 2 for 90 seconds
  step(90, 0, 0, 0);

  // Phase 7: 22 to 27 min — Riding to final destination
  step(300, 35, fwdLat, fwdLng);

  eq('commute false-alarm guard: direct scorers produced zero alarms', falseAlarms, 0);
  eq('commute false-alarm guard: watcher recorded zero anomalies', watcher.getAnomalies().length, 0);
}

// ── 6. createAnomalyWatcher Integration ──────────────────────────────────────
{
  let notifiedAnomaly = null;
  const testWatcher = createAnomalyWatcher({
    destination: { lat: 17.50, lng: 78.50 },
    clock: () => 1000000,
    onAnomaly: (a) => { notifiedAnomaly = a; },
    maxInMemory: 5,
  });

  // Feed motion jerk
  testWatcher.feedSpeed(0);
  testWatcher.feedMotion({ g: 3.2, at: 1000000 });
  testWatcher.feedMotion({ g: 1.0, at: 1000120 }); // 120 ms spike
  testWatcher.feedSpeed(12); // running pace

  eq('watcher triggered phone_snatch anomaly', notifiedAnomaly?.kind, 'phone_snatch');
  eq('watcher recorded anomaly in memory', testWatcher.getAnomalies().length, 1);

  // Reset clears state
  testWatcher.reset();
  eq('watcher reset cleared in-memory anomalies', testWatcher.getAnomalies().length, 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
