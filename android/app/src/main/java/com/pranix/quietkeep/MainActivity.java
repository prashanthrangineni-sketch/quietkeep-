package com.pranix.quietkeep;

import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.view.View;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import androidx.core.content.ContextCompat;
import com.getcapacitor.BridgeActivity;
import com.pranix.quietkeep.plugins.PerceptionPlugin;
import com.pranix.quietkeep.plugins.ReminderAlarmPlugin;
import com.pranix.quietkeep.plugins.VoicePlugin;
import com.pranix.quietkeep.services.KeepAliveService;

/**
 * MainActivity v6
 *
 * v6 changes over v5:
 *   ADDED: TTSBridge registration via addJavascriptInterface("AndroidTTS").
 *     Exposes window.AndroidTTS.speak(text) to the WebView.
 *   ADDED: window.__QK_TTS__ alias injected in injectRuntimeJS() so all JS
 *     code can call window.__QK_TTS__("text") without knowing the bridge name.
 *   ADDED: TTSManager initialised eagerly in onCreate() so first-speak latency
 *     is minimised (TTS engine init takes ~300-600ms on first call).
 *   ADDED: TTSManager.shutdown() in onDestroy() to release TTS engine resources.
 *
 * v5 retained: fetch interceptor, __QK_APP_TYPE__, WebChromeClient audio bridge,
 *   file chooser, KeepAliveService Hans-freeze prevention.
 */
public class MainActivity extends BridgeActivity {

    private static final String TAG = "QK_MAIN";
    private static final int FILE_CHOOSER_REQUEST_CODE = 1001;
    private android.webkit.ValueCallback<android.net.Uri[]> mFilePathCallback;

    // Server URL baked in at build time — always the production API host.
    private static final String SERVER_URL = "https://quietkeep.com";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Must run BEFORE super.onCreate() — prevents OplusHansManager (ColorOS) from
        // freezing the UID during the Capacitor WebView cold-start window.
        startKeepAliveService();

        super.onCreate(savedInstanceState);

        registerPlugin(PerceptionPlugin.class);
        registerPlugin(VoicePlugin.class);
        registerPlugin(ReminderAlarmPlugin.class);

        // v6: Eagerly initialise TTS engine so it is ready by first speak call
        TTSManager.getInstance(this);

