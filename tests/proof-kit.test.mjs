// tests/proof-kit.test.mjs
// Unit tests for Drive Phase-2 Proof Kit (Task Card AG-04)

import {
  CHECKLIST_STEPS,
  getStep,
  base64ToBytes,
  evalDeskTest,
  evalParkedCarSnapshot,
  evalFirmBrakes,
  parsePacketHeader,
  evalSave60Record,
  decodeGpsRecord,
  parseBlackboxPacket,
  evalSpeedCheck,
  formatProofSummary,
  saveProofResult,
} from '../src/lib/proof-kit.js';
import { encodeObdRecord } from '../src/lib/blackbox.js';

let pass = 0;
let fail = 0;

function check(name, condition) {
  const ok = !!condition;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) {
    fail++;
  } else {
    pass++;
  }
}

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

console.log('── 1. Checklist Structure ──');
check('CHECKLIST_STEPS is a non-empty array', Array.isArray(CHECKLIST_STEPS) && CHECKLIST_STEPS.length >= 8);
eq('getStep finds step 1 by id', getStep('reader_genuine')?.stepNumber, 1);
eq('getStep finds step 2 by id', getStep('desk_test_tilt')?.stepNumber, 2);
eq('getStep finds step 3 by id', getStep('parked_car_reader')?.stepNumber, 3);
eq('getStep finds step 4 by id', getStep('voice_car_status')?.stepNumber, 4);
eq('getStep finds step 5a by id', getStep('proof_ride_brakes')?.stepNumber, 5);
eq('getStep finds step 5b by id', getStep('proof_ride_fall_checkin')?.stepNumber, 5);
eq('getStep finds step 5c by id', getStep('proof_ride_save60')?.stepNumber, 5);
eq('getStep finds step 6 by id', getStep('speed_check')?.stepNumber, 6);
eq('getStep finds step 7 by id', getStep('speed_rule')?.stepNumber, 7);
eq('getStep finds step 8 by id', getStep('indicator_reminder')?.stepNumber, 8);
eq('getStep finds step by number string', getStep('6')?.id, 'speed_check');

console.log('\n── 2. Desk Test Evaluator (evalDeskTest) ──');
// Missing data must fail
check('evalDeskTest(null) fails on missing data', evalDeskTest(null).pass === false);
check('evalDeskTest({}) fails on missing data', evalDeskTest({}).pass === false);
check('evalDeskTest({ records: [] }) fails on missing data', evalDeskTest({ records: [] }).pass === false);
check('evalDeskTest missing reason is missing_data', evalDeskTest({ records: [] }).reason === 'missing_data');

// No new records (all in baseline) must fail
const r1 = { id: 'evt_001', trigger: 'test_tilt', sealed: true };
check('evalDeskTest fails when candidate is in baselineIds',
  evalDeskTest({ records: [r1], baselineIds: ['evt_001'] }).pass === false
);
eq('evalDeskTest baseline reason is no_new_records',
  evalDeskTest({ records: [r1], baselineIds: ['evt_001'] }).reason, 'no_new_records'
);

// Unsealed candidate must fail
const rUnsealed = { id: 'evt_002', trigger: 'test_tilt', sealed: false };
check('evalDeskTest fails when new record is unsealed',
  evalDeskTest({ records: [rUnsealed] }).pass === false
);
eq('evalDeskTest unsealed reason is record_not_sealed',
  evalDeskTest({ records: [rUnsealed] }).reason, 'record_not_sealed'
);

// Sealed candidate passes
const rSealed = { id: 'evt_003', trigger: 'test_tilt', sealed: true, signature: 'sig123' };
const deskPass = evalDeskTest({ records: [r1, rSealed], baselineIds: ['evt_001'] });
check('evalDeskTest passes with sealed candidate', deskPass.pass === true);
eq('evalDeskTest evidence includes recordId', deskPass.evidence?.recordId, 'evt_003');

console.log('\n── 3. Parked Car Reader Snapshot (evalParkedCarSnapshot) ──');
// Missing data must fail
check('evalParkedCarSnapshot(null) fails', evalParkedCarSnapshot(null).pass === false);
check('evalParkedCarSnapshot({}) fails', evalParkedCarSnapshot({}).pass === false);
check('evalParkedCarSnapshot reason on null is missing_data', evalParkedCarSnapshot(null).reason === 'missing_data');

// Missing rpm or voltage
check('evalParkedCarSnapshot fails when rpm is missing',
  evalParkedCarSnapshot({ voltage: 12.6 }).pass === false
);
eq('evalParkedCarSnapshot missing rpm reason',
  evalParkedCarSnapshot({ voltage: 12.6 }).reason, 'missing_rpm'
);

check('evalParkedCarSnapshot fails when voltage is missing',
  evalParkedCarSnapshot({ rpm: 750 }).pass === false
);
eq('evalParkedCarSnapshot missing voltage reason',
  evalParkedCarSnapshot({ rpm: 750 }).reason, 'missing_voltage'
);

