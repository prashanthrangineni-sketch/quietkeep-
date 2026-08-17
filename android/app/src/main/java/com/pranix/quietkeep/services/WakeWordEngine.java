package com.pranix.quietkeep.services;

import android.util.Log;

/**
 * WakeWordEngine.java — Phase 9A
 *
 * Ultra-lightweight offline wake word detection for "Lotus".
 * Runs inside VoiceService capture thread on every non-silent PCM chunk.
 */
public class WakeWordEngine {

    private static final String TAG = "QK_WAKE";

    /** Configurable trigger phrase reference (defaults to "Aaria", swappable via settings) */
    private volatile String targetWakeWord = "Aaria";

    public WakeWordEngine() {
        Log.w(TAG, "Wake word engine initialization warning: aaria_wakeword.tflite is a text placeholder. Wake word detection is unavailable.");
    }

    public String getTargetWakeWord() {
        return targetWakeWord;
    }

    public void setTargetWakeWord(String wakeWord) {
        if (wakeWord != null && !wakeWord.trim().isEmpty()) {
            this.targetWakeWord = wakeWord.trim();
            Log.d(TAG, "Target wake word updated to: " + this.targetWakeWord);
        }
    }

    // ── Tuning constants ──────────────────────────────────────────────────

    private static final int SAMPLE_RATE = 16000;
    private static final double FRAME_ENERGY_THRESHOLD = 150.0;
    private static final int FRAME_SAMPLES = 160; // 10ms
    private static final int MIN_SYLLABLE_GAP_FRAMES = 8;
    private static final int MIN_WORD_FRAMES = 10;    // ~100ms
    private static final int MAX_WORD_FRAMES = 90;    // ~900ms
    private static final int TARGET_SYLLABLES = 2;
    private static final double DETECTION_THRESHOLD = 0.60;
    private static final long COOLDOWN_MS = 2000L;

    private volatile long lastDetectionTime = 0;
    private volatile int batteryPct = 100;

    private double getEffectiveEnergyThreshold() {
        if (batteryPct < 15) return FRAME_ENERGY_THRESHOLD * 2.0;
        if (batteryPct < 30) return FRAME_ENERGY_THRESHOLD * 1.5;
        return FRAME_ENERGY_THRESHOLD;
    }

    public void setBatteryPct(int pct) {
        this.batteryPct = Math.max(0, Math.min(100, pct));
    }

    public boolean detectWakeWord(byte[] pcmBytes) {
        // Always return false: wake word engine is disabled due to placeholder model
        return false;
    }

    public void resetCooldown() {
        lastDetectionTime = 0;
    }

    // ── Internal detection logic (Retained but not called) ───────────────────

    private double computeDetectionScore(short[] samples) {
        int totalFrames = samples.length / FRAME_SAMPLES;
        if (totalFrames < MIN_WORD_FRAMES) return 0.0;

        double[] frameEnergy = new double[totalFrames];
        for (int f = 0; f < totalFrames; f++) {
            frameEnergy[f] = computeFrameEnergy(samples, f * FRAME_SAMPLES, FRAME_SAMPLES);
        }

        boolean[] voiced = new boolean[totalFrames];
        for (int f = 0; f < totalFrames; f++) {
            voiced[f] = frameEnergy[f] > FRAME_ENERGY_THRESHOLD;
        }

        int syllableCount = countSyllablePeaks(frameEnergy, voiced, totalFrames);
        double spectralScore = computeSpectralTiltScore(samples, voiced, totalFrames);
        int wordDuration = longestVoicedRunFrames(voiced, totalFrames);
        double durationScore = scoreDuration(wordDuration);

        double syllableScore = 0.0;
        if (syllableCount == TARGET_SYLLABLES) {
            syllableScore = 1.0;
        } else if (Math.abs(syllableCount - TARGET_SYLLABLES) == 1) {
            syllableScore = 0.5;
        }

        double combined = (syllableScore * 0.5)
                        + (spectralScore  * 0.3)
                        + (durationScore  * 0.2);

        Log.d(TAG, String.format(
            "score=%.2f [syl=%d/%.1f spec=%.2f dur=%d/%.1f]",
            combined, syllableCount, syllableScore,
            spectralScore, wordDuration, durationScore
        ));

        return combined;
    }

    private double computeFrameEnergy(short[] samples, int offset, int length) {
        long sum = 0;
        int end = Math.min(offset + length, samples.length);
        for (int i = offset; i < end; i++) {
            sum += (long) samples[i] * samples[i];
        }
        int count = end - offset;
        return count > 0 ? Math.sqrt((double) sum / count) : 0.0;
    }

    private int countSyllablePeaks(double[] energy, boolean[] voiced, int totalFrames) {
        int peaks = 0;
        int lastPeak = -MIN_SYLLABLE_GAP_FRAMES;

        for (int f = 1; f < totalFrames - 1; f++) {
            if (!voiced[f]) continue;
            if (energy[f] > energy[f - 1] && energy[f] >= energy[f + 1]) {
                if (f - lastPeak >= MIN_SYLLABLE_GAP_FRAMES) {
                    peaks++;
                    lastPeak = f;
                    if (peaks > TARGET_SYLLABLES + 1) return peaks;
                }
            }
        }
        return peaks;
    }

    private double computeSpectralTiltScore(short[] samples, boolean[] voiced, int totalFrames) {
        long lowSum = 0, highSum = 0;
        for (int f = 0; f < totalFrames && f < samples.length / FRAME_SAMPLES; f++) {
            if (!voiced[f]) continue;
            int start = f * FRAME_SAMPLES;
            int end   = Math.min(start + FRAME_SAMPLES, samples.length);
            for (int i = start; i < end - 1; i += 2) {
                long e = (long) samples[i] * samples[i];
                if ((i / FRAME_SAMPLES) % 2 == 0) lowSum += e; else highSum += e;
            }
        }
        long total = lowSum + highSum;
        if (total == 0) return 0.5;
        double tilt = (double) lowSum / total;
        return Math.max(0.0, Math.min(1.0, (tilt - 0.4) / 0.3));
    }

    private int longestVoicedRunFrames(boolean[] voiced, int totalFrames) {
        int max = 0, cur = 0;
        for (int f = 0; f < totalFrames; f++) {
            cur = voiced[f] ? cur + 1 : 0;
            max = Math.max(max, cur);
        }
        return max;
    }

    private double scoreDuration(int frames) {
        if (frames < MIN_WORD_FRAMES || frames > MAX_WORD_FRAMES) return 0.0;
        int target = 45;
        int delta  = Math.abs(frames - target);
        return Math.max(0.0, 1.0 - (double) delta / target);
    }

    private static short[] bytesToShorts(byte[] bytes) {
        int len = bytes.length / 2;
        short[] shorts = new short[len];
        for (int i = 0; i < len; i++) {
            shorts[i] = (short) ((bytes[i * 2 + 1] << 8) | (bytes[i * 2] & 0xFF));
        }
        return shorts;
    }
}
