package com.pranix.aariaedge;

import java.util.ArrayList;
import java.util.List;

/**
 * Turns a stream of sound into "speech started" and "speech ended" events.
 *
 * It asks a {@link WindowScorer} how likely each 32 ms window is speech and applies the start and end
 * thresholds and the minimum speech and silence lengths. It does not know which library does the scoring.
 *
 * WHY THE SCORER IS SEPARATE (3 Oct 2026)
 * This class used to run the speech-detector model itself through the onnxruntime Java library, while
 * the recogniser (sherpa-onnx) ran on its own, newer copy of the same native library. On a phone only
 * one file named libonnxruntime.so can be packed, and the two halves refuse each other's copy
 * ("cannot locate symbol OrtGetApiBase"). The first test on a simulated phone found it. On the phone the
 * scorer is now {@link SherpaVadScorer}, which uses the recogniser's own library, so one copy serves both.
 */
public class VadProcessor {

    /** Says how likely it is (0 to 1) that one window of sound is speech. Remembers what came before. */
    public interface WindowScorer {
        /**
         * @param window512 exactly 512 samples at 16 kHz, each between -1 and 1. Read it, do not keep it.
         */
        float score(float[] window512) throws Exception;

        /** Forget everything heard so far. */
        void reset();
    }

    public enum EventType {
        SPEECH_START,
        SPEECH_END
    }

    public static class Event {
        public EventType type;
        public long t;
        public long durationMs;

        public Event(EventType type, long t, long durationMs) {
            this.type = type;
            this.t = t;
            this.durationMs = durationMs;
        }
    }

    private final WindowScorer scorer;
    private int sampleRate;
    private int minSpeechMs;
    private int minSilenceMs;

    private float[] windowBuffer = new float[512]; // Current window buffer
    private int windowPos = 0;

    private boolean isSpeechActive = false;
    private long speechStartTime = 0;
    private long lastSpeechTime = 0;
    
    // Configurable thresholds for hysteresis
    private float startThreshold = 0.5f;
    private float endThreshold = 0.35f;

    // Track for tests
    public float maxProbability = 0f;

    public VadProcessor(WindowScorer scorer, int sampleRate, int minSpeechMs, int minSilenceMs) {
        this.scorer = scorer;
        this.sampleRate = sampleRate;
        this.minSpeechMs = minSpeechMs;
        this.minSilenceMs = minSilenceMs;
    }

    public List<Event> process(short[] pcm16k, long startMs) {
        List<Event> events = new ArrayList<>();
        
        long samplesPerMs = sampleRate / 1000;

        for (int i = 0; i < pcm16k.length; i++) {
            windowBuffer[windowPos++] = pcm16k[i] / 32768.0f;

            if (windowPos == 512) {
                // Process the 512-sample window
                long currentMs = startMs + (i / samplesPerMs);
                try {
                    float prob = scorer.score(windowBuffer);
                    if (prob > maxProbability) {
                        maxProbability = prob;
                    }

                    if (prob > startThreshold) {
                        lastSpeechTime = currentMs;
                        if (!isSpeechActive) {
                            isSpeechActive = true;
                            speechStartTime = currentMs;
                            events.add(new Event(EventType.SPEECH_START, speechStartTime, 0));
                        }
                    } else if (prob < endThreshold) {
                        if (isSpeechActive && (currentMs - lastSpeechTime > minSilenceMs)) {
                            isSpeechActive = false;
                            long duration = lastSpeechTime - speechStartTime;
                            if (duration >= minSpeechMs) {
                                events.add(new Event(EventType.SPEECH_END, currentMs, duration));
                            }
                        }
                    }
                } catch (Exception e) {
                    e.printStackTrace();
                }

                windowPos = 0;
            }
        }
        return events;
    }

    public void reset() {
        if (scorer != null) scorer.reset();
        windowPos = 0;
        isSpeechActive = false;
        speechStartTime = 0;
        lastSpeechTime = 0;
    }
}
