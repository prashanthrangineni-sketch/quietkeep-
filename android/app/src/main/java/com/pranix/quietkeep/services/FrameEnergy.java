package com.pranix.quietkeep.services;

/**
 * FrameEnergy - turns microphone samples into a short-frame energy envelope.
 * (DRV-11b, hand-off from the Drive thread, 18 Oct 2026.)
 *
 * One number per 10 ms frame (160 samples at 16 kHz = 100 frames per second):
 * the frame's RMS level, scaled to 0..1. That is all that ever leaves the
 * native side for the indicator listener - never the samples themselves.
 *
 * Pure and stateful only in the obvious way: samples that do not fill a whole
 * frame are carried into the next call, so frame edges do not depend on how
 * the microphone happened to deliver its buffers. No Android imports, so the
 * JVM unit test (FrameEnergyTest) can run it directly.
 */
public final class FrameEnergy {

    public static final int SAMPLE_RATE = 16000;
    public static final int FRAME_SAMPLES = 160;          // 10 ms
    public static final int FRAMES_PER_SECOND = SAMPLE_RATE / FRAME_SAMPLES;

    private final int frameSamples;
    private double sumSq = 0;
    private int filled = 0;

    public FrameEnergy() { this(FRAME_SAMPLES); }

    public FrameEnergy(int frameSamples) {
        if (frameSamples <= 0) throw new IllegalArgumentException("frameSamples must be > 0");
        this.frameSamples = frameSamples;
    }

    /**
     * Feeds samples; returns the energies of every frame completed by them
     * (possibly none). The input array is only read, never kept.
     */
    public float[] push(short[] pcm, int offset, int length) {
        if (pcm == null || length <= 0) return new float[0];
        int completes = (filled + length) / frameSamples;
        float[] out = new float[completes];
        int k = 0;
        for (int i = offset; i < offset + length; i++) {
            double s = pcm[i] / 32768.0;
            sumSq += s * s;
            filled++;
            if (filled == frameSamples) {
                out[k++] = (float) Math.sqrt(sumSq / frameSamples);
                sumSq = 0;
                filled = 0;
            }
        }
        return out;
    }

    /** Forget any part-filled frame (call when listening stops or pauses). */
    public void reset() {
        sumSq = 0;
        filled = 0;
    }
}