check('evalParkedCarSnapshot fails on non-finite values',
  evalParkedCarSnapshot({ rpm: NaN, voltage: 12.4 }).pass === false
);

// Both present passes
const snapPass = evalParkedCarSnapshot({ rpm: 780, voltage: 12.6, coolantC: 85, mil: false });
check('evalParkedCarSnapshot passes with valid rpm and voltage', snapPass.pass === true);
eq('evalParkedCarSnapshot evidence captures values', snapPass.evidence?.rpm, 780);
eq('evalParkedCarSnapshot evidence captures voltage', snapPass.evidence?.voltage, 12.6);

console.log('\n── 4. Proof Ride Firm Brakes (evalFirmBrakes) ──');
// Missing data must fail
check('evalFirmBrakes() fails on missing data', evalFirmBrakes().pass === false);
check('evalFirmBrakes(null) fails on missing data', evalFirmBrakes(null).pass === false);
check('evalFirmBrakes({ events: [] }) fails', evalFirmBrakes({ events: [] }).pass === false);

// Count parameter
check('evalFirmBrakes count 2 fails', evalFirmBrakes({ count: 2, minCount: 3 }).pass === false);
check('evalFirmBrakes count 3 passes', evalFirmBrakes({ count: 3, minCount: 3 }).pass === true);
check('evalFirmBrakes count 5 passes', evalFirmBrakes({ count: 5, minCount: 3 }).pass === true);

// Events list with timestamps
const now = 1729600000000;
const e1 = { id: 'b1', kind: 'hard_brake', created_at: now - 5 * 60 * 1000 };
const e2 = { id: 'b2', kind: 'hard_brake', created_at: now - 10 * 60 * 1000 };
const e3 = { id: 'b3', kind: 'hard_brake', created_at: now - 20 * 60 * 1000 };
const eOld = { id: 'bOld', kind: 'hard_brake', created_at: now - 45 * 60 * 1000 }; // > 30 min ago
const ePothole = { id: 'p1', kind: 'pothole', created_at: now - 15 * 60 * 1000 };

check('evalFirmBrakes with 3 recent hard brakes passes',
  evalFirmBrakes({ events: [e1, e2, e3], nowMs: now }).pass === true
);
check('evalFirmBrakes fails when only 2 are within 30 min',
  evalFirmBrakes({ events: [e1, e2, eOld], nowMs: now }).pass === false
);
check('evalFirmBrakes fails when one event is a pothole not a brake',
  evalFirmBrakes({ events: [e1, e2, ePothole], nowMs: now }).pass === false
);

console.log('\n── 5. Save Last 60 OBD Record (evalSave60Record) ──');
// Missing data must fail
check('evalSave60Record(null) fails', evalSave60Record(null).pass === false);
check('evalSave60Record({}) fails', evalSave60Record({}).pass === false);
check('evalSave60Record("") fails', evalSave60Record('').pass === false);

// Header with obd_samples = 0
const hZero = { trigger: 'voice_save', obd_samples: 0, gps_samples: 10, imu_samples: 50 };
check('evalSave60Record with 0 OBD samples fails', evalSave60Record(hZero).pass === false);
eq('evalSave60Record zero obd reason is no_obd_samples', evalSave60Record(hZero).reason, 'no_obd_samples');

// Header with obd_samples > 0
const hGood = { trigger: 'voice_save', obd_samples: 118, gps_samples: 58, imu_samples: 600, started_at: '2026-10-22T10:00:00Z' };
const save60Pass = evalSave60Record(hGood);
check('evalSave60Record with obd_samples > 0 passes', save60Pass.pass === true);
eq('evalSave60Record evidence has obdSamples count', save60Pass.evidence?.obdSamples, 118);

// Packet string simulation (JSON line + binary payload)
const packetHeaderStr = JSON.stringify(hGood) + '\n';
const packetBytes = Buffer.concat([Buffer.from(packetHeaderStr, 'utf8'), Buffer.alloc(32)]);
const packetB64 = packetBytes.toString('base64');

check('evalSave60Record parses base64 packet string',
  evalSave60Record(packetB64).pass === true
);
check('evalSave60Record parses record object with data field',
  evalSave60Record({ data: packetB64 }).pass === true
);

console.log('\n── 6. Binary GPS & Packet Parsing ──');
// Create a fake GPS sample (40 bytes)
const gpsBuf = Buffer.alloc(40);
const gpsView = new DataView(gpsBuf.buffer, gpsBuf.byteOffset, 40);
gpsView.setBigInt64(0, 1729600000000000n, true); // timestampUs
gpsView.setFloat64(8, 17.44, true);              // lat
gpsView.setFloat64(16, 78.38, true);             // lon
gpsView.setFloat32(24, 520.0, true);             // alt
gpsView.setFloat32(28, 10.0, true);              // speed: 10 m/s = 36 km/h
gpsView.setFloat32(32, 90.0, true);              // bearing
gpsView.setFloat32(36, 4.0, true);               // accuracy

