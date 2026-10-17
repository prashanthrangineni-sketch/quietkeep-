// tests/blackbox-feed.test.mjs
// Unit tests for QuietKeep Black Box Live OBD Feed (Task Card DRV-08)
// Tests:
// 1. Feed pushes ~2 samples per second
// 2. Never overlaps reads under slow replies (skips tick while previous read is in-flight)
// 3. Survives simulator failure modes without terminating
// 4. Backs off after 5 consecutive failures and recovers on success
// 5. Stops cleanly (clears timer, stops polling)
// 6. compareSpeeds helper (pairs GPS with nearest OBD <= 500 ms, computes max/mean diff)

import { ObdSimulator } from '../src/lib/obd/simulator.js';
import { ObdReader } from '../src/lib/obd/reader.js';
import { startObdFeed, compareSpeeds } from '../src/lib/obd/blackbox-feed.js';

let pass = 0, fail = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  (${detail})`}`);
  ok ? pass++ : fail++;
}

console.log('── Black Box Live OBD Feed Unit Tests ──\n');

// ── 1. Feed pushes ~2 samples per second ─────────────────────────────────────
console.log('1. Feed Rate (~2 samples / sec)');
await (async () => {
  const sim = new ObdSimulator({ responseDelayMs: 5 });
  const reader = new ObdReader(sim);
  await reader.connect();

  const pushed = [];
  const stop = startObdFeed(reader, {
    intervalMs: 500,
    source: 'simulated',
    push: async (sample) => {
      pushed.push(sample);
    },
  });

  // Wait 1150 ms: at t=0 (tick 1), t=500 (tick 2), t=1000 (tick 3) -> 3 samples
  await new Promise(r => setTimeout(r, 1150));
  stop();
  reader.destroy();

  check('feed pushes ~2 samples per second (2 to 3 samples in 1.15 s)', pushed.length >= 2 && pushed.length <= 4, `got ${pushed.length}`);
  check('pushed samples have correct source="simulated"', pushed.length > 0 && pushed[0].source === 'simulated');
  check('pushed samples carry finite numbers for speed, rpm, voltage',
    Number.isFinite(pushed[0].speedKmh) &&
    Number.isFinite(pushed[0].rpm) &&
    Number.isFinite(pushed[0].voltage)
  );
  check('pushed samples carry epoch-ms number timestamps (no ISO parsing on old Android)', typeof pushed[0].at === 'number' && Number.isFinite(pushed[0].at) && pushed[0].at > 0);
})();

// ── 2. Never overlaps reads under slow replies ───────────────────────────────
console.log('\n2. Non-overlapping Read Serialization');
await (async () => {
  const sim = new ObdSimulator({ responseDelayMs: 5 });
  const reader = new ObdReader(sim);
  await reader.connect();

  let activeReads = 0;
  let maxConcurrent = 0;

  // Wrap readSnapshot to artificially introduce a 50 ms delay
  const origSnapshot = reader.readSnapshot.bind(reader);
  reader.readSnapshot = async () => {
    activeReads++;
    maxConcurrent = Math.max(maxConcurrent, activeReads);
    await new Promise(r => setTimeout(r, 50));
    const res = await origSnapshot();
    activeReads--;
    return res;
  };

  const pushed = [];
  // Fast interval (40 ms) with 120 ms read time -> ticks during in-flight must be skipped
  const stop = startObdFeed(reader, {
    intervalMs: 40,
    push: async (s) => { pushed.push(s); },
  });

  await new Promise(r => setTimeout(r, 350));
  stop();
  reader.destroy();

  check('never overlaps reads under slow replies (maxConcurrent === 1)', maxConcurrent === 1, `maxConcurrent: ${maxConcurrent}`);
  check('pushed multiple samples sequentially without concurrency', pushed.length >= 2);
})();

// ── 3. Survives simulator failure modes ───────────────────────────────────────
console.log('\n3. Simulator Failure Modes Resilience');
await (async () => {
  const sim = new ObdSimulator({ responseDelayMs: 5 });
  const reader = new ObdReader(sim);
  await reader.connect();

  const pushed = [];
  const stop = startObdFeed(reader, {
    intervalMs: 80,
    push: async (s) => { pushed.push(s); },
  });

  // Let 1 sample push normally
  await new Promise(r => setTimeout(r, 100));
  const countBefore = pushed.length;
  check('feed pushes initial samples before failure mode', countBefore >= 1);

  // Switch simulator into failure modes
  sim.setFailureMode('no_data');
  await new Promise(r => setTimeout(r, 120));

  sim.setFailureMode('garbage_bytes');
  await new Promise(r => setTimeout(r, 120));

  // Recover simulator to normal
  sim.setFailureMode(null);
  await new Promise(r => setTimeout(r, 200));

  stop();
  reader.destroy();

  check('feed survives failure modes and continues operating', pushed.length > countBefore);
})();

