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
        registerPlugin(com.pranix.aariaedge.AariaEdgePlugin.class);
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
            + "  if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.AariaEdge) {\n"
            + "    var aaria = window.Capacitor.Plugins.AariaEdge;\n"
            + "    // The Edge listener and QuietKeep's own listening cannot hold the microphone together. This bridge gives\n"
            + "    // the microphone up when QuietKeep needs it and takes it back when QuietKeep says it is free again.\n"
            + "    // Newer engine: it pauses inside its own listening service and keeps its notice, so listening can come\n"
            + "    // back even when QuietKeep is not on screen; a pause nobody ends is ended by the engine after three minutes.\n"
            + "    // Older engine, or a pause that fails: the listening service is stopped and started again from here.\n"
            + "    //\n"
            + "    // Everything below is done one thing at a time, in the order it was asked for (qkEdgeInTurn). A signal\n"
            + "    // that arrives while an earlier one is still being handled waits its turn, so two of them can never\n"
            + "    // cross each other.\n"
            + "    //\n"
            + "    // qkEdgeStopped is true only while THIS bridge is the one that stopped the listener, so a person's own\n"
            + "    // Turn off is never undone.\n"
            + "    var qkEdgeStopped = false;\n"
            + "    var qkEdgeRetryOnScreen = false;\n"
            + "    var qkEdgeTries = 0;\n"
            + "    // True from an 'I need the microphone' until the next 'it is free' (or the safety timer).\n"
            + "    var qkEdgeWanted = false;\n"
            + "    // True from the moment listening is turned off from this page, until it is turned on again from this page.\n"
            + "    var qkEdgeOff = false;\n"
            + "    // Goes up each time the person turns listening on or off. A turn-on that is overtaken by a later on or\n"
            + "    // off does nothing more.\n"
            + "    var qkEdgeEpoch = 0;\n"
            + "    var qkEdgeTimer = null;\n"
            + "    // Goes up each time the safety timer is set or cleared. A timer that has fired but whose turn comes\n"
            + "    // only after it was set again does nothing.\n"
            + "    var qkEdgeTimerGen = 0;\n"
            + "    var qkEdgeQueue = Promise.resolve();\n"
            + "    var qkEdgeInTurn = function(what, limitMs, fn) {\n"
            + "      var run = function() {\n"
            + "        return new Promise(function(done) {\n"
            + "          var over = false;\n"
            + "          var guard = null;\n"
            + "          var finish = function() {\n"
            + "            if (over) return;\n"
            + "            over = true;\n"
            + "            if (guard !== null) { try { window.clearTimeout(guard); } catch(e){} }\n"
            + "            done();\n"
            + "          };\n"
            + "          // Something that never answers must not hold up everything after it.\n"
            + "          try {\n"
            + "            guard = window.setTimeout(function() {\n"
            + "              if (!over) { console.warn('[QK] Aaria Edge: ' + what + ' did not finish in time'); finish(); }\n"
            + "            }, limitMs);\n"
            + "          } catch(e) {}\n"
            + "          Promise.resolve().then(fn).catch(function(e) {\n"
            + "            console.warn('[QK] Aaria Edge: ' + what + ' failed');\n"
            + "          }).then(finish);\n"
            + "        });\n"
            + "      };\n"
            + "      qkEdgeQueue = qkEdgeQueue.then(run);\n"
            + "      return qkEdgeQueue;\n"
            + "    };\n"
            + "    var qkEdgeNotThere = function(e) {\n"
            + "      // An older engine behind an app-side wrapper: the function exists but the engine does not have it.\n"
            + "      return !!(e && (e.code === 'UNIMPLEMENTED' || /not implemented/i.test(String(e.message || ''))));\n"
            + "    };\n"
            + "    var qkEdgeClearTimer = function() {\n"
            + "      qkEdgeTimerGen++;\n"
            + "      if (qkEdgeTimer !== null) { try { window.clearTimeout(qkEdgeTimer); } catch(e){} qkEdgeTimer = null; }\n"
            + "    };\n"
            + "    var qkEdgeTakeMicBack = null;\n"
            + "    var qkEdgeArmTimer = function(ms) {\n"
            + "      // A stop that nobody ends is ended from here, so listening is never lost for good.\n"
            + "      qkEdgeClearTimer();\n"
            + "      var gen = qkEdgeTimerGen;\n"
            + "      try {\n"
            + "        qkEdgeTimer = window.setTimeout(function() {\n"
            + "          qkEdgeTimer = null;\n"
            + "          qkEdgeInTurn('the safety timer', 20000, async function() {\n"
            + "            // Set again, or cleared, while this waited its turn (QuietKeep asked for the microphone again).\n"
            + "            if (gen !== qkEdgeTimerGen) return;\n"
            + "            await qkEdgeTakeMicBack();\n"
            + "          });\n"
            + "        }, ms);\n"
            + "      } catch(e) { console.warn('[QK] Aaria Edge: the safety timer could not be set'); }\n"
            + "    };\n"
            + "    // Older engine, or a pause that failed: stop the listening service, and remember that this bridge did it.\n"
            + "    var qkEdgeStopIt = async function(sureItIsOn) {\n"
            + "      // A wake can only come from a listener that is on. Otherwise ask first, so that listening the person\n"
            + "      // turned off is never started again by the take-back below.\n"
            + "      var need = sureItIsOn === true;\n"
            + "      if (!need) {\n"
            + "        var st = await aaria.isBackgroundListening();\n"
            + "        need = !!(st && (st.listening || st.paused));\n"
            + "      }\n"
            + "      if (!need && !qkEdgeStopped) return;\n"
            + "      qkEdgeStopped = true;\n"
            + "      qkEdgeTries = 0;\n"
            + "      // Three minutes, counted from the latest 'I need the microphone'.\n"
            + "      qkEdgeArmTimer(180000);\n"
            + "      if (need) {\n"
            + "        try { await aaria.stopBackgroundListening(); }\n"
            + "        catch(e) { console.warn('[QK] Aaria Edge could not be stopped for the microphone'); }\n"
            + "      }\n"
            + "    };\n"
            + "    var qkEdgeGiveMic = async function(sureItIsOn) {\n"
            + "      qkEdgeWanted = true;\n"
            + "      // QuietKeep needs the microphone now, so a restart that was waiting for the return to the screen waits\n"
            + "      // for the next 'free' signal instead.\n"
            + "      qkEdgeRetryOnScreen = false;\n"
            + "      if (typeof aaria.holdMicrophone === 'function') {\n"
            + "        try {\n"
            + "          await aaria.holdMicrophone();\n"
            + "          // A stop from an earlier, failed pause is still waiting to be undone: its three minutes start again too.\n"
            + "          if (qkEdgeStopped) qkEdgeArmTimer(180000);\n"
            + "          return;\n"
            + "        } catch(e) {\n"
            + "          if (!qkEdgeNotThere(e)) console.warn('[QK] Aaria Edge could not pause itself; stopping it instead');\n"
            + "        }\n"
            + "      }\n"
            + "      await qkEdgeStopIt(sureItIsOn);\n"
            + "    };\n"
            + "    qkEdgeTakeMicBack = async function() {\n"
            + "      qkEdgeWanted = false;\n"
            + "      if (typeof aaria.releaseMicrophone === 'function') {\n"
            + "        // Always passed on: the engine ignores it when nothing is paused, and a pause placed before a page\n"
            + "        // reload is ended this way too.\n"
            + "        try { await aaria.releaseMicrophone(); }\n"
            + "        catch(e) { if (!qkEdgeNotThere(e)) console.warn('[QK] Aaria Edge release failed; its pause ends by itself within three minutes'); }\n"
            + "      }\n"
            + "      if (!qkEdgeStopped) return;\n"
            + "      qkEdgeClearTimer();\n"
            + "      // If the setting cannot be read, listening is started again. The person's own Turn off clears\n"
            + "      // qkEdgeStopped, so reading the setting here is only a second check.\n"
            + "      var on = true;\n"
            + "      try { on = window.localStorage.getItem('qk_wake_mode_v2') === 'counter'; }\n"
            + "      catch(e) { console.warn('[QK] Aaria Edge: the hands-free setting could not be read; starting listening again'); }\n"
            + "      if (!on) { qkEdgeStopped = false; qkEdgeRetryOnScreen = false; qkEdgeTries = 0; return; }\n"
            + "      var refusal = null;\n"
            + "      try { await aaria.startBackgroundListening(); }\n"
            + "      catch(e) { refusal = e || {}; }\n"
            + "      if (refusal === null) {\n"
            + "        qkEdgeStopped = false;\n"
            + "        qkEdgeRetryOnScreen = false;\n"
            + "        return;\n"
            + "      }\n"
            + "      if (refusal.message === 'turned_off') {\n"
            + "        // The person turned listening off on the notice while it was being started: that stands.\n"
            + "        qkEdgeStopped = false; qkEdgeRetryOnScreen = false; qkEdgeTries = 0;\n"
            + "        console.log('[QK] Aaria Edge: listening was turned off on the notice; not starting it again');\n"
            + "        return;\n"
            + "      }\n"
            + "      var hidden = !!(window.document && window.document.visibilityState && window.document.visibilityState !== 'visible');\n"
            + "      var notOnScreen = hidden || refusal.message === 'not_in_foreground';\n"
            + "      if (notOnScreen) {\n"
            + "        // Android lets listening start only while QuietKeep is on screen. Keep the note and try again\n"
            + "        // when it comes back to the screen.\n"
            + "        qkEdgeRetryOnScreen = true;\n"
            + "        console.log('[QK] Aaria Edge: listening starts again when QuietKeep is back on screen');\n"
            + "        if (hidden) return;\n"
            + "        // The page believes it is on screen but Android does not: also try again shortly, as below.\n"
            + "      }\n"
            + "      // Any other refusal: two more tries, half a minute apart. After that a 'not on screen' refusal goes on\n"
            + "      // waiting for the return to the screen; anything else is given up until listening is turned on again\n"
            + "      // (QuietKeep does that by itself the next time it is opened).\n"
            + "      qkEdgeTries++;\n"
            + "      if (qkEdgeTries < 3) {\n"
            + "        console.warn('[QK] Aaria Edge could not start listening again; trying again in half a minute');\n"
            + "        qkEdgeArmTimer(30000);\n"
            + "      } else if (notOnScreen) {\n"
            + "        qkEdgeTries = 0;\n"
            + "        console.warn('[QK] Aaria Edge could not start listening again; waiting for QuietKeep to come back on screen');\n"
            + "      } else {\n"
            + "        qkEdgeStopped = false;\n"
            + "        qkEdgeTries = 0;\n"
            + "        console.warn('[QK] Aaria Edge could not start listening again; giving up until it is turned on again');\n"
            + "      }\n"
            + "    };\n"
            + "    var qkEdgeForget = function() {\n"
            + "      // The person's own on or off wins over anything this bridge remembered.\n"
            + "      qkEdgeStopped = false; qkEdgeWanted = false; qkEdgeRetryOnScreen = false; qkEdgeTries = 0; qkEdgeClearTimer();\n"
            + "    };\n"
            + "    window.__QK_WAKE__ = {\n"
            + "      ensureInvokeSurfaces: async function() { if (window.Capacitor.Plugins.WakeWordPlugin) { try { await window.Capacitor.Plugins.WakeWordPlugin.ensureInvokeSurfaces(); } catch(e){} } },\n"
            + "      startHotword: function(opt) {\n"
            + "        qkEdgeOff = false;\n"
            + "        var epoch = ++qkEdgeEpoch;\n"
            + "        // Two minutes: the person may be reading Android's microphone question.\n"
            + "        return qkEdgeInTurn('turning listening on', 120000, async function() {\n"
            + "          qkEdgeForget();\n"
            + "          try {\n"
            + "            await aaria.setWakeName({name: (opt && opt.word) ? opt.word : 'aaria'});\n"
            + "            if (epoch !== qkEdgeEpoch) return;\n"
            + "            await aaria.startBackgroundListening();\n"
            + "          } catch(e) {\n"
            + "            if (epoch !== qkEdgeEpoch) return;\n"
            + "            if (e && e.message === 'microphone_permission_required') {\n"
            + "              try {\n"
            + "                await aaria.requestPermissions();\n"
            + "                if (epoch !== qkEdgeEpoch) return;\n"
            + "                await aaria.startBackgroundListening();\n"
            + "              } catch(e2) { console.warn('[QK] Aaria Edge: listening could not be turned on after the microphone question'); }\n"
            + "            } else if (e && e.message === 'consent_required') {\n"
            + "              if (window.__qkAariaNeedsConsent) window.__qkAariaNeedsConsent(); else window.location.href = '/aaria-consent';\n"
            + "            } else if (e && e.message === 'Consent for wake word is not granted') {\n"
            + "              console.warn('[QK] Wake word consent disabled by user choice');\n"
            + "            } else {\n"
            + "              console.warn('[QK] Aaria Edge: listening could not be turned on');\n"
            + "            }\n"
            + "          }\n"
            + "        });\n"
            + "      },\n"
            + "      stopHotword: function() {\n"
            + "        qkEdgeOff = true;\n"
            + "        ++qkEdgeEpoch;\n"
            + "        return qkEdgeInTurn('turning listening off', 20000, async function() {\n"
            + "          qkEdgeForget();\n"
            + "          try { await aaria.stopBackgroundListening(); }\n"
            + "          catch(e) { console.warn('[QK] Aaria Edge: listening could not be turned off'); }\n"
            + "        });\n"
            + "      },\n"
            + "      isWakeWordAvailable: async function() {\n"
            + "        try {\n"
            + "          var st = await aaria.getStatus(); if (!st || !st.available) return false;\n"
            + "          var c = await aaria.getConsent();\n"
            + "          if (!c.consent) return false;\n"
            + "          if (aaria.checkRecognizer) { var r = await aaria.checkRecognizer(); return (r && r.ok) ? true : false; }\n"
            + "          var d = await aaria.getMyData();\n"
            + "          return (d.downloadedModels && d.downloadedModels.length > 0) ? true : false;\n"
            + "        } catch(e){ return false; }\n"
            + "      }\n"
            + "    };\n"
            + "    aaria.addListener('wakeWord', function(e) {\n"
            + "      // Listening was turned off from this page: a wake that was still on its way is dropped.\n"
            + "      if (qkEdgeOff) return;\n"
            + "      var text = (e && e.hasCommand && typeof e.text === 'string') ? e.text : '';\n"
            + "      if (text && window.__qkOnWakeAcceptsText === true && window.__qkOnWake) {\n"
            + "        // Wake name and command in one breath: QuietKeep acts on the words. No microphone is needed,\n"
            + "        // so the Edge listener carries on.\n"
            + "        window.__qkOnWake('aaria_edge', { text: text });\n"
            + "        return;\n"
            + "      }\n"
            + "      return qkEdgeInTurn('a wake', 20000, async function() {\n"
            + "        if (qkEdgeOff) return;\n"
            + "        if (!window.__qkOnWake) {\n"
            + "          // Nobody on this page takes a wake, so nobody would end a pause.\n"
            + "          // QuietKeep has asked for the microphone and has not said 'free' yet. This wake proves the engine\n"
            + "          // is on, so give the microphone up (again): a newer engine stays paused, and an older one, which\n"
            + "          // may have answered 'not listening' when it was asked a moment ago, is stopped now.\n"
            + "          if (qkEdgeWanted) { await qkEdgeGiveMic(true); return; }\n"
            + "          if (typeof aaria.releaseMicrophone === 'function') {\n"
            + "            // Newer engine: no pause is placed; it is only put back to waiting for the wake name.\n"
            + "            try { await aaria.releaseMicrophone(); return; }\n"
            + "            catch(e2) { if (!qkEdgeNotThere(e2)) console.warn('[QK] Aaria Edge could not be put back to waiting for its name; stopping it instead'); }\n"
            + "          }\n"
            + "          // Older engine: after a bare wake it waits for a command and no longer says that it is listening, so\n"
            + "          // later this bridge could not tell on from off. Stop it. The three-minute timer, or QuietKeep turning\n"
            + "          // listening on when its voice part loads, starts it again.\n"
            + "          await qkEdgeStopIt(true);\n"
            + "          return;\n"
            + "        }\n"
            + "        // Bare wake: QuietKeep opens its own microphone for the command, after the engine has given it up.\n"
            + "        await qkEdgeGiveMic(true);\n"
            + "        if (qkEdgeOff) return;\n"
            + "        window.__qkOnWake('aaria_edge');\n"
            + "      });\n"
            + "    });\n"
            + "    window.addEventListener('qk_mic_claim', function() {\n"
            + "      qkEdgeInTurn('giving up the microphone', 20000, function() { return qkEdgeGiveMic(false); });\n"
            + "    });\n"
            + "    window.addEventListener('qk_mic_release', function() {\n"
            + "      qkEdgeInTurn('taking the microphone back', 20000, qkEdgeTakeMicBack);\n"
            + "    });\n"
            + "    if (window.document && window.document.addEventListener) {\n"
            + "      window.document.addEventListener('visibilitychange', function() {\n"
            + "        // Only a start that Android refused because QuietKeep was not on screen is tried again here.\n"
            + "        if (window.document.visibilityState !== 'visible') return;\n"
            + "        qkEdgeInTurn('the return to the screen', 20000, async function() {\n"
            + "          if (qkEdgeRetryOnScreen) await qkEdgeTakeMicBack();\n"
            + "        });\n"
            + "      });\n"
            + "    }\n"
            + "    console.log('[QK] Wake word plugin __QK_WAKE__ (AariaEdge) active ✓');\n"
            + "  } else if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.WakeWordPlugin) {\n"
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
