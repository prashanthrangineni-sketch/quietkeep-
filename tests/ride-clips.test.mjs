// tests/ride-clips.test.mjs
// TASK CARD AG-D2: Ride recorder for labelled clips (DRV-15)
// Unit tests covering buffer window maths, 5s+5s freeze, normal-sample rate,
// 30-clip cap, opt-out, outcome and label validation, and location coordinate scrubbing.

import {
  CONSTANTS,
  ALLOWED_KINDS,
  ALLOWED_OUTCOMES,
  ALLOWED_LABELS,
  createClipRecorder,
  saveLastRideClips,
  loadLastRideClips,
  labelLastRideClip,
} from '../src/lib/ride-clips.js';

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

function throws(name, fn) {
  let threw = false;
  try {
    fn();
  } catch {
    threw = true;
  }
  console.log(`${threw ? 'PASS' : 'FAIL'}  ${name}`);
  if (!threw) {
    fail++;
  } else {
    pass++;
  }
}

// ── 1. Constants & Allowed Enum Values ─────────────────────────────────────────
eq('CONSTANTS.WINDOW_MS is 10000 (10 seconds)', CONSTANTS.WINDOW_MS, 10000);
eq('CONSTANTS.PRE_EVENT_MS is 5000 (5 seconds)', CONSTANTS.PRE_EVENT_MS, 5000);
eq('CONSTANTS.POST_EVENT_MS is 5000 (5 seconds)', CONSTANTS.POST_EVENT_MS, 5000);
eq('CONSTANTS.MAX_CLIPS_PER_RIDE is 30', CONSTANTS.MAX_CLIPS_PER_RIDE, 30);
eq('CONSTANTS.NORMAL_SAMPLE_INTERVAL_MS is 600000 (10 riding minutes)', CONSTANTS.NORMAL_SAMPLE_INTERVAL_MS, 600000);
eq('ALLOWED_KINDS contains suspected, crash, normal_sample', ALLOWED_KINDS, ['suspected', 'crash', 'normal_sample']);
eq('ALLOWED_OUTCOMES contains pending, cancelled_ok, sent, drill', ALLOWED_OUTCOMES, ['pending', 'cancelled_ok', 'sent', 'drill']);
eq('ALLOWED_LABELS contains bump, fall, nothing', ALLOWED_LABELS, ['bump', 'fall', 'nothing']);

// ── 2. Buffer Window Maths & 5s + 5s Freeze ────────────────────────────────────
{
  let now = 100000;
  const clock = () => now;
  const recorder = createClipRecorder({ clock, enabled: true });

  // Feed 10 seconds of background motion (at 100ms intervals = 10 Hz)
  for (let t = now; t <= now + 10000; t += 100) {
    recorder.feedSample({ at: t, g: 1.0, kmh: 30 });
  }

  // Trigger candidate at t = now + 7000 (7s into recording)
  const eventAt = now + 7000;
  const clip = recorder.onCandidate('suspected', { at: eventAt, impactG: 2.8 });

  assert('candidate clip created', clip !== null);
  eq('clip.kind is suspected', clip.kind, 'suspected');
  eq('clip.outcome is pending', clip.outcome, 'pending');
  eq('clip.label is null', clip.label, null);

  // Started at is exactly eventAt - 5000
  const expectedStartIso = new Date(eventAt - 5000).toISOString();
  eq('clip.startedAt is 5s before event', clip.startedAt, expectedStartIso);

  // Buffer already has samples up to now + 10000 (which is eventAt + 3000).
  // The clip needs eventAt + 5000 = now + 12000. So it is not completed yet.
  assert('clip is not yet completed at now + 10000', clip.completed === false);

  // Advance time and feed samples up to eventAt + 5000 (now + 12000)
  for (let t = now + 10100; t <= eventAt + 5000; t += 100) {
    now = t;
    recorder.feedSample({ at: t, g: 1.0, kmh: 30 });
  }

  assert('clip is completed once t reaches eventAt + 5000', clip.completed === true);

  // Check samples in clip: must span exactly [eventAt - 5000, eventAt + 5000]
  const sampleTimes = clip.samples.map(s => s.at);
  const minTime = Math.min(...sampleTimes);
  const maxTime = Math.max(...sampleTimes);
  eq('earliest sample in clip is eventAt - 5000', minTime, eventAt - 5000);
  eq('latest sample in clip is eventAt + 5000', maxTime, eventAt + 5000);
  eq('total span of clip samples is 10,000 ms', maxTime - minTime, 10000);
}

