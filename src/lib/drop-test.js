// src/lib/drop-test.js
// TASK CARD AG-D3: Drop-and-fall test evaluator (DRV-16)
// Pure logic, injectable options, no browser APIs or network calls.
//
// Evaluates a recorded motion trace using createCrashDetector from src/lib/crash-detect.js.
// Simulates a riding speed of 25 km/h before the drop/fall event and 0 km/h after
// (because staged tests happen at a standstill).
//
// Safety rule: Drill only — never starts SOS, never alerts contacts.

import { createCrashDetector, CRASH_DEFAULTS, magnitudeFromMotionEvent } from './crash-detect.js';

export const DROP_TRIAL_TYPES = {
  cushion_drop_1m: {
    id: 'cushion_drop_1m',
    name: 'Cushion drop (1m)',
    expected: true,
    expectedText: 'detected',
    description: 'Drop phone from 1m onto cushion/foam. Impact > 3.2g, stillness > 8s.',
  },
  pocket_fall: {
    id: 'pocket_fall',
    name: 'Pocket fall',
    expected: true,
    expectedText: 'detected',
    description: 'Phone slips from pocket to floor at standstill. Impact > 3.2g, stillness > 8s.',
  },
  bag_drop: {
    id: 'bag_drop',
    name: 'Bag drop',
    expected: true,
    expectedText: 'detected',
    description: 'Drop bag containing phone from waist height. Impact > 3.2g, stillness > 8s.',
  },
  mount_knock: {
    id: 'mount_knock',
    name: 'Mount knock',
    expected: false,
    expectedText: 'not_detected',
    description: 'Firm tap or knock on bike mount. Movement continues or < 3.2g. Must NOT trigger.',
  },
  normal_handling: {
    id: 'normal_handling',
    name: 'Normal handling',
    expected: false,
    expectedText: 'not_detected',
    description: 'Picking up phone, pocketing, turning. Normal motion < 2g. Must NOT trigger.',
  },
};

export const TRIAL_TYPE_KEYS = Object.keys(DROP_TRIAL_TYPES);

/**
 * Extracts phone model from userAgent if available, safe in any environment.
 */
export function getPhoneModel() {
  if (typeof navigator !== 'undefined') {
    const ua = navigator.userAgent || '';
    const match = ua.match(/\(([^)]+)\)/);
    if (match && match[1]) {
      const parts = match[1].split(';').map(s => s.trim());
      const model = parts.find(p => !p.startsWith('Linux') && !p.startsWith('Android') && !p.startsWith('wv'));
      if (model) return model;
    }
    return ua.slice(0, 80) || 'unknown';
  }
  return 'unknown';
}

/**
 * Evaluates a recorded motion trace with simulated riding speed:
 * 25 km/h before the impact event and 0 km/h after.
 *
 * @param {Array<object>} trace - Array of sensor readings { at, magnitudeG } or device motion events
 * @param {object} [options]
 * @param {number} [options.speedBeforeKmh=25] - Simulated riding speed before impact (default 25 km/h)
 * @param {number} [options.speedAfterKmh=0] - Simulated speed after impact (default 0 km/h)
 * @param {number} [options.impactG] - Custom impact threshold (default 3.2g)
 * @param {number} [options.stillnessMs] - Stillness duration in ms (default 8000ms)
 * @returns {{ detected: boolean, state: string, peakG: number, msToDetect: number|null, missingData?: boolean }}
 */
