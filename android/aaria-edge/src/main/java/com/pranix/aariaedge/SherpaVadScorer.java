package com.pranix.aariaedge;

import android.content.Context;

import com.k2fsa.sherpa.onnx.SileroVadModelConfig;
import com.k2fsa.sherpa.onnx.Vad;
import com.k2fsa.sherpa.onnx.VadModelConfig;

/**
 * The speech-detector model (assets/silero_vad.onnx), run by the same native library as the recogniser.
 *
 * Only the model's own answer per window is used ({@code Vad.compute}); when speech starts and ends is
 * still decided by {@link VadProcessor}, exactly as before. See VadProcessor for why this exists.
 */
public class SherpaVadScorer implements VadProcessor.WindowScorer {

    private final Vad vad;

    /** Throws (often a LinkageError) when the speech engine is not packed into the app. */
    public SherpaVadScorer(Context context) {
        SileroVadModelConfig silero = new SileroVadModelConfig();
        silero.setModel("silero_vad.onnx");
        silero.setWindowSize(512);

        VadModelConfig config = new VadModelConfig();
        config.setSileroVadModelConfig(silero);
        config.setSampleRate(16000);
        config.setNumThreads(1);
        config.setProvider("cpu");

        vad = new Vad(context.getAssets(), config);
    }

    @Override
    public float score(float[] window512) {
        return vad.compute(window512);
    }

    @Override
    public void reset() {
        vad.reset();
    }

    public void release() {
        vad.release();
    }
}
