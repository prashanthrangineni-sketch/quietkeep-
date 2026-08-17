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

    @PluginMethod
    public void isWakeWordAvailable(PluginCall call) {
        Log.d(TAG, "isWakeWordAvailable requested");
        JSObject res = new JSObject();
        res.put("available", false);
        call.resolve(res);
    }
}
