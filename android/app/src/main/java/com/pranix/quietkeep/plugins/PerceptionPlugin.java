package com.pranix.quietkeep.plugins;

import android.content.Context;
import android.content.Intent;
import android.os.BatteryManager;
import android.provider.Settings;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * PerceptionPlugin — passive device signals for QuietKeep
 * Called from perception.ts via: window.Capacitor.Plugins.Perception
 * No static @capacitor/core import needed on the web side.
 *
 * No usage-access permission is needed any more (removed 25 Nov 2026, item 1.6).
 */
@CapacitorPlugin(name = "Perception")
public class PerceptionPlugin extends Plugin {

    // Item 1.6 (25 Nov 2026): reading which app is on screen is removed, together
    // with the usage-access permission. Nothing in the product calls this (see
    // src/lib/capacitor/perception.ts); it stays only so an old caller gets a
    // clear "not available" instead of a crash.
    @PluginMethod
    public void getForegroundApp(PluginCall call) {
        JSObject r = new JSObject();
        r.put("package_name", "unavailable");
        r.put("app_name", "unavailable");
        r.put("removed", true);
        call.resolve(r);
    }

    @PluginMethod
    public void getActivityContext(PluginCall call) {
        try {
            BatteryManager bm = (BatteryManager) getContext().getSystemService(Context.BATTERY_SERVICE);
            int     battery  = bm != null ? bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY) : -1;
            boolean charging = bm != null && bm.isCharging();
            android.os.PowerManager pm = (android.os.PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
            boolean screenOn = pm != null && pm.isInteractive();

            JSObject r = new JSObject();
            r.put("battery_level",  battery);
            r.put("charging",       charging);
            r.put("screen_on",      screenOn);
            r.put("timestamp_ms",   System.currentTimeMillis());
            call.resolve(r);
        } catch (Exception e) { call.reject("getActivityContext: " + e.getMessage()); }
    }

    @PluginMethod
    public void isNotificationListenerEnabled(PluginCall call) {
        try {
            Context context = getContext();
            String pkgName = context.getPackageName();
            String flat = Settings.Secure.getString(
                context.getContentResolver(),
                "enabled_notification_listeners"
            );
            boolean enabled = flat != null && flat.contains(pkgName);
            JSObject ret = new JSObject();
            ret.put("enabled", enabled);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("isNotificationListenerEnabled: " + e.getMessage());
        }
    }

    @PluginMethod
    public void openNotificationListenerSettings(PluginCall call) {
        try {
            Intent intent = new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("openNotificationListenerSettings: " + e.getMessage());
        }
    }

}
