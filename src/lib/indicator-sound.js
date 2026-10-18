// src/lib/indicator-sound.js
// TASK CARD DRV-11: Indicator audio energy envelope detector.
// Pure signal logic on arrays of numbers (energy envelopes), NO browser or mic APIs.
//
// Automotive and motorcycle indicators flash at 60–120 per minute (1.0–2.0 Hz)
// with sharp click onsets (relay/clicker in cars) or periodic beepers (bikes).
//
// Input: array of short-frame energy values at a known frame rate (e.g. 100 frames/s).
// Output: { on: boolean, rateHz: number, confidence: number }
//
// LIMITATIONS & REAL-WORLD CAVEATS:
// 1. Loud cabin music or high air-conditioning blower fan settings can elevate ambient
//    acoustic noise floor above the amplitude of subtle mechanical clickers.
// 2. Modern electric vehicles (EVs) or luxury vehicles often feature quiet synthetic
//    chimes routed through stereo speakers rather than mechanical relays.
// 3. Phone placement (e.g. deep inside a backpack or heavy coat pocket) significantly
//    attenuates acoustic transients.
// 4. This detector is designed as an optional opt-in helper; it never overrides motion-based
//    safety rules.

export const SOUND_CONSTANTS = {
  DEFAULT_FRAME_RATE: 100,          // 100 frames/sec (10 ms per frame)
  WINDOW_DURATION_S: 4.0,           // 4-second observation window
  MIN_INDICATOR_HZ: 0.95,           // 60 flashes/min = 1.0 Hz (with slight tolerance)
  MAX_INDICATOR_HZ: 2.05,           // 120 flashes/min = 2.0 Hz (with slight tolerance)
  MAX_JITTER_CV: 0.15,              // Maximum coefficient of variation of inter-onset intervals
  MIN_ONSET_COUNT: 3,               // At least 3 onsets needed to establish periodic intervals
  REFRACTORY_PERIOD_S: 0.18,        // Minimum time between valid onsets (180 ms)
  MAX_CLICK_DURATION_S: 0.18,       // Clicks/beeps are brief transients; speech syllables are longer
  BASELINE_WINDOW_FRAMES: 30,       // 300 ms moving baseline window
};

/**
 * Detects whether an indicator is ticking/beeping from an array of energy envelope samples.
 *
 * @param {Array<number>} energies array of non-negative energy numbers
 * @param {object} [opts]
 * @param {number} [opts.frameRate] sampling rate of the envelope (default 100 fps)
 * @returns {{ on: boolean, rateHz: number, confidence: number }}
 */
