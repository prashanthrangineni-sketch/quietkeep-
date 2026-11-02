// tests/false-alarm-stats.test.mjs
// TASK CARD AG-D4: False-alarm page (DRV-17)
// Unit tests covering rate calculations, the 10-hour floor, open session filtering,
// paired clip deduplication, classification of false alarms and true events,
// staged fall counts, per-phone-model grouping, date range formatting,
// and resilience against missing tables / empty data.

import {
  CONSTANTS,
  formatDate,
  deduplicateAlarmClips,
  isClipFalseAlarm,
  isClipTrueEvent,
  isCheckInCancelled,
  evalProofRunDropTest,
  computeFalseAlarmStats,
  fetchFalseAlarmData,
} from '../src/lib/false-alarm-stats.js';

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

function assert(name, condition) {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}`);
  if (!condition) {
    fail++;
  } else {
    pass++;
  }
}

// ── 1. Constants ─────────────────────────────────────────────────────────────
eq('CONSTANTS.MIN_RIDING_HOURS_FOR_RATE is 10', CONSTANTS.MIN_RIDING_HOURS_FOR_RATE, 10);
eq('CONSTANTS.NOT_ENOUGH_RIDING_MSG is "not enough riding yet"', CONSTANTS.NOT_ENOUGH_RIDING_MSG, 'not enough riding yet');
eq('CONSTANTS.RATE_PER_HOURS is 1000', CONSTANTS.RATE_PER_HOURS, 1000);
eq('CONSTANTS.PAIR_WINDOW_MS is 30000', CONSTANTS.PAIR_WINDOW_MS, 30000);

// ── 2. Date Formatting ───────────────────────────────────────────────────────
eq('formatDate formats ISO string correctly', formatDate('2026-10-18T10:00:00Z'), '18 Oct 2026');
eq('formatDate formats Date object correctly', formatDate(new Date('2026-11-02T12:00:00Z')), '2 Nov 2026');
eq('formatDate handles null/empty gracefully', formatDate(null), '');

// ── 3. Clip Deduplication & Pairing (AG-D4 Note) ──────────────────────────────
{
  // A. Paired event: detector emitted 'suspected' then 'crash' within 10s in same session
  const paired = [
    { id: 's1', session_id: 'sess1', kind: 'suspected', outcome: 'cancelled_ok', started_at: '2026-11-02T10:00:00.000Z' },
    { id: 'c1', session_id: 'sess1', kind: 'crash', outcome: 'cancelled_ok', started_at: '2026-11-02T10:00:10.000Z' },
  ];
  const deduped = deduplicateAlarmClips(paired);
  eq('paired suspected + crash emits exactly 1 alarm', deduped.length, 1);
  eq('paired alarm is the crash clip', deduped[0].id, 'c1');

  // B. Manual suspected clip whose outcome was set, with NO crash clip
  const loneSuspected = [
    { id: 's2', session_id: 'sess2', kind: 'suspected', outcome: 'cancelled_ok', started_at: '2026-11-02T11:00:00.000Z' },
  ];
  const dedupedLone = deduplicateAlarmClips(loneSuspected);
  eq('lone suspected with outcome set counts as an alarm', dedupedLone.length, 1);
  eq('lone suspected id matches', dedupedLone[0].id, 's2');

  // C. Suspected clip with outcome 'pending' and no label (not manual/resolved) -> NOT an alarm
  const pendingSuspected = [
    { id: 's3', session_id: 'sess3', kind: 'suspected', outcome: 'pending', started_at: '2026-11-02T12:00:00.000Z' },
  ];
  eq('pending suspected clip is not an alarm', deduplicateAlarmClips(pendingSuspected).length, 0);

  // D. Normal sample is never an alarm
  const normalSample = [
    { id: 'n1', session_id: 'sess4', kind: 'normal_sample', outcome: 'pending', started_at: '2026-11-02T13:00:00.000Z' },
  ];
  eq('normal_sample is ignored as alarm', deduplicateAlarmClips(normalSample).length, 0);

  // E. Standalone crash clip is always an alarm
  const loneCrash = [
    { id: 'c2', session_id: 'sess5', kind: 'crash', outcome: 'sent', started_at: '2026-11-02T14:00:00.000Z' },
  ];
  eq('lone crash clip is an alarm', deduplicateAlarmClips(loneCrash).length, 1);
}

// ── 4. Clip Classification (False Alarm vs True Event) ────────────────────────
{
  eq('cancelled_ok is false alarm', isClipFalseAlarm({ outcome: 'cancelled_ok', label: null }), true);
  eq('label bump is false alarm', isClipFalseAlarm({ outcome: 'pending', label: 'bump' }), true);
  eq('label nothing is false alarm', isClipFalseAlarm({ outcome: 'pending', label: 'nothing' }), true);
  eq('label fall is not false alarm', isClipFalseAlarm({ outcome: 'sent', label: 'fall' }), false);
  eq('outcome sent without label is not false alarm', isClipFalseAlarm({ outcome: 'sent', label: null }), false);

  eq('label fall is true event', isClipTrueEvent({ outcome: 'sent', label: 'fall' }), true);
  eq('outcome sent without cancel/bump/nothing is true event', isClipTrueEvent({ outcome: 'sent', label: null }), true);
  eq('cancelled_ok is not true event', isClipTrueEvent({ outcome: 'cancelled_ok', label: null }), false);
  eq('label bump is not true event', isClipTrueEvent({ outcome: 'sent', label: 'bump' }), false);

  eq('cancelled_ok counts as check-in cancelled', isCheckInCancelled({ outcome: 'cancelled_ok' }), true);
  eq('sent does not count as check-in cancelled', isCheckInCancelled({ outcome: 'sent' }), false);
}

// ── 5. Staged Fall Evaluation (from drive_proof_runs) ─────────────────────────
{
  // cushion_drop_1m passed (caught)
  const run1 = evalProofRunDropTest({ step: 'drop_test:cushion_drop_1m', result: 'pass', evidence: { detected: true, expected: true } });
  eq('cushion_drop_1m is staged fall', run1.isStagedFall, true);
  eq('cushion_drop_1m detected is caught', run1.caught, true);

  // pocket_fall failed (not caught)
  const run2 = evalProofRunDropTest({ step: 'drop_test:pocket_fall', result: 'fail', evidence: { detected: false, expected: true } });
  eq('pocket_fall is staged fall', run2.isStagedFall, true);
  eq('pocket_fall not detected is not caught', run2.caught, false);

  // bag_drop passed
  const run3 = evalProofRunDropTest({ step: 'drop_test:bag_drop', result: 'pass', evidence: { detected: true } });
  eq('bag_drop is staged fall and caught', run3.isStagedFall && run3.caught, true);

  // mount_knock is a negative control (not a staged fall)
  const run4 = evalProofRunDropTest({ step: 'drop_test:mount_knock', result: 'pass', evidence: { detected: false, expected: false } });
  eq('mount_knock is not a staged fall', run4.isStagedFall, false);

  // normal_handling is a negative control
  const run5 = evalProofRunDropTest({ step: 'drop_test:normal_handling', result: 'pass', evidence: { detected: false, expected: false } });
  eq('normal_handling is not a staged fall', run5.isStagedFall, false);
}

// ── 6. 10-Hour Floor for Rate Display ─────────────────────────────────────────
{
  // 5 hours of riding, 1 false alarm -> fewer than 10h -> "not enough riding yet", rate is null
  const underFloor = computeFalseAlarmStats({
    drivingSessions: [
      { id: 's1', ended_at: '2026-11-01T15:00:00Z', duration_seconds: 5 * 3600, phone_model: 'Pixel 7' },
    ],
    rideSensorClips: [
      { id: 'c1', session_id: 's1', kind: 'crash', outcome: 'cancelled_ok', phone_model: 'Pixel 7' },
    ],
  });

  eq('under 10 hours has ridingHours = 5.0', underFloor.totals.ridingHours, 5.0);
  eq('under 10 hours rate is null', underFloor.totals.falseAlarmsPer1000Hours, null);
  eq('under 10 hours rateDisplay is "not enough riding yet"', underFloor.totals.rateDisplay, 'not enough riding yet');
  eq('under 10 hours hasEnoughRiding is false', underFloor.totals.hasEnoughRiding, false);

  // Exactly 10 hours of riding, 1 false alarm -> rate is (1 / 10) * 1000 = 100.0
  const atFloor = computeFalseAlarmStats({
    drivingSessions: [
      { id: 's2', ended_at: '2026-11-01T20:00:00Z', duration_seconds: 10 * 3600, phone_model: 'Pixel 7' },
    ],
    rideSensorClips: [
      { id: 'c2', session_id: 's2', kind: 'crash', outcome: 'cancelled_ok', phone_model: 'Pixel 7' },
    ],
  });

  eq('at 10 hours rate is calculated', atFloor.totals.falseAlarmsPer1000Hours, 100.0);
  eq('at 10 hours rateDisplay is "100"', atFloor.totals.rateDisplay, '100');
  eq('at 10 hours hasEnoughRiding is true', atFloor.totals.hasEnoughRiding, true);

  // 25 hours of riding, 2 false alarms -> (2 / 25) * 1000 = 80.0
  const wellOver = computeFalseAlarmStats({
    drivingSessions: [
      { id: 's3', ended_at: '2026-11-01T20:00:00Z', duration_seconds: 25 * 3600, phone_model: 'Pixel 7' },
    ],
    rideSensorClips: [
      { id: 'c3', session_id: 's3', kind: 'crash', outcome: 'cancelled_ok', phone_model: 'Pixel 7' },
      { id: 'c4', session_id: 's3', kind: 'crash', label: 'bump', phone_model: 'Pixel 7' },
    ],
  });

  eq('25 hours with 2 false alarms has rate 80', wellOver.totals.falseAlarmsPer1000Hours, 80.0);
  eq('25 hours rateDisplay is "80"', wellOver.totals.rateDisplay, '80');
}

// ── 7. Open Sessions Ignored ───────────────────────────────────────────────────
{
  const sessionsWithOpen = [
    { id: 's1', ended_at: '2026-11-01T12:00:00Z', duration_seconds: 7200, phone_model: 'Pixel 7' }, // 2 hours
    { id: 's2', ended_at: null, duration_seconds: 3600, phone_model: 'Pixel 7' },                  // open session -> IGNORED
    { id: 's3', ended_at: '2026-11-01T16:00:00Z', duration_seconds: null, phone_model: 'Pixel 7' }, // invalid duration -> IGNORED
    { id: 's4', ended_at: '2026-11-01T18:00:00Z', duration_seconds: 3600, phone_model: 'Pixel 7' }, // 1 hour
  ];

  const stats = computeFalseAlarmStats({ drivingSessions: sessionsWithOpen });
  eq('open and null duration sessions are ignored', stats.totals.ridingHours, 3.0);
  eq('total riding seconds equals sum of closed sessions only (10800s)', stats.totals.ridingSeconds, 10800);
}

// ── 8. Full Multi-Model Fixture Test ──────────────────────────────────────────
{
  const fixtureSessions = [
    // Model A: Pixel 7 - 12 hours total
    { id: 'sess_a1', ended_at: '2026-10-20T10:00:00Z', duration_seconds: 6 * 3600, phone_model: 'Pixel 7', started_at: '2026-10-20T04:00:00Z' },
    { id: 'sess_a2', ended_at: '2026-10-21T10:00:00Z', duration_seconds: 6 * 3600, phone_model: 'Pixel 7', started_at: '2026-10-21T04:00:00Z' },
    // Model B: Galaxy S21 - 5 hours total (below 10h floor)
    { id: 'sess_b1', ended_at: '2026-10-22T10:00:00Z', duration_seconds: 5 * 3600, phone_model: 'Galaxy S21', started_at: '2026-10-22T05:00:00Z' },
  ];

  const fixtureClips = [
    // Model A: 1 paired event (suspected + crash cancelled_ok) -> 1 false alarm, 1 check-in cancelled
    { id: 'clip_s1', session_id: 'sess_a1', kind: 'suspected', outcome: 'cancelled_ok', started_at: '2026-10-20T05:00:00Z', phone_model: 'Pixel 7' },
    { id: 'clip_c1', session_id: 'sess_a1', kind: 'crash', outcome: 'cancelled_ok', started_at: '2026-10-20T05:00:10Z', phone_model: 'Pixel 7' },

    // Model A: 1 true event (crash sent)
    { id: 'clip_c2', session_id: 'sess_a2', kind: 'crash', outcome: 'sent', started_at: '2026-10-21T06:00:00Z', phone_model: 'Pixel 7' },

    // Model B: 1 false alarm (labelled bump)
    { id: 'clip_c3', session_id: 'sess_b1', kind: 'crash', label: 'bump', started_at: '2026-10-22T07:00:00Z', phone_model: 'Galaxy S21' },
  ];

  const fixtureBlackbox = [
    // Model A: 1 unconfirmed blackbox event -> 1 false alarm
    { id: 'bb1', confirmed: false, started_at: '2026-10-20T08:00:00Z', phone_model: 'Pixel 7' },
  ];

  const fixtureProofRuns = [
    // Model A: 3 staged falls, 2 caught
    { step: 'drop_test:cushion_drop_1m', result: 'pass', evidence: { detected: true, phone_model: 'Pixel 7' }, created_at: '2026-10-23T10:00:00Z' },
    { step: 'drop_test:pocket_fall', result: 'pass', evidence: { detected: true, phone_model: 'Pixel 7' }, created_at: '2026-10-23T10:05:00Z' },
    { step: 'drop_test:bag_drop', result: 'fail', evidence: { detected: false, phone_model: 'Pixel 7' }, created_at: '2026-10-23T10:10:00Z' },
    // Model A: 1 mount_knock (negative control -> not a staged fall)
    { step: 'drop_test:mount_knock', result: 'pass', evidence: { detected: false, phone_model: 'Pixel 7' }, created_at: '2026-10-23T10:15:00Z' },

    // Model B: 1 staged fall, 1 caught
    { step: 'drop_test:cushion_drop_1m', result: 'pass', evidence: { detected: true, phone_model: 'Galaxy S21' }, created_at: '2026-10-24T10:00:00Z' },
  ];

  const res = computeFalseAlarmStats({
    drivingSessions: fixtureSessions,
    rideSensorClips: fixtureClips,
    blackboxEvents: fixtureBlackbox,
    driveProofRuns: fixtureProofRuns,
  });

  eq('contains 2 distinct models', res.byModel.length, 2);

  const modelGalaxy = res.byModel.find(m => m.phoneModel === 'Galaxy S21');
  const modelPixel = res.byModel.find(m => m.phoneModel === 'Pixel 7');

  // Galaxy S21 checks (5 hours -> below floor)
  eq('Galaxy ridingHours is 5.0', modelGalaxy.ridingHours, 5.0);
  eq('Galaxy falseAlarms is 1', modelGalaxy.falseAlarms, 1);
  eq('Galaxy rateDisplay is "not enough riding yet"', modelGalaxy.rateDisplay, 'not enough riding yet');
  eq('Galaxy staged falls display is "1 / 1"', modelGalaxy.stagedFallsDisplay, '1 / 1');

  // Pixel 7 checks (12 hours -> above floor, 2 false alarms: 1 clip + 1 blackbox)
  eq('Pixel ridingHours is 12.0', modelPixel.ridingHours, 12.0);
  eq('Pixel falseAlarms is 2 (1 clip + 1 bb)', modelPixel.falseAlarms, 2);
  eq('Pixel trueEvents is 1', modelPixel.trueEvents, 1);
  eq('Pixel checkInsCancelled is 1', modelPixel.checkInsCancelled, 1);
  // (2 / 12) * 1000 = 166.7
  eq('Pixel falseAlarmsPer1000Hours is 166.7', modelPixel.falseAlarmsPer1000Hours, 166.7);
  eq('Pixel rateDisplay is "166.7"', modelPixel.rateDisplay, '166.7');
  eq('Pixel staged falls caught/total is "2 / 3"', modelPixel.stagedFallsDisplay, '2 / 3');

  // Totals checks (12 + 5 = 17 hours -> above floor, 3 false alarms total)
  eq('Totals ridingHours is 17.0', res.totals.ridingHours, 17.0);
  eq('Totals falseAlarms is 3', res.totals.falseAlarms, 3);
  eq('Totals checkInsCancelled is 1', res.totals.checkInsCancelled, 1);
  // (3 / 17) * 1000 = 176.5
  eq('Totals falseAlarmsPer1000Hours is 176.5', res.totals.falseAlarmsPer1000Hours, 176.5);
  eq('Totals staged falls display is "3 / 4"', res.totals.stagedFallsDisplay, '3 / 4');

  // Date range
  assert('Date range has formatted string', typeof res.dateRange.formatted === 'string');
  assert('Date range covers Oct 2026', res.dateRange.formatted.includes('Oct 2026'));
}

// ── 9. Missing Tables & Empty Data Resiliency ──────────────────────────────────
{
  // Null and empty inputs never crash
  const empty1 = computeFalseAlarmStats();
  eq('empty call returns valid structure', typeof empty1, 'object');
  eq('empty call totals riding hours is 0.0', empty1.totals.ridingHours, 0.0);
  eq('empty call rateDisplay is "not enough riding yet"', empty1.totals.rateDisplay, 'not enough riding yet');
  eq('empty call byModel is empty array', empty1.byModel.length, 0);
  eq('empty call dateRange formatted is "No activity recorded"', empty1.dateRange.formatted, 'No activity recorded');

  const empty2 = computeFalseAlarmStats({
    drivingSessions: null,
    blackboxEvents: null,
    rideSensorClips: null,
    driveProofRuns: null,
  });
  eq('null fields handled safely', empty2.totals.falseAlarms, 0);

  // Missing tables simulation via fake Supabase client that throws errors
  const mockSupabaseMissingTables = {
    from: (table) => {
      return {
        select: () => ({
          eq: () => ({
            order: async () => {
              if (table === 'ride_sensor_clips') {
                return { error: { message: 'relation "ride_sensor_clips" does not exist', code: '42P01' }, data: null };
              }
              if (table === 'drive_proof_runs') {
                return { error: { message: 'relation "drive_proof_runs" does not exist', code: '42P01' }, data: null };
              }
              return { error: null, data: [] };
            },
          }),
        }),
      };
    },
  };

  let fetchedData = null;
  let fetchError = null;
  try {
    const res = await fetchFalseAlarmData(mockSupabaseMissingTables, 'user-123');
    fetchedData = res.stats;
  } catch (err) {
    fetchError = err;
  }

  eq('fetchFalseAlarmData does not throw on missing tables', fetchError, null);
  assert('fetchFalseAlarmData returns valid stats when tables are missing', fetchedData !== null);
  eq('missing tables treated as 0 riding hours without error', fetchedData.totals.ridingHours, 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