export function runDropTest(trace, options = {}) {
  if (!Array.isArray(trace) || trace.length === 0) {
    return {
      detected: false,
      state: 'idle',
      peakG: 0,
      msToDetect: null,
      missingData: true,
    };
  }

  // Normalize samples to { at: number, magnitudeG: number }
  const samples = [];
  const startTime = options.startTime || 0;

  for (let i = 0; i < trace.length; i++) {
    const item = trace[i];
    if (!item) continue;

    let g = null;
    if (typeof item.magnitudeG === 'number' && !isNaN(item.magnitudeG)) {
      g = item.magnitudeG;
    } else if (typeof item.g === 'number' && !isNaN(item.g)) {
      g = item.g;
    } else if (item.accelerationIncludingGravity) {
      g = magnitudeFromMotionEvent(item);
    } else if (typeof item.x === 'number' || typeof item.y === 'number' || typeof item.z === 'number') {
      const x = item.x || 0, y = item.y || 0, z = item.z || 0;
      g = Math.sqrt(x * x + y * y + z * z) / 9.81;
    }

    if (typeof g !== 'number' || isNaN(g)) continue;

    const at = typeof item.at === 'number' ? item.at
             : typeof item.timestamp === 'number' ? item.timestamp
             : startTime + i * 20;

    samples.push({ at, magnitudeG: g });
  }

  if (samples.length === 0) {
    return {
      detected: false,
      state: 'idle',
      peakG: 0,
      msToDetect: null,
      missingData: true,
    };
  }

  // Calculate peak acceleration
  let maxG = 0;
  for (const s of samples) {
    if (s.magnitudeG > maxG) maxG = s.magnitudeG;
  }
  const peakG = Math.round(maxG * 100) / 100;

  const speedBeforeKmh = options.speedBeforeKmh ?? 25;
  const speedAfterKmh = options.speedAfterKmh ?? 0;
  const impactThreshold = options.impactG ?? CRASH_DEFAULTS.impactG;

  const detector = createCrashDetector(options);

  let detected = false;
  let impactAt = null;
  let detectedAt = null;
  let stillForMs = null;

  detector.onChange((st, detail) => {
    if (st === 'suspected') {
      if (!impactAt) {
        impactAt = detail?.impact?.at ?? null;
      }
    } else if (st === 'crash') {
      detected = true;
      stillForMs = detail?.stillForMs ?? null;
    }
  });

  // Identify first impact sample where magnitude reaches impact threshold
  const eventIndex = samples.findIndex(s => s.magnitudeG >= impactThreshold);

  // Set initial simulated speed before event
  const firstAt = samples[0].at;
  detector.feedSpeed({ kmh: speedBeforeKmh, at: firstAt });

  let eventTriggered = false;

  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];

    if (eventIndex !== -1 && i === eventIndex && !eventTriggered) {
      // Refresh riding speed just prior to impact so lastRidingAt is fresh and speedBefore is recorded
      detector.feedSpeed({ kmh: speedBeforeKmh, at: s.at });
      // Feed impact motion
      detector.feedMotion({ magnitudeG: s.magnitudeG, at: s.at });
      if (!impactAt) impactAt = s.at;
      // Immediately after impact event, vehicle is stopped at standstill
      detector.feedSpeed({ kmh: speedAfterKmh, at: s.at });
      eventTriggered = true;
    } else {
      detector.feedMotion({ magnitudeG: s.magnitudeG, at: s.at });
    }

    if (detected && detectedAt === null) {
      detectedAt = s.at;
    }
  }

  const finalState = detector.getState();

  let msToDetect = null;
  if (detected) {
    if (impactAt != null && detectedAt != null) {
      msToDetect = detectedAt - impactAt;
    } else if (stillForMs != null) {
      msToDetect = stillForMs;
    } else {
      msToDetect = options.stillnessMs ?? CRASH_DEFAULTS.stillnessMs;
    }
  }

  return {
    detected,
    state: finalState,
    peakG,
    msToDetect,
  };
}

/** Alias for runDropTest */
export const evaluateDropTest = runDropTest;

/**
 * Checks whether a drop test result satisfies the expected outcome for a trial type.
 *
 * @param {string} trialType - Key from DROP_TRIAL_TYPES
 * @param {object} evalResult - Output from runDropTest
 * @returns {{ pass: boolean, expected: boolean, trialType: string, reason: string }}
 */
export function evaluateTrialResult(trialType, evalResult) {
  const trialDef = DROP_TRIAL_TYPES[trialType];
  const expected = trialDef?.expected ?? false;

  if (!evalResult || evalResult.missingData || evalResult.peakG === 0) {
    return {
      pass: false,
      expected,
      trialType,
      reason: 'missing_data',
    };
  }

  if (!trialDef) {
    return {
      pass: false,
      expected: false,
      trialType,
      reason: 'unknown_trial_type',
    };
  }

  const pass = evalResult.detected === expected;
  let reason = 'ok';
  if (!pass) {
    reason = expected ? 'expected_detection_but_missed' : 'false_alarm';
  }

  return {
    pass,
    expected,
    trialType,
    reason,
  };
}

/**
 * Computes running tallies per trial type and overall from proof runs.
 *
 * @param {Array<object>} runs - Array of proof run records ({ step, result, evidence })
 * @returns {object} Tally breakdown per trial type and summary totals
 */