export function detectIndicatorSound(energies, {
  frameRate = SOUND_CONSTANTS.DEFAULT_FRAME_RATE,
} = {}) {
  const resultOff = { on: false, rateHz: 0, confidence: 0 };

  if (!Array.isArray(energies) || energies.length < frameRate * 2) {
    return resultOff;
  }

  const n = energies.length;
  const refractoryFrames = Math.max(1, Math.round(SOUND_CONSTANTS.REFRACTORY_PERIOD_S * frameRate));
  const maxClickFrames = Math.max(1, Math.round(SOUND_CONSTANTS.MAX_CLICK_DURATION_S * frameRate));
  const baselineWin = SOUND_CONSTANTS.BASELINE_WINDOW_FRAMES;

  // ── Step 1: Adaptive baseline and onset extraction ────────────────────────
  // Calculate dynamic baseline and look for sharp jumps
  let rollingSum = 0;
  for (let i = 0; i < Math.min(baselineWin, n); i++) {
    rollingSum += energies[i];
  }

  const onsets = []; // indices of detected sharp transient onsets
  let lastOnsetIdx = -refractoryFrames;

  for (let i = baselineWin; i < n; i++) {
    rollingSum += energies[i] - energies[i - baselineWin];
    const baseline = rollingSum / baselineWin;

    const current = energies[i];
    const prev = energies[i - 1];
    const jump = current - prev;
    const excess = current - baseline;

    // Detect sudden energy jump above baseline
    // Needs a clear upward step and significant excess above rolling average
    if (jump > 0.05 && excess > 0.1 && current > baseline * 1.3) {
      // Local peak check within ±2 frames
      const isLocalPeak = (
        (i + 1 >= n || current >= energies[i + 1]) &&
        (i + 2 >= n || current >= energies[i + 2])
      );

      if (isLocalPeak && (i - lastOnsetIdx >= refractoryFrames)) {
        // Measure transient duration: check how quickly energy drops back towards baseline
        let durationFrames = 0;
        const halfLevel = baseline + (current - baseline) * 0.4;
        for (let k = i + 1; k < Math.min(i + maxClickFrames * 2, n); k++) {
          if (energies[k] > halfLevel) {
            durationFrames++;
          } else {
            break;
          }
        }

        // If energy stays elevated for longer than a click/beep, it's speech or a continuous sound
        if (durationFrames <= maxClickFrames) {
          onsets.push(i);
          lastOnsetIdx = i;
        }
      }
    }
  }

  // If fewer than 3 onsets in the window, no periodicity can be established
  // (Rejects single pothole thuds, steady hums, isolated sounds)
  if (onsets.length < SOUND_CONSTANTS.MIN_ONSET_COUNT) {
    return resultOff;
  }

  // ── Step 2: Calculate inter-onset intervals (IOIs) ────────────────────────
  const onsetTimes = onsets.map((idx) => idx / frameRate);
  const intervals = [];
  for (let j = 0; j < onsetTimes.length - 1; j++) {
    intervals.push(onsetTimes[j + 1] - onsetTimes[j]);
  }

  function statsOf(arr) {
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    const variance = arr.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / arr.length;
    const stdDev = Math.sqrt(variance);
    const cv = mean > 0 ? stdDev / mean : 1.0;
    return { mean, stdDev, cv, rateHz: mean > 0 ? 1 / mean : 0 };
  }

  let stats = statsOf(intervals);

  // Check for tick-tock cadence (alternating short/long intervals that sum to 1.0–2.0 Hz)
  if (stats.cv > SOUND_CONSTANTS.MAX_JITTER_CV && onsetTimes.length >= 5) {
    const pairIntervals = [];
    for (let j = 0; j < onsetTimes.length - 2; j += 2) {
      pairIntervals.push(onsetTimes[j + 2] - onsetTimes[j]);
    }
    if (pairIntervals.length >= 2) {
      const pairStats = statsOf(pairIntervals);
      if (pairStats.cv < stats.cv) {
        stats = pairStats;
      }
    }
  }

  // ── Step 3: Periodicity, Rate, and Jitter Validation ─────────────────────
  const { rateHz, cv } = stats;

  // Rate must fall strictly within 1.0 to 2.0 Hz range (with slight edge margin)
  if (rateHz < SOUND_CONSTANTS.MIN_INDICATOR_HZ || rateHz > SOUND_CONSTANTS.MAX_INDICATOR_HZ) {
    return {
      on: false,
      rateHz: Math.round(rateHz * 100) / 100,
      confidence: 0,
    };
  }

  // Jitter check: must have low coefficient of variation
  // Rejects speech-like irregular energy bursts and irregular music rhythms
  if (cv > SOUND_CONSTANTS.MAX_JITTER_CV) {
    return {
      on: false,
      rateHz: Math.round(rateHz * 100) / 100,
      confidence: Math.max(0, Math.round((1 - cv) * 100) / 100),
    };
  }

  // High confidence when jitter is very low and enough onsets are present
  const confidence = Math.max(0, Math.min(1, 1 - (cv / SOUND_CONSTANTS.MAX_JITTER_CV) * 0.5));
  const isOn = confidence >= 0.6;

  return {
    on: isOn,
    rateHz: Math.round(rateHz * 100) / 100,
    confidence: Math.round(confidence * 100) / 100,
  };
}

/**
 * Creates a streaming indicator sound tracker that maintains a rolling 4s buffer.
 *
 * @param {object} [opts]
 * @param {number} [opts.frameRate] frames per second (default 100)
 * @param {number} [opts.windowSec] buffer duration in seconds (default 4)
 */
export function createIndicatorSoundTracker({
  frameRate = SOUND_CONSTANTS.DEFAULT_FRAME_RATE,
  windowSec = SOUND_CONSTANTS.WINDOW_DURATION_S,
} = {}) {
  const maxCapacity = Math.round(frameRate * windowSec);
  const buffer = [];

  function feed(energy) {
    buffer.push(Number(energy) || 0);
    if (buffer.length > maxCapacity) {
      buffer.shift();
    }
  }

  function feedBatch(energies) {
    if (!Array.isArray(energies)) return;
    for (let i = 0; i < energies.length; i++) {
      feed(energies[i]);
    }
  }

  function status() {
    return detectIndicatorSound(buffer, { frameRate });
  }

  function reset() {
    buffer.length = 0;
  }

  return {
    feed,
    feedBatch,
    status,
    reset,
  };
}
