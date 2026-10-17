// tests/blackbox.test.mjs
// Unit tests for QuietKeep Black Box v1 (.qkedr) - Task Card DRV-01
// Tests:
// 1. Buffer window maths (45 s before / 15 s after)
// 2. Each trigger threshold (3.5 g impact, 200 ms accel integration >= 15 km/h, 1 Hz GPS speed drop >= 15 km/h)
// 3. Test-mode tilt trigger (>= 60 deg from vertical, 0 km/h, 3 s hold)
// 4. Hash and RSA-SHA256 signature verification (tampered byte fails)
// 5. JS wrapper API surface and non-native fallback

import crypto from 'node:crypto';
import {
  CONSTANTS,
  computePacketWindow,
  isImpact,
  isSpeedDropGps,
  isSpeedDropAccel,
  maxSpeedDropAccel,
  tiltFromVerticalDeg,
  isTiltPastThreshold,
  start,
  stop,
  saveLast60s,
  list,
  verify,
  isBlackboxAvailable,
} from '../src/lib/blackbox.js';

let pass = 0, fail = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  (${detail})`}`);
  ok ? pass++ : fail++;
}

console.log('── Black Box v1 (.qkedr) Unit Tests ──');

// ── 1. Buffer Window Maths (45 s before / 15 s after) ─────────────────────────
{
  const triggerTime = 100_000; // ms
  const bufferStart = 20_000;  // ms (80s of history available)

  const w1 = computePacketWindow(triggerTime, bufferStart);
  check(
    'packet window starts 45 s before trigger when buffer has >= 45 s',
    w1.packetStart === triggerTime - 45_000 && w1.preMs === 45_000
  );
  check(
    'packet window ends 15 s after trigger',
    w1.packetEnd === triggerTime + 15_000 && w1.postMs === 15_000
  );
  check(
    'total duration of full packet is exactly 60 s (60,000 ms)',
    w1.packetEnd - w1.packetStart === 60_000
  );

  // Buffer started recently (e.g. only 20 s before trigger)
  const recentBufferStart = 80_000; // trigger at 100_000 -> only 20s available
  const w2 = computePacketWindow(triggerTime, recentBufferStart);
  check(
    'packet window clips to buffer start when buffer < 45 s',
    w2.packetStart === recentBufferStart && w2.preMs === 20_000 && w2.postMs === 15_000
  );

  // Sample counts
  const imuExpectedSamples = (CONSTANTS.TOTAL_DURATION_MS * CONSTANTS.IMU_RATE_HZ) / 1000;
  check('IMU sample count for 60 s at 100 Hz is 6000 samples', imuExpectedSamples === 6000);

  const gpsExpectedSamples = (CONSTANTS.TOTAL_DURATION_MS * CONSTANTS.GPS_RATE_HZ) / 1000;
  check('GPS sample count for 60 s at 1 Hz is 60 samples', gpsExpectedSamples === 60);

  const preImuSamples = (CONSTANTS.PRE_TRIGGER_MS * CONSTANTS.IMU_RATE_HZ) / 1000;
  const postImuSamples = (CONSTANTS.POST_TRIGGER_MS * CONSTANTS.IMU_RATE_HZ) / 1000;
  check('pre-trigger IMU samples = 4500, post-trigger = 1500', preImuSamples === 4500 && postImuSamples === 1500);
}

// ── 2. Trigger Thresholds ─────────────────────────────────────────────────────

