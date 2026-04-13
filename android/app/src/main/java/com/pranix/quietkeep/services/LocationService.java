package com.pranix.quietkeep.services;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.util.Log;

import com.google.android.gms.location.FusedLocationProviderClient;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.Priority;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * LocationService — background geo-trigger polling for QuietKeep.
 *
 * Runs as a foreground service, polls every GEO_INTERVAL_MS milliseconds,
 * reads the current GPS position via FusedLocationProviderClient, and
 * POSTs it to /api/geo/check with a Bearer token.
 *
 * The /api/geo/check endpoint evaluates geo-triggered keeps:
 *   – keeps with geo_trigger_enabled=true whose location matches
 *   – evaluates them with user_state=AT_LOCATION
 *
 * To start:
 *   Intent i = new Intent(context, LocationService.class);
 *   i.setAction("START");
 *   i.putExtra("auth_token",  <Supabase access token>);
 *   i.putExtra("server_url",  "https://quietkeep.com");
 *   context.startForegroundService(i);
 *
 * To stop:
 *   Intent i = new Intent(context, LocationService.class);
 *   i.setAction("STOP");
 *   context.startService(i);
 *
 * Required permissions (already in AndroidManifest.xml after fix):
 *   ACCESS_FINE_LOCATION, ACCESS_COARSE_LOCATION, ACCESS_BACKGROUND_LOCATION,
 *   FOREGROUND_SERVICE, FOREGROUND_SERVICE_LOCATION
 *
 * Required gradle dependency:
 *   implementation 'com.google.android.gms:play-services-location:21.2.0'
 */
public class LocationService extends Service {

    private static final String TAG             = "QK_LOC";
    private static final String CHANNEL_ID      = "qk_location_channel";
    private static final int    NOTIF_ID        = 3;
    private static final long   GEO_INTERVAL_MS = 5 * 60 * 1000L; // 5 minutes
    private static final String PREFS_NAME      = "QuietKeepPrefs";

    private String authToken;
    private String serverUrl;

    private final Handler  handler    = new Handler(Looper.getMainLooper());
    private FusedLocationProviderClient fusedClient;
    private boolean running = false;

    // ── Runnable: poll location every GEO_INTERVAL_MS ────────────────────
    private final Runnable pollRunnable = new Runnable() {
        @Override
        public void run() {
            if (!running) return;
            fetchAndPost();
            handler.postDelayed(this, GEO_INTERVAL_MS);
        }
    };