const decodedGps = decodeGpsRecord(gpsBuf);
eq('decodeGpsRecord speed in km/h is 36', Math.round(decodedGps.speedKmh), 36);
eq('decodeGpsRecord timestampUs extracted', decodedGps.timestampUs, 1729600000000000);

// Assemble a packet with 1 GPS and 1 OBD sample
const testHeader = {
  version: 1,
  format_version: 2,
  trigger: 'voice_save',
  imu_samples: 0,
  gps_samples: 1,
  obd_samples: 1,
};
const encObd = encodeObdRecord({ timestampUs: 1729600000000000, speedKmh: 36.2, rpm: 1500 });
const testPacket = Buffer.concat([
  Buffer.from(JSON.stringify(testHeader) + '\n', 'utf8'),
  gpsBuf,
  Buffer.from(encObd),
]);

const parsed = parseBlackboxPacket(testPacket);
check('parseBlackboxPacket parses header', parsed && parsed.header.trigger === 'voice_save');
eq('parseBlackboxPacket extracts 1 GPS sample', parsed?.gpsSamples?.length, 1);
eq('parseBlackboxPacket extracts 1 OBD sample', parsed?.obdSamples?.length, 1);

console.log('\n── 7. Speed Check (evalSpeedCheck) ──');
// Missing data must fail
check('evalSpeedCheck() fails on missing data', evalSpeedCheck().pass === false);
check('evalSpeedCheck(null) fails on missing data', evalSpeedCheck(null).pass === false);
check('evalSpeedCheck({ obdSamples: [] }) fails', evalSpeedCheck({ obdSamples: [] }).pass === false);
check('evalSpeedCheck({ gpsSamples: [] }) fails', evalSpeedCheck({ gpsSamples: [] }).pass === false);

// Samples with no time overlap (timestamps > 500 ms apart)
const gMismatch = [{ timestampUs: 1000000, speed: 10 }]; // 1s
const oMismatch = [{ timestampUs: 5000000, speedKmh: 36 }]; // 5s
check('evalSpeedCheck fails when samples do not pair in time',
  evalSpeedCheck({ obdSamples: oMismatch, gpsSamples: gMismatch }).pass === false
);
eq('evalSpeedCheck mismatch reason is no_matching_pairs',
  evalSpeedCheck({ obdSamples: oMismatch, gpsSamples: gMismatch }).reason, 'no_matching_pairs'
);

// Samples with large speed difference (> 1 km/h)
const gDiff = [{ timestampUs: 1000000, speed: 10 }]; // 10 m/s = 36.0 km/h
const oDiff = [{ timestampUs: 1000100, speedKmh: 40.0 }]; // diff = 4.0 km/h
const failSpeed = evalSpeedCheck({ obdSamples: oDiff, gpsSamples: gDiff, maxDiffAllowed: 1 });
check('evalSpeedCheck fails when speed difference exceeds threshold', failSpeed.pass === false);
eq('evalSpeedCheck diff exceeded reason', failSpeed.reason, 'speed_diff_exceeded');

// Samples matching closely (diff ≤ 1 km/h)
const gClose = [{ timestampUs: 2000000, speed: 10.0 }]; // 36.0 km/h
const oClose = [{ timestampUs: 2000100, speedKmh: 36.4 }]; // 36.4 km/h, diff = 0.4 km/h
const passSpeed = evalSpeedCheck({ obdSamples: oClose, gpsSamples: gClose, maxDiffAllowed: 1 });
check('evalSpeedCheck passes when maxDiffKmh ≤ 1', passSpeed.pass === true);
eq('evalSpeedCheck captures maxDiffKmh in evidence', passSpeed.evidence?.maxDiffKmh, 0.4);

// Running speed check from parsed packet
const fullPacketCheck = evalSpeedCheck({ record: testPacket, maxDiffAllowed: 1 });
check('evalSpeedCheck on full packet passes', fullPacketCheck.pass === true);

console.log('\n── 8. formatProofSummary & saveProofResult ──');
const summary = formatProofSummary(CHECKLIST_STEPS, {
  reader_genuine: { result: 'pass', note: 'v2.3 genuine firmware' },
  desk_test_tilt: { result: 'pass', evidence: { recordId: 'event_123' } },
});
check('formatProofSummary contains header', summary.includes('=== QuietKeep Drive Phase-2 Proof Run Summary ==='));
check('formatProofSummary contains step 1 note', summary.includes('v2.3 genuine firmware'));
check('formatProofSummary contains Total Passed count', summary.includes('Total Passed: 2 / 10'));

// Test saveProofResult failure without supabase
const saveNoClient = await saveProofResult(null, { step: 'test', result: 'pass' });
check('saveProofResult without supabase client fails safely', saveNoClient.saved === false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
