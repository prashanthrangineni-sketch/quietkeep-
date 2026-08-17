package com.pranix.quietkeep.services;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.util.Log;
import com.pranix.quietkeep.receivers.AlarmReceiver;
import com.pranix.quietkeep.services.ActionExecutor.ActionSpec;

public class ReminderAlarmManager {

    private static final String TAG = "QK_ALARM_MGR";
    private static final String PREFS_NAME = "QuietKeepAlarmsPrefs";

    public static void scheduleReminder(Context context, String reminderId, String text, long fireAtMs, boolean isAlarm) {
        scheduleReminder(context, reminderId, text, fireAtMs, isAlarm, null);
    }

    public static void scheduleReminder(Context context, String reminderId, String text, long fireAtMs, boolean isAlarm, ActionSpec actionSpec) {
        if (fireAtMs <= System.currentTimeMillis()) {
            Log.w(TAG, "scheduleReminder: fireAtMs is in the past, skipping: " + reminderId);
            return;
        }

        // Persist to SharedPreferences
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        SharedPreferences.Editor editor = prefs.edit();
        
        java.util.Set<String> activeIds = prefs.getStringSet("active_alarm_ids", null);
        java.util.Set<String> newActiveIds = new java.util.HashSet<>();
        if (activeIds != null) {
            newActiveIds.addAll(activeIds);
        }
        newActiveIds.add(reminderId);
        editor.putStringSet("active_alarm_ids", newActiveIds);
        
        editor.putString("alarm_text_" + reminderId, text);
        editor.putLong("alarm_fire_at_" + reminderId, fireAtMs);
        editor.putBoolean("alarm_is_alarm_" + reminderId, isAlarm);
        
        if (actionSpec != null) {
            editor.putString("alarm_action_type_" + reminderId, actionSpec.type);
            editor.putString("alarm_phone_" + reminderId, actionSpec.phone);
            editor.putString("alarm_whatsapp_phone_" + reminderId, actionSpec.whatsappPhone);
            editor.putString("alarm_whatsapp_message_" + reminderId, actionSpec.whatsappMessage);
            editor.putString("alarm_navigation_query_" + reminderId, actionSpec.navigationQuery);
            editor.putString("alarm_lat_" + reminderId, actionSpec.lat);
            editor.putString("alarm_lng_" + reminderId, actionSpec.lng);
            editor.putString("alarm_search_query_" + reminderId, actionSpec.searchQuery);
            editor.putString("alarm_app_name_" + reminderId, actionSpec.appName);
            editor.putString("alarm_alarm_message_" + reminderId, actionSpec.alarmMessage);
            if (actionSpec.alarmHour != null) editor.putInt("alarm_alarm_hour_" + reminderId, actionSpec.alarmHour);
            if (actionSpec.alarmMinutes != null) editor.putInt("alarm_alarm_minutes_" + reminderId, actionSpec.alarmMinutes);
            if (actionSpec.timerLengthSeconds != null) editor.putInt("alarm_timer_length_seconds_" + reminderId, actionSpec.timerLengthSeconds);
            editor.putString("alarm_sms_message_" + reminderId, actionSpec.smsMessage);
            if (actionSpec.torchEnable != null) editor.putBoolean("alarm_torch_enable_" + reminderId, actionSpec.torchEnable);
            if (actionSpec.volumeDirection != null) editor.putInt("alarm_volume_direction_" + reminderId, actionSpec.volumeDirection);
        }
        editor.apply();

        // Schedule in the system AlarmManager
        scheduleReminderInSystem(context, reminderId, text, fireAtMs, isAlarm, actionSpec);
    }

