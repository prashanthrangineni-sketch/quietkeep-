// tests/overtake-advisor.test.mjs
// TASK CARD AG-01: Unit tests for overtaking advisor v1 (DRV-12a)

import {
  CONSTANTS,
  PHRASES,
  metresBetween,
  bearingDeg,
  angleBetween,
  isNight,
  createRoadAheadProvider,
  trackCurvature,
  formatPhrase,
  adviseOvertake,
  createOvertakeWatcher,
} from '../src/lib/overtake-advisor.js';

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

function approxEq(name, got, want, tolerance = 0.5) {
  const diff = Math.abs(got - want);
  const ok = diff <= tolerance;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} (got ${got}, want ${want})`);
  if (!ok) {
    fail++;
  } else {
    pass++;
  }
}

console.log('--- 1. Constants ---');
eq('CONSTANTS.HEADING_TOLERANCE_DEG is 30', CONSTANTS.HEADING_TOLERANCE_DEG, 30);
eq('CONSTANTS.CURVATURE_BEND_DEG_PER_100M is 15', CONSTANTS.CURVATURE_BEND_DEG_PER_100M, 15);
eq('CONSTANTS.AVOID_HAZARD_DISTANCE_M is 300', CONSTANTS.AVOID_HAZARD_DISTANCE_M, 300);
eq('CONSTANTS.AVOID_MIN_SPEED_KMH is 15', CONSTANTS.AVOID_MIN_SPEED_KMH, 15);
eq('CONSTANTS.AVOID_NIGHT_HAZARD_DISTANCE_M is 500', CONSTANTS.AVOID_NIGHT_HAZARD_DISTANCE_M, 500);
eq('CONSTANTS.CAUTION_HAZARD_DISTANCE_MAX_M is 600', CONSTANTS.CAUTION_HAZARD_DISTANCE_MAX_M, 600);
eq('CONSTANTS.WATCHER_MIN_SPEED_KMH is 40', CONSTANTS.WATCHER_MIN_SPEED_KMH, 40);
eq('CONSTANTS.WATCHER_COOLDOWN_MS is 180000', CONSTANTS.WATCHER_COOLDOWN_MS, 3 * 60 * 1000);
eq('CONSTANTS.WATCHER_SPEECH_QUIET_MS is 120000', CONSTANTS.WATCHER_SPEECH_QUIET_MS, 2 * 60 * 1000);
eq('CONSTANTS.WATCHER_MAX_PER_HOUR is 6', CONSTANTS.WATCHER_MAX_PER_HOUR, 6);

console.log('\n--- 2. Bend maths & curvature ---');
// Straight track: 0° change over 200 m -> inBend: false, degPer100m: 0
// Coordinate delta of ~200 m north is approx 0.0018 degrees latitude (1 deg lat ~= 111,139 m)
const fixStraight1 = { lat: 17.3850, lng: 78.4867, headingDeg: 0, at: 1000 };
const fixStraight2 = { lat: 17.3850 + (200 / 111139), lng: 78.4867, headingDeg: 0, at: 6000 };
const curvStraight = trackCurvature([fixStraight1, fixStraight2]);
eq('straight track has inBend false', curvStraight.inBend, false);
approxEq('straight track has degPer100m 0', curvStraight.degPer100m, 0, 0.1);

// Curve: 90° over 200 m -> inBend: true, degPer100m: 45
const fixTurn1 = { lat: 17.3850, lng: 78.4867, headingDeg: 0, at: 1000 };
const fixTurn2 = { lat: 17.3850 + (200 / 111139), lng: 78.4867, headingDeg: 90, at: 6000 };
const curvTurn = trackCurvature([fixTurn1, fixTurn2]);
eq('90 deg over 200 m has inBend true', curvTurn.inBend, true);
approxEq('90 deg over 200 m has degPer100m 45', curvTurn.degPer100m, 45, 1);

// Gentle curve: 10° over 100 m -> 10 deg/100m < 15 -> inBend false
const fixGentle1 = { lat: 17.3850, lng: 78.4867, headingDeg: 10, at: 1000 };
const fixGentle2 = { lat: 17.3850 + (100 / 111139), lng: 78.4867, headingDeg: 20, at: 6000 };
const curvGentle = trackCurvature([fixGentle1, fixGentle2]);
eq('gentle curve has inBend false', curvGentle.inBend, false);
approxEq('gentle curve has degPer100m 10', curvGentle.degPer100m, 10, 0.5);

// Pruning fixes older than 20s
const oldFix = { lat: 17.3800, lng: 78.4867, headingDeg: 90, at: 1000 };
const recentFix1 = { lat: 17.3850, lng: 78.4867, headingDeg: 0, at: 30000 };
const recentFix2 = { lat: 17.3850 + (100 / 111139), lng: 78.4867, headingDeg: 0, at: 35000 };
const curvWindow = trackCurvature([oldFix, recentFix1, recentFix2]);
eq('old fix excluded so inBend is false', curvWindow.inBend, false);

console.log('\n--- 3. Heading filter (spots behind are ignored) ---');
const originPos = { lat: 17.3850, lng: 78.4867, headingDeg: 0 }; // Heading North
const spotNorth = { id: 's1', lat: 17.3850 + (150 / 111139), lng: 78.4867, kind: 'hard_brake', severity: 2, reports: 3 }; // North ~150m, 0 deg
const spotSouth = { id: 's2', lat: 17.3850 - (150 / 111139), lng: 78.4867, kind: 'pothole', severity: 1, reports: 1 }; // South ~150m, 180 deg
const spotEast = { id: 's3', lat: 17.3850, lng: 78.4867 + (150 / 111139), kind: 'swerve', severity: 2, reports: 2 }; // East ~150m, 90 deg
const spotNNE = { id: 's4', lat: 17.3850 + (250 / 111139), lng: 78.4867 + (100 / 111139), kind: 'hard_brake', severity: 1, reports: 2 }; // ~22 deg offset, ~270m
const spotFarNorth = { id: 's5', lat: 17.3850 + (800 / 111139), lng: 78.4867, kind: 'hard_brake', severity: 2, reports: 4 }; // North ~800m

const provider = createRoadAheadProvider({ spots: [spotNorth, spotSouth, spotEast, spotNNE, spotFarNorth] });
const ahead300 = provider.ahead(originPos, 300);

eq('only spots within 300m and ±30 deg returned', ahead300.map(s => s.id), ['s1', 's4']);
eq('spot behind (South) is ignored', ahead300.some(s => s.id === 's2'), false);
eq('spot to side (East 90 deg) is ignored', ahead300.some(s => s.id === 's3'), false);
eq('spot beyond 300m (800m) is ignored when lookahead is 300', ahead300.some(s => s.id === 's5'), false);
eq('spots returned nearest first', ahead300[0].id, 's1');
approxEq('spot distance is populated', ahead300[0].distance, 150, 5);

console.log('\n--- 4. Night logic with injected clock ---');
// 23:00 to 05:00
const afternoonTime = new Date('2026-10-19T14:30:00Z');
afternoonTime.setHours(14, 30, 0, 0);
eq('14:30 is not night', isNight(afternoonTime), false);

const lateEvening = new Date('2026-10-19T22:50:00Z');
lateEvening.setHours(22, 50, 0, 0);
eq('22:50 is not night', isNight(lateEvening), false);

const nightStart = new Date('2026-10-19T23:05:00Z');
nightStart.setHours(23, 5, 0, 0);
eq('23:05 is night', isNight(nightStart), true);

const midnight = new Date('2026-10-19T02:00:00Z');
midnight.setHours(2, 0, 0, 0);
eq('02:00 is night', isNight(midnight), true);

const earlyMorning = new Date('2026-10-19T04:55:00Z');
earlyMorning.setHours(4, 55, 0, 0);
eq('04:55 is night', isNight(earlyMorning), true);

const dawn = new Date('2026-10-19T05:05:00Z');
dawn.setHours(5, 5, 0, 0);
eq('05:05 is not night', isNight(dawn), false);

console.log('\n--- 5. Advice branches and reasons ---');
// Branch 1: avoid because in a bend
const advBend = adviseOvertake({
  position: originPos,
  speedKmh: 45,
  provider,
  fixes: [fixTurn1, fixTurn2],
  now: afternoonTime,
});
eq('bend triggers avoid', advBend.advice, 'avoid');
eq('bend reason listed', advBend.reasons.includes('You are in a bend'), true);
eq('bend phrase matches template', advBend.phrase, "Don't overtake here. You are in a bend.");

// Branch 2: avoid because hazard within 300m (severity >= 2)
const provSevere = createRoadAheadProvider({ spots: [spotNorth] }); // spotNorth has severity 2 at ~150m
const advSevere = adviseOvertake({
  position: originPos,
  speedKmh: 45,
  provider: provSevere,
  fixes: [fixStraight1, fixStraight2],
  now: afternoonTime,
});
eq('severe hazard within 300m triggers avoid', advSevere.advice, 'avoid');
eq('severe hazard reason listed', advSevere.reasons.includes('Riders brake hard just ahead'), true);
eq('severe hazard phrase', advSevere.phrase, "Don't overtake here. Riders brake hard just ahead.");

// Branch 3: avoid because pothole within 300m (reports >= 3)
const spotPothole = { id: 'p1', lat: 17.3850 + (100 / 111139), lng: 78.4867, kind: 'pothole', severity: 1, reports: 3 };
const provPothole = createRoadAheadProvider({ spots: [spotPothole] });
const advPothole = adviseOvertake({
  position: originPos,
  speedKmh: 45,
  provider: provPothole,
  fixes: [fixStraight1, fixStraight2],
  now: afternoonTime,
});
eq('pothole within 300m triggers avoid', advPothole.advice, 'avoid');
eq('pothole reason is rough road', advPothole.reasons.includes('Rough road just ahead'), true);
eq('pothole phrase', advPothole.phrase, "Don't overtake here. Rough road just ahead.");

// Branch 4: avoid because speed < 15 km/h (crawling traffic)
const advSlow = adviseOvertake({
  position: originPos,
  speedKmh: 12,
  provider: createRoadAheadProvider({ spots: [] }),
  fixes: [fixStraight1, fixStraight2],
  now: afternoonTime,
});
eq('speed < 15 km/h triggers avoid', advSlow.advice, 'avoid');
eq('traffic is too slow reason listed', advSlow.reasons.includes('Traffic is too slow'), true);
eq('traffic slow phrase', advSlow.phrase, "Don't overtake here. Traffic is too slow.");

// Branch 5: avoid because night AND hazard within 500m
const spotNightHaz = { id: 'n1', lat: 17.3850 + (420 / 111139), lng: 78.4867, kind: 'hard_brake', severity: 1, reports: 1 };
const provNightHaz = createRoadAheadProvider({ spots: [spotNightHaz] });
const advNightAvoid = adviseOvertake({
  position: originPos,
  speedKmh: 45,
  provider: provNightHaz,
  fixes: [fixStraight1, fixStraight2],
  now: midnight,
});
eq('night with hazard at 420m triggers avoid', advNightAvoid.advice, 'avoid');

// Branch 6: caution because hazard within 300-600m during day
const advCautionHazard = adviseOvertake({
  position: originPos,
  speedKmh: 45,
  provider: provNightHaz, // at ~420m
  fixes: [fixStraight1, fixStraight2],
  now: afternoonTime,
});
eq('hazard at 420m in daytime triggers caution', advCautionHazard.advice, 'caution');
eq('caution phrase contains distance rounded', advCautionHazard.phrase.includes('400 metres ahead') || advCautionHazard.phrase.includes('420 metres ahead'), true);

// Branch 7: caution because night without hazards
const advCautionNight = adviseOvertake({
  position: originPos,
  speedKmh: 45,
  provider: createRoadAheadProvider({ spots: [] }),
  fixes: [fixStraight1, fixStraight2],
  now: midnight,
});
eq('night without hazards triggers caution', advCautionNight.advice, 'caution');

// Branch 8: no_known_hazard during daytime on straight road with no hazards
const advClear = adviseOvertake({
  position: originPos,
  speedKmh: 45,
  provider: createRoadAheadProvider({ spots: [] }),
  fixes: [fixStraight1, fixStraight2],
  now: afternoonTime,
  lookaheadMetres: 500,
});
eq('clear condition produces no_known_hazard', advClear.advice, 'no_known_hazard');
eq('no_known_hazard phrase formatted', advClear.phrase, 'Nothing is reported for the next 500 metres. Check your mirrors and oncoming traffic before you overtake.');

console.log('\n--- 6. Rate limits in createOvertakeWatcher ---');
// Fixed local midday so the night rule never applies in any time zone (CI runs in UTC).
const DAY_BASE_MS = new Date(2026, 9, 20, 12, 0, 0).getTime();
let fakeClockMs = DAY_BASE_MS + 1000000;
const watcher = createOvertakeWatcher({ clock: () => fakeClockMs });

// 6a: Speed < 40 km/h does NOT fire
const rBelowSpeed = watcher.update({
  position: originPos,
  speedKmh: 35,
  provider: provSevere,
  fixes: [fixStraight1, fixStraight2],
});
eq('speed < 40 km/h returns null', rBelowSpeed, null);

// 6b: Speed >= 40 km/h with bend/hazard fires
const rFires = watcher.update({
  position: originPos,
  speedKmh: 45,
  provider: provSevere,
  fixes: [fixStraight1, fixStraight2],
});
eq('speed >= 40 km/h with hazard fires', rFires != null, true);
eq('rFires advice is avoid', rFires?.advice, 'avoid');

// 6c: Cooldown of 3 minutes
fakeClockMs += 60 * 1000; // 1 min later
const rCooldown = watcher.update({
  position: originPos,
  speedKmh: 45,
  provider: provSevere,
  fixes: [fixStraight1, fixStraight2],
});
eq('warning within 3 min cooldown returns null', rCooldown, null);

fakeClockMs += 2.5 * 60 * 1000; // 3.5 min total since last warning
const rAfterCooldown = watcher.update({
  position: originPos,
  speedKmh: 45,
  provider: provSevere,
  fixes: [fixStraight1, fixStraight2],
});
eq('warning after 3 min cooldown fires', rAfterCooldown != null, true);

// 6d: Never within 2 minutes of other speech
fakeClockMs += 3.5 * 60 * 1000;
const rSpeechBlocked = watcher.update({
  position: originPos,
  speedKmh: 45,
  provider: provSevere,
  fixes: [fixStraight1, fixStraight2],
  somethingElseSpokeAt: fakeClockMs - 30 * 1000, // spoken 30s ago
});
eq('blocked when other speech occurred 30s ago (< 2 min)', rSpeechBlocked, null);

const rSpeechAllowed = watcher.update({
  position: originPos,
  speedKmh: 45,
  provider: provSevere,
  fixes: [fixStraight1, fixStraight2],
  somethingElseSpokeAt: fakeClockMs - 130 * 1000, // spoken 130s ago (> 2 min)
});
eq('allowed when other speech occurred > 2 min ago', rSpeechAllowed != null, true);

// 6e: Max 6 per hour limit
watcher.reset();
fakeClockMs = DAY_BASE_MS + 2000000;
let firedCount = 0;
for (let i = 0; i < 10; i++) {
  const res = watcher.update({
    position: originPos,
    speedKmh: 45,
    provider: provSevere,
    fixes: [fixStraight1, fixStraight2],
  });
  if (res) firedCount++;
  fakeClockMs += 3.5 * 60 * 1000; // advance by 3.5 minutes each step
}
eq('capped at exactly 6 warnings within the hour', firedCount, 6);

// 6f: Does NOT fire unprompted for caution or traffic_slow
watcher.reset();
fakeClockMs = DAY_BASE_MS + 3000000;
const rCautionUnprompted = watcher.update({
  position: originPos,
  speedKmh: 45,
  provider: provNightHaz, // caution range
  fixes: [fixStraight1, fixStraight2],
});
eq('caution does NOT fire unprompted', rCautionUnprompted, null);

console.log('\n--- 7. Multilingual & Safety Wording Check ---');
// Safety check: NO phrase in any language may contain "clear", "safe", or "you can overtake"
const forbidden = /\b(clear|safe|you can overtake)\b/i;

function checkAllStrings(obj, path = '') {
  for (const [k, v] of Object.entries(obj)) {
    const currPath = path ? `${path}.${k}` : k;
    if (typeof v === 'string') {
      const match = forbidden.exec(v);
      if (match) {
        console.log(`FAIL forbidden word in ${currPath}: "${match[0]}" in "${v}"`);
        fail++;
      } else {
        pass++;
      }
    } else if (typeof v === 'object' && v !== null) {
      checkAllStrings(v, currPath);
    }
  }
}

checkAllStrings(PHRASES, 'PHRASES');

// Check formatted output for en, hi, te
const advForTest = {
  advice: 'avoid',
  reasons: ['You are in a bend'],
  reasonKeys: ['bend'],
  phraseKey: 'avoid',
};

const enAvoid = formatPhrase(advForTest, 'en');
const hiAvoid = formatPhrase(advForTest, 'hi');
const teAvoid = formatPhrase(advForTest, 'te');

eq('en avoid formatted correctly', enAvoid, "Don't overtake here. You are in a bend.");
eq('hi avoid formatted correctly', hiAvoid, "यहाँ ओवरटेक न करें। आगे मोड़ है।");
eq('te avoid formatted correctly', teAvoid, "ఇక్కడ ఓవర్‌టేక్ చేయవద్దు. ముందు మలుపు ఉంది.");

const advCautionTest = {
  advice: 'caution',
  hazardDistance: 400,
  phraseKey: 'caution',
};
const enCaution = formatPhrase(advCautionTest, 'en');
const hiCaution = formatPhrase(advCautionTest, 'hi');
const teCaution = formatPhrase(advCautionTest, 'te');

eq('en caution formatted', enCaution.includes('400 metres ahead'), true);
eq('hi caution formatted', hiCaution.includes('400'), true);
eq('te caution formatted', teCaution.includes('400'), true);

const advClearTest = {
  advice: 'no_known_hazard',
  lookaheadMetres: 500,
  phraseKey: 'no_known_hazard',
};
const enClear = formatPhrase(advClearTest, 'en');
const hiClear = formatPhrase(advClearTest, 'hi');
const teClear = formatPhrase(advClearTest, 'te');

eq('en no_known_hazard contains before you overtake', enClear.includes('before you overtake'), true);
eq('hi no_known_hazard contains 500', hiClear.includes('500'), true);
eq('te no_known_hazard contains 500', teClear.includes('500'), true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
