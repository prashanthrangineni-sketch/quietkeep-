## Summary

Implements **AG-D3: Drop-and-fall test screen (DRV-16)**.
Provides an in-app verification tool and evaluator for staged phone drops, falls, and non-crash disturbance trials (knocks, handling) to validate rider crash detection physics and prevent false alarms.

### What Was Built

1. **`src/lib/drop-test.js`**:
   - `runDropTest(trace, options)` / `evaluateDropTest`:
     - Pure evaluator running `createCrashDetector` from `src/lib/crash-detect.js` without modifying crash-detect.js.
     - Feeds a simulated riding speed of 25 km/h before the impact event and 0 km/h after (standstill aftermath).
     - Extracts and normalizes accelerometer trace readings, calculates `peakG`, determines impact occurrence, and measures `msToDetect` (~8,000 ms of required stillness).
     - Returns `{ detected, state, peakG, msToDetect }`.
   - `evaluateTrialResult(trialType, evalResult)`:
     - Validates result against expectation for the trial type:
       - `cushion_drop_1m`: expected detected = true
       - `pocket_fall`: expected detected = true
       - `bag_drop`: expected detected = true
       - `mount_knock`: expected detected = false
       - `normal_handling`: expected detected = false
     - Strict integrity rule: missing data (0 samples, NaN, null trace) is strictly a failure and never claims pass.
   - `computeDropTestTally(runs)`:
     - Aggregates running tallies per trial type (`caught / total`, `false alarms / total`, `pass / total`, `passRate`).
     - Computes summary KPIs: staged falls caught rate (target ≥ 90%) and false alarm rate (target 0%).
   - `generateDropTrace(type, options)`:
     - Synthetic 15-second trace generator (50 Hz, 750 samples) for automated testing and simulated trial runs.
   - `getPhoneModel()`:
     - Pure helper safely reading phone model from user agent across browser/Capacitor environments.

2. **`src/app/drive/proof/page.jsx`**:
   - New **Drop and Fall Test** section added to the internal field-test screen (`/drive/proof`).
   - Trial type selector for the 5 trial categories with expected outcome badges.
   - "Start 15s Trial" button: requests `DeviceMotionEvent` permissions, records 15 seconds of physical motion, runs `runDropTest`, evaluates verdict, and writes to `public.drive_proof_runs` with `step = 'drop_test:<type>'`, `result = 'pass'|'fail'`, and `evidence = { detected, peakG, msToDetect, phone_model }`.
   - "Run Simulated Trace" button for quick verification on desktop or in development without accelerometer hardware.
   - Running Tally & Metrics display:
     - Summary KPI cards: Staged Falls Caught (`X / Y`), False Alarms (`X / Y`), and Total Trials.
     - Per-type breakdown table with live caught, false alarm, and pass percentages.
   - Safety rule: Drill only — never starts SOS, never alerts contacts.

3. **`docs/drive/drop-test-protocol.md`**:
   - Comprehensive field-test protocol document detailing safety rules (standstill staging only, soft cushion/mattress surfaces only, never drop from a moving vehicle).
   - Standard 20 trials per type per phone model benchmark (100 total trials per device).
   - Clear pass criteria: ≥ 90% catch rate for staged falls, 0% false alarms for knocks and handling, missing data never passes.

4. **`tests/drop-test.test.mjs`**:
   - 74 automated unit tests covering all 5 trial types with synthetic traces, impact with no stillness (correctly rejected), missing data guards (empty/null/invalid traces strictly failing), custom simulated speed behavior (0 km/h before rejected vs 25 km/h before accepted), running tally math, and helper functions.

### Changed Files
- `src/lib/drop-test.js` (created)
- `tests/drop-test.test.mjs` (created)
- `docs/drive/drop-test-protocol.md` (created)
- `docs/drive/pr-bodies/AG-D3.md` (created)
- `src/app/drive/proof/page.jsx` (modified: one new "Drop and fall test" section)

