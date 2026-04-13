package com.pranix.quietkeep.receivers;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.util.Log;
import com.pranix.quietkeep.services.VoiceService;
import com.pranix.quietkeep.services.LocationService;

/**
 * BootReceiver — restarts VoiceService after device reboot if it was active.
 * v2 (FIX B10): Now checks RECORD_AUDIO permission before attempting restart.
 *     On Android 6+, RECORD_AUDIO is a dangerous permission requiring runtime
 *     grant. On boot, if the permission was revoked or never granted, attempting
 *     startForegroundService() will cause VoiceService to silently fail.
 *     We abort early and log instead of letting the service start and fail.
 */
public class BootReceiver extends BroadcastReceiver {

    private static final String TAG        = "QK_BOOT";
    private static final String PREFS_NAME = "QuietKeepPrefs";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (!Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())) return;

        // FIX B10: Check RECORD_AUDIO permission before attempting service restart.
        // If user revoked mic permission after enabling TAU, skip restart gracefully.
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.M) {
            int permState = context.checkSelfPermission(android.Manifest.permission.RECORD_AUDIO);
            if (permState != PackageManager.PERMISSION_GRANTED) {
                Log.w(TAG, "RECORD_AUDIO not granted — skipping VoiceService restart after boot.");
                // Clear the active flag so we don't retry on subsequent boots
                context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                    .edit().putBoolean("voice_service_active", false).apply();
                return;
            }
        }

        SharedPreferences prefs =
            context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        if (!prefs.getBoolean("voice_service_active", false)) return;

        String authToken   = prefs.getString("auth_token",   null);
        String mode        = prefs.getString("voice_mode",   "personal");
        String serverUrl   = prefs.getString("server_url",   "https://quietkeep.com");
        String workspaceId = prefs.getString("workspace_id", null);

        if (authToken == null) {
            Log.w(TAG, "No auth_token stored — skipping VoiceService restart.");
            return;
        }

        Log.d(TAG, "BootReceiver: restarting VoiceService (mode=" + mode + ")");

        Intent svc = new Intent(context, VoiceService.class);
        svc.setAction("START");
        svc.putExtra("auth_token",   authToken);
        svc.putExtra("server_url",   serverUrl);
        svc.putExtra("mode",         mode);
        svc.putExtra("workspace_id", workspaceId);

        try {
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
                context.startForegroundService(svc);
            } else {
                context.startService(svc);
            }
            Log.d(TAG, "BootReceiver: VoiceService started OK");
        } catch (Exception e) {
            Log.e(TAG, "BootReceiver: Failed to start VoiceService: " + e.getMessage());
        }

        // Also restart LocationService for geo-triggered keeps
        try {
            Intent locSvc = new Intent(context, LocationService.class);
            locSvc.setAction("START");
            locSvc.putExtra("auth_token", authToken);
            locSvc.putExtra("server_url", serverUrl);
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
                context.startForegroundService(locSvc);
            } else {
                context.startService(locSvc);
            }
            Log.d(TAG, "BootReceiver: LocationService started OK");
        } catch (Exception e) {
            Log.w(TAG, "BootReceiver: Could not start LocationService: " + e.getMessage());
        }
    }
}
