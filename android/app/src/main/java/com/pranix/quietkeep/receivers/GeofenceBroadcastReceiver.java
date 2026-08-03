package com.pranix.quietkeep.receivers;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;

import com.google.android.gms.location.Geofence;
import com.google.android.gms.location.GeofencingEvent;

import org.json.JSONObject;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * GeofenceBroadcastReceiver — Track A7 Geofence Transition Receiver
 *
 * Listens for OS geofence entry/exit transitions and posts events to /api/geo/trigger.
 */
public class GeofenceBroadcastReceiver extends BroadcastReceiver {
    private static final String TAG = "QK_GEOFENCE_RECV";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null) return;
        GeofencingEvent geofencingEvent = GeofencingEvent.fromIntent(intent);
        if (geofencingEvent == null || geofencingEvent.hasError()) {
            Log.e(TAG, "GeofencingEvent error code: " + (geofencingEvent != null ? geofencingEvent.getErrorCode() : "null"));
            return;
        }

        int geofenceTransition = geofencingEvent.getGeofenceTransition();
        String eventType = (geofenceTransition == Geofence.GEOFENCE_TRANSITION_ENTER) ? "enter"
                : (geofenceTransition == Geofence.GEOFENCE_TRANSITION_EXIT) ? "exit" : "unknown";

        if (geofencingEvent.getTriggeringGeofences() != null) {
            for (Geofence geofence : geofencingEvent.getTriggeringGeofences()) {
                String keepId = geofence.getRequestId();
                Log.d(TAG, "Geofence transition: " + eventType + " for keepId: " + keepId);
                postGeofenceTrigger(keepId, eventType);
            }
        }
    }

    private void postGeofenceTrigger(final String keepId, final String eventType) {
        new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    URL url = new URL("https://quietkeep.com/api/geo/trigger");
                    HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                    conn.setRequestMethod("POST");
                    conn.setRequestProperty("Content-Type", "application/json");
                    conn.setDoOutput(true);

                    JSONObject body = new JSONObject();
                    body.put("keep_id", keepId);
                    body.put("event", eventType);

                    try (OutputStream os = conn.getOutputStream()) {
                        byte[] input = body.toString().getBytes(StandardCharsets.UTF_8);
                        os.write(input, 0, input.length);
                    }

                    int code = conn.getResponseCode();
                    Log.d(TAG, "Posted geofence trigger for keep " + keepId + ", status code: " + code);
                } catch (Exception e) {
                    Log.e(TAG, "Error posting geofence trigger: " + e.getMessage());
                }
            }
        }).start();
    }
}
