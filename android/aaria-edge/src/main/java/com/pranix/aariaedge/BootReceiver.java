package com.pranix.aariaedge;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.os.Build;
import androidx.core.app.NotificationCompat;

import org.json.JSONObject;

import java.io.InputStream;
import java.nio.charset.StandardCharsets;

public class BootReceiver extends BroadcastReceiver {
    private static final String CHANNEL_ID = "aaria_listen_channel";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction()) || 
            Intent.ACTION_MY_PACKAGE_REPLACED.equals(intent.getAction())) {
            
            android.content.SharedPreferences prefs = context.getSharedPreferences("aaria_prefs", Context.MODE_PRIVATE);
            boolean wasOn = prefs.getBoolean("aaria_listen_was_on", false);
            
            if (wasOn) {
                NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
                if (manager == null || !manager.areNotificationsEnabled()) return;

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    NotificationChannel channel = new NotificationChannel(
                            CHANNEL_ID,
                            "Aaria Background Listening",
                            NotificationManager.IMPORTANCE_LOW
                    );
                    manager.createNotificationChannel(channel);
                }

                String lang = prefs.getString("aaria_lang", "en");
                String title = getLocalizedString(context, "s4_paused_title", "Listening is paused", lang);
                String textTemplate = getLocalizedString(context, "s4_paused_open_app", "Open {app} to start listening again.", lang);
                String text = textTemplate.replace("{app}", getAppName(context));

                Intent launchIntent = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
                PendingIntent pi = null;
                if (launchIntent != null) {
                    pi = PendingIntent.getActivity(context, 0, launchIntent, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
                }

                Notification notification = new NotificationCompat.Builder(context, CHANNEL_ID)
                        .setContentTitle(title)
                        .setContentText(text)
                        .setContentIntent(pi)
                        .setSmallIcon(android.R.drawable.ic_btn_speak_now)
                        .setPriority(NotificationCompat.PRIORITY_LOW)
                        .setAutoCancel(true)
                        .build();

                manager.notify(1433, notification);
            }
        }
    }

    private String getLocalizedString(Context context, String key, String fallback, String lang) {
        try {
            InputStream is = context.getAssets().open("ui/" + lang + ".json");
            byte[] buffer = new byte[is.available()];
            is.read(buffer);
            String json = new String(buffer, StandardCharsets.UTF_8);
            JSONObject strings = new JSONObject(json);
            return strings.optString(key, fallback);
        } catch (Exception e) {}
        return fallback;
    }
    
    private String getAppName(Context context) {
        try {
            ApplicationInfo ai = context.getApplicationInfo();
            return context.getPackageManager().getApplicationLabel(ai).toString();
        } catch (Exception e) {
            return "QuietKeep";
        }
    }
}
