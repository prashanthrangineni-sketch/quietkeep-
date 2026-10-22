// src/lib/blackbox.js
// JS wrapper for the QkBlackbox Capacitor plugin.
//
// The wrapper is thin: all heavy lifting (sensors, ring buffer, sealing) runs
// in the Java service. This file gives the rest of the app a simple start /
// stop / list / verify / freeze API.

/**
 * Get the native plugin, or null when running in a browser (non-Capacitor).
 */
function plugin() {
  if (typeof window === 'undefined') return null;
  return window.Capacitor?.Plugins?.QkBlackbox ?? null;
}

/**
 * Start the black box recording. Called when Drive Mode begins.
 * @param {{ audioOptIn?: boolean, testMode?: boolean }} opts
 */
export async function startBlackbox(opts = {}) {
  const p = plugin();
  if (!p) return { started: false, reason: 'not_native' };
  try {
    return await p.start({
      audioOptIn: !!opts.audioOptIn,
      testMode:   !!opts.testMode,
    });
  } catch (e) {
    console.warn('[blackbox] start failed:', e);
    return { started: false, reason: String(e) };
  }
}

/**
 * Stop the black box recording. Called when Drive Mode ends.
 */
export async function stopBlackbox() {
  const p = plugin();
  if (!p) return { stopped: false, reason: 'not_native' };
  try {
    return await p.stop();
  } catch (e) {
    console.warn('[blackbox] stop failed:', e);
    return { stopped: false, reason: String(e) };
  }
}

/**
 * Freeze the current buffer and seal a record.
 * Trigger types: 'crash_detector', 'voice_save', 'test_tilt'
 */
export async function freezeBlackbox(trigger = 'crash_detector') {
  const p = plugin();
  if (!p) return null;
  try {
    return await p.saveLast60s({ trigger });
  } catch (e) {
    console.warn('[blackbox] freeze failed:', e);
    return null;
  }
}

/**
 * List stored black box records on the device.
 * Returns { records: Array<{ id, trigger, started_at, ended_at, audio_opt_in }> }
 */
export async function listBlackboxRecords() {
  const p = plugin();
  if (!p) return { records: [] };
  try {
    return await p.list();
  } catch (e) {
    console.warn('[blackbox] list failed:', e);
    return { records: [] };
  }
}

/**
 * Verify a record's seal. Returns { valid: boolean, hash: string }.
 * @param {string} id  the record id (filename without extension)
 */
export async function verifyBlackboxRecord(id) {
  const p = plugin();
  if (!p) return { valid: false, hash: '', reason: 'not_native' };
  try {
    return await p.verify({ id });
  } catch (e) {
    console.warn('[blackbox] verify failed:', e);
    return { valid: false, hash: '', reason: String(e) };
  }
}

/**
 * Push an OBD reading into the running black box service.
 * @param {{ at?: string|number, speedKmh?: number, rpm?: number, loadPct?: number, coolantC?: number, voltage?: number, mil?: boolean, source?: string }} sample
 */
export async function pushObd(sample) {
  const p = plugin();
  if (!p || typeof p.pushObd !== 'function') {
    return { accepted: false, reason: 'not_native' };
  }
  try {
    return await p.pushObd(sample);
  } catch (e) {
    console.warn('[blackbox] pushObd failed:', e);
    return { accepted: false, reason: String(e) };
  }
}

/**
 * Request microphone permission (needed for audio opt-in).
 * Returns { granted: boolean }.
 */
export async function requestMicPermission() {
  const p = plugin();
  if (!p) return { granted: false };
  try {
    return await p.requestMicPermission();
  } catch (e) {
    console.warn('[blackbox] mic permission request failed:', e);
    return { granted: false };
  }
}

/**
 * Check whether the blackbox is available (running on Android with Capacitor).
 */
export function isBlackboxAvailable() {
  return !!plugin();
}

// Exact function names requested in Task Card DRV-01 step 9:
// "exposing start(), stop(), saveLast60s(), list(), verify(id)"
export const start = startBlackbox;
export const stop = stopBlackbox;
export const saveLast60s = freezeBlackbox;
export const list = listBlackboxRecords;
export const verify = verifyBlackboxRecord;