// 2a. Resultant Acceleration >= 3.5 g
{
  const G = 9.80665;
  check('3.5 g resultant triggers impact_g', isImpact(3.5 * G, 0, 0));
  check('4.2 g resultant triggers impact_g', isImpact(0, 4.2 * G, 0));
  check('3.49 g resultant does NOT trigger impact_g', !isImpact(3.49 * G, 0, 0));
  check('1.0 g gravity-level resultant does NOT trigger impact_g', !isImpact(0, 0, 1.0 * G));

  // Multi-axis vector combination: sqrt(2^2 + 2^2 + 2.5^2) = sqrt(4 + 4 + 6.25) = sqrt(14.25) ≈ 3.77 g >= 3.5 g
  check('combined 3-axis resultant >= 3.5 g triggers', isImpact(2.0 * G, 2.0 * G, 2.5 * G));

  // Sub-threshold vector: sqrt(1.5^2 + 1.5^2 + 1.5^2) = sqrt(6.75) ≈ 2.59 g < 3.5 g
  check('combined 3-axis resultant < 3.5 g does NOT trigger', !isImpact(1.5 * G, 1.5 * G, 1.5 * G));
}

// 2b. Accelerometer speed drop >= 15 km/h in 200 ms sliding window
{
  // 15 km/h = 4.1667 m/s. Over 200 ms, required average deceleration is 4.1667 / 0.2 = ~20.83 m/s² (~2.12 g).
  // Simulate 20 samples at 100 Hz (10 ms interval = 200 ms total)
  const samples200ms = [];
  const baseTimeUs = 1_000_000;

  // Case 1: Sharp deceleration of 25 m/s² over 200 ms -> Δv = 25 * 0.2 = 5.0 m/s (18 km/h >= 15 km/h)
  for (let i = 0; i < 21; i++) {
    samples200ms.push(baseTimeUs + i * 10_000, 25.0, 0.0, 0.0);
  }
  const drop1 = maxSpeedDropAccel(samples200ms, 21);
  check('accel integration over 200 ms detects ~5.0 m/s drop', Math.abs(drop1 - 5.0) < 0.05);
  check('speed drop >= 15 km/h within 200 ms triggers speed_drop_accel', isSpeedDropAccel(samples200ms, 21));

  // Case 2: Mild braking of 10 m/s² over 200 ms -> Δv = 10 * 0.2 = 2.0 m/s (7.2 km/h < 15 km/h)
  const mildBraking = [];
  for (let i = 0; i < 21; i++) {
    mildBraking.push(baseTimeUs + i * 10_000, 10.0, 0.0, 0.0);
  }
  const drop2 = maxSpeedDropAccel(mildBraking, 21);
  check('mild braking (2.0 m/s drop) does NOT trigger speed_drop_accel', !isSpeedDropAccel(mildBraking, 21));

  // Case 3: Slow deceleration over 1000 ms (1 second) where each 200 ms window only has 1.0 m/s drop
  const slowDecel = [];
  for (let i = 0; i < 101; i++) {
    slowDecel.push(baseTimeUs + i * 10_000, 5.0, 0.0, 0.0);
  }
  check('5 m/s² deceleration across 1 s does NOT trigger in any 200 ms window', !isSpeedDropAccel(slowDecel, 101));
}

// 2c. GPS Speed Drop >= 15 km/h between consecutive 1 Hz fixes
{
  check('GPS speed drop from 60 km/h to 40 km/h (20 km/h drop) triggers', isSpeedDropGps(60.0, 40.0));
  check('GPS speed drop exactly 15 km/h triggers', isSpeedDropGps(50.0, 35.0));
  check('GPS speed drop from 60 km/h to 46 km/h (14 km/h drop) does NOT trigger', !isSpeedDropGps(60.0, 46.0));
  check('GPS speed increase (acceleration) does NOT trigger', !isSpeedDropGps(30.0, 50.0));
  check('GPS steady speed does NOT trigger', !isSpeedDropGps(40.0, 40.0));
}

