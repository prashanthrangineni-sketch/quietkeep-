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

    @JavascriptInterface
    public void speak(String text) {
        if (text == null || text.trim().isEmpty()) return;
        Log.d(TAG, "speak: " + text);
        TTSManager.getInstance(mCtx).speak(text);
    }
}
