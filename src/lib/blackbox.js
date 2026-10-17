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
};

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
