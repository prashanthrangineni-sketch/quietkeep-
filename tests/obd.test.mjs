// tests/obd.test.mjs
// Unit tests for QuietKeep Car Reader v1 (OBD-II over Bluetooth) - Task Card DRV-06
// Tests:
// 1. Pure Mode 01 decoders with known byte examples
// 2. Pure Mode 03 DTC decoders (P, C, B, U prefixes and padding)
// 3. Pure Mode 09 VIN decoders & multi-frame ISO-TP assembly
// 4. Strict read-only enforcement (refusing Mode 04 and NVM write AT commands)
// 5. Multi-ECU prioritization (preferring 7E8 engine ECU over 7E9)
// 6. Command queue serialization (never sending two commands concurrently)
// 7. Timeouts and timeout recovery
// 8. Simulator failure modes ('no_data', 'unable_to_connect', 'slow_replies', 'dropped_prompt', 'garbage_bytes')
// 9. Full simulated session: connect -> snapshot -> faults -> voice summary

import {
  parseHexBytes,
  decodeSupportedPids,
  decodeMode01Response,
  decodeMode03Response,
  decodeMode09VinResponse,
} from '../src/lib/obd/pids.js';

import {
  Elm327,
  assertReadOnlyCommand,
  assembleIsoTpFrames,
  prioritizeEngineEcu,
} from '../src/lib/obd/elm327.js';

import { ObdSimulator } from '../src/lib/obd/simulator.js';

import {
  ObdReader,
  formatObdSummary,
  describeFaultCode,
} from '../src/lib/obd/reader.js';

let pass = 0, fail = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  (${detail})`}`);
  ok ? pass++ : fail++;
}

console.log('── Car Reader v1 (OBD-II) Unit Tests ──\n');

