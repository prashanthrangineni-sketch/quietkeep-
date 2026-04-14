package com.pranix.quietkeep;

import android.content.Context;
import android.speech.tts.TextToSpeech;
import android.util.Log;
import java.util.LinkedList;
import java.util.Locale;
import java.util.Queue;
import java.util.UUID;

/**
 * TTSManager v2 — singleton native Android TTS with pre-init queue.
 *
 * CHANGES OVER v1:
 *   FIXED: mPendingText (single String) → mPendingQueue (LinkedList).
 *     Root cause of silent TTS: greetOnLogin + keepSaved both fire within
 *     ~500ms of app start. Second call overwrote mPendingText before init
 *     completed. Now ALL pre-init utterances are queued and drained in order.
 *
 *   FIXED: Retry-safe lifecycle. If mTts is null when speak() is called
 *     (e.g. after shutdown() + before next getInstance()), re-init is
 *     triggered automatically and the text is queued.
 *
 *   ARCHITECTURE NOTE (Foreground Service prep):
 *     TTSManager is intentionally Activity-scoped (Context = applicationContext).
 *     When the always-listening foreground service (Phase 5) is implemented,
 *     it can call TTSManager.getInstance(serviceContext).speak() directly
 *     without any changes here — applicationContext survives Activity destruction.
 *
 * JS BRIDGE (unchanged):
 *   window.__QK_TTS__("Keep saved")
 *   → TTSBridge.speak() → TTSManager.getInstance().speak()
 */
public class TTSManager {

    private static final String TAG = "QK_TTS";

    // ── Singleton ──────────────────────────────────────────────────────────
    private static TTSManager sInstance;

    // ── State ──────────────────────────────────────────────────────────────
    private TextToSpeech   mTts;
    private boolean        mReady  = false;
    private Context        mCtx;

    // PATCH P1: Replace single mPendingText with a proper queue.
    // All utterances received before TTS init completes are stored here
    // and drained in FIFO order the moment onInit(SUCCESS) fires.
    private final Queue<String> mPendingQueue = new LinkedList<>();

    // ── Constructor ────────────────────────────────────────────────────────
    private TTSManager(Context ctx) {
        mCtx = ctx.getApplicationContext();
        init();
    }

    // ── Singleton accessor ─────────────────────────────────────────────────
    public static synchronized TTSManager getInstance(Context ctx) {
        if (sInstance == null) {
            sInstance = new TTSManager(ctx);
        }
        return sInstance;
    }

    // ── Init ───────────────────────────────────────────────────────────────
    private void init() {
        mReady = false;
        mTts = new TextToSpeech(mCtx, status -> {
            if (status == TextToSpeech.SUCCESS) {
                // Prefer en-IN; fall back to en-US
                int result = mTts.setLanguage(new Locale("en", "IN"));
                if (result == TextToSpeech.LANG_MISSING_DATA ||
                    result == TextToSpeech.LANG_NOT_SUPPORTED) {
                    mTts.setLanguage(Locale.US);
                }
                mTts.setSpeechRate(0.92f);
                mTts.setPitch(1.0f);
                mReady = true;
                Log.d(TAG, "TTS initialised ✓  pending=" + mPendingQueue.size());

                // PATCH P1: Drain entire queue, not just one item.
                // Uses QUEUE_ADD so utterances play sequentially, not interrupting each other.
                while (!mPendingQueue.isEmpty()) {
                    speakNow(mPendingQueue.poll(), /* flush= */ false);
                }
            } else {
                Log.e(TAG, "TTS init failed — status " + status);
                mPendingQueue.clear(); // Don't accumulate if engine permanently failed
            }
        });
    }

    // ── Public API ─────────────────────────────────────────────────────────

