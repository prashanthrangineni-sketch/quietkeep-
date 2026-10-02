package com.pranix.aariaedge;

import android.content.Context;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.util.Log;

import java.io.InputStream;
import java.util.List;

import ai.onnxruntime.OrtEnvironment;
import ai.onnxruntime.OrtSession;

public class AariaEdge {
    private static final String TAG = "AariaEdge";
    
    private final Context context;
    private final EventListener listener;
    private AudioRecord audioRecord;
    private Thread recordingThread;
    private volatile boolean isRecording = false;
    private volatile boolean isPaused = false;

    private OrtEnvironment env;
    private OrtSession session;

    public interface EventListener {
        void onSpeechStart(long t);
        void onSpeechEnd(long t, long durationMs, short[] audioData);
        void onLevel(double rms);
    }

    public AariaEdge(Context context, EventListener listener) {
        this.context = context;
        this.listener = listener;
        try {
            env = OrtEnvironment.getEnvironment();
            byte[] modelBytes = loadModel("silero_vad.onnx");
            session = env.createSession(modelBytes, new OrtSession.SessionOptions());
        } catch (Exception e) {
            Log.e(TAG, "Failed to load ONNX model", e);
        }
    }

    private byte[] loadModel(String filename) throws Exception {
        try (InputStream is = context.getAssets().open(filename)) {
            byte[] buffer = new byte[is.available()];
            is.read(buffer);
            return buffer;
        }
    }

    public void start(int sampleRate, int minSpeechMs, int minSilenceMs) throws Exception {
        if (isRecording) {
            return;
        }

        int bufferSize = AudioRecord.getMinBufferSize(sampleRate, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
        
        audioRecord = new AudioRecord(MediaRecorder.AudioSource.MIC, sampleRate, 
                AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, bufferSize * 2);

        if (audioRecord.getState() != AudioRecord.STATE_INITIALIZED) {
            throw new Exception("AudioRecord initialization failed");
        }

        isRecording = true;
        audioRecord.startRecording();

        recordingThread = new Thread(() -> recordLoop(sampleRate, minSpeechMs, minSilenceMs));
        recordingThread.start();
    }

    public void stop() {
        isRecording = false;
        if (audioRecord != null) {
            audioRecord.stop();
            audioRecord.release();
            audioRecord = null;
        }
        if (recordingThread != null) {
            try {
                recordingThread.join();
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
            recordingThread = null;
        }
    }

    public void pause() {
        isPaused = true;
    }

    public void resume() {
        isPaused = false;
    }

    private void recordLoop(int sampleRate, int minSpeechMs, int minSilenceMs) {
        // We use 512 sample reads for VAD windowing (32 ms at 16 kHz)
        int readSize = 512;
        short[] buffer = new short[readSize];

        VadProcessor processor = new VadProcessor(env, session, sampleRate, minSpeechMs, minSilenceMs);
        long lastLevelTime = 0;
        
        int preRollSize = (int)(sampleRate * 0.3);
        short[] preRollBuffer = new short[preRollSize];
        int preRollHead = 0;
        int preRollCount = 0;

        short[] speechBuffer = new short[sampleRate * 5];
        int speechLength = 0;
        boolean inSpeech = false;
        
        try {
            while (isRecording) {
                int read = audioRecord.read(buffer, 0, readSize);
                if (read > 0) {
                    if (isPaused) {
                        if (inSpeech) {
                            inSpeech = false;
                            speechLength = 0;
                            preRollCount = 0;
                            preRollHead = 0;
                        }
                        processor.reset();
                        continue;
                    }
                    
                    long now = System.currentTimeMillis();
                    long startMs = now - (long)((read / (double)sampleRate) * 1000);
                    
                    // calculate RMS level
                    double sumSq = 0;
                    for (int i = 0; i < read; i++) {
                        sumSq += buffer[i] * buffer[i];
                    }
                    double rms = Math.sqrt(sumSq / read);
                    
                    if (now - lastLevelTime >= 100) { // max 10/s
                        listener.onLevel(rms);
                        lastLevelTime = now;
                    }
                    
                    short[] chunk = buffer;
                    if (read < readSize) {
                        chunk = new short[read];
                        System.arraycopy(buffer, 0, chunk, 0, read);
                    }

                    List<VadProcessor.Event> events = processor.process(chunk, startMs);
                    for (VadProcessor.Event ev : events) {
                        if (ev.type == VadProcessor.EventType.SPEECH_START) {
                            inSpeech = true;
                            speechLength = 0;
                            if (speechBuffer.length < preRollCount + readSize) {
                                speechBuffer = new short[Math.max(preRollCount * 2, sampleRate * 5)];
                            }
                            int startIdx = preRollCount == preRollSize ? preRollHead : 0;
                            for (int i = 0; i < preRollCount; i++) {
                                speechBuffer[speechLength++] = preRollBuffer[(startIdx + i) % preRollSize];
                            }
                            listener.onSpeechStart(ev.t);
                        } else if (ev.type == VadProcessor.EventType.SPEECH_END) {
                            inSpeech = false;
                            short[] audioData = new short[speechLength];
                            System.arraycopy(speechBuffer, 0, audioData, 0, speechLength);
                            listener.onSpeechEnd(ev.t, ev.durationMs, audioData);
                            speechLength = 0;
                            preRollCount = 0;
                            preRollHead = 0;
                        }
                    }

                    if (inSpeech) {
                        if (speechLength + read > speechBuffer.length) {
                            short[] newBuf = new short[Math.max(speechBuffer.length * 2, speechLength + read)];
                            System.arraycopy(speechBuffer, 0, newBuf, 0, speechLength);
                            speechBuffer = newBuf;
                        }
                        System.arraycopy(chunk, 0, speechBuffer, speechLength, read);
                        speechLength += read;
                    } else {
                        for (int i = 0; i < read; i++) {
                            preRollBuffer[preRollHead] = chunk[i];
                            preRollHead = (preRollHead + 1) % preRollSize;
                            if (preRollCount < preRollSize) preRollCount++;
                        }
                    }
                }
            }
        } catch (Exception e) {
            Log.e(TAG, "Recording loop error", e);
        }
    }
}