// ── 1. Pure Mode 01 Decoders with Known Byte Examples ─────────────────────────
console.log('1. Pure Mode 01 Decoders');
{
  // 010C RPM: ((A*256+B)/4)
  // "41 0C 1A F8" -> (0x1A * 256 + 0xF8) / 4 = (6656 + 248) / 4 = 1726 rpm
  const rRpm = decodeMode01Response('41 0C 1A F8');
  check('010C RPM: 41 0C 1A F8 -> 1726 rpm', rRpm && rRpm.value === 1726, JSON.stringify(rRpm));

  // 010D Speed: A km/h
  // "41 0D 3C" -> 60 km/h
  const rSpeed = decodeMode01Response('41 0D 3C');
  check('010D Speed: 41 0D 3C -> 60 km/h', rSpeed && rSpeed.value === 60, JSON.stringify(rSpeed));

  // 0105 Coolant: A - 40 °C
  // "41 05 7B" -> 0x7B = 123; 123 - 40 = 83 °C
  const rCoolant = decodeMode01Response('41 05 7B');
  check('0105 Coolant: 41 05 7B -> 83 °C', rCoolant && rCoolant.value === 83, JSON.stringify(rCoolant));

  // 0104 Engine load: (A*100)/255 %
  // "41 04 7F" -> (127 * 100) / 255 = 49.8%
  const rLoad = decodeMode01Response('41 04 7F');
  check('0104 Engine Load: 41 04 7F -> 49.8%', rLoad && rLoad.value === 49.8, JSON.stringify(rLoad));

  // 012F Fuel level: (A*100)/255 %
  // "41 2F A0" -> (160 * 100) / 255 = 62.7%
  const rFuel = decodeMode01Response('41 2F A0');
  check('012F Fuel level: 41 2F A0 -> 62.7%', rFuel && rFuel.value === 62.7, JSON.stringify(rFuel));

  // 0142 Control module voltage: ((A*256+B)/1000 V)
  // "41 42 37 14" -> (0x37 * 256 + 0x14) / 1000 = (14080 + 20) / 1000 = 14.10 V
  const rVolt = decodeMode01Response('41 42 37 14');
  check('0142 Module Voltage: 41 42 37 14 -> 14.10 V', rVolt && rVolt.value === 14.1, JSON.stringify(rVolt));

  // 0101 Monitor Status: MIL on = bit 7 of A, DTC count = bits 0-6 of A
  // "41 01 82 07 65 00" -> A = 0x82 (MIL ON, count = 2)
  const rMilOn = decodeMode01Response('41 01 82 07 65 00');
  check('0101 Status MIL on + 2 DTCs', rMilOn && rMilOn.value.mil === true && rMilOn.value.dtcCount === 2);

  // "41 01 00 07 65 00" -> A = 0x00 (MIL OFF, count = 0)
  const rMilOff = decodeMode01Response('41 01 00 07 65 00');
  check('0101 Status MIL off + 0 DTCs', rMilOff && rMilOff.value.mil === false && rMilOff.value.dtcCount === 0);

  // Supported PIDs Bitmaps
  // "41 00 BE 3F B8 13"
  // BE = 10111110 -> 01, 03, 04, 05, 06, 07
  // 3F = 00111111 -> 0B, 0C, 0D, 0E, 0F, 10
  // B8 = 10111000 -> 11, 13, 14, 15
  // 13 = 00010011 -> 1C, 1F, 20
  const rSupp = decodeMode01Response('41 00 BE 3F B8 13');
  check('0100 Supported PIDs includes 01, 04, 05, 0C, 0D, 20',
    rSupp &&
    rSupp.supportedPids.includes('01') &&
    rSupp.supportedPids.includes('04') &&
    rSupp.supportedPids.includes('05') &&
    rSupp.supportedPids.includes('0C') &&
    rSupp.supportedPids.includes('0D') &&
    rSupp.supportedPids.includes('20')
  );

  // 0111 Throttle position: (A*100)/255 %
  // "41 11 4C" -> (76 * 100) / 255 = 29.8%
  const rThrottle = decodeMode01Response('41 11 4C');
  check('0111 Throttle position: 41 11 4C -> 29.8%', rThrottle && rThrottle.value === 29.8, JSON.stringify(rThrottle));

  // 0146 Ambient air temperature: A - 40 °C
  // "41 46 41" -> 65 - 40 = 25 °C
  const rAmbient = decodeMode01Response('41 46 41');
  check('0146 Ambient air temp: 41 46 41 -> 25 °C', rAmbient && rAmbient.value === 25, JSON.stringify(rAmbient));

  // 0151 Fuel type per SAE J1979
  // "41 51 01" -> petrol (code 1)
  const rFuelTypePetrol = decodeMode01Response('41 51 01');
  check('0151 Fuel type petrol: 41 51 01 -> petrol', rFuelTypePetrol && rFuelTypePetrol.value.name === 'petrol' && rFuelTypePetrol.value.code === 1);

  // "41 51 04" -> diesel (code 4)
  const rFuelTypeDiesel = decodeMode01Response('41 51 04');
  check('0151 Fuel type diesel: 41 51 04 -> diesel', rFuelTypeDiesel && rFuelTypeDiesel.value.name === 'diesel' && rFuelTypeDiesel.value.code === 4);

  // "41 51 11" -> hybrid_petrol (code 0x11 = 17)
  const rFuelTypeHybrid = decodeMode01Response('41 51 11');
  check('0151 Fuel type hybrid: 41 51 11 -> hybrid_petrol', rFuelTypeHybrid && rFuelTypeHybrid.value.name === 'hybrid_petrol' && rFuelTypeHybrid.value.code === 17);

  // 015B Hybrid battery pack remaining life: (A*100)/255 %
  // "41 5B C8" -> (200 * 100) / 255 = 78.4%
  const rHybridBatt = decodeMode01Response('41 5B C8');
  check('015B Hybrid battery pack life: 41 5B C8 -> 78.4%', rHybridBatt && rHybridBatt.value === 78.4, JSON.stringify(rHybridBatt));

  // 015C Engine oil temperature: A - 40 °C
  // "41 5C 82" -> 130 - 40 = 90 °C
  const rOil = decodeMode01Response('41 5C 82');
  check('015C Engine oil temp: 41 5C 82 -> 90 °C', rOil && rOil.value === 90, JSON.stringify(rOil));
}

// ── 2. Pure Mode 03 DTC Decoder ───────────────────────────────────────────────
console.log('\n2. Mode 03 DTC Decoder');
{
  // 0133 -> P0133 (0x01, 0x33), 0420 -> P0420 (0x04, 0x20)
  const dtcs1 = decodeMode03Response('43 02 01 33 04 20');
  check('Mode 03 frames decode to P0133 and P0420',
    dtcs1.length === 2 && dtcs1[0] === 'P0133' && dtcs1[1] === 'P0420',
    JSON.stringify(dtcs1)
  );

  // P0301 (0x03, 0x01) with padding 00 00
  const dtcs2 = decodeMode03Response('43 01 03 01 00 00');
  check('Mode 03 frame decodes to P0301 ignoring 00 00 padding',
    dtcs2.length === 1 && dtcs2[0] === 'P0301',
    JSON.stringify(dtcs2)
  );

  // Other code prefixes: C, B, U
  // 01 = 00 -> P; 41 = 0100 0001 -> prefix 01 = C0101
  // 81 = 1000 0001 -> prefix 10 = B0101
  // C1 = 1100 0001 -> prefix 11 = U0101
  const dtcsPrefixes = decodeMode03Response([0x43, 0x03, 0x41, 0x23, 0x82, 0x34, 0xC1, 0x55]);
  check('Mode 03 prefix mapping (C, B, U)',
    dtcsPrefixes.includes('C0123') && dtcsPrefixes.includes('B0234') && dtcsPrefixes.includes('U0155'),
    JSON.stringify(dtcsPrefixes)
  );

  // Empty / No faults
  const dtcsEmpty = decodeMode03Response('43 00 00 00 00 00');
  check('Mode 03 with all zeros returns empty array', dtcsEmpty.length === 0);
}