// ── 3. Immediate Freeze When Buffer Already Holds Past 5s ─────────────────────
{
  let now = 50000;
  const recorder = createClipRecorder({ clock: () => now, enabled: true });

  // Pre-fill buffer from 20000 to 50000
  for (let t = 20000; t <= 50000; t += 200) {
    recorder.feedSample({ at: t, g: 1.0, kmh: 40 });
  }

  // Trigger candidate for an event that happened at 35000
  // Window: [30000, 40000] — both pre and post are already in buffer!
  const clip = recorder.onCandidate('crash', { at: 35000 });
  assert('clip freezes immediately when window is in buffer', clip.completed === true);
  eq('clip sample count matches window', clip.samples.length, 51); // (40000-30000)/200 + 1 = 51
}

// ── 4. Normal-Sample Rate (1 per 10 Riding Minutes) ───────────────────────────
{
  let now = 0;
  // Injected random returns 0.5, meaning offset is exactly at 5 minutes of riding time
  const recorder = createClipRecorder({
    clock: () => now,
    enabled: true,
    random: () => 0.5,
  });

  // Step 1: Ride for 4 minutes at 30 km/h (240,000 ms) — target is at 5 min (300,000 ms)
  for (let t = 0; t <= 240000; t += 1000) {
    now = t;
    recorder.feedSample({ at: t, g: 1.0, kmh: 30 });
  }
  eq('no normal sample fired before 5 minutes', recorder.getClips().length, 0);

  // Step 2: Cross 5 minutes (300,000 ms)
  for (let t = 241000; t <= 300000; t += 1000) {
    now = t;
    recorder.feedSample({ at: t, g: 1.0, kmh: 30 });
  }
  const clips1 = recorder.getClips();
  eq('1st normal sample fired at 5 riding minutes', clips1.length, 1);
  eq('1st normal sample has kind normal_sample', clips1[0].kind, 'normal_sample');

  // Step 3: Standstill at signal for 10 minutes (speed = 0)
  for (let t = 301000; t <= 901000; t += 1000) {
    now = t;
    recorder.feedSample({ at: t, g: 1.0, kmh: 0 });
  }
  eq('stopped at signal does not trigger normal samples', recorder.getClips().length, 1);

  // Step 4: Ride for another 10 minutes at 30 km/h (accumulates 10 more riding minutes -> total 15 riding minutes)
  // Target 2 is at 10 min + 5 min = 15 riding minutes
  for (let t = 902000; t <= 1502000; t += 1000) {
    now = t;
    recorder.feedSample({ at: t, g: 1.0, kmh: 30 });
  }
  const clips2 = recorder.getClips();
  eq('2nd normal sample fired after 10 additional riding minutes', clips2.length, 2);
  eq('2nd normal sample has kind normal_sample', clips2[1].kind, 'normal_sample');

  // Step 5: Ride for 10 more riding minutes (total 25 riding minutes) -> 3rd normal sample
  for (let t = 1503000; t <= 2103000; t += 1000) {
    now = t;
    recorder.feedSample({ at: t, g: 1.0, kmh: 30 });
  }
  const clips3 = recorder.getClips();
  eq('3rd normal sample fired at 25 riding minutes', clips3.length, 3);
}

// ── 5. 30-Clip Cap Per Ride ───────────────────────────────────────────────────
{
  let now = 1000;
  const recorder = createClipRecorder({ clock: () => now, enabled: true, random: () => 0.5 });

  // Trigger 35 candidate events
  for (let i = 1; i <= 35; i++) {
    now += 1000;
    recorder.feedSample({ at: now, g: 1.0, kmh: 20 });
    const c = recorder.onCandidate('suspected', { at: now });
    if (i <= 30) {
      assert(`candidate #${i} is accepted`, c !== null);
    } else {
      assert(`candidate #${i} beyond cap is rejected (returns null)`, c === null);
    }
  }

  eq('total clips is strictly capped at 30', recorder.getClips().length, 30);
}

// ── 6. Opt-Out Records Nothing ─────────────────────────────────────────────────
{
  let now = 1000;
  const recorder = createClipRecorder({ clock: () => now, enabled: false });

  // Feed motion and speed while opted out
  for (let t = 1000; t <= 20000; t += 200) {
    recorder.feedMotion({ g: 1.8, at: t });
    recorder.feedSpeed({ kmh: 45, at: t });
    recorder.feedSample({ at: t, g: 1.8, kmh: 45 });
  }

  const candidate = recorder.onCandidate('suspected', { at: 10000 });
  eq('onCandidate returns null when opted out', candidate, null);
  eq('getClips() returns empty array when opted out', recorder.getClips().length, 0);
  eq('buffer remains empty when opted out', recorder.getBuffer().length, 0);
}

