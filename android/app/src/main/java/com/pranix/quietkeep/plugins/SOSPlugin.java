package com.pranix.quietkeep.plugins;

import android.content.Intent;
import android.net.Uri;
import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * SOSPlugin — Capacitor Plugin for 112 ELS Emergency Dispatch (Track A8).
 */
@CapacitorPlugin(name = "SOSPlugin")
public class SOSPlugin extends Plugin {
    private static final String TAG = "QK_SOS_PLUGIN";

    @PluginMethod
    public void dispatch112(PluginCall call) {
        Log.d(TAG, "dispatch112 requested via Capacitor plugin");
        try {
            Intent intent = new Intent(Intent.ACTION_DIAL);
            intent.setData(Uri.parse("tel:112"));
            intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);

            JSObject res = new JSObject();
            res.put("success", true);
            call.resolve(res);
        } catch (Exception e) {
            Log.e(TAG, "Failed to dispatch 112 emergency call: " + e.getMessage(), e);
            call.reject("Emergency dialer failed: " + e.getMessage());
        }
    }
}
