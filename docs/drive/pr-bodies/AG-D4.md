## Summary

Implements **AG-D4: False-alarm page (DRV-17)**.
Provides pure calculation logic and a dedicated read-only screen (`/drive/stats`) to evaluate crash detection performance, false-alarm rates per 1,000 riding hours, check-ins cancelled, and staged drop-test validation per phone model and in aggregate.

### What Was Built

1. **`src/lib/false-alarm-stats.js`**:
   - `computeFalseAlarmStats(data)`: Pure calculator for ride safety calibration data:
     - **Riding Hours**: Sum of durations from `driving_sessions`. Open sessions (`ended_at == null` or missing duration) are strictly ignored.
     - **10-Hour Floor**: Displays `"not enough riding yet"` (rate is `null`) whenever riding hours are below 10 hours. Normalised rate `(falseAlarms / ridingHours) * 1000` is computed only once ≥ 10 riding hours are recorded.
     - **AG-D4 Event Pairing Rule**: Detector emits `'suspected'` then `'crash'` for a single event; alarms are counted only from clips of kind `'crash'` (or lone manual `'suspected'` clips whose outcome is set), never both.
     - **False Alarm vs True Event Classification**:
       - Clips with outcome `cancelled_ok` or label `bump`/`nothing` = false alarm.
       - Clips with label `fall` or outcome `sent` (without cancel/bump/nothing) = true event.
       - Black box events with `confirmed: false` = false alarm; `confirmed: true` = true event.
     - **Check-ins Cancelled**: Count of deduplicated candidate events cancelled by the rider (`cancelled_ok`).
     - **Staged Falls Caught / Total**: Evaluates `drive_proof_runs` drop trials (`drop_test:cushion_drop_1m`, `drop_test:pocket_fall`, `drop_test:bag_drop`) caught vs total. Negative controls (`mount_knock`, `normal_handling`) are excluded from staged fall tallies.
     - **Per Phone Model & Totals**: Grouped breakdown per phone model plus aggregate totals row.
     - **Date Range**: Computes and formats earliest and latest activity timestamps covered.
   - `fetchFalseAlarmData(supabase, userId)`: Reads the signed-in user's own rows across `driving_sessions`, `blackbox_events`, `ride_sensor_clips`, and `drive_proof_runs`. Handles unmerged or missing tables gracefully as "no data" without crashing.

2. **`src/app/drive/stats/page.jsx`**:
   - Unlisted URL `/drive/stats` (read-only).
   - Date range coverage header badge.
   - Overview metrics cards: Riding Hours, False Alarms / 1,000h, Check-ins Cancelled, Staged Falls Caught.
   - Overall Totals summary table.
   - Breakdown tables per phone model with status badges and context notes.
   - Refresh button and full responsiveness using project-standard dark palette.

3. **`tests/false-alarm-stats.test.mjs`**:
   - Comprehensive test suite covering rate maths, the 10-hour floor, open session filtering, paired event deduplication, outcome/label classification, staged fall evaluation, multi-model fixtures, date range formatting, and missing table resilience.

### Allowed Files Check
- `src/app/drive/stats/page.jsx` (created)
- `src/lib/false-alarm-stats.js` (created)
- `tests/false-alarm-stats.test.mjs` (created)
- `docs/drive/pr-bodies/AG-D4.md` (created)

No other files created or modified.

### Test Output
```
PASS  CONSTANTS.MIN_RIDING_HOURS_FOR_RATE is 10
PASS  CONSTANTS.NOT_ENOUGH_RIDING_MSG is "not enough riding yet"
PASS  CONSTANTS.RATE_PER_HOURS is 1000
PASS  CONSTANTS.PAIR_WINDOW_MS is 30000
PASS  formatDate formats ISO string correctly
PASS  formatDate formats Date object correctly
PASS  formatDate handles null/empty gracefully
PASS  paired suspected + crash emits exactly 1 alarm
PASS  paired alarm is the crash clip
PASS  lone suspected with outcome set counts as an alarm
PASS  lone suspected id matches
PASS  pending suspected clip is not an alarm
PASS  normal_sample is ignored as alarm
PASS  lone crash clip is an alarm
PASS  cancelled_ok is false alarm
PASS  label bump is false alarm
PASS  label nothing is false alarm
PASS  label fall is not false alarm
PASS  outcome sent without label is not false alarm
PASS  label fall is true event
PASS  outcome sent without cancel/bump/nothing is true event
PASS  cancelled_ok is not true event
PASS  label bump is not true event
PASS  cancelled_ok counts as check-in cancelled
PASS  sent does not count as check-in cancelled
PASS  cushion_drop_1m is staged fall
PASS  cushion_drop_1m detected is caught
PASS  pocket_fall is staged fall
PASS  pocket_fall not detected is not caught
PASS  bag_drop is staged fall and caught
PASS  mount_knock is not a staged fall
PASS  normal_handling is not a staged fall
PASS  under 10 hours has ridingHours = 5.0
PASS  under 10 hours rate is null
PASS  under 10 hours rateDisplay is "not enough riding yet"
PASS  under 10 hours hasEnoughRiding is false
PASS  at 10 hours rate is calculated
PASS  at 10 hours rateDisplay is "100"
PASS  at 10 hours hasEnoughRiding is true
PASS  25 hours with 2 false alarms has rate 80
PASS  25 hours rateDisplay is "80"
PASS  open and null duration sessions are ignored
PASS  total riding seconds equals sum of closed sessions only (10800s)
PASS  contains 2 distinct models
PASS  Galaxy ridingHours is 5.0
PASS  Galaxy falseAlarms is 1
PASS  Galaxy rateDisplay is "not enough riding yet"
PASS  Galaxy staged falls display is "1 / 1"
PASS  Pixel ridingHours is 12.0
PASS  Pixel falseAlarms is 2 (1 clip + 1 bb)
PASS  Pixel trueEvents is 1
PASS  Pixel checkInsCancelled is 1
PASS  Pixel falseAlarmsPer1000Hours is 166.7
PASS  Pixel rateDisplay is "166.7"
PASS  Pixel staged falls caught/total is "2 / 3"
PASS  Totals ridingHours is 17.0
PASS  Totals falseAlarms is 3
PASS  Totals checkInsCancelled is 1
PASS  Totals falseAlarmsPer1000Hours is 176.5
PASS  Totals staged falls display is "3 / 4"
PASS  Date range has formatted string
PASS  Date range covers Oct 2026
PASS  empty call returns valid structure
PASS  empty call totals riding hours is 0.0
PASS  empty call rateDisplay is "not enough riding yet"
PASS  empty call byModel is empty array
PASS  empty call dateRange formatted is "No activity recorded"
PASS  null fields handled safely
PASS  fetchFalseAlarmData does not throw on missing tables
PASS  fetchFalseAlarmData returns valid stats when tables are missing
PASS  missing tables treated as 0 riding hours without error

71 passed, 0 failed
```

### Limitations & Verification
- Screen is read-only and unlisted (URL `/drive/stats` only).
- When fewer than 10 riding hours exist for a phone model or totals, the rate column displays "not enough riding yet" rather than calculating an under-sampled rate.
- Claude can verify live table integration after merge.

