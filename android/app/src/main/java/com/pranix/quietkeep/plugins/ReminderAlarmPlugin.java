package com.pranix.quietkeep.plugins;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import com.pranix.quietkeep.services.ReminderAlarmManager;

/**
 * ReminderAlarmPlugin — Capacitor bridge exposing AlarmManager to JS.
 *
 * Register in MainActivity.java:
 *   add(ReminderAlarmPlugin.class);
 *
 * Call from JS (after bridge is ready):
 *   const result = await window.Capacitor.Plugins.ReminderAlarm.schedule({
 *     reminderId: "uuid-string",
 *     reminderText: "Doctor at 2pm",
 *     fireAtMs: 1712345678000,
 *     isAlarmType: true,
 *   });
 */
@CapacitorPlugin(name = "ReminderAlarm")
public class ReminderAlarmPlugin extends Plugin {

    @PluginMethod
    public void schedule(PluginCall call) {
        String reminderId   = call.getString("reminderId");
        String reminderText = call.getString("reminderText", "");
        Long   fireAtMs     = call.getLong("fireAtMs");
        boolean isAlarm     = Boolean.TRUE.equals(call.getBoolean("isAlarmType", false));

        if (reminderId == null || fireAtMs == null) {
            call.reject("reminderId and fireAtMs are required");
            return;
        }

        ReminderAlarmManager.scheduleReminder(
            getContext(), reminderId, reminderText, fireAtMs, isAlarm
        );

        JSObject result = new JSObject();
        result.put("scheduled", true);
        result.put("reminderId", reminderId);
        result.put("fireAtMs", fireAtMs);
        call.resolve(result);
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        String reminderId = call.getString("reminderId");
        if (reminderId == null) {
            call.reject("reminderId is required");
            return;
        }
        ReminderAlarmManager.cancelReminder(getContext(), reminderId);
        JSObject result = new JSObject();
        result.put("cancelled", true);
        call.resolve(result);
    }
}
