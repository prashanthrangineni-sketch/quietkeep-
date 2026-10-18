// tests/indicator-sound.test.mjs
// Unit tests for indicator-sound: synthetic click trains, frequency rejection,
// speech rejection, steady hum, single thud, and streaming cessation within 4s.

import {
  SOUND_CONSTANTS,
  detectIndicatorSound,
  createIndicatorSoundTracker,
} from '../src/lib/indicator-sound.js';

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

function approxEq(name, got, want, tol = 0.15) {
  const ok = Math.abs(got - want) <= tol;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} (got ${got}, want ${want})`);
  if (!ok) {
    fail++;
  } else {
    pass++;
  }
}

// ── Synthetic Signal Helpers ─────────────────────────────────────────────────
const FRAME_RATE = 100; // 100 frames/sec = 10ms per frame

/**
 * Generate a synthetic signal of durationSec with background noise and optional click train.
 */
function generateSignal({
  durationSec = 4.0,
  rateHz = null,
  baseline = 0.1,
  noiseAmp = 0.02,
  clickAmp = 1.0,
  jitterSec = 0.005, // small natural physical jitter
  clickDecayFrames = 3, // ~30ms click transient
} = {}) {
  const numFrames = Math.round(durationSec * FRAME_RATE);
  const signal = new Float64Array(numFrames);

  // Background baseline + noise
  for (let i = 0; i < numFrames; i++) {
    // Deterministic pseudo-noise using sine combination
    const n = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
    const pseudoRandom = n - Math.floor(n);
    signal[i] = baseline + (pseudoRandom - 0.5) * noiseAmp;
  }

  // Add click train if rateHz is specified
  if (rateHz && rateHz > 0) {
    const periodSec = 1 / rateHz;
    let t = 0.2; // initial offset
    let clickIdx = 0;
    while (t < durationSec - 0.1) {
      // Deterministic slight jitter
      const jitter = ((Math.sin(clickIdx * 45.1) + 1) / 2 - 0.5) * jitterSec;
      const actualTime = t + jitter;
      const frameIdx = Math.round(actualTime * FRAME_RATE);

      // Inject transient click pulse
      for (let k = 0; k < clickDecayFrames + 2; k++) {
        const targetFrame = frameIdx + k;
        if (targetFrame < numFrames) {
          const decay = Math.exp(-k * 0.9);
          signal[targetFrame] += clickAmp * decay;
        }
      }

      t += periodSec;
      clickIdx++;
    }
  }

  return Array.from(signal);
}

// ── 1. Constants ─────────────────────────────────────────────────────────────
eq('SOUND_CONSTANTS.DEFAULT_FRAME_RATE is 100', SOUND_CONSTANTS.DEFAULT_FRAME_RATE, 100);
eq('SOUND_CONSTANTS.WINDOW_DURATION_S is 4.0', SOUND_CONSTANTS.WINDOW_DURATION_S, 4.0);
eq('SOUND_CONSTANTS.MIN_INDICATOR_HZ is 0.95', SOUND_CONSTANTS.MIN_INDICATOR_HZ, 0.95);
eq('SOUND_CONSTANTS.MAX_INDICATOR_HZ is 2.05', SOUND_CONSTANTS.MAX_INDICATOR_HZ, 2.05);

// ── 2. Synthetic click trains at 1.0, 1.5, 2.0 Hz with noise -> ON ───────────
{
  // 1.0 Hz (standard car flash rate: 60/min)
  const sig10 = generateSignal({ rateHz: 1.0 });
  const res10 = detectIndicatorSound(sig10, { frameRate: FRAME_RATE });
  eq('1.0 Hz click train with noise -> on is true', res10.on, true);
  approxEq('1.0 Hz click train rateHz is ~1.0', res10.rateHz, 1.0);
  eq('1.0 Hz click train confidence >= 0.7', res10.confidence >= 0.7, true);
}

{
  // 1.5 Hz (typical bike/car flash rate: 90/min)
  const sig15 = generateSignal({ rateHz: 1.5 });
  const res15 = detectIndicatorSound(sig15, { frameRate: FRAME_RATE });
  eq('1.5 Hz click train with noise -> on is true', res15.on, true);
  approxEq('1.5 Hz click train rateHz is ~1.5', res15.rateHz, 1.5);
  eq('1.5 Hz click train confidence >= 0.7', res15.confidence >= 0.7, true);
}

{
  // 2.0 Hz (upper legal limit: 120/min)
  const sig20 = generateSignal({ rateHz: 2.0 });
  const res20 = detectIndicatorSound(sig20, { frameRate: FRAME_RATE });
  eq('2.0 Hz click train with noise -> on is true', res20.on, true);
  approxEq('2.0 Hz click train rateHz is ~2.0', res20.rateHz, 2.0);
  eq('2.0 Hz click train confidence >= 0.7', res20.confidence >= 0.7, true);
}

// ── 3. Frequency rejection: 0.5 Hz and 3.0 Hz -> OFF ─────────────────────────
{
  // 0.5 Hz (too slow for indicator, interval = 2.0s)
  const sig05 = generateSignal({ rateHz: 0.5 });
  const res05 = detectIndicatorSound(sig05, { frameRate: FRAME_RATE });
  eq('0.5 Hz clicks (too slow) -> on is false', res05.on, false);
}

{
  // 3.0 Hz (too fast for indicator, interval = 0.333s)
  const sig30 = generateSignal({ rateHz: 3.0 });
  const res30 = detectIndicatorSound(sig30, { frameRate: FRAME_RATE });
  eq('3.0 Hz clicks (too fast) -> on is false', res30.on, false);
}

// ── 4. Speech-like irregular energy -> OFF ────────────────────────────────────
{
  // Speech exhibits irregular bursts of varying syllable durations (150-350ms)
  // and irregular inter-burst intervals with high timing jitter.
  const numFrames = 400; // 4s
  const speechSig = new Float64Array(numFrames).fill(0.08);

  const burstStarts = [30, 85, 120, 210, 290, 340];
  const burstLengths = [25, 30, 20, 35, 25, 20]; // 200–350ms durations

  for (let b = 0; b < burstStarts.length; b++) {
    const start = burstStarts[b];
    const len = burstLengths[b];
    for (let k = 0; k < len; k++) {
      if (start + k < numFrames) {
        speechSig[start + k] += 0.8 * Math.sin((k / len) * Math.PI);
      }
    }
  }

  const resSpeech = detectIndicatorSound(Array.from(speechSig), { frameRate: FRAME_RATE });
  eq('speech-like irregular energy bursts -> on is false', resSpeech.on, false);
}

// ── 5. Steady engine hum -> OFF ──────────────────────────────────────────────
{
  // Engine hum: constant energy level around 0.35 with low vibration ripple
  const hum = Array.from({ length: 400 }, (_, i) => 0.35 + 0.02 * Math.sin(i * 0.4));
  const resHum = detectIndicatorSound(hum, { frameRate: FRAME_RATE });
  eq('steady engine hum -> on is false', resHum.on, false);
  eq('steady engine hum -> confidence is 0', resHum.confidence, 0);
}

// ── 6. Single pothole thud -> OFF ────────────────────────────────────────────
{
  // Pothole: one single large transient spike at t=1.5s (frame 150), baseline elsewhere
  const thud = Array.from({ length: 400 }, () => 0.08);
  // Spike at frame 150
  thud[150] = 2.5;
  thud[151] = 1.8;
  thud[152] = 0.9;
  thud[153] = 0.3;

  const resThud = detectIndicatorSound(thud, { frameRate: FRAME_RATE });
  eq('single pothole thud -> on is false', resThud.on, false);
  eq('single pothole thud -> confidence is 0', resThud.confidence, 0);
}

// ── 7. Streaming tracker: Ticking that stops -> OFF within 4 s ───────────────
{
  const tracker = createIndicatorSoundTracker({ frameRate: FRAME_RATE, windowSec: 4.0 });

  // Phase 1: Feed 4 seconds of 1.5 Hz ticking
  const ticking4s = generateSignal({ durationSec: 4.0, rateHz: 1.5 });
  tracker.feedBatch(ticking4s);

  const initialStatus = tracker.status();
  eq('streaming tracker: 4s of 1.5 Hz ticking -> on is true', initialStatus.on, true);
  approxEq('streaming tracker: detected rate is ~1.5 Hz', initialStatus.rateHz, 1.5);

  // Phase 2: Indicator turned off! Feed 4 seconds of ambient road/engine hum
  const hum4s = Array.from({ length: 400 }, (_, i) => 0.15 + 0.01 * Math.sin(i * 0.5));
  tracker.feedBatch(hum4s);

  // Buffer now holds only the silent hum; status must be off
  const stoppedStatus = tracker.status();
  eq('streaming tracker: ticking stopped -> off within 4 s', stoppedStatus.on, false);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
