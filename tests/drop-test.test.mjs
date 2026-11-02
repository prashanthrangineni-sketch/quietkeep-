// tests/drop-test.test.mjs
// Unit tests for AG-D3: Drop-and-fall test evaluator (DRV-16)

import {
  DROP_TRIAL_TYPES,
  TRIAL_TYPE_KEYS,
  runDropTest,
  evaluateDropTest,
  evaluateTrialResult,
  computeDropTestTally,
  generateDropTrace,
  getPhoneModel,
} from '../src/lib/drop-test.js';

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

function approx(name, got, want, tolerance = 0.1) {
  const ok = Math.abs(got - want) <= tolerance;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} (got ${got}, want ${want} ± ${tolerance})`);
  if (!ok) {
    fail++;
  } else {
    pass++;
  }
}

console.log('=== AG-D3 Drop-and-Fall Test Suite ===\n');

// ── 1. Trial Types Configuration ─────────────────────────────────────────────
eq('DROP_TRIAL_TYPES has 5 configured trial types', TRIAL_TYPE_KEYS.length, 5);
eq('cushion_drop_1m expected is true (detected)', DROP_TRIAL_TYPES.cushion_drop_1m.expected, true);
eq('pocket_fall expected is true (detected)', DROP_TRIAL_TYPES.pocket_fall.expected, true);
eq('bag_drop expected is true (detected)', DROP_TRIAL_TYPES.bag_drop.expected, true);
eq('mount_knock expected is false (not detected)', DROP_TRIAL_TYPES.mount_knock.expected, false);
eq('normal_handling expected is false (not detected)', DROP_TRIAL_TYPES.normal_handling.expected, false);

// ── 2. Synthetic Trace Evaluation Per Trial Type ──────────────────────────────

// Scenario A: Cushion drop (1m)
const cushionTrace = generateDropTrace('cushion_drop_1m');
const cushionRes = runDropTest(cushionTrace);
eq('cushion_drop_1m: detected is true', cushionRes.detected, true);
eq('cushion_drop_1m: state is crash', cushionRes.state, 'crash');
approx('cushion_drop_1m: peakG is ~4.6g', cushionRes.peakG, 4.6, 0.2);
eq('cushion_drop_1m: msToDetect is >= 8000 ms', cushionRes.msToDetect >= 8000, true);

const cushionEval = evaluateTrialResult('cushion_drop_1m', cushionRes);
eq('cushion_drop_1m: evaluateTrialResult passes', cushionEval.pass, true);
eq('cushion_drop_1m: evaluateTrialResult expected is true', cushionEval.expected, true);

// Scenario B: Pocket fall
const pocketTrace = generateDropTrace('pocket_fall');
const pocketRes = runDropTest(pocketTrace);
eq('pocket_fall: detected is true', pocketRes.detected, true);
eq('pocket_fall: state is crash', pocketRes.state, 'crash');
approx('pocket_fall: peakG is ~5.2g', pocketRes.peakG, 5.2, 0.2);
eq('pocket_fall: msToDetect is >= 8000 ms', pocketRes.msToDetect >= 8000, true);

const pocketEval = evaluateTrialResult('pocket_fall', pocketRes);
eq('pocket_fall: evaluateTrialResult passes', pocketEval.pass, true);

// Scenario C: Bag drop
const bagTrace = generateDropTrace('bag_drop');
const bagRes = runDropTest(bagTrace);
eq('bag_drop: detected is true', bagRes.detected, true);
eq('bag_drop: state is crash', bagRes.state, 'crash');
approx('bag_drop: peakG is ~3.9g', bagRes.peakG, 3.9, 0.2);

const bagEval = evaluateTrialResult('bag_drop', bagRes);
eq('bag_drop: evaluateTrialResult passes', bagEval.pass, true);

// Scenario D: Mount knock (firm knock, but motion continues — no stillness)
const mountTrace = generateDropTrace('mount_knock');
const mountRes = runDropTest(mountTrace);
eq('mount_knock: detected is false (no stillness after impact)', mountRes.detected, false);
eq('mount_knock: msToDetect is null', mountRes.msToDetect, null);

const mountEval = evaluateTrialResult('mount_knock', mountRes);
eq('mount_knock: evaluateTrialResult passes (correctly not detected)', mountEval.pass, true);
eq('mount_knock: evaluateTrialResult expected is false', mountEval.expected, false);

// Scenario E: Normal handling (gentle motions, maxG < 2g)
const normalTrace = generateDropTrace('normal_handling');
const normalRes = runDropTest(normalTrace);
eq('normal_handling: detected is false', normalRes.detected, false);
eq('normal_handling: msToDetect is null', normalRes.msToDetect, null);
eq('normal_handling: peakG is < 2.5g', normalRes.peakG < 2.5, true);

const normalEval = evaluateTrialResult('normal_handling', normalRes);
eq('normal_handling: evaluateTrialResult passes (correctly not detected)', normalEval.pass, true);

// ── 3. High Impact Without Stillness Is NOT a Crash ───────────────────────────
const noStillnessTrace = generateDropTrace('impact_no_stillness');
const noStillnessRes = runDropTest(noStillnessTrace);
eq('impact_no_stillness: detected is false', noStillnessRes.detected, false);
eq('impact_no_stillness: state is not crash', noStillnessRes.state !== 'crash', true);
eq('impact_no_stillness: msToDetect is null', noStillnessRes.msToDetect, null);
approx('impact_no_stillness: recorded high peakG ~6.0g', noStillnessRes.peakG, 6.0, 0.2);

// If evaluated as a cushion_drop_1m, it must fail because it was not detected
const noStillnessCushionEval = evaluateTrialResult('cushion_drop_1m', noStillnessRes);
eq('impact_no_stillness: fails cushion_drop expectation', noStillnessCushionEval.pass, false);
eq('impact_no_stillness: reason is expected_detection_but_missed', noStillnessCushionEval.reason, 'expected_detection_but_missed');

// ── 4. Missing Data Never Claims Pass ─────────────────────────────────────────

// Empty array
const emptyRes = runDropTest([]);
eq('empty trace: detected is false', emptyRes.detected, false);
eq('empty trace: missingData is true', emptyRes.missingData, true);
eq('empty trace: peakG is 0', emptyRes.peakG, 0);

// Even for expected-not-detected types, missing data MUST FAIL
eq('empty trace fails cushion_drop_1m', evaluateTrialResult('cushion_drop_1m', emptyRes).pass, false);
eq('empty trace fails pocket_fall', evaluateTrialResult('pocket_fall', emptyRes).pass, false);
eq('empty trace fails bag_drop', evaluateTrialResult('bag_drop', emptyRes).pass, false);
eq('empty trace fails mount_knock (missing data)', evaluateTrialResult('mount_knock', emptyRes).pass, false);
eq('empty trace fails normal_handling (missing data)', evaluateTrialResult('normal_handling', emptyRes).pass, false);
eq('empty trace reason is missing_data', evaluateTrialResult('mount_knock', emptyRes).reason, 'missing_data');

// Null / undefined input
const nullRes = runDropTest(null);
eq('null trace: detected is false', nullRes.detected, false);
eq('null trace fails normal_handling', evaluateTrialResult('normal_handling', nullRes).pass, false);

// Invalid samples (all NaN)
const invalidRes = runDropTest([{ at: 1, magnitudeG: NaN }, { at: 2, g: null }]);
eq('invalid samples: detected is false', invalidRes.detected, false);
eq('invalid samples fails normal_handling', evaluateTrialResult('normal_handling', invalidRes).pass, false);

// ── 5. Simulated Speed Verification ──────────────────────────────────────────
// Custom simulated speeds: ensure riding speed threshold works as expected
const traceWithDrop = generateDropTrace('cushion_drop_1m');
// If speedBefore was 0 km/h (no simulated riding speed), impact should NOT be suspected/crash
const zeroSpeedRes = runDropTest(traceWithDrop, { speedBeforeKmh: 0 });
eq('0 km/h speed before impact: crash detector rejects standstill drop', zeroSpeedRes.detected, false);

// Default simulated speed (25 km/h) before event enables detection
const defaultSpeedRes = runDropTest(traceWithDrop, { speedBeforeKmh: 25, speedAfterKmh: 0 });
eq('25 km/h simulated speed before event enables crash detection', defaultSpeedRes.detected, true);

// ── 6. Running Tally Calculations ─────────────────────────────────────────────
const sampleRuns = [
  // 5 cushion drops: 4 pass (caught), 1 fail (missed)
  { step: 'drop_test:cushion_drop_1m', result: 'pass', evidence: { detected: true, peakG: 4.5, msToDetect: 8100, phone_model: 'Pixel 8' } },
  { step: 'drop_test:cushion_drop_1m', result: 'pass', evidence: { detected: true, peakG: 4.8, msToDetect: 8200, phone_model: 'Pixel 8' } },
  { step: 'drop_test:cushion_drop_1m', result: 'pass', evidence: { detected: true, peakG: 4.2, msToDetect: 8050, phone_model: 'Pixel 8' } },
  { step: 'drop_test:cushion_drop_1m', result: 'pass', evidence: { detected: true, peakG: 4.9, msToDetect: 8150, phone_model: 'Pixel 8' } },
  { step: 'drop_test:cushion_drop_1m', result: 'fail', evidence: { detected: false, peakG: 2.9, msToDetect: null, phone_model: 'Pixel 8' } },

  // 3 pocket falls: 3 pass (caught)
  { step: 'drop_test:pocket_fall', result: 'pass', evidence: { detected: true, peakG: 5.1, msToDetect: 8000, phone_model: 'Pixel 8' } },
  { step: 'drop_test:pocket_fall', result: 'pass', evidence: { detected: true, peakG: 5.5, msToDetect: 8100, phone_model: 'Pixel 8' } },
  { step: 'drop_test:pocket_fall', result: 'pass', evidence: { detected: true, peakG: 5.3, msToDetect: 8050, phone_model: 'Pixel 8' } },

  // 4 mount knocks: 3 pass (not detected), 1 fail (false alarm)
  { step: 'drop_test:mount_knock', result: 'pass', evidence: { detected: false, peakG: 3.8, msToDetect: null, phone_model: 'Pixel 8' } },
  { step: 'drop_test:mount_knock', result: 'pass', evidence: { detected: false, peakG: 4.1, msToDetect: null, phone_model: 'Pixel 8' } },
  { step: 'drop_test:mount_knock', result: 'pass', evidence: { detected: false, peakG: 3.9, msToDetect: null, phone_model: 'Pixel 8' } },
  { step: 'drop_test:mount_knock', result: 'fail', evidence: { detected: true, peakG: 4.5, msToDetect: 8000, phone_model: 'Pixel 8' } },

  // 2 normal handling: 2 pass (not detected)
  { step: 'drop_test:normal_handling', result: 'pass', evidence: { detected: false, peakG: 1.5, msToDetect: null, phone_model: 'Pixel 8' } },
  { step: 'drop_test:normal_handling', result: 'pass', evidence: { detected: false, peakG: 1.7, msToDetect: null, phone_model: 'Pixel 8' } },

  // Non-drop test run (should be ignored by tally)
  { step: 'desk_test_tilt', result: 'pass', evidence: {} },
];

const tally = computeDropTestTally(sampleRuns);

// Cushion drop tally
eq('tally cushion_drop_1m total is 5', tally.byType.cushion_drop_1m.total, 5);
eq('tally cushion_drop_1m caught is 4', tally.byType.cushion_drop_1m.caught, 4);
eq('tally cushion_drop_1m pass is 4', tally.byType.cushion_drop_1m.pass, 4);
eq('tally cushion_drop_1m fail is 1', tally.byType.cushion_drop_1m.fail, 1);
eq('tally cushion_drop_1m caughtRate is 0.8', tally.byType.cushion_drop_1m.caughtRate, 0.8);

// Pocket fall tally
eq('tally pocket_fall total is 3', tally.byType.pocket_fall.total, 3);
eq('tally pocket_fall caught is 3', tally.byType.pocket_fall.caught, 3);
eq('tally pocket_fall caughtRate is 1', tally.byType.pocket_fall.caughtRate, 1);

// Mount knock tally (false alarm tracked)
eq('tally mount_knock total is 4', tally.byType.mount_knock.total, 4);
eq('tally mount_knock falseAlarms is 1', tally.byType.mount_knock.falseAlarms, 1);
eq('tally mount_knock pass is 3', tally.byType.mount_knock.pass, 3);
eq('tally mount_knock fail is 1', tally.byType.mount_knock.fail, 1);
eq('tally mount_knock falseAlarmRate is 0.25', tally.byType.mount_knock.falseAlarmRate, 0.25);

// Normal handling tally
eq('tally normal_handling total is 2', tally.byType.normal_handling.total, 2);
eq('tally normal_handling falseAlarms is 0', tally.byType.normal_handling.falseAlarms, 0);

// Summary totals
eq('tally summary totalTrials is 14', tally.summary.totalTrials, 14);
eq('tally summary stagedFallsTotal is 8', tally.summary.stagedFallsTotal, 8); // 5 cushion + 3 pocket
eq('tally summary stagedFallsCaught is 7', tally.summary.stagedFallsCaught, 7); // 4 + 3
approx('tally summary stagedFallsCaughtRate is ~0.88', tally.summary.stagedFallsCaughtRate, 0.88, 0.02);
eq('tally summary nonCrashTrialsTotal is 6', tally.summary.nonCrashTrialsTotal, 6); // 4 mount + 2 normal
eq('tally summary falseAlarmsTotal is 1', tally.summary.falseAlarmsTotal, 1);
approx('tally summary falseAlarmRate is ~0.17', tally.summary.falseAlarmRate, 0.17, 0.02);

// ── 7. Helpers & Aliases ──────────────────────────────────────────────────────
eq('evaluateDropTest alias equals runDropTest', evaluateDropTest, runDropTest);
eq('getPhoneModel returns a string', typeof getPhoneModel(), 'string');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
