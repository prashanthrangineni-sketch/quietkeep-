package com.pranix.quietkeep.receivers;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.util.Log;

import androidx.core.app.NotificationCompat;

import com.pranix.quietkeep.MainActivity;

public class AlarmReceiver extends BroadcastReceiver {

    private static final String TAG        = "QK_ALARM";
    private static final String CHANNEL_ID = "qk_reminders_alarm";

    @Override
    public void onReceive(Context context, Intent intent) {
        Log.d(TAG, "AlarmReceiver.onReceive: alarm fired");

        String reminderId   = intent.getStringExtra("reminder_id");
        String reminderText = intent.getStringExtra("reminder_text");
        boolean isAlarmType = intent.getBooleanExtra("is_alarm_type", false);

        if (reminderId == null || reminderText == null) {
            Log.w(TAG, "AlarmReceiver: missing reminder_id or reminder_text, skipping");
            return;
        }

        createNotificationChannel(context, isAlarmType);

        String actionType = intent.getStringExtra("action_type");
        if (actionType != null && !actionType.trim().isEmpty()) {
            // Build the intent to launch CountdownActivity
            Intent countdownIntent = new Intent(context, com.pranix.quietkeep.activities.CountdownActivity.class);
            countdownIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            
            // Forward action spec properties
            countdownIntent.putExtra("action_type", actionType);
            countdownIntent.putExtra("phone", intent.getStringExtra("phone"));
            countdownIntent.putExtra("whatsapp_phone", intent.getStringExtra("whatsapp_phone"));
            countdownIntent.putExtra("whatsapp_message", intent.getStringExtra("whatsapp_message"));
            countdownIntent.putExtra("navigation_query", intent.getStringExtra("navigation_query"));
            countdownIntent.putExtra("lat", intent.getStringExtra("lat"));
            countdownIntent.putExtra("lng", intent.getStringExtra("lng"));
            countdownIntent.putExtra("search_query", intent.getStringExtra("search_query"));
            countdownIntent.putExtra("app_name", intent.getStringExtra("app_name"));
            countdownIntent.putExtra("alarm_message", intent.getStringExtra("alarm_message"));
            if (intent.hasExtra("alarm_hour")) countdownIntent.putExtra("alarm_hour", intent.getIntExtra("alarm_hour", 8));
            if (intent.hasExtra("alarm_minutes")) countdownIntent.putExtra("alarm_minutes", intent.getIntExtra("alarm_minutes", 0));
            if (intent.hasExtra("timer_length_seconds")) countdownIntent.putExtra("timer_length_seconds", intent.getIntExtra("timer_length_seconds", 60));
            countdownIntent.putExtra("sms_message", intent.getStringExtra("sms_message"));
            if (intent.hasExtra("torch_enable")) countdownIntent.putExtra("torch_enable", intent.getBooleanExtra("torch_enable", false));
            if (intent.hasExtra("volume_direction")) countdownIntent.putExtra("volume_direction", intent.getIntExtra("volume_direction", 0));
            countdownIntent.putExtra("display_name", intent.getStringExtra("display_name"));

            // Show full screen intent notification
            showNotificationWithFullScreenIntent(context, reminderId, reminderText, isAlarmType, countdownIntent);

            // Also launch CountdownActivity directly if full screen intent is allowed
            if (canUseFullScreenIntent(context)) {
                try {
                    context.startActivity(countdownIntent);
                } catch (Exception e) {
                    Log.w(TAG, "Failed to start CountdownActivity directly: " + e.getMessage());
                }
            } else {
                Log.w(TAG, "Skipping direct CountdownActivity start because full-screen intent is not permitted by OS/user.");
            }
        } else {
            // Legacy / simple notification flow
            showNotification(context, reminderId, reminderText, isAlarmType);
        }

        // Speak the reminder out loud via native TTS
        try {
            Intent ttsIntent = new Intent(context, com.pranix.quietkeep.services.ReminderTTSService.class);
            ttsIntent.putExtra("text_to_speak", reminderText);
            context.startService(ttsIntent);
        } catch (Exception e) {
            Log.w(TAG, "Failed to start ReminderTTSService: " + e.getMessage());
        }
    }