// ── 3. Multi-Frame ISO-TP Assembly & Mode 09 VIN ──────────────────────────────
console.log('\n3. Multi-Frame ISO-TP Assembly & Mode 09 VIN');
{
  // Simulated CAN frames with 7E8 header for VIN "WVWZZZ3CZWE123456"
  // W=57, V=56, W=57, Z=5A, Z=5A, Z=5A, 3=33, C=43, Z=5A, W=57, E=45, 1=31, 2=32, 3=33, 4=34, 5=35, 6=36
  const framesWithHeaders = [
    '7E8 10 14 49 02 01 57 56 57',
    '7E8 21 5A 5A 5A 33 43 5A 57',
    '7E8 22 45 31 32 33 34 35 36',
  ];

  const assembled = assembleIsoTpFrames(framesWithHeaders);
  const vin = decodeMode09VinResponse(assembled);
  check('Multi-frame ISO-TP assembled into 17-char VIN', vin === 'WVWZZZ3CZWE123456', vin);

  // ELM-style numbered lines format: "0: ...", "1: ...", "2: ..."
  const elmFrames = [
    '0: 49 02 01 57 56 57',
    '1: 5A 5A 5A 33 43 5A 57',
    '2: 45 31 32 33 34 35 36',
  ];
  const assembledElm = assembleIsoTpFrames(elmFrames);
  const vinElm = decodeMode09VinResponse(assembledElm);
  check('ELM-style 0:/1:/2: format assembled into 17-char VIN', vinElm === 'WVWZZZ3CZWE123456', vinElm);
}

// ── 4. Strict Read-Only Promise ───────────────────────────────────────────────
console.log('\n4. Strict Read-Only Promise');
{
  // Must refuse Mode 04 (clear trouble codes)
  let mode04Blocked = false;
  try {
    assertReadOnlyCommand('04');
  } catch (e) {
    mode04Blocked = true;
  }
  check('assertReadOnlyCommand refuses Mode 04', mode04Blocked);

  let mode0400Blocked = false;
  try {
    assertReadOnlyCommand('0400');
  } catch (e) {
    mode0400Blocked = true;
  }
  check('assertReadOnlyCommand refuses Mode 0400', mode0400Blocked);

  // Must refuse AT commands that write to EEPROM / NVM
  let atppBlocked = false;
  try {
    assertReadOnlyCommand('ATPP 01 ON');
  } catch (e) {
    atppBlocked = true;
  }
  check('assertReadOnlyCommand refuses ATPP (programmable parameter write)', atppBlocked);

  let atsdBlocked = false;
  try {
    assertReadOnlyCommand('ATSD 1234');
  } catch (e) {
    atsdBlocked = true;
  }
  check('assertReadOnlyCommand refuses ATSD (save data write)', atsdBlocked);

  // Must refuse other writing/bidirectional OBD modes (e.g. Mode 08 actuator test)
  let mode08Blocked = false;
  try {
    assertReadOnlyCommand('08 01 02');
  } catch (e) {
    mode08Blocked = true;
  }
  check('assertReadOnlyCommand refuses Mode 08 (bidirectional control)', mode08Blocked);

  // Allowed read-only modes must pass
  let readsPassed = false;
  try {
    assertReadOnlyCommand('0100');
    assertReadOnlyCommand('010C');
    assertReadOnlyCommand('03');
    assertReadOnlyCommand('0902');
    assertReadOnlyCommand('ATZ');
    assertReadOnlyCommand('ATE0');
    assertReadOnlyCommand('ATH1');
    assertReadOnlyCommand('ATSP0');
    assertReadOnlyCommand('ATDPN');
    readsPassed = true;
  } catch (e) {
    readsPassed = false;
  }
  check('assertReadOnlyCommand permits safe Mode 01, 03, 09 and safe AT read commands', readsPassed);
}

