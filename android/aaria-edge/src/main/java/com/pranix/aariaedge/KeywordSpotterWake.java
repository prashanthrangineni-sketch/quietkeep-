package com.pranix.aariaedge;

import android.content.Context;

import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.security.MessageDigest;

/**
 * The second listener: a small keyword-spotting model (sherpa-onnx's English zipformer, see MODELS.md) that
 * listens only for the name "Aaria". It is switched off by default ("secondListener" setting) and is made
 * only when that setting is on at the moment listening starts. When it is off, this class is never created.
 *
 * Before the native engine is given the model, every model file is read and its SHA-256 compared with the one
 * recorded in MODELS.md. A missing or damaged file is caught here, logged, and kept as {@link #problem()}; the
 * spotter then hears nothing and the existing wake check carries on alone.
 *
 * score() and release() never run at the same time, so "Turn off" cannot free the engine while it is in use.
 *
 * Accuracy, false wakes and battery use of this listener are not measured.
 */
public class KeywordSpotterWake implements WakeWordDetector {

    /** Folder inside the app's assets. Filled by the downloadKeywordSpotter Gradle task. */
    public static final String DIR = "kws";
    public static final String KEYWORDS = "keywords.txt";
    /** Every model file the engine needs, with its SHA-256 as recorded in MODELS.md. */
    static final String[][] MODEL_FILES = {
        {"encoder-epoch-12-avg-2-chunk-16-left-64.int8.onnx", "1e721676515bcd42a186979733981213c66c80db680e1cc582dfedf3be76e678"},
        {"decoder-epoch-12-avg-2-chunk-16-left-64.onnx", "f61ebd3eed3773a44d088d53dfae92dbb6aec4839f4dcaee2d402414741663a3"},
        {"joiner-epoch-12-avg-2-chunk-16-left-64.int8.onnx", "eae9da0c7e1e6c6a3f4cc42d167899c388f6c6701b94cb96320e4f55df79624c"},
        {"tokens.txt", "fd2ded4050a55d2b1578870ba8697d02371980217806b7558bd0a5cc60f3ba53"},
    };

    /** Opens a file of the model by its path inside the assets, for example "kws/tokens.txt". */
    public interface Files {
        InputStream open(String path) throws IOException;
    }

    /** The native engine. heard() is given one piece of speech, 16 kHz, samples between -1 and 1. */
    public interface Engine {
        boolean heard(float[] samples16k);
        void release();
    }

    public interface EngineMaker {
        Engine make() throws Throwable;
    }

    /** Where problems go. On a phone: the Android log. */
    public interface Log {
        void problem(String message, Throwable cause);
    }

    static Log log = (message, cause) -> {
        try { android.util.Log.w("AariaEdge", message, cause); } catch (Throwable ignored) {}
    };

    /** Makes one for the phone, reading the model from the app's assets. Nothing is loaded until load(). */
    public static KeywordSpotterWake forPhone(Context context) {
        final android.content.res.AssetManager assets = context.getAssets();
        return new KeywordSpotterWake(assets::open, () -> new SherpaKeywordEngine(assets));
    }

    private final Files files;
    private final EngineMaker maker;
    private final String[][] modelFiles;
    private final Object lock = new Object();
    private Engine engine;
    private volatile String problem;

    public KeywordSpotterWake(Files files, EngineMaker maker) {
        this(files, maker, MODEL_FILES);
    }

    /** For tests: the files to check, each {name, SHA-256}. */
    KeywordSpotterWake(Files files, EngineMaker maker, String[][] modelFiles) {
        this.files = files;
        this.maker = maker;
        this.modelFiles = modelFiles;
    }

    /** modelDir is not used: the model is read from the app's assets (folder {@link #DIR}). */
    @Override
    public void load(File modelDir) {
        synchronized (lock) {
            if (engine != null) return;
            problem = null;
            try {
                for (String[] f : modelFiles) checkFile(f[0], f[1]);
                checkFile(KEYWORDS, null);
                Engine made = maker.make();
                if (made == null) throw new IllegalStateException("the keyword engine did not start");
                engine = made;
            } catch (Throwable t) {
                engine = null;
                problem = "Second listener not loaded: " + describe(t);
                log.problem(problem, t);
            }
        }
    }

    private void checkFile(String name, String expectedSha256) throws Exception {
        String path = DIR + "/" + name;
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        long size = 0;
        try (InputStream is = files.open(path)) {
            if (is == null) throw new IOException(path + " is missing");
            byte[] buffer = new byte[8192];
            int read;
            while ((read = is.read(buffer)) > 0) {
                digest.update(buffer, 0, read);
                size += read;
            }
        } catch (IOException e) {
            throw new IOException(path + " is missing or cannot be read", e);
        }
        if (size == 0) throw new IOException(path + " is empty");
        if (expectedSha256 == null) return;
        StringBuilder hex = new StringBuilder();
        for (byte b : digest.digest()) hex.append(String.format("%02x", b));
        if (!expectedSha256.equalsIgnoreCase(hex.toString())) {
            throw new IOException(path + " is damaged (SHA-256 " + hex + ", expected " + expectedSha256 + ")");
        }
    }

    private static String describe(Throwable t) {
        return t.getMessage() != null ? t.getMessage() : t.getClass().getSimpleName();
    }

    @Override
    public float score(short[] frame16k) {
        synchronized (lock) {
            if (engine == null || frame16k == null || frame16k.length == 0) return 0.0f;
            float[] samples = new float[frame16k.length];
            for (int i = 0; i < frame16k.length; i++) samples[i] = frame16k[i] / 32768.0f;
            try {
                return engine.heard(samples) ? 1.0f : 0.0f;
            } catch (Throwable t) {
                problem = "Second listener failed while listening: " + describe(t);
                log.problem(problem, t);
                return 0.0f;
            }
        }
    }

    @Override
    public String id() {
        return "keyword_spotter";
    }

    /** Frees the engine and its memory. Waits for a score() that is under way. Safe to call more than once. */
    public void release() {
        synchronized (lock) {
            if (engine == null) return;
            try {
                engine.release();
            } catch (Throwable t) {
                log.problem("Second listener did not release cleanly", t);
            } finally {
                engine = null;
            }
        }
    }

    public boolean isLoaded() {
        synchronized (lock) {
            return engine != null;
        }
    }

    /** Why the spotter is not listening, or null when it loaded and has had no problem. */
    public String problem() {
        return problem;
    }
}
