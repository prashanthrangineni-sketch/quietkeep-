package com.pranix.aariaedge;

import java.nio.FloatBuffer;
import java.nio.LongBuffer;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import ai.onnxruntime.OnnxTensor;
import ai.onnxruntime.OrtEnvironment;
import ai.onnxruntime.OrtSession;

public class VadProcessor {

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

    private OrtEnvironment env;
    private OrtSession session;
    private int sampleRate;
    private int minSpeechMs;
    private int minSilenceMs;

    private float[][][] state = new float[2][1][128];
    private float[] contextBuffer = new float[64];
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

    public VadProcessor(OrtEnvironment env, OrtSession session, int sampleRate, int minSpeechMs, int minSilenceMs) {
        this.env = env;
        this.session = session;
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
                    float prob = runModel();
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

                // Prepare next window: the last 64 samples become the context
                System.arraycopy(windowBuffer, 512 - 64, contextBuffer, 0, 64);
                windowPos = 0;
            }
        }
        return events;
    }

    public void reset() {
        state = new float[2][1][128];
        contextBuffer = new float[64];
        windowPos = 0;
        isSpeechActive = false;
        speechStartTime = 0;
        lastSpeechTime = 0;
    }

    private float runModel() throws Exception {
        int inputLength = 64 + 512; // context + window
        float[] modelInput = new float[inputLength];
        
        System.arraycopy(contextBuffer, 0, modelInput, 0, 64);
        System.arraycopy(windowBuffer, 0, modelInput, 64, 512);

        long[] inputShape = {1, inputLength};
        long[] stateShape = {2, 1, 128};
        long[] srShape = {1};

        FloatBuffer inputBuffer = FloatBuffer.wrap(modelInput);
        FloatBuffer stateBuffer = FloatBuffer.allocate(256);
        for (int i = 0; i < 2; i++) {
            stateBuffer.put(state[i][0]);
        }
        stateBuffer.rewind();

        try (
            OnnxTensor inputTensor = OnnxTensor.createTensor(env, inputBuffer, inputShape);
            OnnxTensor stateTensor = OnnxTensor.createTensor(env, stateBuffer, stateShape);
            OnnxTensor srTensor = OnnxTensor.createTensor(env, LongBuffer.wrap(new long[]{sampleRate}), srShape)
        ) {
            Map<String, OnnxTensor> inputs = Map.of(
                "input", inputTensor,
                "state", stateTensor,
                "sr", srTensor
            );

            try (OrtSession.Result result = session.run(inputs)) {
                float[][] out = (float[][]) result.get(0).getValue();
                float[][][] stateOut = (float[][][]) result.get(1).getValue();

                // Update state
                for (int i = 0; i < 2; i++) {
                    System.arraycopy(stateOut[i][0], 0, state[i][0], 0, 128);
                }

                return out[0][0];
            }
        }
    }
}
