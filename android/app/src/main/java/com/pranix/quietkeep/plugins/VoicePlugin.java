package com.pranix.quietkeep.plugins;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.provider.Settings;
import android.util.Log;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import com.pranix.quietkeep.services.VoiceService;
import com.pranix.quietkeep.services.LocationService;

/**
 * VoicePlugin v7
 *
 * FIX v7: Fixed isKeptAlive() guard in onMicPermissionResult.
 *
 * ROOT CAUSE OF PREVIOUS FAILURE (v6 bug):
 * onMicPermissionResult() had:
 *   if (call.isKeptAlive()) { return; }
 *
 * Capacitor marks a call as "kept alive" when requestPermissionForAlias() is
 * invoked — the call stays alive until the @PermissionCallback resolves it.
 * isKeptAlive() returns TRUE inside every @PermissionCallback invocation.
 * This means the guard ALWAYS fired, always returned without calling
 * call.resolve(), and the JS promise hung forever, then timed out.
 *
 * Result: user grants mic permission via the system dialog, but the JS layer
 * never receives { granted: true }, the callPlugin promise rejects, the
 * getUserMedia fallback may also fail on first run, and requestMicPermission()
 * returns false → "Microphone permission denied" toast even though permission
 * was actually granted.
 *
 * FIX: Replace isKeptAlive() guard with a static boolean flag to prevent
 * ColorOS/Hans double-callback re-entry. The flag is set on first delivery
 * and cleared when the next permission request begins.
 *
 * FIX v6 retained: isRunning() uses VoiceService.captureActive static flag only.
 *   ActivityManager.getRunningServices() is deprecated since Android 8 (API 26)
 *   and returns unreliable/stale/empty results on ColorOS 12+, Android 12+.
 *
 * v5 retained: requestBatteryOptimizationExemption, isBatteryOptimizationExempt,
 *   Handler.post() defer in startService.
 */
@CapacitorPlugin(
    name = "VoicePlugin",
    permissions = {
        @Permission(
            strings = { Manifest.permission.RECORD_AUDIO },
            alias = "microphone"
        ),
        @Permission(
            strings = { Manifest.permission.POST_NOTIFICATIONS },
            alias = "notifications"
        )
    }
)
public class VoicePlugin extends Plugin {

    private static final String TAG        = "QK_VOICE";
    private static final String PREFS_NAME = "QuietKeepPrefs";

    // FIX v7: Static flag to guard against ColorOS/Hans double-callback re-entry.
    // Replaces the broken call.isKeptAlive() check in onMicPermissionResult.
    // Set to true when the first callback result is delivered.
    // Reset to false at the start of each new requestMicPermission call.
    private static volatile boolean micCallbackDelivered = false;

    // ── Permission request ────────────────────────────────────────────────

    @PluginMethod
    public void requestMicPermission(PluginCall call) {
        Log.d(TAG, "VoicePlugin.requestMicPermission called");

        // FIX v7: Reset the re-entry guard for each fresh permission request.
        micCallbackDelivered = false;

        boolean micGranted = getPermissionState("microphone")
            == com.getcapacitor.PermissionState.GRANTED;

        if (micGranted) {
            Log.d(TAG, "RECORD_AUDIO already granted");
            JSObject r = new JSObject();
            r.put("granted", true);
            call.resolve(r);
            return;
        }

        requestPermissionForAlias("microphone", call, "onMicPermissionResult");
    }

    @PermissionCallback
    private void onMicPermissionResult(PluginCall call) {
        // FIX v7: Use static boolean flag instead of call.isKeptAlive().
        //
        // PREVIOUS BUG: `if (call.isKeptAlive()) return;`
        // isKeptAlive() is always true inside a @PermissionCallback — Capacitor
        // marks the call as "kept alive" when requestPermissionForAlias() is
        // called, and it stays alive until the callback resolves it. The old guard
        // caused this method to ALWAYS return without resolving, so the JS promise
        // hung forever. JS callPlugin timed out → catch → getUserMedia fallback
        // may also fail on first launch → requestMicPermission returned false.
        //
        // NEW FIX: Track delivery with a static boolean. Only deliver once per
        // request cycle. This prevents ColorOS Hans from firing the callback
        // twice while still correctly delivering the first result.
        if (micCallbackDelivered) {
            Log.w(TAG, "onMicPermissionResult: duplicate callback skipped (Hans re-entry)");
            return;
        }
        micCallbackDelivered = true;

        boolean granted = getPermissionState("microphone")
            == com.getcapacitor.PermissionState.GRANTED;
        Log.d(TAG, "RECORD_AUDIO permission result: granted=" + granted);

        JSObject r = new JSObject();
        r.put("granted", granted);
        call.resolve(r);
    }

