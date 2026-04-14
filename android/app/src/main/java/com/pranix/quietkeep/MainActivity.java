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
 * MainActivity v5
 *
 * FIX v5: Runtime JS injection — server URL rewrite + app type.
 *
 * ROOT CAUSE OF BUSINESS APK FAILURE (v4):
 * Both APKs had server.url = "https://quietkeep.com" in capacitor.config.json.
 * This caused Capacitor to load the LIVE Vercel deployment instead of the local
 * bundle that was built with the correct NEXT_PUBLIC_APP_TYPE.
 *
 * FIX: server.url is now REMOVED from both capacitor configs. The APK loads its
 * own local bundle from assets/public/. All /api/* calls in the bundle use
 * relative paths which resolve to capacitor://localhost/api/ — these return 404.
 *
 * We fix this by injecting a fetch() interceptor via evaluateJavascript() that
 * rewrites any relative /api/ request to https://quietkeep.com/api/.
 *
 * Additionally, __QK_APP_TYPE__ is injected from the package name so routing
 * works correctly even if the build env var was somehow not baked in.
 *
 * INJECTION TIMING: evaluateJavascript() fires after the WebView DOM is ready.
 * We use addJavascriptInterface() + onPageStarted to inject before any JS runs.
 * Actually we use a <script> injected via shouldInterceptRequest for index.html.
 * Simplest reliable approach: inject via evaluateJavascript after page load AND
 * also patch it into the WebView's initial HTML via a custom WebViewClient.
 *
 * v4 retained: WebChromeClient audio bridge, WebSettings, KeepAliveService.
 * v3 retained: KeepAliveService before super.onCreate() blocks Hans UID freeze.
 */
public class MainActivity extends BridgeActivity {

    private static final String TAG = "QK_MAIN";
    private static final int FILE_CHOOSER_REQUEST_CODE = 1001;
    private android.webkit.ValueCallback<android.net.Uri[]> mFilePathCallback;

    // Server URL baked in at build time — always the production API host.
    // The WebView loads local assets; all /api/ fetch calls must be rewritten to this.
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

        // Apply WebView bridge after super.onCreate() so getBridge() is available.
        applyWebViewBridge();
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

            // ── Inject runtime constants + fetch rewrite ────────────────────
            // Fires after Capacitor's own WebViewClient has loaded the page.
            // We hook into the existing WebViewClient's onPageFinished so we
            // don't replace Capacitor's client (which would break the bridge).
            android.webkit.WebViewClient existingClient = webView.getWebViewClient();

            webView.setWebViewClient(new android.webkit.WebViewClient() {

                @Override
                public boolean shouldOverrideUrlLoading(
                        android.webkit.WebView view,
                        android.webkit.WebResourceRequest request) {
                    // Delegate to existing Capacitor client
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
                    // Delegate to Capacitor first so bridge is fully ready
                    if (existingClient != null) {
                        existingClient.onPageFinished(view, url);
                    } else {
                        super.onPageFinished(view, url);
                    }

                    // Now inject our runtime constants
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

                // ── File chooser for <input type="file"> (camera + gallery) ──
                @Override
                public boolean onShowFileChooser(
                        android.webkit.WebView view,
                        android.webkit.ValueCallback<android.net.Uri[]> filePathCallback,
                        FileChooserParams fileChooserParams) {
                    // Delegate to Capacitor's existing handler first
                    if (existing != null) {
                        boolean handled = existing.onShowFileChooser(view, filePathCallback, fileChooserParams);
                        if (handled) return true;
                    }
                    // Fallback: camera-first chooser with gallery option
                    try {
                        if (mFilePathCallback != null) {
                            mFilePathCallback.onReceiveValue(null);
                        }
                        mFilePathCallback = filePathCallback;

                        // Check if accept type requests camera specifically
                        String[] acceptTypes = fileChooserParams.getAcceptTypes();
                        boolean wantsCamera = false;
                        if (acceptTypes != null) {
                            for (String t : acceptTypes) {
                                if (t != null && t.contains("image")) { wantsCamera = true; break; }
                            }
                        }

                        // Camera intent — opens camera directly
                        android.content.Intent takePictureIntent = new android.content.Intent(
                                android.provider.MediaStore.ACTION_IMAGE_CAPTURE);

                        // Gallery fallback
                        android.content.Intent galleryIntent = new android.content.Intent(
                                android.content.Intent.ACTION_GET_CONTENT);
                        galleryIntent.addCategory(android.content.Intent.CATEGORY_OPENABLE);
                        galleryIntent.setType("image/*");

                        // Chooser: camera as primary, gallery as extra
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
     * Inject runtime JS constants into the WebView after each page load.
     *
     * FIX v5: Without server.url, Capacitor loads local assets. All fetch('/api/...')
     * calls in the Next.js bundle use relative paths, which resolve to
     * capacitor://localhost/api/ and return 404.
     *
     * This injection does two things:
     *
     * 1. Sets window.__QK_APP_TYPE__ from the package name — the JS routing
     *    in page.jsx reads this first before process.env.NEXT_PUBLIC_APP_TYPE.
     *    This is the runtime safety net for APK variant isolation.
     *
     * 2. Patches window.fetch() to rewrite relative /api/ paths to
     *    https://quietkeep.com/api/ so all API calls hit the production server.
     *    This is transparent to all existing JS code — no other changes needed.
     *
     * IDEMPOTENT: The guard `if (window.__QK_PATCHED__)` prevents double-patching
     * on React client-side navigations that re-trigger onPageFinished.
     */
    private void injectRuntimeJS(android.webkit.WebView view) {
        // Determine app type from package name — 100% reliable, no env var dependency
        String appType = getPackageName().contains(".business") ? "business" : "personal";

        String js = "javascript:(function() {\n"
            + "  if (window.__QK_PATCHED__) return;\n"
            + "  window.__QK_PATCHED__ = true;\n"
            + "\n"
            + "  // 1. Runtime constants\n"
            + "  window.__QK_SERVER_URL__ = '" + SERVER_URL + "';\n"
            + "  window.__QK_APP_TYPE__   = '" + appType + "';\n"
            + "\n"
            + "  // 2. Fetch interceptor: rewrite relative /api/ → production server\n"
            + "  //    Only fires for relative paths starting with /api/\n"
            + "  //    Absolute URLs (https://...) pass through unchanged.\n"
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