// ── 4. Backs off after 5 consecutive failures and recovers ───────────────────
console.log('\n4. Backoff After 5 Consecutive Failures & Recovery');
await (async () => {
  let virtualTime = 1000;
  const scheduledTimeouts = [];
  let timeoutCounter = 0;

  // Mock injectable timers
  const setTimer = (fn, ms) => {
    const id = ++timeoutCounter;
    scheduledTimeouts.push({ id, fn, delayMs: ms, scheduledAt: virtualTime, fireAt: virtualTime + ms });
    return id;
  };

  const clearTimer = (id) => {
    const idx = scheduledTimeouts.findIndex(t => t.id === id);
    if (idx >= 0) scheduledTimeouts.splice(idx, 1);
  };

  let failReads = 0;
  let succeedReads = 0;
  let shouldFail = true;

  const mockReader = {
    readSnapshot: async () => {
      if (shouldFail) {
        failReads++;
        throw new Error(`Simulated read failure #${failReads}`);
      }
      succeedReads++;
      return { speedKmh: 45, rpm: 1500, at: '2026-10-17T12:00:00Z' };
    },
  };

  const pushed = [];
  const stop = startObdFeed(mockReader, {
    intervalMs: 500,
    backoffMs: 2000,
    maxConsecutiveFailures: 5,
    clock: () => virtualTime,
    setTimer,
    clearTimer,
    push: async (s) => { pushed.push(s); },
  });

  // Helper to advance time and fire pending timers
  async function runNextTimer() {
    scheduledTimeouts.sort((a, b) => a.fireAt - b.fireAt);
    const next = scheduledTimeouts.shift();
    if (!next) return;
    virtualTime = next.fireAt;
    await next.fn();
    return next;
  }

  // Initial tick was scheduled at delay 0
  const t0 = await runNextTimer();
  check('tick 0 fired immediately', t0 && t0.delayMs === 0);

  // Fires failures 2, 3, 4, 5. Each should be scheduled with intervalMs (500)
  for (let i = 2; i <= 5; i++) {
    const t = await runNextTimer();
    check(`failure #${i} scheduled with normal intervalMs (500)`, t && t.delayMs === 500);
  }

  check('reached 5 consecutive failures', failReads === 5);

  // After 5 consecutive failures, the next tick MUST be scheduled with backoffMs (2000)
  const backoffTimer = await runNextTimer();
  check('after 5 consecutive failures, next tick backs off to 2000 ms', backoffTimer && backoffTimer.delayMs === 2000, `got ${backoffTimer?.delayMs}`);

  // Now recover: allow next read to succeed
  shouldFail = false;
  const recoveredTimer = await runNextTimer();
  check('recovered read succeeded', succeedReads === 1);
  check('sample was pushed upon recovery', pushed.length === 1 && pushed[0].speedKmh === 45);

  // After success, interval returns to normal 500 ms
  const nextNormalTimer = scheduledTimeouts[0];
  check('after recovery, interval resets back to 500 ms', nextNormalTimer && nextNormalTimer.delayMs === 500, `got ${nextNormalTimer?.delayMs}`);

  stop();
})();

// ── 5. Stops cleanly ─────────────────────────────────────────────────────────
console.log('\n5. Clean Stop');
await (async () => {
  let timerCleared = false;
  let timerId = 42;

  const setTimer = (fn, ms) => timerId;
  const clearTimer = (id) => {
    if (id === timerId) timerCleared = true;
  };

  let readsAfterStop = 0;
  let stopped = false;
  const mockReader = {
    readSnapshot: async () => {
      if (stopped) readsAfterStop++;
      return { speedKmh: 20 };
    },
  };

  const stop = startObdFeed(mockReader, {
    intervalMs: 100,
    setTimer,
    clearTimer,
    push: async () => {},
  });

  stop();
  stopped = true;

  check('stop() clears active timer', timerCleared === true);
  check('stop() prevents further reads', readsAfterStop === 0);
})();

