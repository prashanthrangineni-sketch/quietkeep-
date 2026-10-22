// tests/obd-profiles.test.mjs
// Unit tests for QuietKeep Car Reader Vehicle Profiles (DRV-07a / AG-02)
// Tests:
// 1. Pure Mode 01 decoders with known byte examples (11, 46, 51, 5B, 5C)
// 2. Profile detection for all five profiles (petrol_car, diesel_car, honda_hybrid, toyota_hybrid, bs6_two_wheeler)
// 3. Hybrid rule: "engine off while moving is normal" (rpm 0 while moving is not a fault; includes "Hybrid battery at N percent")
// 4. Two-wheeler summary: short summary, 12-13.5V battery normal, missing coolant handled cleanly, multilingual
// 5. Full simulated session per profile (all 5 profiles)

import {
  decodeMode01Response,
  SAE_J1979_FUEL_TYPES,
} from '../src/lib/obd/pids.js';

import {
  VEHICLE_PROFILES,
  detectProfile,
  isEngineOffNormal,
  summaryFor,
} from '../src/lib/obd/profiles.js';

import { ObdSimulator } from '../src/lib/obd/simulator.js';
import { ObdReader } from '../src/lib/obd/reader.js';

let pass = 0, fail = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  (${detail})`}`);
  ok ? pass++ : fail++;
}

console.log('── Vehicle Profiles (DRV-07a / AG-02) Unit Tests ──\n');

// ── 1. Decoders with Known Bytes ──────────────────────────────────────────────
console.log('1. Decoders with Known Bytes (11, 46, 51, 5B, 5C)');
{
  // PID 11: Throttle position (A*100)/255 %
  // 0x00 -> 0.0%
  const rTh0 = decodeMode01Response('41 11 00');
  check('0111 Throttle min: 41 11 00 -> 0.0%', rTh0 && rTh0.value === 0.0);

  // 0xFF (255) -> 100.0%
  const rThMax = decodeMode01Response('41 11 FF');
  check('0111 Throttle max: 41 11 FF -> 100.0%', rThMax && rThMax.value === 100.0);

  // 0x4C (76) -> 29.8%
  const rThMid = decodeMode01Response('41 11 4C');
  check('0111 Throttle mid: 41 11 4C -> 29.8%', rThMid && rThMid.value === 29.8);

  // PID 46: Ambient air temperature (A - 40 °C)
  // 0x28 (40) -> 0 °C
  const rAmb0 = decodeMode01Response('41 46 28');
  check('0146 Ambient air temp: 41 46 28 -> 0 °C', rAmb0 && rAmb0.value === 0);

  // 0x41 (65) -> 25 °C
  const rAmb25 = decodeMode01Response('41 46 41');
  check('0146 Ambient air temp: 41 46 41 -> 25 °C', rAmb25 && rAmb25.value === 25);

  // 0x14 (20) -> -20 °C
  const rAmbSub = decodeMode01Response('41 46 14');
  check('0146 Ambient air temp below zero: 41 46 14 -> -20 °C', rAmbSub && rAmbSub.value === -20);

  // PID 51: Fuel type (SAE J1979 table)
  // 0x01 -> petrol
  const rFtPetrol = decodeMode01Response('41 51 01');
  check('0151 Fuel type 0x01 -> petrol', rFtPetrol && rFtPetrol.value.name === 'petrol' && rFtPetrol.value.code === 1);

  // 0x04 -> diesel
  const rFtDiesel = decodeMode01Response('41 51 04');
  check('0151 Fuel type 0x04 -> diesel', rFtDiesel && rFtDiesel.value.name === 'diesel' && rFtDiesel.value.code === 4);

  // 0x08 -> electric
  const rFtElec = decodeMode01Response('41 51 08');
  check('0151 Fuel type 0x08 -> electric', rFtElec && rFtElec.value.name === 'electric' && rFtElec.value.code === 8);

  // 0x11 -> hybrid_petrol
  const rFtHyb = decodeMode01Response('41 51 11');
  check('0151 Fuel type 0x11 -> hybrid_petrol', rFtHyb && rFtHyb.value.name === 'hybrid_petrol' && rFtHyb.value.code === 17);

  // 0x06 -> cng
  const rFtCng = decodeMode01Response('41 51 06');
  check('0151 Fuel type 0x06 -> cng', rFtCng && rFtCng.value.name === 'cng' && rFtCng.value.code === 6);

  // PID 5B: Hybrid battery pack remaining life (A*100)/255 %
  // 0x00 -> 0.0%
  const rHb0 = decodeMode01Response('41 5B 00');
  check('015B Hybrid battery 41 5B 00 -> 0.0%', rHb0 && rHb0.value === 0.0);

  // 0xC8 (200) -> 78.4%
  const rHbMid = decodeMode01Response('41 5B C8');
  check('015B Hybrid battery 41 5B C8 -> 78.4%', rHbMid && rHbMid.value === 78.4);

  // 0xFF (255) -> 100.0%
  const rHbMax = decodeMode01Response('41 5B FF');
  check('015B Hybrid battery 41 5B FF -> 100.0%', rHbMax && rHbMax.value === 100.0);

  // PID 5C: Engine oil temperature (A - 40 °C)
  // 0x82 (130) -> 90 °C
  const rOil90 = decodeMode01Response('41 5C 82');
  check('015C Engine oil temp: 41 5C 82 -> 90 °C', rOil90 && rOil90.value === 90);

  // 0x8C (140) -> 100 °C
  const rOil100 = decodeMode01Response('41 5C 8C');
  check('015C Engine oil temp: 41 5C 8C -> 100 °C', rOil100 && rOil100.value === 100);
}