    private boolean canUseFullScreenIntent(Context context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) { // API 34+
            NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) {
                boolean allowed = nm.canUseFullScreenIntent();
                if (!allowed) {
                    Log.w(TAG, "canUseFullScreenIntent: USE_FULL_SCREEN_INTENT permission is withheld by the OS/user.");
                }
                return allowed;
            }
        }
        return true;
    }

    private void createNotificationChannel(Context context, boolean isAlarmType) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;

        int importance = isAlarmType
            ? NotificationManager.IMPORTANCE_HIGH
            : NotificationManager.IMPORTANCE_DEFAULT;

        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            "QuietKeep Reminders",
            importance
        );
        channel.setDescription("Reminder and alarm notifications from QuietKeep");
        channel.enableVibration(true);
        channel.setVibrationPattern(new long[]{0, 300, 150, 300});

        if (isAlarmType) {
            Uri alarmUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
            if (alarmUri == null) {
                alarmUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
            }
            AudioAttributes att = new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ALARM)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build();
            channel.setSound(alarmUri, att);
            channel.setBypassDnd(true);
        }

        nm.createNotificationChannel(channel);
    }

    private void showNotification(Context context, String reminderId, String reminderText, boolean isAlarmType) {
        NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;

        Intent openIntent = new Intent(context, MainActivity.class);
        openIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        openIntent.putExtra("deeplink", "/reminders");

        int flags = Build.VERSION.SDK_INT >= Build.VERSION_CODES.M
            ? PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            : PendingIntent.FLAG_UPDATE_CURRENT;

        PendingIntent pi = PendingIntent.getActivity(
            context, reminderId.hashCode(), openIntent, flags
        );

        Uri soundUri = isAlarmType
            ? RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
            : RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
            .setContentTitle("⏰ QuietKeep Reminder")
            .setContentText(reminderText)
            .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
            .setContentIntent(pi)
            .setAutoCancel(true)
            .setPriority(isAlarmType ? NotificationCompat.PRIORITY_MAX : NotificationCompat.PRIORITY_HIGH)
            .setCategory(isAlarmType ? NotificationCompat.CATEGORY_ALARM : NotificationCompat.CATEGORY_REMINDER)
            .setSound(soundUri)
            .setVibrate(new long[]{0, 300, 150, 300})
            .setStyle(new NotificationCompat.BigTextStyle().bigText(reminderText));

        if (isAlarmType) {
            if (canUseFullScreenIntent(context)) {
                builder.setFullScreenIntent(pi, true);
            } else {
                Log.w(TAG, "showNotification: Skipping setFullScreenIntent because permission is withheld.");
            }
        }

        nm.notify(Math.abs(reminderId.hashCode()) % 10000, builder.build());
        Log.d(TAG, "AlarmReceiver: notification shown for reminder=" + reminderId);
    }

    private void showNotificationWithFullScreenIntent(Context context, String reminderId, String reminderText, boolean isAlarmType, Intent countdownIntent) {
        NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;

        int flags = Build.VERSION.SDK_INT >= Build.VERSION_CODES.M
            ? PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_MUTABLE
            : PendingIntent.FLAG_UPDATE_CURRENT;

        PendingIntent pi = PendingIntent.getActivity(
            context, reminderId.hashCode(), countdownIntent, flags
        );

        Uri soundUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
            .setContentTitle("⏰ QuietKeep Scheduled Execution")
            .setContentText(reminderText)
            .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setSound(soundUri)
            .setVibrate(new long[]{0, 300, 150, 300})
            .setStyle(new NotificationCompat.BigTextStyle().bigText(reminderText));

        if (canUseFullScreenIntent(context)) {
            builder.setFullScreenIntent(pi, true);
        } else {
            Log.w(TAG, "showNotificationWithFullScreenIntent: Skipping setFullScreenIntent because permission is withheld.");
        }

        nm.notify(Math.abs(reminderId.hashCode()) % 10000, builder.build());
        Log.d(TAG, "AlarmReceiver: full screen notification shown for reminder=" + reminderId);
    }
}
