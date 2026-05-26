package com.pranix.quietkeep.services;

import com.pranix.quietkeep.R;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.net.Uri;
import android.os.Build;
import android.os.IBinder;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.BatteryManager;
import android.os.PowerManager;
import android.util.Log;
import androidx.annotation.Nullable;
import org.json.JSONException;
import org.json.JSONObject;
import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import android.content.SharedPreferences;
import org.json.JSONArray;

/**
 * VoiceService v9
 * v9: FIX — replace discontinued /api/sarvam-stt endpoint with /api/groq-stt.
 *
 *   ROOT CAUSE OF COLOROS FREEZE:
 *   sendChunk() was calling /api/sarvam-stt which was discontinued (Sarvam AI shut down).
 *   Every chunk call timed out at 25 seconds (10s connect + 15s read timeout).
 *   The capture thread was alive but stuck in timeout loops, which OplusHansManager
 *   (ColorOS battery arbiter) classified as a frozen UID and killed the service.
 *
 *   FIX: Point sendChunk() at /api/groq-stt which accepts the same multipart
 *   form-data (file + language_code fields) and returns the same JSON shape
 *   ({transcript: "..."}). No other changes required — the response parsing,
 *   timeout values, and WAV encoding are all unchanged.
 *
 *   /api/groq-stt uses Groq Whisper Large v3 Turbo (~300-500ms latency vs
 *   25s timeout on the dead Sarvam endpoint). This also fixes the STT accuracy
 *   regression that users were seeing (silence because sarvam returned nothing).
 *
 * v8 retained: Non-blocking suggestion fetch after successful capture.
 * v7 retained: WakeLock acquire(timeoutMs) fix.
 * v6 retained: Android 14+ FOREGROUND_SERVICE_TYPE_MICROPHONE fix.
 * v5 retained: captureActive static flag, verbose diagnostics.
 * v4 retained: Bug fixes B7, B9, B12.
 *
 * Pipeline: mic → 3s WAV chunk → POST /api/groq-stt → transcript
 *           → POST /api/voice/capture → read auto_exec → fire Intent
 */
public class VoiceService extends Service {
    private static final String TAG            = "QK_VOICE";
    private static final String CHANNEL_ID     = "quietkeep-voice";
    private static final int    NOTIF_ID       = 9001;
    private static final int    SAMPLE_RATE    = 16000;
    private static final int    CHUNK_MS       = 3000;
    private static final int    SILENCE_CHUNKS = 2;

    private AudioRecord      audioRecord;
    private Thread           captureThread;
    private volatile boolean isCapturing  = false;
    private volatile int     captureRetry = 0;
    private static final int MAX_RETRIES  = 3;
    private static final long RETRY_DELAY_MS = 2000L;
    private String authToken, serverUrl, sessionId, mode, workspaceId;
    private String languageCode = "en-IN";
    private int silentChunks = 0;

    private PowerManager.WakeLock wakeLock;

    public static volatile boolean captureActive = false;

    private final WakeWordEngine wakeWordEngine = new WakeWordEngine();

    private volatile boolean alwaysOnMode = false;

    private volatile boolean batterySafe     = true;
    private volatile boolean batteryCritical = false;
    private volatile int     batteryPct      = 100;

    private volatile boolean screenOff = false;
    private volatile int     skipChunkCounter = 0;

