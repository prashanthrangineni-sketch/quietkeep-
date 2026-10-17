package com.pranix.quietkeep.plugins;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
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
import com.pranix.quietkeep.services.BlackboxLogic;
import com.pranix.quietkeep.services.BlackboxService;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.security.KeyFactory;
import java.security.PublicKey;
import java.security.Signature;
import java.security.spec.X509EncodedKeySpec;
import java.util.Base64;

/**
 * QkBlackbox — Capacitor plugin for the on-phone crash black box.
 *
 * Follows the same pattern as SOSPlugin: annotated with @CapacitorPlugin,
 * registered in MainActivity.onCreate(), called from JS via
 * window.Capacitor.Plugins.QkBlackbox.
 */
@CapacitorPlugin(
    name = "QkBlackbox",
    permissions = {
        @Permission(strings = { Manifest.permission.ACCESS_FINE_LOCATION }, alias = "location"),
        @Permission(strings = { Manifest.permission.RECORD_AUDIO }, alias = "microphone")
    }
)
public class QkBlackboxPlugin extends Plugin {
    private static final String TAG = "QK_BLACKBOX_PLUGIN";

    /**
     * Start the black box recording (called when Drive Mode starts).
     * Options: { audioOptIn: boolean, testMode: boolean }
     */
    @PluginMethod
    public void start(PluginCall call) {
        try {
            boolean audioOptIn = call.getBoolean("audioOptIn", false);
            boolean testMode = call.getBoolean("testMode", false);

            Intent intent = new Intent(getContext(), BlackboxService.class);
            intent.putExtra(BlackboxService.EXTRA_AUDIO_OPT_IN, audioOptIn);
            intent.putExtra(BlackboxService.EXTRA_TEST_MODE, testMode);

            if (Build.VERSION.SDK_INT >= 26) {
                getContext().startForegroundService(intent);
            } else {
                getContext().startService(intent);
            }

            JSObject res = new JSObject();
            res.put("started", true);
            res.put("audioOptIn", audioOptIn);
            res.put("testMode", testMode);
            call.resolve(res);
        } catch (Exception e) {
            Log.e(TAG, "start failed: " + e.getMessage(), e);
            call.reject("BlackboxService could not start: " + e.getMessage());
        }
    }

    /**
     * Stop the black box recording (called when Drive Mode stops).
     */
    @PluginMethod
    public void stop(PluginCall call) {
        try {
            Intent intent = new Intent(getContext(), BlackboxService.class);
            getContext().stopService(intent);
            JSObject res = new JSObject();
            res.put("stopped", true);
            call.resolve(res);
        } catch (Exception e) {
            Log.e(TAG, "stop failed: " + e.getMessage(), e);
            call.reject("BlackboxService could not stop: " + e.getMessage());
        }
    }

    /**
     * Manually trigger a freeze (SAVE_LAST_60S voice intent or crash detector).
     * Options: { trigger: string }
     */
    @PluginMethod
    public void saveLast60s(PluginCall call) {
        try {
            String trigger = call.getString("trigger", "voice_save");
            // The service has a static externalTrigger that we cannot call on the
            // service object directly from here, so we send a broadcast or use the
            // static callback mechanism. For simplicity, we restart the freeze
            // through the service's pendingTrigger mechanism.
            //
            // A cleaner approach: BlackboxService exposes a static reference.
            // This is pragmatic for a v1 implementation.
            BlackboxService.onFreezeComplete = () -> {
                JSONObject result = BlackboxService.lastFreezeResult;
                if (result != null) {
                    JSObject res = new JSObject();
                    try {
                        res.put("id", result.optString("id", ""));
                        res.put("trigger", result.optString("trigger", trigger));
                        res.put("hash", result.optString("hash", ""));
                        res.put("path", result.optString("path", ""));
                    } catch (Exception ignored) {}
                    call.resolve(res);
                } else {
                    call.resolve(new JSObject());
                }
                BlackboxService.onFreezeComplete = null;
            };

            // Send a broadcast to the running service to trigger a freeze
            Intent intent = new Intent("com.pranix.quietkeep.BLACKBOX_FREEZE");
            intent.putExtra("trigger", trigger);
            intent.setPackage(getContext().getPackageName());
            getContext().sendBroadcast(intent);

            // Also try direct static call if service is running
            // (The service should pick up the intent within the post-trigger window)

        } catch (Exception e) {
            Log.e(TAG, "saveLast60s failed: " + e.getMessage(), e);
            call.reject("saveLast60s failed: " + e.getMessage());
        }
    }

