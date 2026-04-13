package com.pranix.quietkeep.services;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.util.Log;
import androidx.annotation.Nullable;
import com.pranix.quietkeep.R;

/**
 * KeepAliveService v2
 *
 * FIX v2: Changed notification importance from IMPORTANCE_MIN to IMPORTANCE_LOW.
 *
 * ROOT CAUSE OF PREVIOUS FAILURE:
 * IMPORTANCE_MIN notifications are invisible to OplusHansManager (ColorOS).
 * Hans does not treat a process with an IMPORTANCE_MIN foreground notification
 * as "actively foreground" — it still freezes the UID during the WebView load window.
 *
 * IMPORTANCE_LOW:
 * - No sound, no heads-up popup, no vibration
 * - Appears silently in the notification shade (small persistent entry)
 * - Hans DOES recognise this as a legitimate foreground signal → no freeze
 * - This is the minimum importance level that bypasses Hans on ColorOS 12+
 *
 * PURPOSE: Prevent Realme/ColorOS OplusHansManager from freezing the app
 * UID during cold start while the Capacitor WebView is loading.
 * Once the app is loaded, VoiceService takes over the foreground signal.
 *
 * LIFECYCLE:
 * - Started: MainActivity.onCreate() (BEFORE super.onCreate() and WebView load)
 * - Keeps the process alive during the WebView initialisation window
 * - START_STICKY ensures restart if OS kills it
 */
public class KeepAliveService extends Service {

    private static final String TAG        = "QK_ALIVE";
    private static final String CHANNEL_ID = "qk_keepalive";
    private static final int    NOTIF_ID   = 8001;

    @Override
    public void onCreate() {
        super.onCreate();
        Log.d(TAG, "KeepAliveService.onCreate");
        createChannel();
        startForegroundCompat();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        Log.d(TAG, "KeepAliveService.onStartCommand — process is alive ✓");
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        Log.d(TAG, "KeepAliveService.onDestroy");
        super.onDestroy();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            // FIX v2: IMPORTANCE_LOW (was IMPORTANCE_MIN).
            // IMPORTANCE_MIN is invisible to Hans and does not register as
            // a real foreground signal on ColorOS. IMPORTANCE_LOW is silent
            // (no sound, no popup) but IS visible in the notification shade
            // and IS recognised as active foreground by Hans.
            NotificationChannel ch = new NotificationChannel(
                CHANNEL_ID,
                "QuietKeep",
                NotificationManager.IMPORTANCE_LOW); // FIXED: was IMPORTANCE_MIN
            ch.setDescription("Keeps QuietKeep active in the background");
            ch.setShowBadge(false);
            ch.enableLights(false);
            ch.enableVibration(false);
            NotificationManager nm =
                (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            if (nm != null) nm.createNotificationChannel(ch);
        }
    }

    private void startForegroundCompat() {
        Notification n = buildNotification();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
        } else {
            startForeground(NOTIF_ID, n);
        }
        Log.d(TAG, "KeepAliveService: startForeground called ✓ (Hans bypass active, IMPORTANCE_LOW)");
    }

    private Notification buildNotification() {
        Notification.Builder builder = new Notification.Builder(this, CHANNEL_ID)
            .setContentTitle("QuietKeep")
            .setContentText("Active")
            .setSmallIcon(R.mipmap.ic_launcher)
            .setOngoing(true)
            .setShowWhen(false);

        // FIX v2: Use PRIORITY_LOW (was PRIORITY_MIN).
        // PRIORITY_LOW = silent notification, appears in shade, no sound/popup.
        // PRIORITY_MIN = completely suppressed on many devices including Realme.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            builder.setPriority(Notification.PRIORITY_LOW); // FIXED: was PRIORITY_MIN
            // Removed VISIBILITY_SECRET — not needed, and can cause issues on some OEMs
        }

        return builder.build();
    }
}