// ── 7. Labels and Outcomes Validated ──────────────────────────────────────────
{
  let now = 10000;
  const recorder = createClipRecorder({ clock: () => now, enabled: true });
  const clip = recorder.onCandidate('suspected', { at: now });

  // Valid outcomes
  eq('default outcome is pending', clip.outcome, 'pending');
  recorder.setOutcome(clip.id, 'cancelled_ok');
  eq('setOutcome cancelled_ok updates clip', clip.outcome, 'cancelled_ok');

  recorder.setOutcome(clip.id, 'sent');
  eq('setOutcome sent updates clip', clip.outcome, 'sent');

  recorder.setOutcome(clip.id, 'drill');
  eq('setOutcome drill updates clip', clip.outcome, 'drill');

  // Invalid outcome throws
  throws('invalid outcome throws Error', () => {
    recorder.setOutcome(clip.id, 'invalid_outcome');
  });

  // Valid labels
  eq('default label is null', clip.label, null);
  recorder.label(clip.id, 'bump');
  eq('label bump updates clip', clip.label, 'bump');

  recorder.label(clip.id, 'fall');
  eq('label fall updates clip', clip.label, 'fall');

  recorder.label(clip.id, 'nothing');
  eq('label nothing updates clip', clip.label, 'nothing');

  // Invalid label throws
  throws('invalid label throws Error', () => {
    recorder.label(clip.id, 'not_a_valid_label');
  });

  // Invalid candidate kind throws
  throws('invalid candidate kind throws Error', () => {
    recorder.onCandidate('alien_abduction');
  });
}

// ── 8. No Location Coordinates Stored in Samples (Speed Only) ─────────────────
{
  let now = 100000;
  const recorder = createClipRecorder({ clock: () => now, enabled: true });

  // Feed sample with dirty GPS / coordinate properties
  recorder.feedSample({
    at: now,
    g: 1.25,
    kmh: 42.5,
    lat: 17.385044,
    lng: 78.486671,
    lon: 78.486671,
    accuracy: 3.5,
    heading: 180,
    coords: { latitude: 17.385, longitude: 78.486 },
  });

  const buffer = recorder.getBuffer();
  eq('buffer has 1 sample', buffer.length, 1);
  const sample = buffer[0];

  assert('sample has at', typeof sample.at === 'number');
  assert('sample has g', typeof sample.g === 'number');
  assert('sample has kmh', typeof sample.kmh === 'number');
  assert('sample has NO lat property', !('lat' in sample));
  assert('sample has NO lng property', !('lng' in sample));
  assert('sample has NO lon property', !('lon' in sample));
  assert('sample has NO accuracy property', !('accuracy' in sample));
  assert('sample has NO heading property', !('heading' in sample));
  assert('sample has NO coords property', !('coords' in sample));

  const clip = recorder.onCandidate('suspected', { at: now });
  recorder.flush();

  for (const s of clip.samples) {
    assert('clip sample has NO lat', !('lat' in s));
    assert('clip sample has NO lng', !('lng' in s));
    assert('clip sample has NO lon', !('lon' in s));
    assert('clip sample has NO accuracy', !('accuracy' in s));
    assert('clip sample has NO heading', !('heading' in s));
  }
}

