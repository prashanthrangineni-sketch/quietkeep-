package com.pranix.quietkeep;

import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.PowerManager;
import android.util.Log;
import android.view.View;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;
import com.pranix.quietkeep.plugins.ContactsPlugin;
import com.pranix.quietkeep.plugins.OCRPlugin;
import com.pranix.quietkeep.plugins.PerceptionPlugin;
import com.pranix.quietkeep.plugins.ReminderAlarmPlugin;
import com.pranix.quietkeep.plugins.SOSPlugin;
import com.pranix.quietkeep.plugins.VoicePlugin;
import com.pranix.quietkeep.plugins.WakeWordPlugin;
import com.pranix.quietkeep.services.KeepAliveService;

/**
 * MainActivity v8
 * WS-2a: Fixed Android WebView asynchronous microphone permission request bridge.
 */
public class MainActivity extends BridgeActivity {

    private static final String TAG = "QK_MAIN";
    private static final int FILE_CHOOSER_REQUEST_CODE = 1001;
    private static final int AUDIO_PERMISSION_REQUEST_CODE = 1002;

    // LOCATION FOR THE PAGE. The app is a WebView, and a WebView answers a
    // page's location request through WebChromeClient.onGeolocationPermissionsShowPrompt.
    // Nothing here implemented it, and the default answer is NO - so every
    // location request from quietkeep.com was refused, whatever the person
    // tapped. The founder saw it on 1 Oct 2026: allowed location in onboarding,
    // got "Denied". The same refusal sat under the "remind me at Chintal Kunta"
    // reminders and SOS location. Android's own location permission was never
    // even asked for. Both are handled now, the same way the microphone is.
    private static final int LOCATION_PERMISSION_REQUEST_CODE = 1003;
    private String mPendingGeoOrigin = null;
    private android.webkit.GeolocationPermissions.Callback mPendingGeoCallback = null;

    private android.webkit.ValueCallback<android.net.Uri[]> mFilePathCallback;
    private PermissionRequest mPendingAudioPermissionRequest = null;

    /** When back was last pressed with nowhere left to go. See onBackPressed(). */
    private long mLastBackPressAt = 0L;
    private static final long EXIT_CONFIRM_WINDOW_MS = 2000L;

    // Server URL baked in at build time — always the production API host.
    private static final String SERVER_URL = "https://quietkeep.com";

    // "Talk to Aaria" widget. QuickMicWidget has opened this activity with this
    // action since Track A3, but nothing here ever looked at it - so a tap
    // launched the app and stopped. A tap that arrives before the page has
    // loaded (cold start) is held here and delivered in onPageFinished.
    private static final String ACTION_VOICE_MIC_TAP = "ACTION_VOICE_MIC_TAP";
    private volatile boolean mPendingMicWake = false;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Must run BEFORE super.onCreate() — prevents OplusHansManager (ColorOS) from
        // freezing the UID during the Capacitor WebView cold-start window.
        startKeepAliveService();

        registerPlugin(PerceptionPlugin.class);
        registerPlugin(VoicePlugin.class);
        registerPlugin(ReminderAlarmPlugin.class);
        registerPlugin(ContactsPlugin.class);
        registerPlugin(WakeWordPlugin.class);
        registerPlugin(OCRPlugin.class);
        registerPlugin(SOSPlugin.class);

        super.onCreate(savedInstanceState);

        // Enable remote debugging of WebView
        WebView.setWebContentsDebuggingEnabled(true);

        // v6: Eagerly initialise TTS engine so it is ready by first speak call
        TTSManager.getInstance(this);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (pm != null && !pm.isIgnoringBatteryOptimizations(getPackageName())) {
                try {
                    Intent bIntent = new Intent(android.provider.Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
                    bIntent.setData(Uri.parse("package:" + getPackageName()));
                    startActivity(bIntent);
                } catch (Exception e) {
                    Log.w(TAG, "Battery exemption prompt failed: " + e.getMessage());
                }
            }
        }

        // Apply WebView bridge after super.onCreate() so getBridge() is available.
        applyWebViewBridge();

        // Apply system bar insets and status bar color padding
        applySystemBarInsets();