// ── 3. Test-Mode Tilt Trigger ─────────────────────────────────────────────────
{
  const G = 9.80665;

  // Phone vertical (upright): gravity is along one axis (e.g. Y or Z = 9.81 m/s², X = 0)
  const angleUpright = tiltFromVerticalDeg(0, G, 0);
  check('upright phone has 0 degree tilt from vertical', Math.abs(angleUpright) < 0.1);
  check('upright phone does NOT trigger test tilt', !isTiltPastThreshold(0, G, 0));

  // Phone tilted 45 degrees: equal components on two axes
  // cos(theta) = 1/sqrt(2) => theta = 45 deg
  const angle45 = tiltFromVerticalDeg(0, G * Math.cos(Math.PI / 4), G * Math.sin(Math.PI / 4));
  check('45 degree tilt is calculated accurately', Math.abs(angle45 - 45.0) < 0.5);
  check('45 degree tilt (< 60 deg threshold) does NOT trigger test tilt', !isTiltPastThreshold(0, G * Math.cos(Math.PI / 4), G * Math.sin(Math.PI / 4)));

  // Phone tilted 65 degrees:
  // cos(theta) = cos(65 deg)
  const cos65 = Math.cos(65 * Math.PI / 180);
  const sin65 = Math.sin(65 * Math.PI / 180);
  const angle65 = tiltFromVerticalDeg(0, G * cos65, G * sin65);
  check('65 degree tilt is >= 60 degrees', angle65 >= 60.0);
  check('65 degree tilt triggers test tilt flag', isTiltPastThreshold(0, G * cos65, G * sin65));

  // Flat phone (90 degrees):
  check('flat phone on desk (90 deg from upright) triggers tilt flag', isTiltPastThreshold(G, 0, 0));

  // Test mode requirement checks: 0 km/h speed gating and 3 s hold duration
  const testModeSpeedGated = (speedKmh, isTilted, holdMs) => {
    return isTilted && speedKmh <= 2.0 && holdMs >= CONSTANTS.TEST_TILT_HOLD_MS;
  };

  check('desk tilt test: tilted 65 deg at 0 km/h held 3000 ms triggers', testModeSpeedGated(0.0, true, 3000));
  check('desk tilt test: tilted 65 deg at 0 km/h held only 2000 ms does NOT trigger', !testModeSpeedGated(0.0, true, 2000));
  check('desk tilt test: tilted 65 deg while driving at 30 km/h does NOT trigger', !testModeSpeedGated(30.0, true, 3500));
}

