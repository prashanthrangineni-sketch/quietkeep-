package com.pranix.quietkeep.plugins;

import android.app.usage.UsageStats;
import android.app.usage.UsageStatsManager;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.pm.PackageManager;
import android.os.BatteryManager;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.List;
import java.util.SortedMap;
import java.util.TreeMap;

/**
 * PerceptionPlugin — passive device signals for QuietKeep
 * Called from perception.ts via: window.Capacitor.Plugins.Perception
 * No static @capacitor/core import needed on the web side.
 *
 * REQUIRED PERMISSION (manual grant):
 *   Settings → Apps → Special app access → Usage access → QuietKeep → Allow
 */
@CapacitorPlugin(name = "Perception")
public class PerceptionPlugin extends Plugin {

    @PluginMethod
    public void getForegroundApp(PluginCall call) {
        try {
            UsageStatsManager usm = (UsageStatsManager)
                getContext().getSystemService(Context.USAGE_STATS_SERVICE);
            long end = System.currentTimeMillis();
            List<UsageStats> stats = usm.queryUsageStats(
                UsageStatsManager.INTERVAL_DAILY, end - 60_000, end);

            if (stats == null || stats.isEmpty()) {
                JSObject r = new JSObject();
                r.put("package_name", "unknown");
                r.put("app_name", "unknown");
                r.put("permission_required", "PACKAGE_USAGE_STATS");
                call.resolve(r); return;
            }

            SortedMap<Long, UsageStats> sorted = new TreeMap<>();
            for (UsageStats s : stats) sorted.put(s.getLastTimeUsed(), s);

            String pkg  = sorted.get(sorted.lastKey()).getPackageName();
            String name = pkg;
            try {
                name = getContext().getPackageManager()
                    .getApplicationLabel(
                        getContext().getPackageManager().getApplicationInfo(pkg, 0)
                    ).toString();
            } catch (PackageManager.NameNotFoundException ignored) {}

            JSObject r = new JSObject();
            r.put("package_name", pkg);
            r.put("app_name",     name);
            r.put("last_used_ms", sorted.lastKey());
            call.resolve(r);
        } catch (Exception e) { call.reject("getForegroundApp: " + e.getMessage()); }
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
    public void getClipboardText(PluginCall call) {
        try {
            ClipboardManager cm = (ClipboardManager) getContext().getSystemService(Context.CLIPBOARD_SERVICE);
            String text = "";
            if (cm != null && cm.hasPrimaryClip()) {
                android.content.ClipData.Item item = cm.getPrimaryClip().getItemAt(0);
                if (item != null && item.getText() != null) text = item.getText().toString();
            }
            JSObject r = new JSObject();
            r.put("text", text.length() > 300 ? text.substring(0, 300) : text);
            call.resolve(r);
        } catch (Exception e) { call.reject("getClipboardText: " + e.getMessage()); }
    }
}