// ── 6. compareSpeeds speed agreement helper ──────────────────────────────────
console.log('\n6. compareSpeeds Speed Agreement Helper');
{
  // Scenario A: Exact speed match (< 1 km/h diff) within 500 ms window
  const obdSamples = [
    { at: '2026-10-17T10:00:00.100Z', speedKmh: 48.2 },
    { at: '2026-10-17T10:00:00.600Z', speedKmh: 48.7 },
    { at: '2026-10-17T10:00:01.100Z', speedKmh: 49.1 },
    { at: '2026-10-17T10:00:01.600Z', speedKmh: 49.8 },
    { at: '2026-10-17T10:00:02.100Z', speedKmh: 50.2 },
  ];

  const gpsSamples = [
    { at: '2026-10-17T10:00:00.000Z', speedKmh: 48.0 },
    { at: '2026-10-17T10:00:01.000Z', speedKmh: 49.0 },
    { at: '2026-10-17T10:00:02.000Z', speedKmh: 50.0 },
  ];

  const resA = compareSpeeds(obdSamples, gpsSamples);
  check('pairs all 3 GPS fixes with nearest OBD sample', resA.pairs.length === 3);
  check('pairs supports numeric comparison (res.pairs >= 3)', resA.pairs >= 3);
  check('max speed diff is <= 1.0 km/h', resA.maxDiffKmh <= 1.0, `maxDiffKmh: ${resA.maxDiffKmh}`);
  check('mean speed diff is <= 0.5 km/h', resA.meanDiffKmh <= 0.5, `meanDiffKmh: ${resA.meanDiffKmh}`);

  // Scenario B: Phase-2 Ride Proof simulation ("car speed matches GPS within 1 km/h")
  const baseEpochMs = 1700000000000;
  const proofObd = [];
  const proofGps = [];

  for (let i = 0; i < 20; i++) {
    const obdTime = baseEpochMs + i * 500;
    const trueSpeed = 40.0 + Math.sin(i / 3) * 10;
    proofObd.push({
      timestampUs: obdTime * 1000,
      speedKmh: trueSpeed + 0.3,
    });
    // GPS at 1 Hz (every 1000 ms)
    if (i % 2 === 0) {
      proofGps.push({
        timestampUs: obdTime * 1000,
        speed: (trueSpeed) / 3.6, // m/s format
      });
    }
  }

  const proofRes = compareSpeeds(proofObd, proofGps);
  check('phase-2 proof: pairs >= 10 GPS fixes', proofRes.pairs.length >= 10);
  check('phase-2 proof: maxDiffKmh < 1.0 km/h (actual ~0.3)', proofRes.maxDiffKmh <= 1.0, `got ${proofRes.maxDiffKmh}`);
  check('phase-2 proof: meanDiffKmh < 0.5 km/h', proofRes.meanDiffKmh < 0.5, `got ${proofRes.meanDiffKmh}`);

  // Scenario C: No match when time delta > 500 ms
  const farObd = [{ at: '2026-10-17T10:00:00.000Z', speedKmh: 50 }];
  const farGps = [{ at: '2026-10-17T10:00:02.000Z', speedKmh: 50 }]; // 2000 ms away
  const farRes = compareSpeeds(farObd, farGps);
  check('no pair created when samples are > 500 ms apart', farRes.pairs.length === 0);
  check('empty match returns 0 maxDiff and 0 meanDiff', farRes.maxDiffKmh === 0 && farRes.meanDiffKmh === 0);

  // Scenario D: Nearest sample selection when multiple OBD samples are within 500 ms
  const multiObd = [
    { at: '2026-10-17T10:00:00.600Z', speedKmh: 30.0 }, // 400 ms before
    { at: '2026-10-17T10:00:00.900Z', speedKmh: 42.0 }, // 100 ms before (closer!)
    { at: '2026-10-17T10:00:01.300Z', speedKmh: 60.0 }, // 300 ms after
  ];
  const singleGps = [{ at: '2026-10-17T10:00:01.000Z', speedKmh: 42.0 }];
  const multiRes = compareSpeeds(multiObd, singleGps);
  check('selects nearest OBD sample (100 ms delta instead of 400 or 300 ms)',
    multiRes.pairs.length === 1 && multiRes.pairs[0].timeDeltaMs === 100 && multiRes.maxDiffKmh === 0.0
  );

  // Scenario E: NaN speeds are filtered out
  const nanObd = [{ at: '2026-10-17T10:00:00.000Z', speedKmh: NaN }];
  const validGps = [{ at: '2026-10-17T10:00:00.100Z', speedKmh: 40 }];
  const nanRes = compareSpeeds(nanObd, validGps);
  check('NaN speed is ignored and not paired', nanRes.pairs.length === 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