// ── 5. Multi-ECU Prioritization (7E8 Engine First) ───────────────────────────
console.log('\n5. Multi-ECU Prioritization');
{
  const mixedLines = [
    '7E9 06 41 00 80 00 00 00',
    '7E8 06 41 00 BE 3F B8 13',
  ];
  const prioritized = prioritizeEngineEcu(mixedLines);
  check('7E8 engine ECU lines sorted before 7E9 transmission ECU lines',
    prioritized[0].startsWith('7E8') && prioritized[1].startsWith('7E9')
  );
}

// ── 6. Command Queue Serialization ────────────────────────────────────────────
console.log('\n6. Command Queue Serialization');
await (async () => {
  const sentCommands = [];
  let concurrentWrites = 0;
  let maxConcurrent = 0;

  let dataCallback = null;
  const mockTransport = {
    write(cmd) {
      concurrentWrites++;
      if (concurrentWrites > maxConcurrent) maxConcurrent = concurrentWrites;
      sentCommands.push(cmd.trim());

      // Simulate asynchronous reply with delay
      setTimeout(() => {
        concurrentWrites--;
        if (dataCallback) {
          dataCallback(`\r\r41 0C 1A F8\r\r>`);
        }
      }, 25);
    },
    onData(cb) {
      dataCallback = cb;
    },
  };

  const elm = new Elm327(mockTransport);

  // Launch three commands simultaneously
  const p1 = elm.send('010C');
  const p2 = elm.send('010C');
  const p3 = elm.send('010C');

  await Promise.all([p1, p2, p3]);

  check('Commands queued: never more than 1 write in-flight at a time', maxConcurrent === 1, `max: ${maxConcurrent}`);
  check('All three commands processed sequentially in order', sentCommands.length === 3);
  elm.destroy();
})();

// ── 7. Timeouts and Timeout Handling ──────────────────────────────────────────
console.log('\n7. Timeouts and Timeout Handling');
await (async () => {
  const silentTransport = {
    write() {
      // Intentionally never replies
    },
    onData() {},
  };

  const elm = new Elm327(silentTransport);
  let timedOut = false;
  const start = Date.now();
  try {
    await elm.send('010C', { timeoutMs: 100 });
  } catch (err) {
    timedOut = err.message.includes('timed out');
  }
  const duration = Date.now() - start;

  check('Command times out when transport is silent', timedOut && duration >= 90 && duration < 300, `duration: ${duration}ms`);
  elm.destroy();
})();

// ── 8. Simulator Failure Modes ────────────────────────────────────────────────
console.log('\n8. Simulator Failure Modes');
await (async () => {
  // Mode: 'no_data'
  {
    const sim = new ObdSimulator({ failureMode: 'no_data', responseDelayMs: 5 });
    const elm = new Elm327(sim);
    const res = await elm.send('010C');
    check("Simulator 'no_data' mode sets noData flag", res.noData === true);
    elm.destroy();
  }

  // Mode: 'unable_to_connect'
  {
    const sim = new ObdSimulator({ failureMode: 'unable_to_connect', responseDelayMs: 5 });
    const elm = new Elm327(sim);
    let rejected = false;
    try {
      await elm.send('0100');
    } catch (err) {
      rejected = err.message.includes('UNABLE TO CONNECT');
    }
    check("Simulator 'unable_to_connect' mode rejects with error", rejected);
    elm.destroy();
  }

  // Mode: 'slow_replies'
  {
    const sim = new ObdSimulator({ failureMode: 'slow_replies' });
    const elm = new Elm327(sim);
    let timedOut = false;
    try {
      await elm.send('010C', { timeoutMs: 100 });
    } catch (err) {
      timedOut = err.message.includes('timed out');
    }
    check("Simulator 'slow_replies' mode triggers client timeout", timedOut);
    elm.destroy();
  }

  // Mode: 'dropped_prompt'
  {
    const sim = new ObdSimulator({ failureMode: 'dropped_prompt', responseDelayMs: 5 });
    const elm = new Elm327(sim);
    let timedOut = false;
    try {
      await elm.send('010C', { timeoutMs: 100 });
    } catch (err) {
      timedOut = err.message.includes('timed out');
    }
    check("Simulator 'dropped_prompt' mode causes timeout as client waits for '>'", timedOut);
    elm.destroy();
  }

  // Mode: 'garbage_bytes'
  {
    const sim = new ObdSimulator({ failureMode: 'garbage_bytes', responseDelayMs: 5 });
    const elm = new Elm327(sim);
    const res = await elm.send('010C');
    // Does not crash; returns raw response
    const dec = decodeMode01Response(res.assembled || res.raw);
    check("Simulator 'garbage_bytes' does not crash and decodes as null", dec === null);
    elm.destroy();
  }
})();