// ── 4. Hash and RSA-SHA256 Signature Verification ─────────────────────────────
{
  // Create a realistic mock .qkedr packet:
  // JSON header line + binary sample block
  const header = {
    version: 1,
    device_id: 'test_device_android_id_123',
    vehicle_id: null,
    trigger: 'impact_g',
    started_at: '2026-10-17T10:00:00.000Z',
    ended_at: '2026-10-17T10:01:00.000Z',
    trigger_at: '2026-10-17T10:00:45.000Z',
    pre_trigger_ms: 45000,
    post_trigger_ms: 15000,
    sample_rate_hz: 100,
    gps_rate_hz: 1,
    audio_opt_in: false,
    audio_codec: null,
    imu_samples: 10,
    gps_samples: 2,
    audio_bytes: 0,
  };
  const headerBytes = Buffer.from(JSON.stringify(header) + '\n', 'utf8');

  // Dummy IMU samples (10 samples * 28 bytes = 280 bytes)
  const imuBytes = Buffer.alloc(280);
  for (let i = 0; i < 280; i++) imuBytes[i] = (i * 7) & 0xff;

  // Dummy GPS samples (2 samples * 40 bytes = 80 bytes)
  const gpsBytes = Buffer.alloc(80);
  for (let i = 0; i < 80; i++) gpsBytes[i] = (i * 13) & 0xff;

  const packet = Buffer.concat([headerBytes, imuBytes, gpsBytes]);

  // Compute SHA-256
  const hash = crypto.createHash('sha256').update(packet).digest('hex');
  check('SHA-256 hash computed has 64 hex characters', hash.length === 64);

  // Generate test RSA-2048 keypair
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
  });

  // Sign packet with SHA256withRSA
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(packet);
  const signature = signer.sign(privateKey);

  // Verify valid packet
  const verifier = crypto.createVerify('RSA-SHA256');
  verifier.update(packet);
  const isValid = verifier.verify(publicKey, signature);
  check('original packet signature verifies successfully', isValid === true);

  // TAMPER TEST 1: Flip one byte in the header
  const tamperedHeaderPacket = Buffer.from(packet);
  tamperedHeaderPacket[10] ^= 0x01; // flip 1 bit in JSON header
  const vTamperHeader = crypto.createVerify('RSA-SHA256');
  vTamperHeader.update(tamperedHeaderPacket);
  const isHeaderTamperValid = vTamperHeader.verify(publicKey, signature);
  check('tampered byte in header FAILS signature verification', isHeaderTamperValid === false);

  // TAMPER TEST 2: Flip one byte in the IMU binary samples
  const tamperedImuPacket = Buffer.from(packet);
  tamperedImuPacket[headerBytes.length + 50] ^= 0x01; // flip 1 bit in IMU block
  const vTamperImu = crypto.createVerify('RSA-SHA256');
  vTamperImu.update(tamperedImuPacket);
  const isImuTamperValid = vTamperImu.verify(publicKey, signature);
  check('tampered byte in IMU sample block FAILS signature verification', isImuTamperValid === false);

  // TAMPER TEST 3: Flip one byte in the GPS binary samples
  const tamperedGpsPacket = Buffer.from(packet);
  tamperedGpsPacket[packet.length - 5] ^= 0x01; // flip 1 bit in GPS block
  const vTamperGps = crypto.createVerify('RSA-SHA256');
  vTamperGps.update(tamperedGpsPacket);
  const isGpsTamperValid = vTamperGps.verify(publicKey, signature);
  check('tampered byte in GPS block FAILS signature verification', isGpsTamperValid === false);

  // TAMPER TEST 4: Truncate packet by 1 byte
  const truncatedPacket = packet.subarray(0, packet.length - 1);
  const vTruncated = crypto.createVerify('RSA-SHA256');
  vTruncated.update(truncatedPacket);
  const isTruncatedValid = vTruncated.verify(publicKey, signature);
  check('truncated packet FAILS signature verification', isTruncatedValid === false);
}

// ── 5. JS Wrapper API Surface & Non-Native Fallbacks ──────────────────────────
{
  check('isBlackboxAvailable() returns false in node (no window.Capacitor)', isBlackboxAvailable() === false);

  const startRes = await start({ audioOptIn: false });
  check('start() returns safe fallback when not native', startRes.started === false && startRes.reason === 'not_native');

  const stopRes = await stop();
  check('stop() returns safe fallback when not native', stopRes.stopped === false && stopRes.reason === 'not_native');

  const freezeRes = await saveLast60s('voice_save');
  check('saveLast60s() returns null when not native', freezeRes === null);

  const listRes = await list();
  check('list() returns empty records array when not native', Array.isArray(listRes.records) && listRes.records.length === 0);

  const verifyRes = await verify('fake-id');
  check('verify() returns valid:false when not native', verifyRes.valid === false && verifyRes.reason === 'not_native');

  // Test with mock Capacitor plugin
  const calls = [];
  globalThis.window = {
    Capacitor: {
      Plugins: {
        QkBlackbox: {
          start: async (opts) => { calls.push(['start', opts]); return { started: true, ...opts }; },
          stop: async () => { calls.push(['stop']); return { stopped: true }; },
          saveLast60s: async (opts) => { calls.push(['saveLast60s', opts]); return { id: 'evt_1', ...opts }; },
          list: async () => ({ records: [{ id: 'evt_1', trigger: 'impact_g', started_at: '2026-10-17T10:00:00Z' }] }),
          verify: async (opts) => ({ valid: opts.id === 'evt_1', hash: 'abc', id: opts.id }),
        },
      },
    },
  };

  check('isBlackboxAvailable() returns true when Capacitor plugin registered', isBlackboxAvailable() === true);

  const mockStart = await start({ audioOptIn: true, testMode: true });
  check('start() forwards options to plugin', mockStart.started === true && mockStart.audioOptIn === true && mockStart.testMode === true);

  const mockFreeze = await saveLast60s('voice_save');
  check('saveLast60s() forwards trigger to plugin', mockFreeze.id === 'evt_1' && mockFreeze.trigger === 'voice_save');

  const mockList = await list();
  check('list() retrieves records from plugin', mockList.records.length === 1 && mockList.records[0].trigger === 'impact_g');

  const mockVerify = await verify('evt_1');
  check('verify() returns valid true for existing record', mockVerify.valid === true);

  delete globalThis.window;
}