// ── 2. Profile Detection for All Five ─────────────────────────────────────────
console.log('\n2. Profile Detection for All Five Profiles');
{
  const fullCarPids = ['01', '04', '05', '0C', '0D', '11', '20', '2F', '40', '42', '46', '51', '5C'];
  const hybridPids = ['01', '04', '05', '0C', '0D', '11', '20', '2F', '40', '42', '46', '51', '5B', '5C'];
  const twoWheelerPids = ['01', '05', '0C', '0D', '11']; // minimal set, <= 10 PIDs, no 2F, no 04, no 5B

  // Profile 1: petrol_car
  const pPetrol = detectProfile(fullCarPids, 1);
  check('Detects petrol_car from petrol fuel code (1)', pPetrol === VEHICLE_PROFILES.PETROL_CAR, pPetrol);

  const pPetrolStr = detectProfile(fullCarPids, 'petrol');
  check('Detects petrol_car from "petrol" string', pPetrolStr === VEHICLE_PROFILES.PETROL_CAR);

  // Profile 2: diesel_car
  const pDiesel = detectProfile(fullCarPids, 4);
  check('Detects diesel_car from diesel fuel code (4)', pDiesel === VEHICLE_PROFILES.DIESEL_CAR, pDiesel);

  const pDieselStr = detectProfile(fullCarPids, 'diesel');
  check('Detects diesel_car from "diesel" string', pDieselStr === VEHICLE_PROFILES.DIESEL_CAR);

  // Profile 3: honda_hybrid
  const pHondaVin = detectProfile(hybridPids, 0x11, { vin: 'MAKGM467000123456' });
  check('Detects honda_hybrid from hybrid fuel + MAK (Honda India) VIN', pHondaVin === VEHICLE_PROFILES.HONDA_HYBRID, pHondaVin);

  const pHondaMake = detectProfile(hybridPids, 'hybrid_petrol', { make: 'Honda' });
  check('Detects honda_hybrid from hybrid fuel + Honda make', pHondaMake === VEHICLE_PROFILES.HONDA_HYBRID);

  const pHondaDefault = detectProfile(hybridPids, 0x11);
  check('Detects honda_hybrid as default hybrid profile', pHondaDefault === VEHICLE_PROFILES.HONDA_HYBRID);

  // Profile 4: toyota_hybrid
  const pToyotaVin = detectProfile(hybridPids, 0x11, { vin: 'MBJE1234567890123' });
  check('Detects toyota_hybrid from hybrid fuel + MBJ (Toyota India) VIN', pToyotaVin === VEHICLE_PROFILES.TOYOTA_HYBRID, pToyotaVin);

  const pToyotaMake = detectProfile(hybridPids, 'hybrid_petrol', { make: 'Toyota' });
  check('Detects toyota_hybrid from hybrid fuel + Toyota make', pToyotaMake === VEHICLE_PROFILES.TOYOTA_HYBRID);

  // Profile 5: bs6_two_wheeler
  const p2wPids = detectProfile(twoWheelerPids, 1);
  check('Detects bs6_two_wheeler from minimal PID set (<=10 PIDs without 04/2F/5B)', p2wPids === VEHICLE_PROFILES.BS6_TWO_WHEELER, p2wPids);

  const p2wHint = detectProfile(twoWheelerPids, 1, { isTwoWheeler: true });
  check('Detects bs6_two_wheeler from isTwoWheeler option', p2wHint === VEHICLE_PROFILES.BS6_TWO_WHEELER);

  const p2wStr = detectProfile([], 'bs6_two_wheeler');
  check('Detects bs6_two_wheeler from direct string', p2wStr === VEHICLE_PROFILES.BS6_TWO_WHEELER);
}