// ── 9. Full Simulated Session: Connect -> Snapshot -> Faults -> Summary ───────
console.log('\n9. Full Simulated Session');
await (async () => {
  // Scenario A: Faults present (P0301, P0420) and MIL is ON
  const simWithFaults = new ObdSimulator({
    vin: 'WVWZZZ3CZWE123456',
    faults: ['P0301', 'P0420'],
    mil: true,
    responseDelayMs: 5,
  });

  const readerWithFaults = new ObdReader(simWithFaults);
  const initRes = await readerWithFaults.connect();
  check('Session connect() completes init sequence', initRes.ok === true && initRes.protocol === '6');

  const snapshot = await readerWithFaults.readSnapshot();
  check('Snapshot reads RPM in realistic idle range (750-850)', snapshot.rpm >= 750 && snapshot.rpm <= 850, `rpm: ${snapshot.rpm}`);
  check('Snapshot reads speed (0-60 km/h)', snapshot.speedKmh >= 0 && snapshot.speedKmh <= 60, `speed: ${snapshot.speedKmh}`);
  check('Snapshot reads coolant temperature', snapshot.coolantC >= 40 && snapshot.coolantC <= 90, `coolant: ${snapshot.coolantC}`);
  check('Snapshot reads control module voltage ~14.1 V', snapshot.voltage >= 13.5 && snapshot.voltage <= 15.0, `voltage: ${snapshot.voltage}`);
  check('Snapshot reflects MIL ON and dtcCount = 2', snapshot.mil === true && snapshot.dtcCount === 2);

  const faults = await readerWithFaults.readFaults();
  check('readFaults() retrieves P0301 and P0420',
    faults.length === 2 && faults.includes('P0301') && faults.includes('P0420'),
    JSON.stringify(faults)
  );

  const vin = await readerWithFaults.readVin();
  check('readVin() retrieves 17-character VIN', vin === 'WVWZZZ3CZWE123456', vin);

  const summary = readerWithFaults.summary(snapshot, faults);
  check('Fault summary describes check engine light and misfire cylinder 1',
    summary.includes('Check engine light is on') &&
    summary.includes('misfire on cylinder 1 (P0301)') &&
    summary.includes('catalytic converter system efficiency below threshold (P0420)'),
    summary
  );

  readerWithFaults.destroy();

  // Scenario B: Healthy Car (No faults, MIL OFF, warm engine 88 °C)
  const healthySnapshot = {
    rpm: 800,
    speedKmh: 45,
    coolantC: 88,
    loadPct: 28.5,
    fuelPct: 65.0,
    voltage: 14.1,
    mil: false,
    dtcCount: 0,
    at: new Date().toISOString(),
  };

  const healthySummary = formatObdSummary(healthySnapshot, []);
  check('Healthy summary reports warm engine, battery volts, and no warning lights',
    healthySummary === 'Engine is warm at 88 degrees, battery 14.1 volts, no warning lights.',
    healthySummary
  );

  // Scenario C: Unknown trouble code
  const unknownDesc = describeFaultCode('P1234');
  check('Unknown code falls back to mechanic recommendation',
    unknownDesc === 'code P1234, needs a mechanic to read',
    unknownDesc
  );
})();

// ── Allow-list (review fix, 17 Oct 2026) ─────────────────────────────────────
{
  const refused = (c) => { try { assertReadOnlyCommand(c); return false; } catch { return true; } };
  for (const c of ['AT@3 QKTEST', 'ATSH 7E0', 'ATBRD 23', 'ATMA', 'ATPB C0 01', 'ATWM 81 10 F1 3E',
                   '2E F1 90 00', '22 F1 90', '10 03', '3E 00', '14 FF FF FF', '0400', '04', '0 4', '07', '0A',
                   '010C; 04', 'hello', '']) {
    check(`refuses '${c}'`, refused(c));
  }
  for (const c of ['ATZ', 'AT E0', 'atl0', 'ATS0', 'ATH1', 'ATSP0', 'ATDPN', 'ATRV',
                   '0100', '010C', '01 0D', '0105', '010C1', '03', '0902']) {
    check(`allows '${c}'`, !refused(c));
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