    private static void scheduleReminderInSystem(Context context, String reminderId, String text, long fireAtMs, boolean isAlarm, ActionSpec actionSpec) {
        AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;

        Intent intent = new Intent(context, AlarmReceiver.class);
        intent.putExtra("reminder_id",   reminderId);
        intent.putExtra("reminder_text", text);
        intent.putExtra("is_alarm_type", isAlarm);

        if (actionSpec != null) {
            intent.putExtra("action_type", actionSpec.type);
            intent.putExtra("phone", actionSpec.phone);
            intent.putExtra("whatsapp_phone", actionSpec.whatsappPhone);
            intent.putExtra("whatsapp_message", actionSpec.whatsappMessage);
            intent.putExtra("navigation_query", actionSpec.navigationQuery);
            intent.putExtra("lat", actionSpec.lat);
            intent.putExtra("lng", actionSpec.lng);
            intent.putExtra("search_query", actionSpec.searchQuery);
            intent.putExtra("app_name", actionSpec.appName);
            intent.putExtra("alarm_message", actionSpec.alarmMessage);
            if (actionSpec.alarmHour != null) intent.putExtra("alarm_hour", actionSpec.alarmHour);
            if (actionSpec.alarmMinutes != null) intent.putExtra("alarm_minutes", actionSpec.alarmMinutes);
            if (actionSpec.timerLengthSeconds != null) intent.putExtra("timer_length_seconds", actionSpec.timerLengthSeconds);
            intent.putExtra("sms_message", actionSpec.smsMessage);
            if (actionSpec.torchEnable != null) intent.putExtra("torch_enable", actionSpec.torchEnable);
            if (actionSpec.volumeDirection != null) intent.putExtra("volume_direction", actionSpec.volumeDirection);
            
            // Derive displayName
            String displayName = null;
            if (actionSpec.phone != null) displayName = actionSpec.phone;
            else if (actionSpec.whatsappPhone != null) displayName = actionSpec.whatsappPhone;
            else if (actionSpec.navigationQuery != null) displayName = actionSpec.navigationQuery;
            else if (actionSpec.appName != null) displayName = actionSpec.appName;
            intent.putExtra("display_name", displayName);
        }

        int flags = Build.VERSION.SDK_INT >= Build.VERSION_CODES.M
            ? PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            : PendingIntent.FLAG_UPDATE_CURRENT;

        PendingIntent pi = PendingIntent.getBroadcast(
            context, Math.abs(reminderId.hashCode()) % 100000, intent, flags
        );

        if (isAlarm && Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            AlarmManager.AlarmClockInfo alarmClockInfo = new AlarmManager.AlarmClockInfo(fireAtMs, pi);
            am.setAlarmClock(alarmClockInfo, pi);
            Log.d(TAG, "scheduleReminderInSystem: setAlarmClock at " + fireAtMs + " for " + reminderId);
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, fireAtMs, pi);
            Log.d(TAG, "scheduleReminderInSystem: setExactAndAllowWhileIdle at " + fireAtMs + " for " + reminderId);
        } else {
            am.setExact(AlarmManager.RTC_WAKEUP, fireAtMs, pi);
            Log.d(TAG, "scheduleReminderInSystem: setExact at " + fireAtMs + " for " + reminderId);
        }
    }

    public static void cancelReminder(Context context, String reminderId) {
        // Remove from SharedPreferences
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        SharedPreferences.Editor editor = prefs.edit();
        
        java.util.Set<String> activeIds = prefs.getStringSet("active_alarm_ids", null);
        if (activeIds != null) {
            java.util.Set<String> newActiveIds = new java.util.HashSet<>(activeIds);
            newActiveIds.remove(reminderId);
            editor.putStringSet("active_alarm_ids", newActiveIds);
        }
        
        editor.remove("alarm_text_" + reminderId);
        editor.remove("alarm_fire_at_" + reminderId);
        editor.remove("alarm_is_alarm_" + reminderId);
        editor.remove("alarm_action_type_" + reminderId);
        editor.remove("alarm_phone_" + reminderId);
        editor.remove("alarm_whatsapp_phone_" + reminderId);
        editor.remove("alarm_whatsapp_message_" + reminderId);
        editor.remove("alarm_navigation_query_" + reminderId);
        editor.remove("alarm_lat_" + reminderId);
        editor.remove("alarm_lng_" + reminderId);
        editor.remove("alarm_search_query_" + reminderId);
        editor.remove("alarm_app_name_" + reminderId);
        editor.remove("alarm_alarm_message_" + reminderId);
        editor.remove("alarm_alarm_hour_" + reminderId);
        editor.remove("alarm_alarm_minutes_" + reminderId);
        editor.remove("alarm_timer_length_seconds_" + reminderId);
        editor.remove("alarm_sms_message_" + reminderId);
        editor.remove("alarm_torch_enable_" + reminderId);
        editor.remove("alarm_volume_direction_" + reminderId);
        editor.apply();

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

    public static void restoreAlarms(Context context) {
        Log.d(TAG, "Restoring alarms after device reboot...");
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        java.util.Set<String> activeIds = prefs.getStringSet("active_alarm_ids", null);
        if (activeIds == null || activeIds.isEmpty()) {
            Log.d(TAG, "No alarms found to restore.");
            return;
        }
        
        long now = System.currentTimeMillis();
        java.util.Set<String> toRemove = new java.util.HashSet<>();
        
        for (String id : activeIds) {
            long fireAtMs = prefs.getLong("alarm_fire_at_" + id, 0);
            if (fireAtMs <= now) {
                toRemove.add(id);
                continue;
            }
            
            String text = prefs.getString("alarm_text_" + id, "");
            boolean isAlarm = prefs.getBoolean("alarm_is_alarm_" + id, false);
            
            ActionSpec spec = null;
            String type = prefs.getString("alarm_action_type_" + id, null);
            if (type != null) {
                spec = new ActionSpec();
                spec.type = type;
                spec.phone = prefs.getString("alarm_phone_" + id, null);
                spec.whatsappPhone = prefs.getString("alarm_whatsapp_phone_" + id, null);
                spec.whatsappMessage = prefs.getString("alarm_whatsapp_message_" + id, null);
                spec.navigationQuery = prefs.getString("alarm_navigation_query_" + id, null);
                spec.lat = prefs.getString("alarm_lat_" + id, null);
                spec.lng = prefs.getString("alarm_lng_" + id, null);
                spec.searchQuery = prefs.getString("alarm_search_query_" + id, null);
                spec.appName = prefs.getString("alarm_app_name_" + id, null);
                spec.alarmMessage = prefs.getString("alarm_alarm_message_" + id, null);
                if (prefs.contains("alarm_alarm_hour_" + id)) spec.alarmHour = prefs.getInt("alarm_alarm_hour_" + id, 8);
                if (prefs.contains("alarm_alarm_minutes_" + id)) spec.alarmMinutes = prefs.getInt("alarm_alarm_minutes_" + id, 0);
                if (prefs.contains("alarm_timer_length_seconds_" + id)) spec.timerLengthSeconds = prefs.getInt("alarm_timer_length_seconds_" + id, 60);
                spec.smsMessage = prefs.getString("alarm_sms_message_" + id, null);
                if (prefs.contains("alarm_torch_enable_" + id)) spec.torchEnable = prefs.getBoolean("alarm_torch_enable_" + id, false);
                if (prefs.contains("alarm_volume_direction_" + id)) spec.volumeDirection = prefs.getInt("alarm_volume_direction_" + id, 0);
            }
            
            scheduleReminderInSystem(context, id, text, fireAtMs, isAlarm, spec);
        }
        
        if (!toRemove.isEmpty()) {
            SharedPreferences.Editor editor = prefs.edit();
            java.util.Set<String> cleanIds = new java.util.HashSet<>(activeIds);
            cleanIds.removeAll(toRemove);
            editor.putStringSet("active_alarm_ids", cleanIds);
            for (String id : toRemove) {
                editor.remove("alarm_text_" + id);
                editor.remove("alarm_fire_at_" + id);
                editor.remove("alarm_is_alarm_" + id);
                editor.remove("alarm_action_type_" + id);
                editor.remove("alarm_phone_" + id);
                editor.remove("alarm_whatsapp_phone_" + id);
                editor.remove("alarm_whatsapp_message_" + id);
                editor.remove("alarm_navigation_query_" + id);
                editor.remove("alarm_lat_" + id);
                editor.remove("alarm_lng_" + id);
                editor.remove("alarm_search_query_" + id);
                editor.remove("alarm_app_name_" + id);
                editor.remove("alarm_alarm_message_" + id);
                editor.remove("alarm_alarm_hour_" + id);
                editor.remove("alarm_alarm_minutes_" + id);
                editor.remove("alarm_timer_length_seconds_" + id);
                editor.remove("alarm_sms_message_" + id);
                editor.remove("alarm_torch_enable_" + id);
                editor.remove("alarm_volume_direction_" + id);
            }
            editor.apply();
        }
    }
}