// ── 9. Done When: 10 Simulated Candidate Events Saved and Labelled ─────────────
{
  const startTime = 500000;
  let now = startTime;
  const clock = () => now;
  // random: 0.99 ensures automatic normal sample triggers at ~9.9 riding minutes,
  // so none fires automatically during this 2-minute test.
  const recorder = createClipRecorder({ clock, enabled: true, random: () => 0.99 });

  // 10 distinct candidate events across the ride
  const eventPlan = [
    { kind: 'suspected', offset: 10000, label: 'bump', outcome: 'cancelled_ok' },
    { kind: 'suspected', offset: 20000, label: 'bump', outcome: 'cancelled_ok' },
    { kind: 'normal_sample', offset: 30000, label: 'nothing', outcome: 'pending' },
    { kind: 'suspected', offset: 40000, label: 'bump', outcome: 'cancelled_ok' },
    { kind: 'normal_sample', offset: 50000, label: 'nothing', outcome: 'pending' },
    { kind: 'suspected', offset: 60000, label: 'fall', outcome: 'sent' },
    { kind: 'crash', offset: 70000, label: 'fall', outcome: 'sent' },
    { kind: 'normal_sample', offset: 80000, label: 'nothing', outcome: 'pending' },
    { kind: 'suspected', offset: 90000, label: 'bump', outcome: 'drill' },
    { kind: 'crash', offset: 100000, label: 'bump', outcome: 'cancelled_ok' },
  ];

  const createdClips = [];
  const eventMap = new Map(eventPlan.map(p => [startTime + p.offset, p]));
  const endTime = startTime + 115000;

  // Feed 115 seconds of ride trace (100ms ticks = 10 Hz)
  for (let t = startTime; t <= endTime; t += 100) {
    now = t;
    const plan = eventMap.get(t);
    const gVal = plan ? (plan.kind === 'crash' ? 3.6 : (plan.kind === 'suspected' ? 2.4 : 1.0)) : 1.0;
    recorder.feedSample({ at: t, g: gVal, kmh: 35 });
    if (plan) {
      const clip = recorder.onCandidate(plan.kind, { at: t });
      assert(`candidate event created at offset ${plan.offset}`, clip !== null);
      createdClips.push({ clip, plan });
    }
  }

  recorder.flush();

  eq('exactly 10 candidate events recorded', recorder.getClips().length, 10);
  eq('initially all 10 clips are unlabelled', recorder.getUnlabelledClips().length, 10);

  // Label each of the 10 candidate events and assign outcomes
  for (const { clip, plan } of createdClips) {
    recorder.label(clip.id, plan.label);
    recorder.setOutcome(clip.id, plan.outcome);
  }

  eq('after labeling, 0 clips remain unlabelled', recorder.getUnlabelledClips().length, 0);

  const savedClips = recorder.getClips();
  for (let i = 0; i < savedClips.length; i++) {
    const c = savedClips[i];
    const p = eventPlan[i];
    eq(`clip #${i + 1} kind is ${p.kind}`, c.kind, p.kind);
    eq(`clip #${i + 1} label is ${p.label}`, c.label, p.label);
    eq(`clip #${i + 1} outcome is ${p.outcome}`, c.outcome, p.outcome);
    assert(`clip #${i + 1} has captured samples`, c.samples.length > 0);
    assert(`clip #${i + 1} peakG >= 1.0`, c.peakG >= 1.0);
  }
}

// ── 10. LocalStorage Persistence Helpers ──────────────────────────────────────
{
  const mockStorage = {
    _data: {},
    getItem(k) { return this._data[k] || null; },
    setItem(k, v) { this._data[k] = String(v); },
  };

  const sampleClips = [
    { id: 'clip-1', kind: 'suspected', label: null, outcome: 'pending', startedAt: '2026-11-02T10:00:00Z', peakG: 2.5 },
    { id: 'clip-2', kind: 'crash', label: null, outcome: 'sent', startedAt: '2026-11-02T10:05:00Z', peakG: 4.1 },
  ];

  saveLastRideClips(sampleClips, mockStorage);
  const loaded = loadLastRideClips(mockStorage);
  eq('loaded clips count matches saved count', loaded.length, 2);
  eq('first clip id matches', loaded[0].id, 'clip-1');

  const updated = labelLastRideClip('clip-1', 'bump', mockStorage);
  eq('labelLastRideClip updates label to bump', updated.label, 'bump');

  const reloaded = loadLastRideClips(mockStorage);
  eq('persisted clip has updated label', reloaded[0].label, 'bump');
}

// ── Upload to ride_sensor_clips (Claude review fix) ──
{
  const { uploadRideClips } = await import('../src/lib/ride-clips.js');
  const inserted = [];
  const db = { from: (t) => ({ insert: async (row) => { inserted.push({ t, row }); return { error: inserted.length === 2 ? { code: '23505', message: 'dup' } : null }; } }) };
  const clips = [
    { id: 'a1', kind: 'suspected', outcome: 'cancelled_ok', label: null, samples: [{ at: 1, g: 2.1, kmh: 30, lat: 17.4 }], phone_model: 'X', startedAt: '2026-11-02T10:00:00.000Z' },
    { id: 'a2', kind: 'normal_sample', outcome: 'pending', label: 'nothing', samples: [], phone_model: 'X', startedAt: '2026-11-02T10:10:00.000Z' },
    { id: 'a3', kind: 'bogus', samples: [] },
  ];
  const r = await uploadRideClips({ db, userId: 'u1', clips });
  eq('upload: two valid clips inserted, bogus kind skipped', inserted.length, 2);
  eq('upload: duplicate counts as uploaded', r.uploaded, 2);
  eq('upload: table name', inserted[0].t, 'ride_sensor_clips');
  eq('upload: owner set', inserted[0].row.owner, 'u1');
  eq('upload: no coordinates in samples', JSON.stringify(inserted[0].row.samples).includes('lat'), false);
  const none = await uploadRideClips({ db, userId: null, clips });
  eq('upload: signed out uploads nothing', none.uploaded, 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
