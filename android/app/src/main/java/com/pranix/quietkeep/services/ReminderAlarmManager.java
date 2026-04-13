package com.pranix.quietkeep.services;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.util.Log;

import com.pranix.quietkeep.receivers.AlarmReceiver;

/**
 * ReminderAlarmManager — schedules and cancels Android alarms for QuietKeep reminders.
 *
 * Called from the Capacitor plugin bridge when the web app saves a reminder with
 * reminder_type = 'alarm'. Uses AlarmManager.setAlarmClock() which fires:
 * - When the app is closed
 * - When the phone is locked
 * - Even in Doze mode (unlike regular setExact)
 *
 * Usage from JavaScript (via CapacitorPlugin or direct bridge):
 *   window.Capacitor.Plugins.ReminderAlarm.schedule({
 *     reminderId: "uuid",
 *     reminderText: "Doctor appointment",
 *     fireAtMs: 1712345678000,
 *     isAlarmType: true,
 *   });
 */
public class ReminderAlarmManager {

    private static final String TAG = "QK_ALARM_MGR";

    /**
     * Schedule a reminder alarm.
     * @param context    app context
     * @param reminderId unique reminder UUID from Supabase
     * @param text       reminder text to show in notification
     * @param fireAtMs   epoch milliseconds when to fire
     * @param isAlarm    true = alarm sound bypassing silent, false = regular notification
     */
    public static void scheduleReminder(Context context, String reminderId, String text, long fireAtMs, boolean isAlarm) {
        if (fireAtMs <= System.currentTimeMillis()) {
            Log.w(TAG, "scheduleReminder: fireAtMs is in the past, skipping: " + reminderId);
            return;
        }

        AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;

        Intent intent = new Intent(context, AlarmReceiver.class);
        intent.putExtra("reminder_id",   reminderId);
        intent.putExtra("reminder_text", text);
        intent.putExtra("is_alarm_type", isAlarm);

        int flags = Build.VERSION.SDK_INT >= Build.VERSION_CODES.M
            ? PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            : PendingIntent.FLAG_UPDATE_CURRENT;

        PendingIntent pi = PendingIntent.getBroadcast(
            context, Math.abs(reminderId.hashCode()) % 100000, intent, flags
        );

        if (isAlarm && Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            // setAlarmClock: fires in Doze, shows clock icon in status bar
            AlarmManager.AlarmClockInfo alarmClockInfo = new AlarmManager.AlarmClockInfo(fireAtMs, pi);
            am.setAlarmClock(alarmClockInfo, pi);
            Log.d(TAG, "scheduleReminder: setAlarmClock at " + fireAtMs + " for " + reminderId);
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            // setExactAndAllowWhileIdle: fires in Doze but no status bar icon
            am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, fireAtMs, pi);
            Log.d(TAG, "scheduleReminder: setExactAndAllowWhileIdle at " + fireAtMs + " for " + reminderId);
        } else {
            am.setExact(AlarmManager.RTC_WAKEUP, fireAtMs, pi);
            Log.d(TAG, "scheduleReminder: setExact at " + fireAtMs + " for " + reminderId);
        }
    }

    /**
     * Cancel a previously scheduled alarm.
     */
    public static void cancelReminder(Context context, String reminderId) {
        AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;

        Intent intent = new Intent(context, AlarmReceiver.class);
        int flags = Build.VERSION.SDK_INT >= Build.VERSION_CODES.M
            ? PendingIntent.FLAG_NO_CREATE | PendingIntent.FLAG_IMMUTABLE
            : PendingIntent.FLAG_NO_CREATE;

        PendingIntent pi = PendingIntent.getBroadcast(
            context, Math.abs(reminderId.hashCode()) % 100000, intent, flags
        );

        if (pi != null) {
            am.cancel(pi);
            pi.cancel();
            Log.d(TAG, "cancelReminder: cancelled " + reminderId);
        }
    }
}
