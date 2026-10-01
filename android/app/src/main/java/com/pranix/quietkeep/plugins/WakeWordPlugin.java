package com.pranix.quietkeep.plugins;

import android.content.Intent;
import android.os.Build;
import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import com.pranix.quietkeep.services.VoiceService;

/**
 * WakeWordPlugin — Capacitor Plugin for Aaria Wake Word Control (Track A3).
 */
@CapacitorPlugin(name = "WakeWordPlugin")
public class WakeWordPlugin extends Plugin {
    private static final String TAG = "QK_WAKE_PLUGIN";

    @PluginMethod
    public void startHotword(PluginCall call) {
        Log.d(TAG, "startHotword requested via Capacitor plugin");
        try {
            Intent intent = new Intent(getContext(), VoiceService.class);
            intent.setAction("START_HOTWORD");
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                getContext().startForegroundService(intent);
            } else {
                getContext().startService(intent);
            }
            call.resolve();
        } catch (Exception e) {
            Log.e(TAG, "Failed to start hotword service: " + e.getMessage(), e);
            call.reject("Start hotword failed");
        }
    }

    @PluginMethod
    public void stopHotword(PluginCall call) {
        Log.d(TAG, "stopHotword requested via Capacitor plugin");
        try {
            Intent intent = new Intent(getContext(), VoiceService.class);
            intent.setAction("STOP_HOTWORD");
            getContext().startService(intent);
            call.resolve();
        } catch (Exception e) {
            Log.e(TAG, "Failed to stop hotword service: " + e.getMessage(), e);
            call.reject("Stop hotword failed");
        }
    }

    @PluginMethod
    public void ensureInvokeSurfaces(PluginCall call) {
        Log.d(TAG, "ensureInvokeSurfaces requested");
        JSObject res = new JSObject();
        res.put("surfacesRegistered", true);
        call.resolve(res);
    }

    /**
     * Ask the home screen to place the "Talk to Aaria" widget, so nobody has
     * to hunt for it in the launcher's widget list (the founder could not find
     * it there on 1 Oct 2026 - launchers file it under the app name, which is
     * "QuietKeep Personal", and some hide app widgets in a submenu).
     *
     * Android 8+ shows its own "Add to home screen?" card. The result says
     * plainly whether this launcher supports that, so the app can fall back to
     * instructions instead of a button that silently does nothing.
     */
    @PluginMethod
    public void pinWidget(PluginCall call) {
        JSObject res = new JSObject();
        try {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
                res.put("requested", false);
                res.put("reason", "android_too_old");
                call.resolve(res);
                return;
            }
            android.appwidget.AppWidgetManager mgr =
                android.appwidget.AppWidgetManager.getInstance(getContext());
            if (mgr == null || !mgr.isRequestPinAppWidgetSupported()) {
                res.put("requested", false);
                res.put("reason", "launcher_does_not_support");
                call.resolve(res);
                return;
            }
            android.content.ComponentName provider = new android.content.ComponentName(
                getContext(), com.pranix.quietkeep.widgets.QuickMicWidget.class);
            boolean asked = mgr.requestPinAppWidget(provider, null, null);
            Log.d(TAG, "pinWidget requested: " + asked);
            res.put("requested", asked);
            if (!asked) res.put("reason", "launcher_refused");
            call.resolve(res);
        } catch (Exception e) {
            Log.e(TAG, "pinWidget failed: " + e.getMessage(), e);
            res.put("requested", false);
            res.put("reason", "error: " + e.getMessage());
            call.resolve(res);
        }
    }

    @PluginMethod
    public void isWakeWordAvailable(PluginCall call) {
        Log.d(TAG, "isWakeWordAvailable requested");
        JSObject res = new JSObject();
        res.put("available", false);
        call.resolve(res);
    }
}