        // Opened by the widget from cold: the page is not there yet, so only
        // remember it. onPageFinished delivers it.
        if (isMicTap(getIntent())) mPendingMicWake = true;
    }

    /** The widget tapped while the app was already running. */
    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (isMicTap(intent)) {
            mPendingMicWake = true;
            deliverMicWake();
        }
    }

    private static boolean isMicTap(Intent intent) {
        return intent != null && ACTION_VOICE_MIC_TAP.equals(intent.getAction());
    }

    /**
     * Tell the page the person wants to talk. The page's wake engine
     * (src/lib/wake-word-engine.js registerNativeWake) defines
     * window.__qkOnWake once the app has booted and the person is signed in,
     * and Aaria starts listening on it. That can be a few seconds after the
     * page itself loads, so the call retries for up to ten seconds rather than
     * firing once into a page that is not ready and being lost.
     */
    private void deliverMicWake() {
        if (!mPendingMicWake) return;
        WebView webView = null;
        try { webView = getBridge() != null ? getBridge().getWebView() : null; } catch (Exception ignored) {}
        if (webView == null) return;
        mPendingMicWake = false;
        final String js = "(function f(n){"
            + "if (typeof window.__qkOnWake === 'function') { window.__qkOnWake('widget'); return; }"
            + "if (n > 0) setTimeout(function(){ f(n - 1); }, 250);"
            + "})(40);";
        final WebView target = webView;
        target.post(() -> target.evaluateJavascript(js, null));
        Log.d(TAG, "widget mic tap delivered to the page");
    }

    /**
     * BACK GOES BACK.
     *
     * There was no handling here at all, so Capacitor's default applied: the
     * moment the WebView has no history entry to pop, the activity finishes and
     * the app is gone. Every screen in QuietKeep is loaded from quietkeep.com,
     * so that state is reached constantly - and the founder reported the
     * symptom for days. One press, and an assistant he was mid-sentence with
     * disappeared.
     *
     * Three steps, in order:
     *   1. Somewhere to go back to -> go there.
     *   2. Nowhere to go, first press -> say so, and wait.
     *   3. Second press inside the window -> leave.
     *
     * Deliberately NOT a silent exit on the second press either: the toast is
     * what turns an accident into a choice. Two seconds is long enough to read
     * and short enough not to trap someone who does want out.
     */
    @Override
    public void onBackPressed() {
        WebView webView = null;
        try {
            if (getBridge() != null) webView = getBridge().getWebView();
        } catch (Exception e) {
            Log.w(TAG, "onBackPressed: no bridge yet - " + e.getMessage());
        }

        if (webView != null && webView.canGoBack()) {
            webView.goBack();
            return;
        }

        long now = System.currentTimeMillis();
        if (now - mLastBackPressAt < EXIT_CONFIRM_WINDOW_MS) {
            super.onBackPressed();
            return;
        }

        mLastBackPressAt = now;
        try {
            android.widget.Toast.makeText(
                this, "Press back again to close QuietKeep",
                android.widget.Toast.LENGTH_SHORT).show();
        } catch (Exception e) {
            // A toast that cannot be shown must never become a reason the app
            // can no longer be closed.
            Log.w(TAG, "onBackPressed: toast failed - " + e.getMessage());
        }
    }

    /**
     * P0 Fix: Handle SDK 35+ forced edge-to-edge window insets on Android 15+.
     * Padds the content view by systemBars() and displayCutout() so the app header
     * is completely clear of the status bar clock/battery/notification icons.
     * Also sets the Activity window background to seamlessly match the app navbar
     * in both light and dark modes.
     */
    private void applySystemBarInsets() {
        try {
            final View root = findViewById(android.R.id.content);
            if (root == null) {
                Log.w(TAG, "applySystemBarInsets: content view null — skipping");
                return;
            }

            boolean isBusiness = getPackageName().contains(".business");
            boolean isDark = (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK)
                    == Configuration.UI_MODE_NIGHT_YES;

            int navBarColor;
            if (isBusiness) {
                navBarColor = isDark ? Color.parseColor("#0a1b14") : Color.parseColor("#ffffff");
            } else {
                navBarColor = isDark ? Color.parseColor("#0b0f19") : Color.parseColor("#ffffff");
            }

            getWindow().setBackgroundDrawable(new ColorDrawable(navBarColor));
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                getWindow().setStatusBarColor(navBarColor);
            }

            WindowInsetsControllerCompat insetsController =
                    WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
            if (insetsController != null) {
                insetsController.setAppearanceLightStatusBars(!isDark);
            }

            ViewCompat.setOnApplyWindowInsetsListener(root, (v, insets) -> {
                Insets bars = insets.getInsets(
                    WindowInsetsCompat.Type.systemBars()
                    | WindowInsetsCompat.Type.displayCutout());
                v.setPadding(bars.left, bars.top, bars.right, bars.bottom);
                return WindowInsetsCompat.CONSUMED;
            });
            ViewCompat.requestApplyInsets(root);
            Log.d(TAG, "applySystemBarInsets: system bar padding applied ✓ (isBusiness=" + isBusiness + " isDark=" + isDark + ")");
        } catch (Exception e) {
            Log.w(TAG, "applySystemBarInsets failed (non-fatal): " + e.getMessage());
        }
    }

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
                    // A widget tap that arrived before this page existed.
                    deliverMicWake();
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
                            Log.d(TAG, "onPermissionRequest: RECORD_AUDIO already granted → granting WebView");
                            request.grant(request.getResources());
                        } else {
                            Log.d(TAG, "onPermissionRequest: RECORD_AUDIO not yet granted → requesting runtime permission from OS");
                            mPendingAudioPermissionRequest = request;
                            ActivityCompat.requestPermissions(
                                MainActivity.this,
                                new String[]{android.Manifest.permission.RECORD_AUDIO},
                                AUDIO_PERMISSION_REQUEST_CODE
                            );
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
                public void onGeolocationPermissionsShowPrompt(
                        String origin,
                        android.webkit.GeolocationPermissions.Callback callback) {
                    boolean fine = ContextCompat.checkSelfPermission(MainActivity.this,
                        android.Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
                    boolean coarse = ContextCompat.checkSelfPermission(MainActivity.this,
                        android.Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
                    if (fine || coarse) {
                        Log.d(TAG, "geolocation: Android permission held -> allowing " + origin);
                        callback.invoke(origin, true, false);
                        return;
                    }
                    Log.d(TAG, "geolocation: asking Android for location on behalf of " + origin);
                    mPendingGeoOrigin = origin;
                    mPendingGeoCallback = callback;
                    ActivityCompat.requestPermissions(
                        MainActivity.this,
                        new String[]{
                            android.Manifest.permission.ACCESS_FINE_LOCATION,
                            android.Manifest.permission.ACCESS_COARSE_LOCATION
                        },
                        LOCATION_PERMISSION_REQUEST_CODE
                    );
                }

                @Override
                public void onPermissionRequestCanceled(PermissionRequest request) {
                    if (request == mPendingAudioPermissionRequest) {
                        mPendingAudioPermissionRequest = null;
                    }
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
            + "  if (window.AndroidTTS && typeof window.AndroidTTS.speak === 'function') {\n"
            + "    window.__QK_TTS__     = function(t){try{window.AndroidTTS.speak(String(t||'')); }catch(e){}};\n"
            + "    window.__QK_TTS_LOW__ = function(t){try{window.AndroidTTS.speakLow(String(t||'')); }catch(e){}};\n"
            + "    window.__QK_CANCEL__  = function(){try{window.AndroidTTS.stop(); }catch(e){}};\n"
            + "    window.__QK_SET_LANG__ = function(l){try{window.AndroidTTS.setLanguage(String(l||'en-IN'));}catch(e){}};\n"
            + "    console.log('[QK] TTS bridges: __QK_TTS__ __QK_TTS_LOW__ __QK_CANCEL__ active');\n"
            + "  } else {\n"
            + "    console.log('[QK] AndroidTTS not available — TTS will use speechSynthesis');\n"
            + "  }\n"
            + "\n"
            + "  // 2b. Native Contacts Plugin — window.__QK_CONTACTS__.getAll()\n"
            + "  if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.ContactsPlugin) {\n"
            + "    window.__QK_CONTACTS__ = {\n"
            + "      getAll: async function() {\n"
            + "        try {\n"
            + "          var res = await window.Capacitor.Plugins.ContactsPlugin.getAll();\n"
            + "          return res.contacts || [];\n"
            + "        } catch(e) {\n"
            + "          console.error('[QK] Contacts plugin error:', e);\n"
            + "          return [];\n"
            + "        }\n"
            + "      }\n"
            + "    };\n"
            + "    console.log('[QK] Contacts plugin __QK_CONTACTS__ active ✓');\n"
            + "  }\n"
            + "\n"
            + "  // 2c. Native Wake Word Plugin — window.__QK_WAKE__\n"
            + "  if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.WakeWordPlugin) {\n"
            + "    window.__QK_WAKE__ = {\n"
            + "      ensureInvokeSurfaces: async function() { try { await window.Capacitor.Plugins.WakeWordPlugin.ensureInvokeSurfaces(); } catch(e){} },\n"
            + "      startHotword: async function() { try { await window.Capacitor.Plugins.WakeWordPlugin.startHotword(); } catch(e){} },\n"
            + "      stopHotword: async function() { try { await window.Capacitor.Plugins.WakeWordPlugin.stopHotword(); } catch(e){} },\n"
            + "      isWakeWordAvailable: async function() { try { var res = await window.Capacitor.Plugins.WakeWordPlugin.isWakeWordAvailable(); return res.available || false; } catch(e){ return false; } }\n"
            + "    };\n"
            + "    console.log('[QK] Wake word plugin __QK_WAKE__ active ✓');\n"
            + "  }\n"
            + "\n"
            + "  // 2d. Native OCR Plugin — window.__QK_OCR__\n"
            + "  if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.OCRPlugin) {\n"
            + "    window.__QK_OCR__ = {\n"
            + "      scanReceipt: async function() {\n"
            + "        try { return await window.Capacitor.Plugins.OCRPlugin.scanReceipt(); } catch(e){ return { text:'', blocks:[], detected:{} }; }\n"
            + "      },\n"
            + "      scanDocument: async function() {\n"
            + "        try { return await window.Capacitor.Plugins.OCRPlugin.scanDocument(); } catch(e){ return { text:'', detected:{} }; }\n"
            + "      }\n"
            + "    };\n"
            + "    console.log('[QK] OCR plugin __QK_OCR__ active ✓');\n"
            + "  }\n"
            + "\n"
            + "  // 2e. Native SOS Plugin — window.__QK_SOS__\n"
            + "  if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.SOSPlugin) {\n"
            + "    window.__QK_SOS__ = {\n"
            + "      dispatch112: async function() { try { await window.Capacitor.Plugins.SOSPlugin.dispatch112(); } catch(e){} }\n"
            + "    };\n"
            + "    console.log('[QK] SOS plugin __QK_SOS__ active ✓');\n"
            + "  }\n"
            + "\n"
            + "  // 2f. Native Geofence Bridge — window.__QK_GEO__\n"
            + "  if (window.AndroidGeo) {\n"
            + "    window.__QK_GEO__ = {\n"
            + "      registerKeepGeofences: async function() { try { window.AndroidGeo.registerKeepGeofences(); } catch(e){} },\n"
            + "      clearGeofences: async function() { try { window.AndroidGeo.clearGeofences(); } catch(e){} }\n"
            + "    };\n"
            + "    console.log('[QK] Geofence bridge __QK_GEO__ active ✓');\n"
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

    /**
     * LotusWakeBridgeHolder
     */
    public static class LotusWakeBridgeHolder {
        public static volatile android.app.Activity sActivity = null;
    }

    @Override
    public void onResume() {
        super.onResume();
        LotusWakeBridgeHolder.sActivity = this;
        Log.d(TAG, "LotusWakeBridgeHolder: Activity registered ✓");
    }

    @Override
    public void onPause() {
        super.onPause();
    }

    @Override
    public void onDestroy() {
        LotusWakeBridgeHolder.sActivity = null;
        super.onDestroy();
        TTSManager.getInstance(this).shutdown();
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == AUDIO_PERMISSION_REQUEST_CODE) {
            if (mPendingAudioPermissionRequest != null) {
                if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
                    Log.d(TAG, "onRequestPermissionsResult: RECORD_AUDIO granted by user → granting WebView");
                    mPendingAudioPermissionRequest.grant(mPendingAudioPermissionRequest.getResources());
                } else {
                    Log.w(TAG, "onRequestPermissionsResult: RECORD_AUDIO denied by user → denying WebView");
                    mPendingAudioPermissionRequest.deny();
                }
                mPendingAudioPermissionRequest = null;
            }
        }
        if (requestCode == LOCATION_PERMISSION_REQUEST_CODE && mPendingGeoCallback != null) {
            boolean allowed = false;
            for (int r : grantResults) {
                if (r == PackageManager.PERMISSION_GRANTED) { allowed = true; break; }
            }
            Log.d(TAG, "geolocation: person " + (allowed ? "allowed" : "refused") + " location");
            // retain=false: ask Android again next time rather than caching a
            // refusal inside the WebView where Settings cannot undo it.
            mPendingGeoCallback.invoke(mPendingGeoOrigin, allowed, false);
            mPendingGeoCallback = null;
            mPendingGeoOrigin = null;
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