export function computeDropTestTally(runs = []) {
  const byType = {};

  for (const typeKey of TRIAL_TYPE_KEYS) {
    const def = DROP_TRIAL_TYPES[typeKey];
    byType[typeKey] = {
      id: typeKey,
      name: def.name,
      expected: def.expected,
      total: 0,
      caught: 0,
      falseAlarms: 0,
      pass: 0,
      fail: 0,
    };
  }

  let totalTrials = 0;
  let stagedFallsTotal = 0;
  let stagedFallsCaught = 0;
  let nonCrashTrialsTotal = 0;
  let falseAlarmsTotal = 0;

  for (const run of runs) {
    if (!run || typeof run.step !== 'string') continue;
    if (!run.step.startsWith('drop_test:')) continue;

    const typeKey = run.step.slice('drop_test:'.length);
    const item = byType[typeKey];
    if (!item) continue;

    const evidence = run.evidence || {};
    const detected = Boolean(evidence.detected);
    const isPass = run.result === 'pass';

    item.total++;
    totalTrials++;

    if (detected) {
      item.caught++;
    }

    if (item.expected) {
      // Fall/drop trial: caught is good
      stagedFallsTotal++;
      if (detected) stagedFallsCaught++;
    } else {
      // Non-crash trial: detected is a false alarm
      nonCrashTrialsTotal++;
      if (detected) {
        item.falseAlarms++;
        falseAlarmsTotal++;
      }
    }

    if (isPass) {
      item.pass++;
    } else {
      item.fail++;
    }
  }

  // Calculate rates
  for (const typeKey of TRIAL_TYPE_KEYS) {
    const item = byType[typeKey];
    item.caughtRate = item.total > 0 ? Math.round((item.caught / item.total) * 100) / 100 : 0;
    item.falseAlarmRate = item.total > 0 ? Math.round((item.falseAlarms / item.total) * 100) / 100 : 0;
    item.passRate = item.total > 0 ? Math.round((item.pass / item.total) * 100) / 100 : 0;
  }

  return {
    byType,
    summary: {
      totalTrials,
      stagedFallsTotal,
      stagedFallsCaught,
      stagedFallsCaughtRate: stagedFallsTotal > 0 ? Math.round((stagedFallsCaught / stagedFallsTotal) * 100) / 100 : 0,
      nonCrashTrialsTotal,
      falseAlarmsTotal,
      falseAlarmRate: nonCrashTrialsTotal > 0 ? Math.round((falseAlarmsTotal / nonCrashTrialsTotal) * 100) / 100 : 0,
    },
  };
}

/**
 * Generates synthetic motion traces for test and validation scenarios.
 * Returns an array of { at, magnitudeG } spanning 15 seconds at 50Hz (750 samples).
 *
 * @param {'cushion_drop_1m'|'pocket_fall'|'bag_drop'|'mount_knock'|'normal_handling'|'impact_no_stillness'} type
 * @param {object} [options]
 * @returns {Array<{ at: number, magnitudeG: number }>}
 */
export function generateDropTrace(type, options = {}) {
  const samples = [];
  const startTime = options.startTime || 1000000;
  const durationMs = options.durationMs || 15000;
  const stepMs = 20; // 50 Hz

  for (let t = 0; t <= durationMs; t += stepMs) {
    const at = startTime + t;
    let g = 1.0; // 1g rest

    switch (type) {
      case 'cushion_drop_1m':
        if (t < 1000) {
          g = 1.0;
        } else if (t >= 1000 && t < 1200) {
          // Free-fall dip (< 0.35g for 200ms)
          g = 0.15;
        } else if (t >= 1200 && t <= 1260) {
          // Sharp impact peak
          g = 4.6;
        } else if (t > 1260 && t <= 1360) {
          // Rebound
          g = 1.4;
        } else {
          // Rest on cushion (stillness: deviation < 0.22 from 1g)
          g = 0.99;
        }
        break;

      case 'pocket_fall':
        if (t < 1500) {
          // Walking agitation
          g = 1.15;
        } else if (t >= 1500 && t < 1620) {
          // Slip / freefall dip
          g = 0.22;
        } else if (t >= 1620 && t <= 1680) {
          // Hard floor impact
          g = 5.2;
        } else {
          // Still on floor
          g = 1.0;
        }
        break;

      case 'bag_drop':
        if (t < 2000) {
          g = 1.0;
        } else if (t >= 2000 && t < 2140) {
          // Freefall
          g = 0.25;
        } else if (t >= 2140 && t <= 2220) {
          // Cushioned bag impact
          g = 3.9;
        } else {
          // Still on ground
          g = 1.01;
        }
        break;

      case 'mount_knock':
        if (t < 2000) {
          // Riding vibration
          g = 1.25;
        } else if (t >= 2000 && t <= 2060) {
          // Firm knock on phone mount
          g = 4.2;
        } else {
          // Motion continues right after knock (riding / vibration, deviation > 0.22)
          g = 1.35;
        }
        break;

      case 'normal_handling':
        // Gentle handling, pocketing, rotating (never > 2g, never < 0.35g for > 100ms)
        g = 1.0 + 0.3 * Math.sin(t / 400);
        break;

      case 'impact_no_stillness':
        if (t < 1000) {
          g = 1.0;
        } else if (t >= 1000 && t <= 1060) {
          // High impact
          g = 6.0;
        } else {
          // User continues moving / shaking vigorously (no stillness aftermath)
          g = 1.5 + 0.5 * Math.sin(t / 200);
        }
        break;

      default:
        g = 1.0;
    }

    samples.push({ at, magnitudeG: Math.round(g * 100) / 100 });
  }

  return samples;
}