    @PluginMethod
    public void checkMicPermission(PluginCall call) {
        boolean granted = getPermissionState("microphone")
            == com.getcapacitor.PermissionState.GRANTED;
        JSObject r = new JSObject();
        r.put("granted", granted);
        call.resolve(r);
    }

    // ── Battery optimization ──────────────────────────────────────────────

    @PluginMethod
    public void requestBatteryOptimizationExemption(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
            JSObject r = new JSObject();
            r.put("exempt", true);
            r.put("requested", false);
            r.put("reason", "not_needed_pre_m");
            call.resolve(r);
            return;
        }

        Context context = getContext();
        String pkg = context.getPackageName();
        PowerManager pm = (PowerManager) context.getSystemService(Context.POWER_SERVICE);

        if (pm == null) {
            call.reject("PowerManager not available");
            return;
        }

        boolean alreadyExempt = pm.isIgnoringBatteryOptimizations(pkg);

        if (alreadyExempt) {
            Log.d(TAG, "Battery optimization: already exempt ✓");
            JSObject r = new JSObject();
            r.put("exempt", true);
            r.put("requested", false);
            r.put("reason", "already_exempt");
            call.resolve(r);
            return;
        }

        Log.d(TAG, "Battery optimization: requesting exemption via system dialog");

        try {
            Intent intent = new Intent(
                Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
            intent.setData(Uri.parse("package:" + pkg));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(intent);

            JSObject r = new JSObject();
            r.put("exempt", false);
            r.put("requested", true);
            r.put("reason", "dialog_shown");
            call.resolve(r);
        } catch (Exception e) {
            Log.e(TAG, "Battery exemption dialog failed: " + e.getMessage());
            try {
                Intent fallback = new Intent(
                    Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
                fallback.setData(Uri.parse("package:" + pkg));
                fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                context.startActivity(fallback);
                JSObject r = new JSObject();
                r.put("exempt", false);
                r.put("requested", true);
                r.put("reason", "fallback_settings");
                call.resolve(r);
            } catch (Exception e2) {
                call.reject("Could not open battery settings: " + e2.getMessage(), e2);
            }
        }
    }

    @PluginMethod
    public void isBatteryOptimizationExempt(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
            JSObject r = new JSObject();
            r.put("exempt", true);
            call.resolve(r);
            return;
        }
        PowerManager pm = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
        boolean exempt = pm != null
            && pm.isIgnoringBatteryOptimizations(getContext().getPackageName());
        Log.d(TAG, "isBatteryOptimizationExempt: " + exempt);
        JSObject r = new JSObject();
        r.put("exempt", exempt);
        call.resolve(r);
    }

    // ── Service start / stop ──────────────────────────────────────────────