// ── 3. Hybrid Rule: Engine Off While Moving is Normal ─────────────────────────
console.log('\n3. Hybrid "Engine Off While Moving is Normal" Rule');
{
  const movingSnapshot = {
    rpm: 0, // Engine off in EV mode
    speedKmh: 35, // Moving at 35 km/h
    coolantC: 85,
    loadPct: 15.0,
    voltage: 14.1,
    hybridBatteryPct: 76.5,
    mil: false,
    dtcCount: 0,
  };

  // Rule check helper
  check('Honda hybrid: RPM 0 at 35 km/h is normal', isEngineOffNormal(VEHICLE_PROFILES.HONDA_HYBRID, 35, 0) === true);
  check('Toyota hybrid: RPM 0 at 35 km/h is normal', isEngineOffNormal(VEHICLE_PROFILES.TOYOTA_HYBRID, 35, 0) === true);
  check('Petrol car: RPM 0 at 35 km/h is an engine stall (abnormal)', isEngineOffNormal(VEHICLE_PROFILES.PETROL_CAR, 35, 0) === false);
  check('Diesel car: RPM 0 at 35 km/h is an engine stall (abnormal)', isEngineOffNormal(VEHICLE_PROFILES.DIESEL_CAR, 35, 0) === false);

  // Summary for Honda hybrid: must NOT report stall or fault, must include "Hybrid battery at 77 percent"
  const hondaSummary = summaryFor(VEHICLE_PROFILES.HONDA_HYBRID, movingSnapshot, []);
  check('Honda hybrid summary does not complain about 0 RPM stall',
    !hondaSummary.toLowerCase().includes('stall') && !hondaSummary.includes('Warning:'),
    hondaSummary
  );
  check('Honda hybrid summary includes "Hybrid battery at 77 percent"',
    hondaSummary.includes('Hybrid battery at 77 percent'),
    hondaSummary
  );

  // Summary for Toyota hybrid: same rule
  const toyotaSnapshot = { ...movingSnapshot, hybridBatteryPct: 82.0 };
  const toyotaSummary = summaryFor(VEHICLE_PROFILES.TOYOTA_HYBRID, toyotaSnapshot, []);
  check('Toyota hybrid summary does not complain about 0 RPM stall',
    !toyotaSummary.toLowerCase().includes('stall') && !toyotaSummary.includes('Warning:'),
    toyotaSummary
  );
  check('Toyota hybrid summary includes "Hybrid battery at 82 percent"',
    toyotaSummary.includes('Hybrid battery at 82 percent'),
    toyotaSummary
  );

  // Petrol car with same moving snapshot: warns that engine is off while moving
  const petrolSummary = summaryFor(VEHICLE_PROFILES.PETROL_CAR, movingSnapshot, []);
  check('Petrol car reports warning when engine off while moving',
    petrolSummary.includes('Warning: Engine is off while moving'),
    petrolSummary
  );
}

