package com.pranix.aariaedge;

import android.content.Context;

import com.k2fsa.sherpa.onnx.SileroVadModelConfig;
import com.k2fsa.sherpa.onnx.Vad;
import com.k2fsa.sherpa.onnx.VadModelConfig;

/**
 * The speech-detector model (assets/silero_vad.onnx), run by the same native library as the recogniser.
 *
 * Each window of sound is handed to sherpa-onnx's detector, which is then asked one question: "is this
 * speech right now?". The answer comes back as 1 or 0. How long speech must last, and how much silence
 * ends it, is still decided by {@link VadProcessor}, exactly as before; sherpa-onnx's own timers are set
 * to zero so they add nothing. See VadProcessor for why this class exists.
 *
 * Measured on 3 Oct 2026 against the previous scorer on 150 recorded sentences: the same start and end
 * events for every one; speech is noticed about 64 ms later (two windows), which the 0.3 s of sound the
 * plugin keeps from before the start covers.
 *
 * (sherpa-onnx also offers Vad.compute(), the model's raw answer. It is not used: fed the 512-sample
 * window it returned almost zero for clear speech on a simulated phone, and how it wants its input is
 * not documented.)
 */
public class SherpaVadScorer implements VadProcessor.WindowScorer {

    private final Vad vad;

    /** Throws (often a LinkageError) when the speech engine is not packed into the app. */
    public SherpaVadScorer(Context context) {
        SileroVadModelConfig silero = new SileroVadModelConfig();
        silero.setModel("silero_vad.onnx");
        silero.setThreshold(0.5f);          // sherpa-onnx ends speech at threshold - 0.15, the same 0.35 VadProcessor uses
        silero.setMinSilenceDuration(0f);   // VadProcessor does the timing
        silero.setMinSpeechDuration(0f);
        silero.setWindowSize(512);
        silero.setMaxSpeechDuration(20f);

        VadModelConfig config = new VadModelConfig();
        config.setSileroVadModelConfig(silero);
        config.setSampleRate(16000);
        config.setNumThreads(1);
        config.setProvider("cpu");

        vad = new Vad(context.getAssets(), config);
    }

    @Override
    public float score(float[] window512) {
        vad.acceptWaveform(window512);
        // sherpa-onnx also collects finished pieces of speech; nobody reads them here, so drop them.
        while (!vad.empty()) {
            vad.pop();
        }
        return vad.isSpeechDetected() ? 1.0f : 0.0f;
    }

    @Override
    public void reset() {
        vad.reset();
    }

    public void release() {
        vad.release();
    }
}
