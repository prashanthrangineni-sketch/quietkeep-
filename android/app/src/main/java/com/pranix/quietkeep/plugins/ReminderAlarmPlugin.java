package com.pranix.quietkeep.plugins;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import com.pranix.quietkeep.services.ReminderAlarmManager;
import com.pranix.quietkeep.services.ActionExecutor.ActionSpec;

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

        ActionSpec spec = null;
        String actionType = call.getString("actionType");
        if (actionType != null && !actionType.trim().isEmpty()) {
            spec = new ActionSpec();
            spec.type = actionType;
            spec.phone = call.getString("phone");
            spec.whatsappPhone = call.getString("whatsappPhone");
            spec.whatsappMessage = call.getString("whatsappMessage");
            spec.navigationQuery = call.getString("navigationQuery");
            spec.lat = call.getString("lat");
            spec.lng = call.getString("lng");
            spec.searchQuery = call.getString("searchQuery");
            spec.appName = call.getString("appName");
            spec.alarmMessage = call.getString("alarmMessage");
            if (call.hasOption("alarmHour")) spec.alarmHour = call.getInt("alarmHour");
            if (call.hasOption("alarmMinutes")) spec.alarmMinutes = call.getInt("alarmMinutes");
            if (call.hasOption("timerLengthSeconds")) spec.timerLengthSeconds = call.getInt("timerLengthSeconds");
            spec.smsMessage = call.getString("smsMessage");
            if (call.hasOption("torchEnable")) spec.torchEnable = call.getBoolean("torchEnable");
            if (call.hasOption("volumeDirection")) spec.volumeDirection = call.getInt("volumeDirection");
        }

        ReminderAlarmManager.scheduleReminder(
            getContext(), reminderId, reminderText, fireAtMs, isAlarm, spec
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