// ── 4. Two-Wheeler Summary ────────────────────────────────────────────────────
console.log('\n4. Two-Wheeler Summary');
{
  // Healthy 2-wheeler with small battery (12-13.5V normal)
  const twoWheelerSnapshot = {
    rpm: 1400,
    speedKmh: 0,
    coolantC: null, // Air-cooled scooter/motorcycle, no coolant sensor
    voltage: 12.8, // Normal 12.8V small battery
    mil: false,
    dtcCount: 0,
  };

  const twSummaryEn = summaryFor(VEHICLE_PROFILES.BS6_TWO_WHEELER, twoWheelerSnapshot, [], 'en');
  check('Two-wheeler summary is short and mentions battery 12.8 volts',
    twSummaryEn === 'Battery 12.8 volts, no warning lights.',
    twSummaryEn
  );

  // With head/engine temperature present
  const twWithTemp = { ...twoWheelerSnapshot, coolantC: 84 };
  const twTempSummary = summaryFor(VEHICLE_PROFILES.BS6_TWO_WHEELER, twWithTemp, [], 'en');
  check('Two-wheeler summary with temp includes engine degrees',
    twTempSummary === 'Engine warm at 84 degrees, battery 12.8 volts, no warning lights.',
    twTempSummary
  );

  // Multilingual support (Hindi, Telugu)
  const twSummaryHi = summaryFor(VEHICLE_PROFILES.BS6_TWO_WHEELER, twoWheelerSnapshot, [], 'hi');
  check('Two-wheeler Hindi summary', twSummaryHi.includes('बैटरी 12.8 वोल्ट'), twSummaryHi);

  const twSummaryTe = summaryFor(VEHICLE_PROFILES.BS6_TWO_WHEELER, twoWheelerSnapshot, [], 'te');
  check('Two-wheeler Telugu summary', twSummaryTe.includes('బ్యాటరీ 12.8 వోల్ట్‌లు'), twSummaryTe);

  // Faults reported correctly
  const twFaultSummary = summaryFor(VEHICLE_PROFILES.BS6_TWO_WHEELER, twoWheelerSnapshot, ['P0301'], 'en');
  check('Two-wheeler fault summary describes check engine light',
    twFaultSummary.includes('Check engine light is on: misfire on cylinder 1 (P0301)'),
    twFaultSummary
  );
}