// ── Pure algorithmic calculations (matching BlackboxLogic.java) ─────────────
export const CONSTANTS = {
  PRE_TRIGGER_MS: 45000,
  POST_TRIGGER_MS: 15000,
  TOTAL_DURATION_MS: 60000,
  IMPACT_G: 3.5,
  SPEED_DROP_MS: 15.0 / 3.6, // 4.1667 m/s
  SPEED_DROP_WINDOW_MS: 200,
  GPS_SPEED_DROP_KMH: 15.0,
  TEST_TILT_DEGREES: 60.0,
  TEST_TILT_HOLD_MS: 3000,
  IMU_RATE_HZ: 100,
  GPS_RATE_HZ: 1,
  IMU_RECORD_BYTES: 32,
  GPS_RECORD_BYTES: 40,
  OBD_RATE_HZ: 2,
  OBD_RECORD_BYTES: 32,
  OBD_FLAG_MIL_ON: 0x01,
  OBD_FLAG_VALUE_MISSING: 0x02,
  // DRV-01c crash confirmation (mirror of BlackboxLogic.java)
  CANDIDATE_IMPACT_G: 4.0,
  IMPACT_SMOOTH_SAMPLES: 3,
  SEVERE_IMPACT_G: 8.0,
  MOVING_BEFORE_KMH: 20.0,
  STOPPED_AFTER_KMH: 5.0,
  SUSTAINED_DROP_KMH: 20.0,
  MAX_GPS_ACCURACY_M: 20.0,
  MAX_JOLTS_KEPT: 10,
};

// ── Crash confirmation (DRV-01c) ─────────────────────────────────────────
// A trigger opens a candidate; the packet is a crash record only when the
// motion around it looks like a crash. Mirrors BlackboxLogic.java exactly.

export function smoothedG(magnitudesMs2) {
  if (!magnitudesMs2 || magnitudesMs2.length === 0) return 0;
  let sum = 0;
  for (const m of magnitudesMs2) sum += m;
  return (sum / magnitudesMs2.length) / 9.80665;
}

export function isImpactCandidate(g) {
  return g >= CONSTANTS.CANDIDATE_IMPACT_G - 1e-9;
}

export function isSpeedDropGpsTrusted(prevKmh, currKmh, prevAccuracyM, currAccuracyM) {
  if (prevAccuracyM > CONSTANTS.MAX_GPS_ACCURACY_M || currAccuracyM > CONSTANTS.MAX_GPS_ACCURACY_M) return false;
  if (prevKmh < CONSTANTS.MOVING_BEFORE_KMH) return false;
  return isSpeedDropGps(prevKmh, currKmh);
}

/**
 * @param {string} trigger
 * @param {number} peakSmoothedG
 * @param {number} speedBeforeKmh  NaN when no trusted fix in the 5 s before
 * @param {{offsetMs:number, kmh:number}[]} after  trusted fixes 0..10 s after
 * @returns {{ confirmed: boolean, reason: string }}
 */
export function confirmCrash(trigger, peakSmoothedG, speedBeforeKmh, after = []) {
  if (trigger === 'crash_detector') return { confirmed: true, reason: 'crash_detector' };
  if (trigger === 'voice_save' || trigger === 'manual') return { confirmed: true, reason: 'saved_by_driver' };
  if (trigger === 'test_tilt') return { confirmed: true, reason: 'test_mode' };
  if (peakSmoothedG >= CONSTANTS.SEVERE_IMPACT_G - 1e-9) return { confirmed: true, reason: 'severe_impact' };
  const movingBefore = Number.isFinite(speedBeforeKmh) && speedBeforeKmh >= CONSTANTS.MOVING_BEFORE_KMH;
  if (!movingBefore || !after || after.length === 0) {
    return { confirmed: false, reason: movingBefore ? 'no_gps_after' : 'not_moving_before' };
  }
  let minAfter = Infinity;
  let allLowLater = true;
  let laterFixes = 0;
  for (const f of after) {
    if (f.offsetMs < 0 || f.offsetMs > 10000) continue;
    minAfter = Math.min(minAfter, f.kmh);
    if (f.offsetMs >= 2000) {
      laterFixes++;
      if (f.kmh > speedBeforeKmh - CONSTANTS.SUSTAINED_DROP_KMH) allLowLater = false;
    }
  }
  if (minAfter <= CONSTANTS.STOPPED_AFTER_KMH) return { confirmed: true, reason: 'stopped_after_impact' };
  if (laterFixes >= 3 && allLowLater) return { confirmed: true, reason: 'sustained_slowdown' };
  return { confirmed: false, reason: 'kept_moving' };
}