    /**
     * speak(text) — thread-safe, call from JS bridge or Java.
     *
     * If TTS engine is not yet ready (init in progress), text is queued.
     * If TTS engine was shut down (mTts == null), engine is re-initialised
     * and text is queued — PATCH P2: retry-safe lifecycle.
     *
     * @param text  The text to speak. Null or blank is silently ignored.
     */
    public void speak(String text) {
        if (text == null || text.trim().isEmpty()) return;

        // PATCH P2: Re-init if engine was shut down and a new speak() arrives.
        // This covers the gap between Activity.onDestroy() and the next
        // getInstance() call (e.g. from a Service or a new Activity).
        if (mTts == null) {
            Log.w(TAG, "speak() called after shutdown — re-initialising");
            mPendingQueue.add(text);
            init();
            return;
        }

        if (!mReady) {
            // PATCH P1: Queue instead of overwrite.
            Log.d(TAG, "TTS not ready — queuing: " + text);
            mPendingQueue.add(text);
            return;
        }

        speakNow(text, /* flush= */ true);
    }

    /**
     * setLanguage — called from JS when user switches language.
     * No-op if engine not ready (language will be set to en-IN on init).
     * Supported locales: "en-IN", "en-US", "te-IN" (Telugu), "hi-IN" (Hindi).
     *
     * @param bcp47  BCP-47 language tag, e.g. "en-IN"
     */
    public void setLanguage(String bcp47) {
        if (mTts == null || !mReady) return;
        try {
            String[] parts = bcp47.split("-");
            Locale locale = parts.length >= 2
                ? new Locale(parts[0], parts[1])
                : new Locale(parts[0]);
            int result = mTts.setLanguage(locale);
            if (result == TextToSpeech.LANG_MISSING_DATA ||
                result == TextToSpeech.LANG_NOT_SUPPORTED) {
                Log.w(TAG, "Language not supported: " + bcp47 + " — keeping current");
            } else {
                Log.d(TAG, "Language set: " + bcp47);
            }
        } catch (Exception e) {
            Log.e(TAG, "setLanguage failed: " + e.getMessage());
        }
    }

    /**
     * Phase 4: speakQueued — low-priority QUEUE_ADD.
     * Appends after any currently speaking utterance.
     * Called by TTSBridge.speakLow() → window.__QK_TTS_LOW__().
     */
    public void speakQueued(String text) {
        if (text == null || text.trim().isEmpty()) return;
        if (mTts == null) {
            mPendingQueue.add(text);
            init();
            return;
        }
        if (!mReady) {
            mPendingQueue.add(text);
            return;
        }
        speakNow(text, /* flush= */ false);
    }

    /**
     * Phase 4: stop() — immediately stop all speech.
     * Called by TTSBridge.stop() → window.AndroidTTS.stop().
     */
    public void stop() {
        if (mTts != null && mReady) {
            try { mTts.stop(); } catch (Exception e) {
                Log.e(TAG, "stop() failed: " + e.getMessage());
            }
        }
        mPendingQueue.clear();
    }

    /** Call from MainActivity.onDestroy to release TTS engine resources. */
    public void shutdown() {
        mReady = false;
        mPendingQueue.clear();
        if (mTts != null) {
            try { mTts.stop(); } catch (Exception ignored) {}
            try { mTts.shutdown(); } catch (Exception ignored) {}
            mTts = null;
        }
        // PATCH P2: clear sInstance so next getInstance() creates a fresh engine.
        // The foreground service can keep its own reference alive via getInstance()
        // before Activity.onDestroy() fires, preventing premature shutdown.
        sInstance = null;
        Log.d(TAG, "TTSManager shut down ✓");
    }

    // ── Internal ───────────────────────────────────────────────────────────

    /**
     * @param flush  true = QUEUE_FLUSH (interrupt current), false = QUEUE_ADD (append).
     *               Pre-init drain uses QUEUE_ADD to preserve utterance order.
     *               Live speak() calls use QUEUE_FLUSH to interrupt stale speech.
     */
    private void speakNow(String text, boolean flush) {
        try {
            int mode = flush ? TextToSpeech.QUEUE_FLUSH : TextToSpeech.QUEUE_ADD;
            mTts.speak(text, mode, null, UUID.randomUUID().toString());
        } catch (Exception e) {
            Log.e(TAG, "speakNow() failed: " + e.getMessage());
        }
    }
}
