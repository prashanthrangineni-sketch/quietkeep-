package com.pranix.quietkeep;

import android.content.Context;
import android.speech.tts.TextToSpeech;
import android.util.Log;
import java.util.Locale;
import java.util.UUID;

/**
 * TTSManager — singleton native Android TTS.
 *
 * USAGE IN MAINACTIVITY:
 *   TTSManager.getInstance(this).speak("Keep saved");
 *
 * JS BRIDGE:
 *   window.__QK_TTS__("Keep saved")
 *   → evaluateJavascript calls TTSManager.getInstance().speak()
 *   via a @JavascriptInterface registered in MainActivity.
 */
public class TTSManager {

    private static final String TAG = "QK_TTS";
    private static TTSManager sInstance;

    private TextToSpeech mTts;
    private boolean      mReady = false;
    private String       mPendingText = null;
    private Context      mCtx;

    private TTSManager(Context ctx) {
        mCtx = ctx.getApplicationContext();
        init();
    }

    public static synchronized TTSManager getInstance(Context ctx) {
        if (sInstance == null) {
            sInstance = new TTSManager(ctx);
        }
        return sInstance;
    }

    private void init() {
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
                Log.d(TAG, "TTS initialised ✓");
                // Speak anything that was queued before init completed
                if (mPendingText != null) {
                    speakNow(mPendingText);
                    mPendingText = null;
                }
            } else {
                Log.e(TAG, "TTS init failed — status " + status);
            }
        });
    }

    /** Call from JS bridge or directly from Java. Thread-safe. */
    public void speak(String text) {
        if (text == null || text.trim().isEmpty()) return;
        if (!mReady) {
            // Queue until engine is ready
            mPendingText = text;
            return;
        }
        speakNow(text);
    }

    private void speakNow(String text) {
        try {
            // QUEUE_FLUSH stops any current utterance; QUEUE_ADD appends
            mTts.speak(text, TextToSpeech.QUEUE_FLUSH,
                       null, UUID.randomUUID().toString());
        } catch (Exception e) {
            Log.e(TAG, "speak() failed: " + e.getMessage());
        }
    }

    /** Call from MainActivity.onDestroy to free TTS engine resources. */
    public void shutdown() {
        if (mTts != null) {
            mTts.stop();
            mTts.shutdown();
            mTts = null;
            mReady = false;
        }
        sInstance = null;
    }
}
