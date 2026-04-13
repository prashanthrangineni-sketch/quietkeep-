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

/**
 * AlarmReceiver — fires when an AlarmManager alarm triggers for a QuietKeep reminder.
 *
 * Called by ReminderAlarmManager.scheduleReminder() when the alarm time arrives.
 * Works even when the app is completely closed or the phone is locked.
 *
 * The notification:
 * - Shows reminder text
 * - Rings even if phone is on silent (for "Alarm" type reminders)
 * - Tapping opens the app at /reminders
 *
 * Registration: android/app/src/main/AndroidManifest.xml
 * Must add:
 *   <receiver android:name=".receivers.AlarmReceiver" android:exported="false" />
 */
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
        showNotification(context, reminderId, reminderText, isAlarmType);
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
            // Alarm type: ring even on silent using the default alarm sound
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

        // Tap notification → open app at /reminders
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
            builder.setFullScreenIntent(pi, true);  // Show over lock screen
        }

        // Use reminder_id hash as notification ID so each reminder shows separately
        nm.notify(Math.abs(reminderId.hashCode()) % 10000, builder.build());
        Log.d(TAG, "AlarmReceiver: notification shown for reminder=" + reminderId);
    }
}