/** Split a plugin list() into crash records and jolts (old records count as confirmed). */
export function splitRecords(records = []) {
  const crashes = [];
  const jolts = [];
  for (const r of records) (r && r.confirmed === false ? jolts : crashes).push(r);
  return { crashes, jolts };
}

export function computePacketWindow(triggerTimeMs, bufferStartMs) {
  const packetStart = Math.max(bufferStartMs, triggerTimeMs - CONSTANTS.PRE_TRIGGER_MS);
  const packetEnd = triggerTimeMs + CONSTANTS.POST_TRIGGER_MS;
  const preMs = triggerTimeMs - packetStart;
  const postMs = CONSTANTS.POST_TRIGGER_MS;
  return { packetStart, packetEnd, preMs, postMs };
}

export function isImpact(ax, ay, az) {
  const g = Math.sqrt(ax * ax + ay * ay + az * az) / 9.80665;
  return g >= (CONSTANTS.IMPACT_G - 1e-6);
}

export function isSpeedDropGps(prevSpeedKmh, currSpeedKmh) {
  return (prevSpeedKmh - currSpeedKmh) >= CONSTANTS.GPS_SPEED_DROP_KMH;
}

export function maxSpeedDropAccel(samples, count) {
  if (count < 2) return 0.0;
  let maxDrop = 0.0;
  for (let windowStart = 0; windowStart < count; windowStart++) {
    let sumVx = 0, sumVy = 0, sumVz = 0;
    const t0 = samples[windowStart * 4];
    for (let j = windowStart + 1; j < count; j++) {
      const tj = samples[j * 4];
      // Stop BEFORE integrating a sample past the 200 ms window.
      if (tj - t0 > CONSTANTS.SPEED_DROP_WINDOW_MS * 1000) break;
      const dt_us = tj - samples[(j - 1) * 4];
      if (dt_us <= 0) continue;
      const dt_s = dt_us / 1000000.0;
      const ax = (samples[(j - 1) * 4 + 1] + samples[j * 4 + 1]) / 2.0;
      const ay = (samples[(j - 1) * 4 + 2] + samples[j * 4 + 2]) / 2.0;
      const az = (samples[(j - 1) * 4 + 3] + samples[j * 4 + 3]) / 2.0;
      sumVx += ax * dt_s;
      sumVy += ay * dt_s;
      sumVz += az * dt_s;

      const elapsed = tj - t0;
      if (elapsed > CONSTANTS.SPEED_DROP_WINDOW_MS * 1000) break;
      const deltaSpeed = Math.sqrt(sumVx * sumVx + sumVy * sumVy + sumVz * sumVz);
      if (deltaSpeed > maxDrop) maxDrop = deltaSpeed;
    }
  }
  return maxDrop;
}

export function isSpeedDropAccel(samples, count) {
  return maxSpeedDropAccel(samples, count) >= CONSTANTS.SPEED_DROP_MS;
}

export function tiltFromVerticalDeg(gx, gy, gz) {
  const mag = Math.sqrt(gx * gx + gy * gy + gz * gz);
  if (mag < 0.01) return 0;
  const cosAngle = Math.abs(gy) / mag;
  return Math.acos(Math.min(1.0, cosAngle)) * (180 / Math.PI);
}

export function isTiltPastThreshold(gx, gy, gz) {
  return tiltFromVerticalDeg(gx, gy, gz) >= CONSTANTS.TEST_TILT_DEGREES;
}

// ── OBD Record Encoding & Decoding (matching BlackboxLogic.java) ─────────────

export function obdRecordBytes() {
  return CONSTANTS.OBD_RECORD_BYTES;
}

