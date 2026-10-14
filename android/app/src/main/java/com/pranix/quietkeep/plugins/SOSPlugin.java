package com.pranix.quietkeep.plugins;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.util.Log;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import com.pranix.quietkeep.activities.SosCountdownActivity;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * SOSPlugin - the phone side of SOS. (AARIA_ONE_PLAN item 3)
 *
 *   dispatch112()          open the dialler at 112 (the person presses call)
 *   syncContacts(contacts) keep the emergency contacts ON THE PHONE, so an SOS
 *                          works with no internet and no server
 *   trigger(source)        start the ten-second countdown screen; after it,
 *                          the phone itself sends the SMS (SosCountdownActivity)
 *   requestSmsPermission() ask for SEND_SMS; without it the countdown ends in
 *                          the SMS composer instead (the person presses Send)
 *   status()               permission state, contacts saved, whether an SOS
 *                          is running right now
 *   journal()              the on-phone record of every trigger/cancel/sent/
 *                          delivered, with timings - the item-3 evidence
 */
@CapacitorPlugin(
    name = "SOSPlugin",
    permissions = { @Permission(strings = { Manifest.permission.SEND_SMS }, alias = "sms") }
)
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

    /** contacts: [{name, phone}] - replaces what is stored. */
    @PluginMethod
    public void syncContacts(PluginCall call) {
        try {
            JSArray in = call.getArray("contacts");
            JSONArray out = new JSONArray();
            if (in != null) {
                for (int i = 0; i < in.length(); i++) {
                    JSONObject c = in.getJSONObject(i);
                    String phone = c.optString("phone", "").trim();
                    if (phone.isEmpty()) continue;
                    JSONObject o = new JSONObject();
                    o.put("name", c.optString("name", ""));
                    o.put("phone", phone);
                    out.put(o);
                }
            }
            prefs().edit().putString(SosCountdownActivity.KEY_CONTACTS, out.toString()).apply();
            JSObject res = new JSObject();
            res.put("saved", out.length());
            call.resolve(res);
        } catch (Exception e) {
            call.reject("syncContacts failed: " + e.getMessage());
        }
    }

    @PluginMethod
    public void trigger(PluginCall call) {
        if (SosCountdownActivity.isActive()) {
            JSObject res = new JSObject();
            res.put("started", false);
            res.put("reason", "already_running");
            call.resolve(res);
            return;
        }
        try {
            Intent i = new Intent(getContext(), SosCountdownActivity.class);
            i.putExtra(SosCountdownActivity.EXTRA_SOURCE, call.getString("source", "app"));
            i.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            JSObject res = new JSObject();
            res.put("started", true);
            res.put("countdown_ms", SosCountdownActivity.COUNTDOWN_MS);
            call.resolve(res);
        } catch (Exception e) {
            Log.e(TAG, "trigger failed", e);
            call.reject("SOS could not start: " + e.getMessage());
        }
    }

    @PluginMethod
    public void requestSmsPermission(PluginCall call) {
        if (getPermissionState("sms") == PermissionState.GRANTED) {
            call.resolve(stateObject());
        } else {
            requestPermissionForAlias("sms", call, "smsPermissionCallback");
        }
    }

    @PermissionCallback
    private void smsPermissionCallback(PluginCall call) {
        call.resolve(stateObject());
    }

    @PluginMethod
    public void status(PluginCall call) {
        JSObject res = stateObject();
        res.put("contacts_saved", SosCountdownActivity.loadContacts(getContext()).size());
        res.put("running", SosCountdownActivity.isActive());
        call.resolve(res);
    }

    @PluginMethod
    public void journal(PluginCall call) {
        try {
            String raw = prefs().getString(SosCountdownActivity.KEY_JOURNAL, "[]");
            JSObject res = new JSObject();
            res.put("events", new JSArray(raw));
            call.resolve(res);
        } catch (Exception e) {
            call.reject("journal unreadable: " + e.getMessage());
        }
    }

    private JSObject stateObject() {
        JSObject res = new JSObject();
        res.put("sms_permission", String.valueOf(getPermissionState("sms")).toLowerCase());
        return res;
    }

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(SosCountdownActivity.PREFS, Context.MODE_PRIVATE);
    }
}
