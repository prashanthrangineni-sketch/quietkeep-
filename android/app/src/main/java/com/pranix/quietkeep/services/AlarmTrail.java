package com.pranix.quietkeep.services;

import android.content.Context;
import android.content.SharedPreferences;

import java.util.HashMap;
import java.util.Map;

/**
 * AlarmTrail - what happened the last time a reminder alarm fired on this phone.
 *
 * WHY THIS EXISTS
 * 3 October 2026: "Call Akhilesh Munugala in one minute", the phone was locked,
 * the reminder was spoken and no call was placed. The server could show that
 * the alarm had been armed with the number. It could not show anything after
 * that, because everything from the alarm firing to the call being placed
 * happens on the phone and was only ever written to the phone's own log,
 * which nobody can read from outside.
 *
 * So each step now leaves one small note here, and the app sends the notes up
 * the next time it is opened (ReminderAlarmPlugin.lastFire). The next report
 * of "it did not call" is answered by reading what happened, not by guessing.
 *
 * WHAT IS NEVER WRITTEN: the phone number, the name, or the words of the
 * reminder. Only which steps ran.
 */
public class AlarmTrail {

    private static final String PREFS = "QuietKeepAlarmTrail";

    /** A new alarm has fired: forget the previous one and start again. */
    public static void begin(Context context, String reminderId, String actionType, boolean hasPhone) {
        try {
            SharedPreferences.Editor e = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit();
            e.clear();
            e.putString("reminder_id", reminderId == null ? "" : reminderId);
            e.putString("fired_at", String.valueOf(System.currentTimeMillis()));
            e.putString("action_type", actionType == null ? "" : actionType);
            e.putString("has_phone", String.valueOf(hasPhone));
            e.apply();
        } catch (Exception ignored) { }
    }

    /** One more step of the same alarm. */
    public static void note(Context context, String key, String value) {
        try {
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                    .edit().putString(key, value == null ? "" : value).apply();
        } catch (Exception ignored) { }
    }

    /** Everything noted for the last alarm. Empty when none has fired yet. */
    public static Map<String, String> read(Context context) {
        Map<String, String> out = new HashMap<>();
        try {
            Map<String, ?> all = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getAll();
            for (Map.Entry<String, ?> entry : all.entrySet()) {
                out.put(entry.getKey(), String.valueOf(entry.getValue()));
            }
        } catch (Exception ignored) { }
        return out;
    }
}