export function obdSamplesForDuration(durationMs) {
  return Math.floor((durationMs * CONSTANTS.OBD_RATE_HZ) / 1000);
}

export function obdBufferCapacity() {
  return obdSamplesForDuration(CONSTANTS.TOTAL_DURATION_MS);
}

/**
 * Encode an OBD record into a 32-byte Uint8Array (little-endian).
 * Missing / non-finite values are stored as Float32 NaN and set OBD_FLAG_VALUE_MISSING bit.
 */
export function encodeObdRecord(sampleOrTimestampUs, speedKmhArg, rpmArg, loadPctArg, coolantCArg, voltageArg, flagsArg = 0) {
  let timestampUs, speedKmh, rpm, loadPct, coolantC, voltage, flags, mil;
  if (typeof sampleOrTimestampUs === 'object' && sampleOrTimestampUs !== null) {
    const s = sampleOrTimestampUs;
    timestampUs = s.timestampUs ?? (s.at ? (typeof s.at === 'number' ? (s.at > 1e14 ? s.at : s.at * 1000) : new Date(s.at).getTime() * 1000) : 0);
    speedKmh = s.speedKmh;
    rpm = s.rpm;
    loadPct = s.loadPct;
    coolantC = s.coolantC;
    voltage = s.voltage;
    flags = s.flags ?? 0;
    mil = s.mil;
  } else {
    timestampUs = sampleOrTimestampUs ?? 0;
    speedKmh = speedKmhArg;
    rpm = rpmArg;
    loadPct = loadPctArg;
    coolantC = coolantCArg;
    voltage = voltageArg;
    flags = flagsArg ?? 0;
  }

  const buf = new Uint8Array(CONSTANTS.OBD_RECORD_BYTES);
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

  view.setBigInt64(0, BigInt(Math.round(Number(timestampUs))), true);

  const fSpeed = (typeof speedKmh === 'number' && Number.isFinite(speedKmh)) ? speedKmh : NaN;
  const fRpm = (typeof rpm === 'number' && Number.isFinite(rpm)) ? rpm : NaN;
  const fLoad = (typeof loadPct === 'number' && Number.isFinite(loadPct)) ? loadPct : NaN;
  const fCoolant = (typeof coolantC === 'number' && Number.isFinite(coolantC)) ? coolantC : NaN;
  const fVoltage = (typeof voltage === 'number' && Number.isFinite(voltage)) ? voltage : NaN;

  view.setFloat32(8, fSpeed, true);
  view.setFloat32(12, fRpm, true);
  view.setFloat32(16, fLoad, true);
  view.setFloat32(20, fCoolant, true);
  view.setFloat32(24, fVoltage, true);

  let finalFlags = flags;
  if (mil) {
    finalFlags |= CONSTANTS.OBD_FLAG_MIL_ON;
  }
  if (Number.isNaN(fSpeed) || Number.isNaN(fRpm) || Number.isNaN(fLoad) || Number.isNaN(fCoolant) || Number.isNaN(fVoltage)) {
    finalFlags |= CONSTANTS.OBD_FLAG_VALUE_MISSING;
  }

  view.setUint8(28, finalFlags & 0xff);
  view.setUint8(29, 0);
  view.setUint8(30, 0);
  view.setUint8(31, 0);

  return buf;
}

/**
 * Decode a 32-byte little-endian OBD record.
 */
export function decodeObdRecord(buffer, offset = 0) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset + offset, CONSTANTS.OBD_RECORD_BYTES);

  const timestampUs = Number(view.getBigInt64(0, true));
  const speedKmh = view.getFloat32(8, true);
  const rpm = view.getFloat32(12, true);
  const loadPct = view.getFloat32(16, true);
  const coolantC = view.getFloat32(20, true);
  const voltage = view.getFloat32(24, true);
  const flags = view.getUint8(28);

  return {
    timestampUs,
    speedKmh,
    rpm,
    loadPct,
    coolantC,
    voltage,
    flags,
    mil: (flags & CONSTANTS.OBD_FLAG_MIL_ON) !== 0,
    valueMissing: (flags & CONSTANTS.OBD_FLAG_VALUE_MISSING) !== 0,
  };
}

export { compareSpeeds } from './obd/blackbox-feed.js';