    // ── Service lifecycle ─────────────────────────────────────────────────

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();
        fusedClient = LocationServices.getFusedLocationProviderClient(this);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) {
            // Restarted by system — re-read prefs
            SharedPreferences prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            authToken = prefs.getString("auth_token",  null);
            serverUrl = prefs.getString("server_url",  "https://quietkeep.com");
            if (authToken != null) startPolling();
            return START_STICKY;
        }

        String action = intent.getAction();

        if ("START".equals(action)) {
            authToken = intent.getStringExtra("auth_token");
            serverUrl = intent.getStringExtra("server_url");
            if (serverUrl == null) serverUrl = "https://quietkeep.com";
            Log.d(TAG, "LocationService START: server=" + serverUrl);
            startPolling();
        } else if ("STOP".equals(action)) {
            Log.d(TAG, "LocationService STOP");
            stopPolling();
            stopSelf();
        }

        return START_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }

    @Override
    public void onDestroy() {
        super.onDestroy();
        stopPolling();
        Log.d(TAG, "LocationService destroyed");
    }

    // ── Internal helpers ──────────────────────────────────────────────────

    private void startPolling() {
        if (running) return;
        running = true;

        Notification n = buildNotification();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            try {
                startForeground(NOTIF_ID, n,
                    android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
            } catch (Exception e) {
                startForeground(NOTIF_ID, n);
            }
        } else {
            startForeground(NOTIF_ID, n);
        }

        // Fire immediately, then every GEO_INTERVAL_MS
        handler.post(pollRunnable);
        Log.d(TAG, "LocationService: polling started every " + (GEO_INTERVAL_MS / 60000) + " min");
    }

    private void stopPolling() {
        running = false;
        handler.removeCallbacks(pollRunnable);
    }

    /**
     * Get last known location from FusedLocationProviderClient and POST to /api/geo/check.
     * Runs on main thread Handler; the actual HTTP call is dispatched to a background thread.
     */
    private void fetchAndPost() {
        if (authToken == null || serverUrl == null) return;

        try {
            fusedClient.getCurrentLocation(Priority.PRIORITY_BALANCED_POWER_ACCURACY, null)
                .addOnSuccessListener(location -> {
                    if (location == null) {
                        Log.d(TAG, "fetchAndPost: no location available");
                        return;
                    }
                    double lat      = location.getLatitude();
                    double lng      = location.getLongitude();
                    float  accuracy = location.getAccuracy();          // meters
                    float  bearing  = location.hasBearing()  ? location.getBearing()  : -1f;
                    float  speed    = location.hasSpeed()    ? location.getSpeed()    : -1f;
                    Log.d(TAG, "fetchAndPost: lat=" + lat + " lng=" + lng
                            + " acc=" + accuracy + " bearing=" + bearing + " speed=" + speed);
                    new Thread(() -> postGeoCheck(lat, lng, accuracy, bearing, speed)).start();
                })
                .addOnFailureListener(e -> Log.w(TAG, "fetchAndPost: location error: " + e.getMessage()));
        } catch (SecurityException e) {
            Log.w(TAG, "fetchAndPost: location permission denied: " + e.getMessage());
        }
    }

    /**
     * POST { lat, lng } to /api/geo/check with Authorization: Bearer header.
     * Runs on a background thread.
     */
    /**
     * v2: POST { lat, lng, accuracy_m, heading_deg, speed_mps } to /api/geo/check.
     * accuracy, bearing, speed are -1 if unavailable (treated as null server-side).
     */
    private void postGeoCheck(double lat, double lng, float accuracy, float bearing, float speed) {
        HttpURLConnection conn = null;
        try {
            URL url = new URL(serverUrl + "/api/geo/check");
            conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("POST");
            conn.setConnectTimeout(10_000);
            conn.setReadTimeout(15_000);
            conn.setDoOutput(true);
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setRequestProperty("Authorization", "Bearer " + authToken);

            StringBuilder bodyBuilder = new StringBuilder();
            bodyBuilder.append("{\"lat\":").append(lat)
                       .append(",\"lng\":").append(lng);
            if (accuracy >= 0) bodyBuilder.append(",\"accuracy_m\":").append(accuracy);
            if (bearing  >= 0) bodyBuilder.append(",\"heading_deg\":").append(bearing);
            if (speed    >= 0) bodyBuilder.append(",\"speed_mps\":").append(speed);
            bodyBuilder.append("}");
            String body = bodyBuilder.toString();
            try (OutputStream os = conn.getOutputStream()) {
                os.write(body.getBytes(StandardCharsets.UTF_8));
            }

            int code = conn.getResponseCode();
            Log.d(TAG, "postGeoCheck: HTTP " + code);

            if (code == 200) {
                BufferedReader br = new BufferedReader(new InputStreamReader(conn.getInputStream()));
                StringBuilder sb = new StringBuilder();
                String line;
                while ((line = br.readLine()) != null) sb.append(line);
                String response = sb.toString();
                Log.d(TAG, "postGeoCheck: response=" + response.substring(0, Math.min(200, response.length())));
            }
        } catch (Exception e) {
            Log.w(TAG, "postGeoCheck: error: " + e.getMessage());
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    // ── Notification ──────────────────────────────────────────────────────

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel ch = new NotificationChannel(
                CHANNEL_ID, "QuietKeep Location", NotificationManager.IMPORTANCE_LOW);
            ch.setDescription("Background location tracking for geo-triggered keeps");
            ch.setShowBadge(false);
            ((NotificationManager) getSystemService(NOTIFICATION_SERVICE)).createNotificationChannel(ch);
        }
    }

    private Notification buildNotification() {
        return new Notification.Builder(this, CHANNEL_ID)
            .setContentTitle("QuietKeep Location Active")
            .setContentText("Watching for location-based reminders")
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setOngoing(true)
            .build();
    }
}