    /**
     * List stored black box records.
     */
    @PluginMethod
    public void list(PluginCall call) {
        try {
            File dir = new File(getContext().getFilesDir(), "blackbox");
            JSArray records = new JSArray();

            if (dir.exists() && dir.isDirectory()) {
                File[] files = dir.listFiles((d, name) -> name.endsWith(".qkedr"));
                if (files != null) {
                    for (File f : files) {
                        try {
                            // Read the JSON header (first line)
                            byte[] bytes = readFile(f);
                            int newline = indexOf(bytes, (byte) '\n');
                            if (newline < 0) continue;

                            String headerJson = new String(bytes, 0, newline, "UTF-8");
                            JSONObject header = new JSONObject(headerJson);

                            JSObject record = new JSObject();
                            record.put("id", f.getName().replace(".qkedr", ""));
                            record.put("trigger", header.optString("trigger", "unknown"));
                            record.put("started_at", header.optString("started_at", ""));
                            record.put("ended_at", header.optString("ended_at", ""));
                            record.put("audio_opt_in", header.optBoolean("audio_opt_in", false));

                            // Read hash from the signature file if present
                            File sigFile = new File(dir, f.getName() + ".sig");
                            if (sigFile.exists()) {
                                record.put("signature", new String(readFile(sigFile), "UTF-8").trim());
                            }

                            records.put(record);
                        } catch (Exception e) {
                            Log.w(TAG, "Skipping unreadable record: " + f.getName());
                        }
                    }
                }
            }

            JSObject res = new JSObject();
            res.put("records", records);
            call.resolve(res);
        } catch (Exception e) {
            Log.e(TAG, "list failed: " + e.getMessage(), e);
            call.reject("list failed: " + e.getMessage());
        }
    }

    /**
     * Verify a record's integrity. { id: string }
     * Returns { valid: boolean, hash: string }
     */
    @PluginMethod
    public void verify(PluginCall call) {
        try {
            String id = call.getString("id", "");
            File dir = new File(getContext().getFilesDir(), "blackbox");
            File packetFile = new File(dir, id + ".qkedr");
            File sigFile = new File(dir, id + ".qkedr.sig");
            File pubFile = new File(dir, id + ".qkedr.pub");

            if (!packetFile.exists()) {
                call.reject("Record not found: " + id);
                return;
            }

            byte[] data = readFile(packetFile);
            byte[] hash = BlackboxLogic.sha256(data);
            String hashHex = bytesToHex(hash);

            boolean valid = false;
            if (sigFile.exists() && pubFile.exists()) {
                String sigB64 = new String(readFile(sigFile), "UTF-8").trim();
                String pubB64 = new String(readFile(pubFile), "UTF-8").trim();
                valid = BlackboxLogic.verifyBase64(data, sigB64, pubB64);
            }

            JSObject res = new JSObject();
            res.put("valid", valid);
            res.put("hash", hashHex);
            res.put("id", id);
            call.resolve(res);
        } catch (Exception e) {
            Log.e(TAG, "verify failed: " + e.getMessage(), e);
            call.reject("verify failed: " + e.getMessage());
        }
    }

    /**
     * Request location permission for the blackbox service.
     */
    @PluginMethod
    public void requestLocationPermission(PluginCall call) {
        if (getPermissionState("location") == PermissionState.GRANTED) {
            call.resolve(new JSObject());
        } else {
            requestPermissionForAlias("location", call, "locationPermissionCallback");
        }
    }

    @PermissionCallback
    private void locationPermissionCallback(PluginCall call) {
        call.resolve(new JSObject());
    }

    /**
     * Request microphone permission for the audio opt-in.
     */
    @PluginMethod
    public void requestMicPermission(PluginCall call) {
        if (getPermissionState("microphone") == PermissionState.GRANTED) {
            JSObject res = new JSObject();
            res.put("granted", true);
            call.resolve(res);
        } else {
            requestPermissionForAlias("microphone", call, "micPermissionCallback");
        }
    }

    @PermissionCallback
    private void micPermissionCallback(PluginCall call) {
        JSObject res = new JSObject();
        res.put("granted", getPermissionState("microphone") == PermissionState.GRANTED);
        call.resolve(res);
    }

    // ── Helpers ──────────────────────────────────────────────────────────

    private static byte[] readFile(File f) throws Exception {
        try (FileInputStream fis = new FileInputStream(f)) {
            byte[] bytes = new byte[(int) f.length()];
            fis.read(bytes);
            return bytes;
        }
    }

    private static int indexOf(byte[] arr, byte val) {
        for (int i = 0; i < arr.length; i++) {
            if (arr[i] == val) return i;
        }
        return -1;
    }

    private static String bytesToHex(byte[] bytes) {
        StringBuilder sb = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) sb.append(String.format("%02x", b));
        return sb.toString();
    }
}
