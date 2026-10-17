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

import java.io.DataInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.util.regex.Pattern;

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
    /** Record ids are always event_<epoch ms>; anything else is refused (no path traversal). */
    private static final Pattern RECORD_ID = Pattern.compile("^event_\\d{10,16}$");

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
     * Push an OBD reading into the running black box service.
     * Options: { at, speedKmh, rpm, loadPct, coolantC, voltage, mil, source }
     * Resolves { accepted: boolean }
     */
    @PluginMethod
    public void pushObd(PluginCall call) {
        try {
            if (!BlackboxService.isRunning()) {
                JSObject res = new JSObject();
                res.put("accepted", false);
                call.resolve(res);
                return;
            }

            String atStr = call.getString("at", null);
            long timestampUs;
            if (atStr != null) {
                try {
                    timestampUs = java.time.Instant.parse(atStr).toEpochMilli() * 1000L;
                } catch (Exception e) {
                    try {
                        timestampUs = Long.parseLong(atStr);
                        if (timestampUs < 10_000_000_000_000L) {
                            timestampUs *= 1000L;
                        }
                    } catch (Exception ex) {
                        timestampUs = System.currentTimeMillis() * 1000L;
                    }
                }
            } else {
                long atNum = call.getData().optLong("at", 0);
                if (atNum > 0) {
                    timestampUs = atNum < 10_000_000_000_000L ? atNum * 1000L : atNum;
                } else {
                    timestampUs = System.currentTimeMillis() * 1000L;
                }
            }

            Double speedKmhObj = call.getData().isNull("speedKmh") ? null : call.getDouble("speedKmh");
            Double rpmObj = call.getData().isNull("rpm") ? null : call.getDouble("rpm");
            Double loadPctObj = call.getData().isNull("loadPct") ? null : call.getDouble("loadPct");
            Double coolantCObj = call.getData().isNull("coolantC") ? null : call.getDouble("coolantC");
            Double voltageObj = call.getData().isNull("voltage") ? null : call.getDouble("voltage");

            float speedKmh = (speedKmhObj != null && !Double.isNaN(speedKmhObj)) ? speedKmhObj.floatValue() : Float.NaN;
            float rpm = (rpmObj != null && !Double.isNaN(rpmObj)) ? rpmObj.floatValue() : Float.NaN;
            float loadPct = (loadPctObj != null && !Double.isNaN(loadPctObj)) ? loadPctObj.floatValue() : Float.NaN;
            float coolantC = (coolantCObj != null && !Double.isNaN(coolantCObj)) ? coolantCObj.floatValue() : Float.NaN;
            float voltage = (voltageObj != null && !Double.isNaN(voltageObj)) ? voltageObj.floatValue() : Float.NaN;

            boolean mil = call.getBoolean("mil", false);
            String source = call.getString("source", null);

            int flags = 0;
            if (mil) {
                flags |= BlackboxLogic.OBD_FLAG_MIL_ON;
            }
            if (Float.isNaN(speedKmh) || Float.isNaN(rpm) || Float.isNaN(loadPct)
                    || Float.isNaN(coolantC) || Float.isNaN(voltage)) {
                flags |= BlackboxLogic.OBD_FLAG_VALUE_MISSING;
            }

            boolean accepted = BlackboxService.pushObd(
                timestampUs, speedKmh, rpm, loadPct, coolantC, voltage, flags, source
            );

            JSObject res = new JSObject();
            res.put("accepted", accepted);
            call.resolve(res);
        } catch (Exception e) {
            Log.e(TAG, "pushObd failed: " + e.getMessage(), e);
            JSObject res = new JSObject();
            res.put("accepted", false);
            call.resolve(res);
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
            if (!BlackboxService.isRunning()) {
                JSObject res = new JSObject();
                res.put("saved", false);
                res.put("reason", "not_running");
                call.resolve(res);
                return;
            }
            // Resolves when the packet is closed (15 s after the trigger).
            BlackboxService.onFreezeComplete = () -> {
                BlackboxService.onFreezeComplete = null;
                JSONObject result = BlackboxService.lastFreezeResult;
                JSObject res = new JSObject();
                if (result != null) {
                    res.put("saved", true);
                    res.put("id", result.optString("id", ""));
                    res.put("trigger", result.optString("trigger", trigger));
                    res.put("hash", result.optString("hash", ""));
                    res.put("sealed", result.optBoolean("sealed", false));
                } else {
                    res.put("saved", false);
                    res.put("reason", "no_result");
                }
                call.resolve(res);
            };

            // Delivered through onStartCommand (ACTION_FREEZE). The first
            // version sent a broadcast that no receiver listened for, so
            // voice and crash-detector freezes never reached the service.
            Intent intent = new Intent(getContext(), BlackboxService.class);
            intent.setAction(BlackboxService.ACTION_FREEZE);
            intent.putExtra(BlackboxService.EXTRA_TRIGGER, trigger);
            getContext().startService(intent);
        } catch (Exception e) {
            BlackboxService.onFreezeComplete = null;
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
                            record.put("audio_status", header.optString("audio_status", "off"));
                            JSONObject fix = header.optJSONObject("last_fix");
                            if (fix != null) {
                                record.put("lat", fix.optDouble("lat"));
                                record.put("lon", fix.optDouble("lon"));
                            }
                            record.put("bytes", f.length());

                            File sigFile = new File(dir, f.getName() + ".sig");
                            record.put("sealed", sigFile.exists());
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
            if (!RECORD_ID.matcher(id).matches()) {
                call.reject("Invalid record id");
                return;
            }
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
            boolean sealed = sigFile.exists() && pubFile.exists();
            if (sealed) {
                byte[] sig = b64(new String(readFile(sigFile), "UTF-8").trim());
                byte[] pub = b64(new String(readFile(pubFile), "UTF-8").trim());
                valid = BlackboxLogic.verify(data, sig, pub);
            }

            JSObject res = new JSObject();
            res.put("valid", valid);
            res.put("sealed", sealed);
            res.put("hash", hashHex);
            res.put("id", id);
            call.resolve(res);
        } catch (Exception e) {
            Log.e(TAG, "verify failed: " + e.getMessage(), e);
            call.reject("verify failed: " + e.getMessage());
        }
    }

    /**
     * Read one record for upload. { id } -> { id, data (base64), signature,
     * public_key, header fields }. Used by src/lib/blackbox-sync.js.
     */
    @PluginMethod
    public void readRecord(PluginCall call) {
        try {
            String id = call.getString("id", "");
            if (!RECORD_ID.matcher(id).matches()) {
                call.reject("Invalid record id");
                return;
            }
            File dir = new File(getContext().getFilesDir(), "blackbox");
            File packetFile = new File(dir, id + ".qkedr");
            if (!packetFile.exists()) {
                call.reject("Record not found: " + id);
                return;
            }
            byte[] data = readFile(packetFile);
            int newline = indexOf(data, (byte) '\n');
            JSONObject header = newline > 0
                ? new JSONObject(new String(data, 0, newline, "UTF-8")) : new JSONObject();
            File sigFile = new File(dir, id + ".qkedr.sig");
            File pubFile = new File(dir, id + ".qkedr.pub");

            JSObject res = new JSObject();
            res.put("id", id);
            res.put("data", android.util.Base64.encodeToString(data, android.util.Base64.NO_WRAP));
            res.put("hash", bytesToHex(BlackboxLogic.sha256(data)));
            res.put("signature", sigFile.exists() ? new String(readFile(sigFile), "UTF-8").trim() : "");
            res.put("public_key", pubFile.exists() ? new String(readFile(pubFile), "UTF-8").trim() : "");
            res.put("trigger", header.optString("trigger", "unknown"));
            res.put("started_at", header.optString("started_at", ""));
            res.put("ended_at", header.optString("ended_at", ""));
            call.resolve(res);
        } catch (Exception e) {
            Log.e(TAG, "readRecord failed: " + e.getMessage(), e);
            call.reject("readRecord failed: " + e.getMessage());
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
        // readFully: a single read() may return fewer bytes than asked.
        try (DataInputStream in = new DataInputStream(new FileInputStream(f))) {
            byte[] bytes = new byte[(int) f.length()];
            in.readFully(bytes);
            return bytes;
        }
    }

    private static byte[] b64(String s) {
        return android.util.Base64.decode(s, android.util.Base64.DEFAULT);
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