    @PluginMethod
    public void startService(PluginCall call) {
        Log.d(TAG, "VoicePlugin.startService called");

        boolean micGranted = getPermissionState("microphone")
            == com.getcapacitor.PermissionState.GRANTED;
        if (!micGranted) {
            Log.e(TAG, "VoicePlugin.startService: RECORD_AUDIO not granted — rejecting");
            call.reject("MIC_PERMISSION_REQUIRED: Call requestMicPermission() first");
            return;
        }

        String authToken    = call.getString("auth_token",    "");
        String serverUrl    = call.getString("server_url",    "https://quietkeep.com");
        String sessionId    = call.getString("session_id",    null);
        String mode         = call.getString("mode",          "personal");
        String workspaceId  = call.getString("workspace_id",  null);
        // STT fix: language_code from app settings — overrides device locale inside VoiceService
        String languageCode = call.getString("language_code", "en-IN");

        Log.d(TAG, "mode=" + mode + " serverUrl=" + serverUrl + " lang=" + languageCode);

        try {
            final Context context = getContext();

            final Intent intent = new Intent(context, VoiceService.class);
            intent.setAction("START");
            intent.putExtra("auth_token",    authToken);
            intent.putExtra("server_url",    serverUrl);
            intent.putExtra("session_id",    sessionId);
            intent.putExtra("mode",          mode);
            intent.putExtra("workspace_id",  workspaceId);
            intent.putExtra("language_code", languageCode);  // STT fix

            new Handler(Looper.getMainLooper()).post(() -> {
                try {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                        Log.d(TAG, "startForegroundService → VoiceService");
                        context.startForegroundService(intent);
                    } else {
                        Log.d(TAG, "startService → VoiceService");
                        context.startService(intent);
                    }
                    Log.d(TAG, "VoicePlugin.startService → service started OK");
                } catch (Exception e) {
                    Log.e(TAG, "startForegroundService deferred FAILED: "
                        + e.getClass().getSimpleName() + ": " + e.getMessage());
                }
            });

            SharedPreferences prefs =
                context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            prefs.edit()
                .putBoolean("voice_service_active", true)
                .putString("auth_token",    authToken)
                .putString("server_url",    serverUrl)
                .putString("voice_mode",    mode)
                .putString("workspace_id",  workspaceId)
                .putString("language_code", languageCode)  // STT fix
                .apply();

            Log.d(TAG, "VoicePlugin.startService → resolve OK");
            JSObject r = new JSObject();
            r.put("started", true);
            r.put("mode", mode);
            call.resolve(r);

        } catch (Exception e) {
            Log.e(TAG, "VoicePlugin.startService FAILED: "
                + e.getClass().getSimpleName() + ": " + e.getMessage());
            call.reject("VOICE_START_FAILED: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void stopService(PluginCall call) {
        Log.d(TAG, "VoicePlugin.stopService called");
        try {
            Intent i = new Intent(getContext(), VoiceService.class);
            i.setAction("STOP");
            getContext().startService(i);

            SharedPreferences prefs =
                getContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            prefs.edit().putBoolean("voice_service_active", false).apply();

            Log.d(TAG, "VoicePlugin.stopService → resolve OK");
            JSObject r = new JSObject();
            r.put("stopped", true);
            call.resolve(r);
        } catch (Exception e) {
            Log.e(TAG, "VoicePlugin.stopService FAILED: " + e.getMessage());
            call.reject("VOICE_STOP_FAILED: " + e.getMessage(), e);
        }
    }

    /**
     * FIX v6: Use VoiceService.captureActive static flag ONLY.
     *
     * ActivityManager.getRunningServices() is deprecated since Android 8 (API 26)
     * and returns unreliable/stale/empty results on ColorOS 12+, Android 12+.
     * Using it caused isRunning() to report false even when VoiceService was
     * actively capturing, breaking the JS voice state UI.
     *
     * The static captureActive flag is set to true by VoiceService.startCapture()
     * ONLY after AudioRecord.startRecording() succeeds, and set to false by
     * stopCapture() or on any AudioRecord error. It accurately reflects whether
     * mic capture is actually happening.
     */
    @PluginMethod
    public void isRunning(PluginCall call) {
        // FIX v6: removed ActivityManager.getRunningServices() — deprecated, unreliable.
        // VoiceService.captureActive is the single source of truth for capture state.
        boolean capturing = VoiceService.captureActive;
        Log.d(TAG, "VoicePlugin.isRunning: captureActive=" + capturing);
        JSObject r = new JSObject();
        r.put("running",   capturing); // service running = capture running (same semantic)
        r.put("capturing", capturing); // mic is actually recording
        call.resolve(r);
    }

    // ── BLOCK 7: Location Service bridge ─────────────────────────────────────
    // Starts/stops LocationService (background geo-trigger polling) from JS.
    // Called by orchestrator.ts → startBackgroundServices().

    @PluginMethod
    public void startLocationService(PluginCall call) {
        try {
            String authToken  = call.getString("auth_token",  null);
            String serverUrl  = call.getString("server_url",  "https://quietkeep.com");
            if (authToken == null || authToken.isEmpty()) {
                call.reject("LOCATION_START_FAILED: auth_token required");
                return;
            }

            Intent i = new Intent(getContext(), LocationService.class);
            i.setAction("START");
            i.putExtra("auth_token", authToken);
            i.putExtra("server_url", serverUrl);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                getContext().startForegroundService(i);
            } else {
                getContext().startService(i);
            }

            // Persist for restart-on-kill
            getContext().getSharedPreferences("QuietKeepPrefs", android.content.Context.MODE_PRIVATE)
                .edit()
                .putString("auth_token",  authToken)
                .putString("server_url",  serverUrl)
                .putBoolean("location_service_active", true)
                .apply();

            Log.d(TAG, "VoicePlugin.startLocationService → started");
            JSObject r = new JSObject();
            r.put("started", true);
            call.resolve(r);
        } catch (Exception e) {
            Log.e(TAG, "VoicePlugin.startLocationService FAILED: " + e.getMessage());
            call.reject("LOCATION_START_FAILED: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void stopLocationService(PluginCall call) {
        try {
            Intent i = new Intent(getContext(), LocationService.class);
            i.setAction("STOP");
            getContext().startService(i);

            getContext().getSharedPreferences("QuietKeepPrefs", android.content.Context.MODE_PRIVATE)
                .edit().putBoolean("location_service_active", false).apply();

            Log.d(TAG, "VoicePlugin.stopLocationService → stopped");
            JSObject r = new JSObject();
            r.put("stopped", true);
            call.resolve(r);
        } catch (Exception e) {
            Log.e(TAG, "VoicePlugin.stopLocationService FAILED: " + e.getMessage());
            call.reject("LOCATION_STOP_FAILED: " + e.getMessage(), e);
        }
    }

}