    private final BroadcastReceiver screenReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            final String action = intent.getAction();
            if (android.content.Intent.ACTION_SCREEN_OFF.equals(action)) {
                screenOff = true;
                skipChunkCounter = 0;
                Log.d(TAG, "VoiceService: screen OFF — halving detection frequency");
            } else if (android.content.Intent.ACTION_SCREEN_ON.equals(action)) {
                screenOff = false;
                skipChunkCounter = 0;
                Log.d(TAG, "VoiceService: screen ON — restoring full detection");
            }
        }
    };

    private final BroadcastReceiver batteryReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            int level  = intent.getIntExtra(BatteryManager.EXTRA_LEVEL, 100);
            int scale  = intent.getIntExtra(BatteryManager.EXTRA_SCALE, 100);
            int status = intent.getIntExtra(BatteryManager.EXTRA_STATUS, -1);
            boolean charging = status == BatteryManager.BATTERY_STATUS_CHARGING
                            || status == BatteryManager.BATTERY_STATUS_FULL;
            double pct = (double) level / scale * 100.0;
            batteryPct      = (int) pct;
            batteryCritical = !charging && pct < 10.0;
            batterySafe     = charging || pct > 15.0;
            wakeWordEngine.setBatteryPct(batteryPct);
            Log.d(TAG, String.format(
                "Battery: %d%% charging=%b safe=%b critical=%b",
                batteryPct, charging, batterySafe, batteryCritical));
            if (batteryCritical && alwaysOnMode) {
                Log.w(TAG, "Battery CRITICAL (< 10%%) — pausing wake detection entirely");
            } else if (!batterySafe && alwaysOnMode) {
                Log.w(TAG, "Battery low (< 15%%) — reducing wake detection frequency");
            }
        }
    };

    public void onCreate() {
        super.onCreate();
        Log.d(TAG, "VoiceService.onCreate");
        createNotificationChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        Log.d(TAG, "VoiceService.onStartCommand intent="
            + (intent != null ? intent.getAction() : "null"));

        if (intent == null) {
            Log.w(TAG, "VoiceService: null intent (restarted by system)");
            createNotificationChannel();
            startForegroundWithMicType(buildNotification("personal"));
            return START_STICKY;
        }

        String action = intent.getAction();

        if ("START".equals(action)) {
            authToken    = intent.getStringExtra("auth_token");
            serverUrl    = intent.getStringExtra("server_url");
            alwaysOnMode = intent.getBooleanExtra("always_on", false);
            Log.d(TAG, "VoiceService alwaysOnMode=" + alwaysOnMode);
            sessionId    = intent.getStringExtra("session_id");
            mode         = intent.getStringExtra("mode");
            workspaceId  = intent.getStringExtra("workspace_id");
            String lc    = intent.getStringExtra("language_code");
            languageCode = (lc != null && !lc.isEmpty()) ? lc : "en-IN";
            Log.d(TAG, "VoiceService STT lang: " + languageCode);
            Log.d(TAG, "VoiceService START: mode=" + mode + " server=" + serverUrl);

            try {
                IntentFilter bf = new IntentFilter(Intent.ACTION_BATTERY_CHANGED);
                registerReceiver(batteryReceiver, bf);
            } catch (Exception ignored) {}

            try {
                IntentFilter sf = new IntentFilter();
                sf.addAction(android.content.Intent.ACTION_SCREEN_OFF);
                sf.addAction(android.content.Intent.ACTION_SCREEN_ON);
                registerReceiver(screenReceiver, sf);
            } catch (Exception ignored) {}

            createNotificationChannel();
            startForegroundWithMicType(buildNotification(mode));
            Log.d(TAG, "VoiceService.startForeground called ✓");
            startCapture();

        } else if ("STOP".equals(action)) {
            Log.d(TAG, "VoiceService STOP");
            stopCapture();
            stopForeground(true);
            stopSelf();
        }

        return START_STICKY;
    }

    private void startForegroundWithMicType(Notification notification) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIF_ID, notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE);
        } else {
            startForeground(NOTIF_ID, notification);
        }
    }

    private Notification buildNotification(String currentMode) {
        String title = "business".equals(currentMode)
            ? "QuietKeep Business is listening"
            : "QuietKeep is listening";
        return new Notification.Builder(this, CHANNEL_ID)
            .setContentTitle(title)
            .setContentText("Tap to open")
            .setSmallIcon(R.mipmap.ic_launcher)
            .setOngoing(true)
            .build();
    }

    private void startCapture() {
        if (isCapturing) {
            Log.d(TAG, "VoiceService.startCapture: already capturing");
            return;
        }
        isCapturing = true;
        silentChunks = 0;
        Log.d(TAG, "VoiceService.startCapture: initialising AudioRecord");

        int bufSize = AudioRecord.getMinBufferSize(
            SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);

        try {
            audioRecord = new AudioRecord(
                MediaRecorder.AudioSource.VOICE_RECOGNITION, SAMPLE_RATE,
                AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, bufSize * 4);

            if (audioRecord.getState() != AudioRecord.STATE_INITIALIZED) {
                Log.e(TAG, "VoiceService: AudioRecord not initialised (attempt " + (captureRetry + 1) + "/" + MAX_RETRIES + ")");
                isCapturing = false;
                captureActive = false;
                if (captureRetry < MAX_RETRIES) {
                    captureRetry++;
                    new android.os.Handler(android.os.Looper.getMainLooper()).postDelayed(
                        this::startCapture, RETRY_DELAY_MS);
                } else {
                    Log.e(TAG, "VoiceService: AudioRecord failed after " + MAX_RETRIES + " retries");
                    captureRetry = 0;
                }
                return;
            }

            audioRecord.startRecording();
            Log.d(TAG, "VoiceService: AudioRecord.startRecording() ✓");

            PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
            if (pm != null) {
                wakeLock = pm.newWakeLock(
                    PowerManager.PARTIAL_WAKE_LOCK, "QuietKeep:VoiceCapture");
                wakeLock.acquire(30 * 60 * 1000L);
                Log.d(TAG, "VoiceService: WakeLock acquired ✓ (30min max)");
            }

            captureActive = true;
            captureRetry = 0;

        } catch (SecurityException se) {
            Log.e(TAG, "VoiceService: RECORD_AUDIO permission denied: " + se.getMessage());
            isCapturing = false;
            captureActive = false;
            return;
        }

        captureThread = new Thread(() -> {
            Log.d(TAG, "VoiceService: capture thread started");
            while (isCapturing) {
                byte[] chunk = recordChunk(bufSize);
                if (chunk == null || chunk.length == 0) {
                    Log.e(TAG, "VoiceService: capture thread exiting — recordChunk returned "
                        + (chunk == null ? "null" : "empty[]"));
                    captureActive = false;
                    break;
                }
                boolean silent = isSilent(chunk);
                Log.d(TAG, "VoiceService: chunk ready, bytes=" + chunk.length + " silent=" + silent);
                if (silent) {
                    silentChunks++;
                    if (silentChunks >= SILENCE_CHUNKS) {
                        if (!alwaysOnMode) sendChunk(chunk, true);
                        silentChunks = 0;
                    }
                } else {
                    silentChunks = 0;
                    if (alwaysOnMode) {
                        if (batteryCritical) {
                            Log.d(TAG, "Skip wake detect — battery CRITICAL");
                            try { Thread.sleep(5000); } catch (InterruptedException ignored) {}
                            continue;
                        }
                        if (!batterySafe) {
                            Log.d(TAG, "Skip wake detect — battery low");
                            continue;
                        }
                        if (screenOff) {
                            skipChunkCounter++;
                            if (skipChunkCounter % 2 == 0) {
                                Log.d(TAG, "Skip wake detect — screen off (adaptive)");
                                continue;
                            }
                        }
                        boolean wakeDetected = wakeWordEngine.detectWakeWord(chunk);
                        if (wakeDetected) {
                            Log.d(TAG, "WakeWordEngine: LOTUS DETECTED — dispatching event");
                            dispatchLotusWakeEvent();
                            sendChunk(chunk, false);
                        }
                        // In always-on mode: only send audio AFTER wake word detected.
                        // Audio without wake word is discarded (saves Groq STT quota).
                    } else {
                        sendChunk(chunk, false);
                    }
                }
            }
            Log.d(TAG, "VoiceService: capture thread ended");
        });
        captureThread.start();
    }

    private byte[] recordChunk(int bufSize) {
        byte[] buf = new byte[bufSize];
        ByteArrayOutputStream bos = new ByteArrayOutputStream();
        long deadline = System.currentTimeMillis() + CHUNK_MS;
        while (System.currentTimeMillis() < deadline && isCapturing) {
            int read = audioRecord.read(buf, 0, buf.length);
            if (read == AudioRecord.ERROR_DEAD_OBJECT) {
                Log.e(TAG, "recordChunk: AudioRecord.ERROR_DEAD_OBJECT — mic taken by another app");
                isCapturing = false;
                captureActive = false;
                if (captureRetry < MAX_RETRIES) {
                    captureRetry++;
                    new android.os.Handler(android.os.Looper.getMainLooper()).postDelayed(() -> {
                        if (authToken != null && serverUrl != null) startCapture();
                    }, RETRY_DELAY_MS * captureRetry);
                }
                return null;
            }
            if (read == AudioRecord.ERROR_INVALID_OPERATION) {
                Log.e(TAG, "recordChunk: ERROR_INVALID_OPERATION — AudioRecord not started");
                return null;
            }
            if (read < 0) Log.e(TAG, "recordChunk: AudioRecord.read() returned error code " + read);
            if (read > 0) bos.write(buf, 0, read);
        }
        byte[] result = bos.toByteArray();
        Log.d(TAG, "recordChunk: collected " + result.length + " bytes over " + CHUNK_MS + "ms");
        return result;
    }

    private boolean isSilent(byte[] pcm) {
        long sum = 0;
        for (int i = 0; i < pcm.length - 1; i += 2) {
            short s = (short) ((pcm[i + 1] << 8) | (pcm[i] & 0xFF));
            sum += Math.abs(s);
        }
        return (sum / (pcm.length / 2.0)) < 200;
    }

    private void sendChunk(byte[] pcm, boolean isFinal) {
        if (serverUrl == null || authToken == null) return;
        Log.d(TAG, "sendChunk START: pcmBytes=" + pcm.length + " isFinal=" + isFinal);
        new Thread(() -> {
            try {
                byte[]  wav      = buildWav(pcm);
                String  boundary = "QK" + System.currentTimeMillis();
                // v9 FIX: /api/sarvam-stt → /api/groq-stt
                // Sarvam AI was discontinued — every call timed out at 25s causing ColorOS UID freeze.
                // groq-stt accepts the same multipart form-data and returns {transcript}.
                String  endpoint = serverUrl + "/api/groq-stt";
                Log.d(TAG, "sendChunk: opening connection to " + endpoint);
                URL     u        = new URL(endpoint);
                HttpURLConnection c = (HttpURLConnection) u.openConnection();
                c.setConnectTimeout(10000);
                c.setReadTimeout(15000);
                c.setRequestMethod("POST");
                c.setDoOutput(true);
                c.setRequestProperty("Content-Type", "multipart/form-data; boundary=" + boundary);
                c.setRequestProperty("Authorization", "Bearer " + authToken);
                java.io.OutputStream os = c.getOutputStream();
                os.write(("--" + boundary
                    + "\r\nContent-Disposition: form-data; name=\"audio\"; filename=\"chunk.wav\""
                    + "\r\nContent-Type: audio/wav\r\n\r\n").getBytes());
                os.write(wav);
                os.write(("\r\n--" + boundary
                    + "\r\nContent-Disposition: form-data; name=\"language_code\"\r\n\r\n"
                    + languageCode + "\r\n--" + boundary + "--\r\n").getBytes());
                os.flush();
                Log.d(TAG, "sendChunk: awaiting response from groq-stt...");
                int code = c.getResponseCode();
                Log.d(TAG, "sendChunk: response code=" + code);
                if (code == 200) {
                    BufferedReader br = new BufferedReader(new InputStreamReader(c.getInputStream()));
                    StringBuilder sb = new StringBuilder();
                    String line;
                    while ((line = br.readLine()) != null) sb.append(line);
                    String t = extractField(sb.toString(), "transcript");
                    Log.d(TAG, "groq-stt transcript: " + t);
                    if (t != null && !t.isEmpty()) postCapture(t, isFinal);
                } else {
                    Log.w(TAG, "groq-stt response code: " + code);
                }
                c.disconnect();
            } catch (java.io.IOException e) {
                Log.w(TAG, "sendChunk: IOException — " + e.getMessage());
            } catch (Exception e) {
                Log.e(TAG, "sendChunk FAILED: " + e.getClass().getName() + " - " + e.getMessage());
            }
        }).start();
    }

    private void postCapture(String transcript, boolean isFinal) {
        Log.d(TAG, "VoiceService.postCapture: "
            + transcript.substring(0, Math.min(50, transcript.length())));
        String body;
        try {
            JSONObject json = new JSONObject();
            json.put("transcript", transcript);
            json.put("source", "android_service");
            json.put("session_id", sessionId != null ? sessionId : JSONObject.NULL);
            json.put("is_final", isFinal);
            if (workspaceId != null) json.put("workspace_id", workspaceId);
            body = json.toString();
        } catch (JSONException e) {
            Log.e(TAG, "postCapture: JSON build failed: " + e.getMessage());
            return;
        }
        HttpURLConnection c = null;
        try {
            URL u = new URL(serverUrl + "/api/voice/capture");
            c = (HttpURLConnection) u.openConnection();
            c.setConnectTimeout(10000);
            c.setReadTimeout(15000);
            c.setRequestMethod("POST");
            c.setDoOutput(true);
            c.setRequestProperty("Content-Type", "application/json");
            c.setRequestProperty("Authorization", "Bearer " + authToken);
            c.getOutputStream().write(body.getBytes("UTF-8"));
            int code = c.getResponseCode();
            Log.d(TAG, "voice/capture → HTTP " + code);
            if (code == 401) {
                Log.e(TAG, "postCapture: HTTP 401 — auth token expired. NOT queuing for retry.");
                c.disconnect();
                return;
            }
            if (code == 200 || code == 201) {
                BufferedReader br = new BufferedReader(new InputStreamReader(c.getInputStream()));
                StringBuilder sb = new StringBuilder();
                String line;
                while ((line = br.readLine()) != null) sb.append(line);
                String json = sb.toString();
                Log.d(TAG, "voice/capture response: " + json.substring(0, Math.min(300, json.length())));
                new Thread(() -> { try { flushRetryQueue(); } catch (Exception ignored) {} }).start();
                new Thread(() -> { try { fetchSuggestions(); } catch (Exception ignored) {} }).start();
                String intentType    = extractNestedField(json, "auto_exec", "intent_type");
                String phone         = extractNestedField(json, "auto_exec", "contact_phone");
                String whatsappPhone = extractNestedField(json, "auto_exec", "whatsapp_phone");
                String whatsappMsg   = extractNestedField(json, "auto_exec", "whatsapp_message");
                String navQuery      = extractNestedField(json, "auto_exec", "navigation_query");
                String navLat        = extractNestedField(json, "auto_exec", "lat");
                String navLng        = extractNestedField(json, "auto_exec", "lng");
                if ("contact".equals(intentType) && phone != null && !phone.isEmpty()) {
                    Intent callIntent = new Intent(Intent.ACTION_CALL, Uri.parse("tel:" + phone));
                    callIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    getApplicationContext().startActivity(callIntent);
                } else if ("whatsapp".equals(intentType) && whatsappPhone != null) {
                    String waUrl = "https://wa.me/" + whatsappPhone.replaceAll("[^0-9]", "");
                    if (whatsappMsg != null && !whatsappMsg.isEmpty()) {
                        try { waUrl += "?text=" + java.net.URLEncoder.encode(whatsappMsg, "UTF-8"); }
                        catch (Exception ignored) {}
                    }
                    Intent waIntent = new Intent(Intent.ACTION_VIEW, Uri.parse(waUrl));
                    waIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    getApplicationContext().startActivity(waIntent);
                } else if ("navigation".equals(intentType)) {
                    String mapsUri = null;
                    if (navLat != null && navLng != null) {
                        mapsUri = "geo:" + navLat + "," + navLng
                            + (navQuery != null ? "?q=" + Uri.encode(navQuery) : "");
                    } else if (navQuery != null) {
                        mapsUri = "geo:0,0?q=" + Uri.encode(navQuery);
                    }
                    if (mapsUri != null) {
                        Intent navIntent = new Intent(Intent.ACTION_VIEW, Uri.parse(mapsUri));
                        navIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        getApplicationContext().startActivity(navIntent);
                    }
                }
            } else {
                Log.w(TAG, "postCapture: HTTP " + code + " — queuing for retry");
                try { enqueueFailedTranscript(transcript); } catch (Exception ignored) {}
            }
            c.disconnect();
        } catch (java.io.IOException e) {
            Log.w(TAG, "postCapture: IOException (" + e.getMessage() + ") — queuing for retry");
            try { enqueueFailedTranscript(transcript); } catch (Exception ignored) {}
            try { if (c != null) c.disconnect(); } catch (Exception ignored) {}
        }
    }

    private void fetchSuggestions() {
        if (serverUrl == null || authToken == null) return;
        try {
            URL u = new URL(serverUrl + "/api/agent/predict");
            HttpURLConnection c = (HttpURLConnection) u.openConnection();
            c.setConnectTimeout(6000);
            c.setReadTimeout(8000);
            c.setRequestMethod("GET");
            c.setRequestProperty("Authorization", "Bearer " + authToken);
            int code = c.getResponseCode();
            if (code == 200) {
                BufferedReader br = new BufferedReader(new InputStreamReader(c.getInputStream()));
                StringBuilder sb = new StringBuilder();
                String line;
                while ((line = br.readLine()) != null) sb.append(line);
                Log.d(TAG, "[SUGGEST] response: " + sb.toString().substring(0, Math.min(200, sb.length())));
            } else {
                Log.d(TAG, "[SUGGEST] non-200: " + code);
            }
            c.disconnect();
        } catch (Exception e) {
            Log.d(TAG, "[SUGGEST] fetch skipped (" + e.getMessage() + ")");
        }
    }

    private static final String PREFS_RETRY    = "qk_voice_retry";
    private static final String PREFS_KEY      = "retry_queue";
    private static final int    QUEUE_MAX      = 5;
    private static final long   QUEUE_MAX_AGE_MS = 24 * 60 * 60 * 1000L;

    private void enqueueFailedTranscript(String transcript) {
        if (transcript == null || transcript.isEmpty()) return;
        try {
            SharedPreferences prefs = getSharedPreferences(PREFS_RETRY, MODE_PRIVATE);
            String raw = prefs.getString(PREFS_KEY, "[]");
            JSONArray arr = new JSONArray(raw);
            String text = transcript.substring(0, Math.min(transcript.length(), 500));
            int    hash = text.hashCode();
            for (int i = 0; i < arr.length(); i++) {
                try {
                    if (arr.getJSONObject(i).optInt("hash", 0) == hash) return;
                } catch (Exception ignored) {}
            }
            if (arr.length() >= QUEUE_MAX) arr.remove(0);
            JSONObject entry = new JSONObject();
            entry.put("text", text);
            entry.put("hash", hash);
            entry.put("queued_at", System.currentTimeMillis());
            arr.put(entry);
            prefs.edit().putString(PREFS_KEY, arr.toString()).apply();
        } catch (Exception e) {
            Log.w(TAG, "enqueueFailedTranscript failed: " + e.getMessage());
        }
    }

    private void flushRetryQueue() {
        try {
            SharedPreferences prefs = getSharedPreferences(PREFS_RETRY, MODE_PRIVATE);
            String raw = prefs.getString(PREFS_KEY, "[]");
            JSONArray arr = new JSONArray(raw);
            if (arr.length() == 0) return;
            prefs.edit().putString(PREFS_KEY, "[]").apply();
            long now = System.currentTimeMillis();
            for (int i = 0; i < arr.length(); i++) {
                try {
                    String t;
                    long queuedAt = now;
                    Object item = arr.get(i);
                    if (item instanceof JSONObject) {
                        JSONObject obj = (JSONObject) item;
                        t        = obj.optString("text", "");
                        queuedAt = obj.optLong("queued_at", now);
                    } else {
                        t = item.toString();
                    }
                    if (now - queuedAt > QUEUE_MAX_AGE_MS) continue;
                    if (t != null && !t.isEmpty()) {
                        postCapture(t, true);
                        Thread.sleep(300);
                    }
                } catch (Exception inner) {
                    Log.w(TAG, "flushRetryQueue item " + i + " failed: " + inner.getMessage());
                }
            }
        } catch (Exception e) {
            Log.w(TAG, "flushRetryQueue error: " + e.getMessage());
        }
    }

    private String extractField(String json, String field) {
        String k = "\"" + field + "\":\"";
        int i = json.indexOf(k);
        if (i < 0) return null;
        int s = i + k.length();
        int e = json.indexOf("\"", s);
        return e < 0 ? null : json.substring(s, e);
    }

    private String extractNestedField(String json, String parent, String field) {
        String parentKey = "\"" + parent + "\":{";
        int pi = json.indexOf(parentKey);
        if (pi < 0) return null;
        int start = pi + parentKey.length();
        int depth = 1, end = start;
        while (end < json.length() && depth > 0) {
            char ch = json.charAt(end);
            if (ch == '{') depth++; else if (ch == '}') depth--;
            end++;
        }
        String sub = json.substring(start, Math.max(start, end - 1));
        return extractField("{" + sub + "}", field);
    }

    private byte[] buildWav(byte[] pcm) {
        byte[] h  = new byte[44];
        int    dl = pcm.length;
        int    tl = dl + 36;
        h[0]='R'; h[1]='I'; h[2]='F'; h[3]='F';
        h[4]=(byte)tl;       h[5]=(byte)(tl>>8);  h[6]=(byte)(tl>>16); h[7]=(byte)(tl>>24);
        h[8]='W'; h[9]='A'; h[10]='V'; h[11]='E';
        h[12]='f'; h[13]='m'; h[14]='t'; h[15]=' ';
        h[16]=16; h[20]=1; h[22]=1;
        h[24]=(byte)SAMPLE_RATE; h[25]=(byte)(SAMPLE_RATE>>8);
        h[26]=(byte)(SAMPLE_RATE>>16); h[27]=(byte)(SAMPLE_RATE>>24);
        int br = SAMPLE_RATE * 2;
        h[28]=(byte)br; h[29]=(byte)(br>>8); h[30]=(byte)(br>>16); h[31]=(byte)(br>>24);
        h[32]=2; h[34]=16;
        h[36]='d'; h[37]='a'; h[38]='t'; h[39]='a';
        h[40]=(byte)dl; h[41]=(byte)(dl>>8); h[42]=(byte)(dl>>16); h[43]=(byte)(dl>>24);
        byte[] w = new byte[44 + dl];
        System.arraycopy(h, 0, w, 0, 44);
        System.arraycopy(pcm, 0, w, 44, dl);
        return w;
    }

    private void dispatchLotusWakeEvent() {
        try {
            android.os.Handler mainHandler = new android.os.Handler(android.os.Looper.getMainLooper());
            mainHandler.post(() -> {
                try {
                    android.app.Activity act = com.pranix.quietkeep.MainActivity.LotusWakeBridgeHolder.sActivity;
                    if (act == null) { Log.w(TAG, "dispatchLotusWakeEvent: MainActivity not available"); return; }
                    if (!(act instanceof com.getcapacitor.BridgeActivity)) { Log.w(TAG, "not a BridgeActivity"); return; }
                    android.webkit.WebView webView = ((com.getcapacitor.BridgeActivity) act).getBridge().getWebView();
                    if (webView == null) { Log.w(TAG, "WebView not available"); return; }
                    String js = "window.dispatchEvent(new CustomEvent('lotus_wake',{detail:{source:'background'}}));";
                    webView.evaluateJavascript(js, null);
                    Log.d(TAG, "lotus_wake event dispatched to WebView ✓");
                } catch (Exception e) {
                    Log.w(TAG, "dispatchLotusWakeEvent (inner): " + e.getMessage());
                }
            });
        } catch (Exception e) {
            Log.w(TAG, "dispatchLotusWakeEvent: " + e.getMessage());
        }
    }

    private void stopCapture() {
        Log.d(TAG, "VoiceService.stopCapture");
        try { unregisterReceiver(batteryReceiver); } catch (Exception ignored) {}
        try { unregisterReceiver(screenReceiver); } catch (Exception ignored) {}
        isCapturing = false;
        captureActive = false;
        if (wakeLock != null && wakeLock.isHeld()) {
            wakeLock.release();
            wakeLock = null;
            Log.d(TAG, "VoiceService: WakeLock released");
        }
        if (audioRecord != null) {
            try { audioRecord.stop(); audioRecord.release(); } catch (Exception ignored) {}
            audioRecord = null;
        }
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel ch = new NotificationChannel(
                CHANNEL_ID, "QuietKeep Voice", NotificationManager.IMPORTANCE_LOW);
            ch.setDescription("TAU voice capture service");
            ((NotificationManager) getSystemService(NOTIFICATION_SERVICE))
                .createNotificationChannel(ch);
        }
    }

    @Nullable @Override public IBinder onBind(Intent i) { return null; }

    @Override
    public void onDestroy() {
        Log.d(TAG, "VoiceService.onDestroy");
        stopCapture();
        super.onDestroy();
    }
}