        // Apply WebView bridge after super.onCreate() so getBridge() is available.
        applyWebViewBridge();
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        // v6: Release TTS engine when Activity is destroyed
        TTSManager.getInstance(this).shutdown();
    }

    // ── WebView audio bridge + runtime injection ──────────────────────────

    private void applyWebViewBridge() {
        try {
            if (getBridge() == null) {
                Log.w(TAG, "applyWebViewBridge: bridge null — skipping");
                return;
            }
            WebView webView = getBridge().getWebView();
            if (webView == null) {
                Log.w(TAG, "applyWebViewBridge: WebView null — skipping");
                return;
            }

            // ── Confirm WebSettings ────────────────────────────────────────
            WebSettings ws = webView.getSettings();
            ws.setDomStorageEnabled(true);
            ws.setDatabaseEnabled(true);
            ws.setMediaPlaybackRequiresUserGesture(false);
            Log.d(TAG, "WebSettings: domStorage=true, database=true, mediaGesture=false");

            webView.setLayerType(View.LAYER_TYPE_HARDWARE, null);

            // v6: Register TTSBridge so JS can call window.AndroidTTS.speak(text)
            // Must be done BEFORE the page loads — addJavascriptInterface is safe
            // to call here because we're before the first page navigation.
            webView.addJavascriptInterface(new TTSBridge(this), "AndroidTTS");
            Log.d(TAG, "TTSBridge registered as 'AndroidTTS' ✓");

            // ── Inject runtime constants + fetch rewrite ────────────────────
            android.webkit.WebViewClient existingClient = webView.getWebViewClient();

            webView.setWebViewClient(new android.webkit.WebViewClient() {

                @Override
                public boolean shouldOverrideUrlLoading(
                        android.webkit.WebView view,
                        android.webkit.WebResourceRequest request) {
                    if (existingClient != null) {
                        return existingClient.shouldOverrideUrlLoading(view, request);
                    }
                    return super.shouldOverrideUrlLoading(view, request);
                }

                @Override
                public void onPageStarted(
                        android.webkit.WebView view,
                        String url,
                        android.graphics.Bitmap favicon) {
                    if (existingClient != null) {
                        existingClient.onPageStarted(view, url, favicon);
                    } else {
                        super.onPageStarted(view, url, favicon);
                    }
                }

                @Override
                public void onPageFinished(android.webkit.WebView view, String url) {
                    if (existingClient != null) {
                        existingClient.onPageFinished(view, url);
                    } else {
                        super.onPageFinished(view, url);
                    }
                    injectRuntimeJS(view);
                }

                @Override
                public void onReceivedError(
                        android.webkit.WebView view,
                        android.webkit.WebResourceRequest request,
                        android.webkit.WebResourceError error) {
                    if (existingClient != null) {
                        existingClient.onReceivedError(view, request, error);
                    } else {
                        super.onReceivedError(view, request, error);
                    }
                }

                @Override
                public android.webkit.WebResourceResponse shouldInterceptRequest(
                        android.webkit.WebView view,
                        android.webkit.WebResourceRequest request) {
                    if (existingClient != null) {
                        return existingClient.shouldInterceptRequest(view, request);
                    }
                    return super.shouldInterceptRequest(view, request);
                }
            });

            // ── Wrap, not replace, the existing WebChromeClient ────────────
            final WebChromeClient existing = webView.getWebChromeClient();

            webView.setWebChromeClient(new WebChromeClient() {

                @Override
                public void onPermissionRequest(PermissionRequest request) {
                    boolean needsAudio = false;
                    for (String res : request.getResources()) {
                        if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(res)) {
                            needsAudio = true;
                            break;
                        }
                    }

                    if (needsAudio) {
                        boolean osGranted = ContextCompat.checkSelfPermission(
                            MainActivity.this,
                            android.Manifest.permission.RECORD_AUDIO
                        ) == PackageManager.PERMISSION_GRANTED;

                        if (osGranted) {
                            Log.d(TAG, "onPermissionRequest: RECORD_AUDIO granted → granting WebView");
                            request.grant(request.getResources());
                        } else {
                            Log.w(TAG, "onPermissionRequest: RECORD_AUDIO not granted → denying WebView");
                            request.deny();
                        }
                        return;
                    }

                    if (existing != null) {
                        existing.onPermissionRequest(request);
                    } else {
                        super.onPermissionRequest(request);
                    }
                }

                @Override
                public void onPermissionRequestCanceled(PermissionRequest request) {
                    if (existing != null) {
                        existing.onPermissionRequestCanceled(request);
                    } else {
                        super.onPermissionRequestCanceled(request);
                    }
                }

                @Override
                public boolean onShowFileChooser(
                        android.webkit.WebView view,
                        android.webkit.ValueCallback<android.net.Uri[]> filePathCallback,
                        FileChooserParams fileChooserParams) {
                    if (existing != null) {
                        boolean handled = existing.onShowFileChooser(view, filePathCallback, fileChooserParams);
                        if (handled) return true;
                    }
                    try {
                        if (mFilePathCallback != null) {
                            mFilePathCallback.onReceiveValue(null);
                        }
                        mFilePathCallback = filePathCallback;

                        android.content.Intent takePictureIntent = new android.content.Intent(
                                android.provider.MediaStore.ACTION_IMAGE_CAPTURE);

                        android.content.Intent galleryIntent = new android.content.Intent(
                                android.content.Intent.ACTION_GET_CONTENT);
                        galleryIntent.addCategory(android.content.Intent.CATEGORY_OPENABLE);
                        galleryIntent.setType("image/*");

                        android.content.Intent chooserIntent = new android.content.Intent(
                                android.content.Intent.ACTION_CHOOSER);
                        chooserIntent.putExtra(android.content.Intent.EXTRA_INTENT, takePictureIntent);
                        chooserIntent.putExtra(android.content.Intent.EXTRA_TITLE, "Take Photo or Choose");
                        chooserIntent.putExtra(android.content.Intent.EXTRA_INITIAL_INTENTS,
                                new android.content.Intent[]{galleryIntent});

                        startActivityForResult(chooserIntent, FILE_CHOOSER_REQUEST_CODE);
                        return true;
                    } catch (Exception e) {
                        Log.e(TAG, "onShowFileChooser failed: " + e.getMessage());
                        if (mFilePathCallback != null) {
                            mFilePathCallback.onReceiveValue(null);
                            mFilePathCallback = null;
                        }
                        return false;
                    }
                }
            });

            Log.d(TAG, "applyWebViewBridge: WebChromeClient + WebViewClient wrappers installed ✓");

        } catch (Exception e) {
            Log.e(TAG, "applyWebViewBridge: setup failed (non-fatal): " + e.getMessage());
        }
    }

    /**
     * v6: Inject runtime JS constants + __QK_TTS__ alias.
     *
     * __QK_TTS__(text) → window.AndroidTTS.speak(text) → TTSBridge → TTSManager
     *
     * The alias lets all JS code call window.__QK_TTS__("text") without
     * caring about the JavascriptInterface name. The fallback to
     * speechSynthesis is handled in VoiceTalkback.jsx speak() function.
     */
    private void injectRuntimeJS(android.webkit.WebView view) {
        String appType = getPackageName().contains(".business") ? "business" : "personal";

        String js = "javascript:(function() {\n"
            + "  if (window.__QK_PATCHED__) return;\n"
            + "  window.__QK_PATCHED__ = true;\n"
            + "\n"
            + "  // 1. Runtime constants\n"
            + "  window.__QK_SERVER_URL__ = '" + SERVER_URL + "';\n"
            + "  window.__QK_APP_TYPE__   = '" + appType + "';\n"
            + "\n"
            + "  // 2. Native TTS alias — __QK_TTS__(text) calls TTSBridge.speak()\n"
            + "  //    AndroidTTS is registered via addJavascriptInterface in applyWebViewBridge().\n"
            + "  //    VoiceTalkback.jsx checks window.__QK_TTS__ before falling back\n"
            + "  //    to browser speechSynthesis.\n"
            + "  if (window.AndroidTTS && typeof window.AndroidTTS.speak === 'function') {\n"
            + "    window.__QK_TTS__ = function(text) {\n"
            + "      try { window.AndroidTTS.speak(String(text || '')); } catch(e) {}\n"
            + "    };\n"
            + "    console.log('[QK] __QK_TTS__ native bridge active');\n"
            + "  } else {\n"
            + "    console.log('[QK] AndroidTTS not available — TTS will use speechSynthesis');\n"
            + "  }\n"
            + "\n"
            + "  // 3. Fetch interceptor: rewrite relative /api/ → production server\n"
            + "  var _origFetch = window.fetch;\n"
            + "  window.fetch = function(input, init) {\n"
            + "    var url = (typeof input === 'string') ? input\n"
            + "            : (input instanceof URL)    ? input.href\n"
            + "            : (input && input.url)      ? input.url\n"
            + "            : null;\n"
            + "    if (url && url.startsWith('/api/')) {\n"
            + "      var rewritten = '" + SERVER_URL + "' + url;\n"
            + "      if (typeof input === 'string') {\n"
            + "        return _origFetch.call(this, rewritten, init);\n"
            + "      } else if (input instanceof Request) {\n"
            + "        return _origFetch.call(this, new Request(rewritten, input), init);\n"
            + "      }\n"
            + "    }\n"
            + "    return _origFetch.apply(this, arguments);\n"
            + "  };\n"
            + "\n"
            + "  console.log('[QK] Runtime injected: APP_TYPE=" + appType + " SERVER=" + SERVER_URL + "');\n"
            + "})();";

        view.evaluateJavascript(js, null);
        Log.d(TAG, "injectRuntimeJS: APP_TYPE=" + appType + " SERVER=" + SERVER_URL);
    }

    // ── KeepAliveService ──────────────────────────────────────────────────

    private void startKeepAliveService() {
        try {
            Intent intent = new Intent(this, KeepAliveService.class);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                startForegroundService(intent);
            } else {
                startService(intent);
            }
            Log.d(TAG, "KeepAliveService started ✓");
        } catch (Exception e) {
            Log.e(TAG, "KeepAliveService start failed: " + e.getMessage());
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == FILE_CHOOSER_REQUEST_CODE) {
            if (mFilePathCallback == null) return;
            android.net.Uri[] results = null;
            if (resultCode == RESULT_OK && data != null) {
                String dataString = data.getDataString();
                if (dataString != null) {
                    results = new android.net.Uri[]{android.net.Uri.parse(dataString)};
                }
            }
            mFilePathCallback.onReceiveValue(results);
            mFilePathCallback = null;
        }
    }
}