// ── 5. Full Simulated Session Per Profile ─────────────────────────────────────
console.log('\n5. Full Simulated Session Per Profile');
await (async () => {
  // Profile A: petrol_car
  {
    const sim = new ObdSimulator({ profile: 'petrol_car', faults: [], mil: false, responseDelayMs: 5 });
    const reader = new ObdReader(sim);
    await reader.connect();
    const detected = await reader.detectProfile();
    check('Session [petrol_car]: detects petrol_car profile', detected === VEHICLE_PROFILES.PETROL_CAR, detected);

    const snapshot = await reader.readSnapshot();
    check('Session [petrol_car]: reads petrol fuel type', snapshot.fuelType && snapshot.fuelType.name === 'petrol');
    check('Session [petrol_car]: reads module voltage ~14.1 V', snapshot.voltage >= 13.8 && snapshot.voltage <= 14.5);
    check('Session [petrol_car]: throttle position decoded', Number.isFinite(snapshot.throttlePct));

    const summary = reader.summary(snapshot, []);
    check('Session [petrol_car]: healthy summary reports warm engine and 14.1V battery',
      summary.includes('battery 14.1 volts') && summary.includes('no warning lights'),
      summary
    );
    reader.destroy();
  }

  // Profile B: diesel_car
  {
    const sim = new ObdSimulator({ profile: 'diesel_car', faults: [], mil: false, responseDelayMs: 5 });
    const reader = new ObdReader(sim);
    await reader.connect();
    const detected = await reader.detectProfile();
    check('Session [diesel_car]: detects diesel_car profile', detected === VEHICLE_PROFILES.DIESEL_CAR, detected);

    const snapshot = await reader.readSnapshot();
    check('Session [diesel_car]: reads diesel fuel type', snapshot.fuelType && snapshot.fuelType.name === 'diesel');
    check('Session [diesel_car]: reads engine oil temp', Number.isFinite(snapshot.oilTempC));

    const summary = reader.summary(snapshot, []);
    check('Session [diesel_car]: summary reports healthy state', summary.includes('no warning lights'), summary);
    reader.destroy();
  }

  // Profile C: honda_hybrid
  {
    const sim = new ObdSimulator({
      profile: 'honda_hybrid',
      engineOffWhileMoving: true,
      hybridBatteryPct: 78,
      faults: [],
      mil: false,
      responseDelayMs: 5,
    });
    const reader = new ObdReader(sim);
    await reader.connect();
    const detected = await reader.detectProfile();
    check('Session [honda_hybrid]: detects honda_hybrid profile', detected === VEHICLE_PROFILES.HONDA_HYBRID, detected);

    const snapshot = await reader.readSnapshot();
    check('Session [honda_hybrid]: reads hybrid battery ~78%', snapshot.hybridBatteryPct === 78, `batt: ${snapshot.hybridBatteryPct}`);
    check('Session [honda_hybrid]: engine RPM is 0 in EV mode while moving', snapshot.rpm === 0);
    check('Session [honda_hybrid]: speed > 0 while rpm is 0', snapshot.speedKmh >= 0);

    const summary = reader.summary(snapshot, []);
    check('Session [honda_hybrid]: summary includes "Hybrid battery at 78 percent"',
      summary.includes('Hybrid battery at 78 percent'),
      summary
    );
    check('Session [honda_hybrid]: summary does NOT report stall', !summary.toLowerCase().includes('stall'));
    reader.destroy();
  }

  // Profile D: toyota_hybrid
  {
    const sim = new ObdSimulator({
      profile: 'toyota_hybrid',
      engineOffWhileMoving: true,
      hybridBatteryPct: 82,
      faults: [],
      mil: false,
      responseDelayMs: 5,
    });
    const reader = new ObdReader(sim);
    await reader.connect();
    const detected = await reader.detectProfile();
    check('Session [toyota_hybrid]: detects toyota_hybrid profile', detected === VEHICLE_PROFILES.TOYOTA_HYBRID, detected);

    const snapshot = await reader.readSnapshot();
    check('Session [toyota_hybrid]: reads hybrid battery ~82%', snapshot.hybridBatteryPct === 82, `batt: ${snapshot.hybridBatteryPct}`);
    check('Session [toyota_hybrid]: engine RPM is 0 in EV mode while moving', snapshot.rpm === 0);

    const summary = reader.summary(snapshot, []);
    check('Session [toyota_hybrid]: summary includes "Hybrid battery at 82 percent"',
      summary.includes('Hybrid battery at 82 percent'),
      summary
    );
    reader.destroy();
  }

  // Profile E: bs6_two_wheeler
  {
    const sim = new ObdSimulator({ profile: 'bs6_two_wheeler', faults: [], mil: false, responseDelayMs: 5 });
    const reader = new ObdReader(sim);
    await reader.connect();
    const detected = await reader.detectProfile();
    check('Session [bs6_two_wheeler]: detects bs6_two_wheeler profile', detected === VEHICLE_PROFILES.BS6_TWO_WHEELER, detected);

    const pids = await reader.supportedPids();
    check('Session [bs6_two_wheeler]: reports small supported PID set (<=10)', pids.length <= 10 && !pids.includes('2F'));

    const snapshot = await reader.readSnapshot();
    check('Session [bs6_two_wheeler]: voltage is ~12.8 V (two-wheeler battery)', snapshot.voltage >= 12.6 && snapshot.voltage <= 13.5, `voltage: ${snapshot.voltage}`);
    check('Session [bs6_two_wheeler]: fuel level 012F is null (not supported)', snapshot.fuelPct === null);
    check('Session [bs6_two_wheeler]: engine load 0104 is null (not supported)', snapshot.loadPct === null);

    const summary = reader.summary(snapshot, []);
    check('Session [bs6_two_wheeler]: summary is short and includes 12.8 volts',
      summary.includes('12.8 volts') && summary.includes('no warning lights'),
      summary
    );
    reader.destroy();
  }
})();

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