// ── 6. Review fixes (17 Oct 2026) ─────────────────────────────────────────────
{
  // 200 ms window boundary: 20 m/s² for samples at 0..200 ms (10 ms apart)
  // integrates to 4.0 m/s (< 4.17, no trigger). The first version also
  // integrated the 210 ms sample and reached 4.2 m/s (a false trigger).
  const s = [];
  for (let i = 0; i <= 21; i++) s.push(i * 10_000, 20, 0, 0);
  const drop = maxSpeedDropAccel(s, 22);
  check('accel integration stops at the 200 ms window edge (no extra sample)',
    Math.abs(drop - 4.0) < 1e-9, `got ${drop}`);
  check('20 m/s² for exactly 200 ms does not trigger (4.0 < 4.17 m/s)', !isSpeedDropAccel(s, 22));
}

{
  const { syncPendingRecords, storagePathFor, base64ToBytes } = await import('../src/lib/blackbox-sync.js');

  check('storage path is <user id>/<record id>.qkedr (matches the bucket policy)',
    storagePathFor('u1', 'event_1700000000000') === 'u1/event_1700000000000.qkedr');
  check('base64ToBytes decodes', base64ToBytes('AAEC').join(',') === '0,1,2');

  const mem = new Map();
  const storage = { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  const uploads = [], rows = [];
  let failUploadOnce = true;
  const fakeSupabase = {
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    storage: { from: (b) => ({ upload: async (path) => {
      if (failUploadOnce) { failUploadOnce = false; return { error: { message: 'network down' } }; }
      uploads.push(b + ':' + path); return { error: null };
    } }) },
    from: (t) => ({ insert: async (row) => { rows.push({ t, ...row }); return { error: null }; } }),
  };
  const fakePlugin = {
    list: async () => ({ records: [{ id: 'event_1700000000000' }] }),
    readRecord: async ({ id }) => ({ id, data: 'AAEC', hash: 'h', signature: 'sig', public_key: 'pub',
      trigger: 'impact_g', started_at: '2026-10-17T00:00:00Z', ended_at: '2026-10-17T00:01:00Z' }),
  };

  const r1 = await syncPendingRecords(fakeSupabase, { plugin: fakePlugin, storage });
  check('a failed upload is reported, not marked synced', r1.failed.length === 1 && r1.uploaded.length === 0);
  const r2 = await syncPendingRecords(fakeSupabase, { plugin: fakePlugin, storage });
  check('retry uploads the record and inserts one row',
    r2.uploaded.length === 1 && uploads[0] === 'blackbox-records:u1/event_1700000000000.qkedr' && rows.length === 1);
  check('row carries owner, storage_path, public_key and sealed',
    rows[0].t === 'blackbox_events' && rows[0].owner === 'u1' && rows[0].public_key === 'pub' && rows[0].sealed === true);
  const r3 = await syncPendingRecords(fakeSupabase, { plugin: fakePlugin, storage });
  check('an already-synced record is not uploaded twice', r3.uploaded.length === 0 && rows.length === 1);

  const r4 = await syncPendingRecords({ auth: { getUser: async () => ({ data: { user: null } }) } }, { plugin: fakePlugin, storage: null });
  check('signed out: nothing is uploaded', r4.skipped === 'signed_out');
  const r5 = await syncPendingRecords(fakeSupabase, { plugin: null, storage });
  check('not native: sync is skipped', r5.skipped === 'not_native');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
