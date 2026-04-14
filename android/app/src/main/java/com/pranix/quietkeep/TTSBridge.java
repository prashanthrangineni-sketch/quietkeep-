package com.pranix.quietkeep;

import android.webkit.JavascriptInterface;
import android.content.Context;
import android.util.Log;

/**
 * TTSBridge — registered with WebView via addJavascriptInterface().
 *
 * In JS:          window.AndroidTTS.speak("Keep saved")
 * Injected alias: window.__QK_TTS__ = function(t){window.AndroidTTS.speak(t);}
 *
 * Registration in MainActivity.applyWebViewBridge():
 *   webView.addJavascriptInterface(new TTSBridge(this), "AndroidTTS");
 */
public class TTSBridge {

    private static final String TAG = "QK_TTSBridge";
    private final Context mCtx;

    public TTSBridge(Context ctx) {
        mCtx = ctx.getApplicationContext();
    }

    /** High-priority speak — interrupts current speech (QUEUE_FLUSH). Default. */
    @JavascriptInterface
    public void speak(String text) {
        if (text == null || text.trim().isEmpty()) return;
        Log.d(TAG, "speak[high]: " + text);
        TTSManager.getInstance(mCtx).speak(text);
    }

    /**
     * Phase 4: Low-priority speak — appends after current speech (QUEUE_ADD).
     * Exposed as window.AndroidTTS.speakLow(text).
     * Injected alias in MainActivity.injectRuntimeJS():
     *   window.__QK_TTS_LOW__ = function(t) { window.AndroidTTS.speakLow(t); }
     */
    @JavascriptInterface
    public void speakLow(String text) {
        if (text == null || text.trim().isEmpty()) return;
        Log.d(TAG, "speak[low]: " + text);
        TTSManager.getInstance(mCtx).speakQueued(text);
    }

    /**
     * Phase 4: Stop current speech immediately.
     * Exposed as window.AndroidTTS.stop().
     * Called by cancelSpeech() in VoiceTalkback.jsx.
     */
    @JavascriptInterface
    public void stop() {
        Log.d(TAG, "stop");
        TTSManager.getInstance(mCtx).stop();
    }

    /**
     * Phase 7: Set TTS language at runtime.
     * Called from dashboard useEffect when voiceLang changes.
     * Supported BCP-47 codes: "en-IN", "te-IN", "hi-IN", "en-US".
     * Silently ignored if TTS engine not ready — language is re-applied on next init.
     *
     * JS: window.AndroidTTS.setLanguage("te-IN")
     */
    @JavascriptInterface
    public void setLanguage(String bcp47) {
        if (bcp47 == null || bcp47.trim().isEmpty()) return;
        Log.d(TAG, "setLanguage: " + bcp47);
        TTSManager.getInstance(mCtx).setLanguage(bcp47.trim());
    }
}
