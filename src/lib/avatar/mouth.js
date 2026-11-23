// src/lib/avatar/mouth.js
// Mouth shapes from the reply audio itself. (AARIA 4.3)
//
// Aaria's voice is an <audio> element in the page (src/lib/tts.js). Listening
// to that sound - not to the text - is what makes the mouth work the same in
// Telugu, Hindi, English and mixed speech, with nothing sent anywhere.
//
// Output: { open, aa, ih, ou, ee, oh }, each 0..1. The five vowels are the VRM
// format's own mouth presets, so the 3D character needs no mapping table; the
// 2D face uses `open` and the widest vowel.
//
// The phone's system voice cannot be heard by the page, so for that path the
// mouth runs a plain open-close cycle between the real start and the end.

export const SILENT = Object.freeze({ open: 0, aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 });

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

/**
 * Turn one frame of frequency data into mouth shapes. Pure, so it is tested.
 * @param {Uint8Array|number[]} bins  getByteFrequencyData output (0..255)
 * @param {number} sampleRate         the AudioContext's sample rate
 */
export function shapesFromSpectrum(bins, sampleRate = 48000) {
  const n = bins ? bins.length : 0;
  if (!n) return { ...SILENT };
  const hzPerBin = sampleRate / 2 / n;
  const band = (lo, hi) => {
    const a = Math.max(0, Math.floor(lo / hzPerBin));
    const b = Math.min(n - 1, Math.ceil(hi / hzPerBin));
    if (b < a) return 0;
    let sum = 0;
    for (let i = a; i <= b; i++) sum += bins[i];
    return sum / (b - a + 1) / 255;
  };
  // Rough vowel regions: the first two resonances of the voice.
  const low = band(250, 700);      // "oh", "ou" live low
  const mid = band(700, 1500);     // "aa" is strong here
  const high = band(1800, 3200);   // "ee", "ih" push energy up here
  const voice = band(120, 3200);
  const open = clamp01((voice - 0.06) * 2.6);
  if (open <= 0.02) return { ...SILENT };
  const total = low + mid + high + 1e-6;
  const l = low / total, m = mid / total, h = high / total;
  return {
    open,
    aa: clamp01(open * (0.35 + m * 1.6)),
    oh: clamp01(open * l * 1.5),
    ou: clamp01(open * Math.max(0, l - m) * 2.2),
    ee: clamp01(open * h * 2.0),
    ih: clamp01(open * Math.max(0, h - l) * 1.6),
  };
}

/** Ease toward a target so the mouth does not flicker at 60 changes a second. */
export function smoothShapes(prev, next, attack = 0.55, release = 0.28) {
  const out = {};
  for (const k of Object.keys(SILENT)) {
    const p = prev?.[k] || 0, t = next?.[k] || 0;
    out[k] = p + (t - p) * (t > p ? attack : release);
  }
  return out;
}

/** The open-close cycle used when the sound cannot be heard by the page. */
export function cycleShapes(tMs) {
  const s = (Math.sin(tMs / 85) + Math.sin(tMs / 137 + 1.3)) / 2;   // irregular, not a metronome
  const open = clamp01(0.35 + s * 0.4);
  return { open, aa: open * 0.8, ih: 0, ou: 0, ee: 0, oh: open * 0.25 };
}

let _ctx = null;
const _sources = new WeakMap();   // one source per <audio>, ever (a browser rule)

/**
 * Listen to an <audio> element. Returns { read(), dispose() } or null when the
 * browser will not allow it - the caller then falls back to cycleShapes().
 * The sound still reaches the speaker: it is passed straight through.
 */
export async function attachMouth(audioEl) {
  if (typeof window === 'undefined' || !audioEl) return null;
  // 23 Nov 2026 (Thread 1 hot-fix, founder's phone): on the Android app, routing
  // Aaria's voice through Web Audio played it at the low "call" level even with
  // the volume at maximum. Her voice must never be quieter because the face is
  // on, so on the app the face uses its built-in talking motion (cycleShapes)
  // and the voice goes straight to the speaker.
  if (onAndroidApp()) return null;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  try {
    if (!_ctx) _ctx = new AC();
    if (_ctx.state !== 'running') { try { await _ctx.resume(); } catch { } }
    // Never route Aaria's voice through a context that is not running: that
    // would make the reply silent. No analyser is better than no voice.
    if (_ctx.state !== 'running') return null;
    let node = _sources.get(audioEl);
    if (!node) {
      const source = _ctx.createMediaElementSource(audioEl);
      const analyser = _ctx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.5;
      source.connect(analyser);
      analyser.connect(_ctx.destination);
      node = { analyser, bins: new Uint8Array(analyser.frequencyBinCount) };
      _sources.set(audioEl, node);
    }
    return {
      read() {
        node.analyser.getByteFrequencyData(node.bins);
        return shapesFromSpectrum(node.bins, _ctx.sampleRate);
      },
      dispose() { /* the source lives and dies with its <audio> element */ },
    };
  } catch {
    return null;
  }
}