### Test Suite Output
```
=== AG-D3 Drop-and-Fall Test Suite ===

PASS  DROP_TRIAL_TYPES has 5 configured trial types
PASS  cushion_drop_1m expected is true (detected)
PASS  pocket_fall expected is true (detected)
PASS  bag_drop expected is true (detected)
PASS  mount_knock expected is false (not detected)
PASS  normal_handling expected is false (not detected)
PASS  cushion_drop_1m: detected is true
PASS  cushion_drop_1m: state is crash
PASS  cushion_drop_1m: peakG is ~4.6g (got 4.6, want 4.6 ± 0.2)
PASS  cushion_drop_1m: msToDetect is >= 8000 ms
PASS  cushion_drop_1m: evaluateTrialResult passes
PASS  cushion_drop_1m: evaluateTrialResult expected is true
PASS  pocket_fall: detected is true
PASS  pocket_fall: state is crash
PASS  pocket_fall: peakG is ~5.2g (got 5.2, want 5.2 ± 0.2)
PASS  pocket_fall: msToDetect is >= 8000 ms
PASS  pocket_fall: evaluateTrialResult passes
PASS  bag_drop: detected is true
PASS  bag_drop: state is crash
PASS  bag_drop: peakG is ~3.9g (got 3.9, want 3.9 ± 0.2)
PASS  bag_drop: evaluateTrialResult passes
PASS  mount_knock: detected is false (no stillness after impact)
PASS  mount_knock: msToDetect is null
PASS  mount_knock: evaluateTrialResult passes (correctly not detected)
PASS  mount_knock: evaluateTrialResult expected is false
PASS  normal_handling: detected is false
PASS  normal_handling: msToDetect is null
PASS  normal_handling: peakG is < 2.5g
PASS  normal_handling: evaluateTrialResult passes (correctly not detected)
PASS  impact_no_stillness: detected is false
PASS  impact_no_stillness: state is not crash
PASS  impact_no_stillness: msToDetect is null
PASS  impact_no_stillness: recorded high peakG ~6.0g (got 6, want 6 ± 0.2)
PASS  impact_no_stillness: fails cushion_drop expectation
PASS  impact_no_stillness: reason is expected_detection_but_missed
PASS  empty trace: detected is false
PASS  empty trace: missingData is true
PASS  empty trace: peakG is 0
PASS  empty trace fails cushion_drop_1m
PASS  empty trace fails pocket_fall
PASS  empty trace fails bag_drop
PASS  empty trace fails mount_knock (missing data)
PASS  empty trace fails normal_handling (missing data)
PASS  empty trace reason is missing_data
PASS  null trace: detected is false
PASS  null trace fails normal_handling
PASS  invalid samples: detected is false
PASS  invalid samples fails normal_handling
PASS  0 km/h speed before impact: crash detector rejects standstill drop
PASS  25 km/h simulated speed before event enables crash detection
PASS  tally cushion_drop_1m total is 5
PASS  tally cushion_drop_1m caught is 4
PASS  tally cushion_drop_1m pass is 4
PASS  tally cushion_drop_1m fail is 1
PASS  tally cushion_drop_1m caughtRate is 0.8
PASS  tally pocket_fall total is 3
PASS  tally pocket_fall caught is 3
PASS  tally pocket_fall caughtRate is 1
PASS  tally mount_knock total is 4
PASS  tally mount_knock falseAlarms is 1
PASS  tally mount_knock pass is 3
PASS  tally mount_knock fail is 1
PASS  tally mount_knock falseAlarmRate is 0.25
PASS  tally normal_handling total is 2
PASS  tally normal_handling falseAlarms is 0
PASS  tally summary totalTrials is 14
PASS  tally summary stagedFallsTotal is 8
PASS  tally summary stagedFallsCaught is 7
PASS  tally summary stagedFallsCaughtRate is ~0.88 (got 0.88, want 0.88 ± 0.02)
PASS  tally summary nonCrashTrialsTotal is 6
PASS  tally summary falseAlarmsTotal is 1
PASS  tally summary falseAlarmRate is ~0.17 (got 0.17, want 0.17 ± 0.02)
PASS  evaluateDropTest alias equals runDropTest
PASS  getPhoneModel returns a string

74 passed, 0 failed
```
