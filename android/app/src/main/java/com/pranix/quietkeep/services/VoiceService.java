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
 * VoiceService v8
 * v8: Non-blocking suggestion fetch after successful capture.
 *     Calls /api/agent/predict with same authToken on a background thread.
 *     Logs suggestions to logcat only — no UI interaction.
 *     Completely fail-safe: any error is silently swallowed.
 *     workspaceId already supported (v6) — no change needed.
 *
 * FIX v7: WakeLock now uses acquire(timeoutMs) instead of acquire().
 *   - acquire() with no timeout = permanent WakeLock.
 *   - If the OS kills the service while the WakeLock is held, the WakeLock
 *     is never released, causing a WakeLock leak that ANR-watchdogs flag.
 *   - acquire(30 * 60 * 1000L) = 30-minute maximum, auto-releases after that.
 *   - 10 minutes is well beyond any single voice session. The service stops
 *     capturing long before this, so the WakeLock is released normally via
 *     stopCapture(). The timeout is a safety net only.
 *
 * v6 retained: Android 14+ FOREGROUND_SERVICE_TYPE_MICROPHONE fix.
 * v5 retained: captureActive static flag, verbose diagnostics.
 * v4 retained: Bug fixes B7, B9, B12.
 *
 * Pipeline: mic → 3s WAV chunk → POST /api/sarvam-stt → transcript
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
    private volatile int     captureRetry = 0;    // AudioRecord conflict retry counter
    private static final int MAX_RETRIES  = 3;    // max retries before giving up
    private static final long RETRY_DELAY_MS = 2000L; // 2 seconds between retries
    private String authToken, serverUrl, sessionId, mode, workspaceId;
    private String languageCode = "en-IN";  // STT fix: set from app settings via intent
    private int silentChunks = 0;

    private PowerManager.WakeLock wakeLock;

    // Static flag lets VoicePlugin.isRunning() report TRUE capture state.
    // Service alive ≠ capture alive — they can diverge on AudioRecord failure.
    public static volatile boolean captureActive = false;

    @Override
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
            sessionId    = intent.getStringExtra("session_id");
            mode         = intent.getStringExtra("mode");
            workspaceId  = intent.getStringExtra("workspace_id");
            // STT fix: read language from intent; default en-IN if missing
            String lc    = intent.getStringExtra("language_code");
            languageCode = (lc != null && !lc.isEmpty()) ? lc : "en-IN";
            Log.d(TAG, "VoiceService STT lang: " + languageCode);

            Log.d(TAG, "VoiceService START: mode=" + mode + " server=" + serverUrl);

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

    /**
     * Android 14+ (API 34) requires startForeground() to explicitly declare
     * FOREGROUND_SERVICE_TYPE_MICROPHONE at runtime. Without this, AudioRecord.read()
     * silently returns 0 bytes on Android 14/15 even when RECORD_AUDIO is granted.
     */
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
                    Log.d(TAG, "VoiceService: scheduling retry in " + RETRY_DELAY_MS + "ms");
                    new android.os.Handler(android.os.Looper.getMainLooper()).postDelayed(
                        this::startCapture, RETRY_DELAY_MS
                    );
                } else {
                    Log.e(TAG, "VoiceService: AudioRecord failed after " + MAX_RETRIES + " retries — mic conflict or permission denied");
                    captureRetry = 0;
                }
                return;
            }

            audioRecord.startRecording();
            Log.d(TAG, "VoiceService: AudioRecord.startRecording() ✓");

            // FIX v7: acquire(timeoutMs) instead of acquire().
            // 30-minute maximum — auto-releases if service is killed mid-session.
            // The normal path releases via stopCapture() before this timeout fires.
            PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
            if (pm != null) {
                wakeLock = pm.newWakeLock(
                    PowerManager.PARTIAL_WAKE_LOCK, "QuietKeep:VoiceCapture");
                wakeLock.acquire(30 * 60 * 1000L); // 30-minute max — covers always-on sessions (was 10min)
                Log.d(TAG, "VoiceService: WakeLock acquired ✓ (30min max)");
            }

            captureActive = true;
            captureRetry = 0; // reset retry counter on successful start

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
                        + (chunk == null ? "null" : "empty[]")
                        + " (AudioRecord error or device policy block)");
                    captureActive = false;
                    break;
                }
                boolean silent = isSilent(chunk);
                Log.d(TAG, "VoiceService: chunk ready, bytes=" + chunk.length
                    + " silent=" + silent);
                if (silent) {
                    silentChunks++;
                    if (silentChunks >= SILENCE_CHUNKS) {
                        sendChunk(chunk, true);
                        silentChunks = 0;
                    }
                } else {
                    silentChunks = 0;
                    sendChunk(chunk, false);
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
                // Schedule a restart — another app may have released the mic shortly
                isCapturing = false;
                captureActive = false;
                if (captureRetry < MAX_RETRIES) {
                    captureRetry++;
                    new android.os.Handler(android.os.Looper.getMainLooper()).postDelayed(() -> {
                        if (authToken != null && serverUrl != null) {
                            Log.d(TAG, "VoiceService: retrying after mic conflict (attempt " + captureRetry + ")");
                            startCapture();
                        }
                    }, RETRY_DELAY_MS * captureRetry); // exponential backoff
                }
                return null;
            }
            if (read == AudioRecord.ERROR_INVALID_OPERATION) {
                Log.e(TAG, "recordChunk: ERROR_INVALID_OPERATION — AudioRecord not started");
                return null;
            }
            if (read < 0) {
                Log.e(TAG, "recordChunk: AudioRecord.read() returned error code " + read);
            }
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
                String  endpoint = serverUrl + "/api/sarvam-stt";
                Log.d(TAG, "sendChunk: opening connection to " + endpoint);
                URL     u        = new URL(endpoint);
                HttpURLConnection c = (HttpURLConnection) u.openConnection();
                c.setConnectTimeout(10000);
                c.setReadTimeout(15000);
                c.setRequestMethod("POST");
                c.setDoOutput(true);
                c.setRequestProperty("Content-Type", "multipart/form-data; boundary=" + boundary);
                c.setRequestProperty("Authorization", "Bearer " + authToken);
                Log.d(TAG, "sendChunk: writing " + wav.length + " bytes to output stream");
                java.io.OutputStream os = c.getOutputStream();
                os.write(("--" + boundary
                    + "\r\nContent-Disposition: form-data; name=\"audio\"; filename=\"chunk.wav\""
                    + "\r\nContent-Type: audio/wav\r\n\r\n").getBytes());
                os.write(wav);
                // STT fix: languageCode from app settings (was hardcoded en-IN)
                os.write(("\r\n--" + boundary
                    + "\r\nContent-Disposition: form-data; name=\"language_code\"\r\n\r\n"
                    + languageCode + "\r\n--"
                    + boundary + "--\r\n").getBytes());
                os.flush();

                Log.d(TAG, "sendChunk: awaiting response from sarvam-stt...");
                int code = c.getResponseCode();
                Log.d(TAG, "sendChunk: response code=" + code);
                if (code == 200) {
                    BufferedReader br = new BufferedReader(new InputStreamReader(c.getInputStream()));
                    StringBuilder sb = new StringBuilder();
                    String line;
                    while ((line = br.readLine()) != null) sb.append(line);
                    String t = extractField(sb.toString(), "transcript");
                    Log.d(TAG, "sarvam-stt transcript: " + t);
                    if (t != null && !t.isEmpty()) postCapture(t, isFinal);
                } else {
                    Log.w(TAG, "sarvam-stt response code: " + code);
                }
                c.disconnect();
            } catch (java.io.IOException e) {
                Log.w(TAG, "sendChunk: IOException (timeout/network) — " + e.getMessage());
            } catch (Exception e) {
                Log.e(TAG, "sendChunk FAILED: " + e.getClass().getName() + " - " + e.getMessage());
            }
        }).start();
    }

    private void postCapture(String transcript, boolean isFinal) {
        // Fix 1: No longer throws IOException — catches it internally and enqueues for retry.
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

        // FIX: declare c before try so the catch block can call c.disconnect() safely.
        // URL construction, openConnection(), and setRequestMethod() all throw checked
        // exceptions (MalformedURLException, IOException, ProtocolException).
        // They must be inside the try/catch — previously they were outside it, causing
        // "unreported exception" compile errors in javac strict mode.
        HttpURLConnection c = null;
        try {
            URL u = new URL(serverUrl + "/api/voice/capture");
            Log.d(TAG, "postCapture: connecting to voice/capture");
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

            // Fix 3: detect 401 (token expired) — stop retrying, log and skip enqueue
            if (code == 401) {
                Log.e(TAG, "postCapture: HTTP 401 — auth token expired or invalid. NOT queuing for retry.");
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
                // Feature 3: flush any previously queued failed transcripts
                new Thread(() -> { try { flushRetryQueue(); } catch (Exception ignored) {} }).start();

                // v8: Non-blocking suggestion fetch — fires after every successful capture.
                // Completely fail-safe: wrapped in try/catch, runs on background thread,
                // never blocks the main capture flow, never throws to caller.
                new Thread(() -> { try { fetchSuggestions(); } catch (Exception ignored) {} }).start();

                String intentType    = extractNestedField(json, "auto_exec", "intent_type");
                String phone         = extractNestedField(json, "auto_exec", "contact_phone");
                String whatsappPhone = extractNestedField(json, "auto_exec", "whatsapp_phone");
                String whatsappMsg   = extractNestedField(json, "auto_exec", "whatsapp_message");
                String navQuery      = extractNestedField(json, "auto_exec", "navigation_query");
                String navLat        = extractNestedField(json, "auto_exec", "lat");
                String navLng        = extractNestedField(json, "auto_exec", "lng");

                if ("contact".equals(intentType) && phone != null && !phone.isEmpty()) {
                    Log.d(TAG, "auto_exec: ACTION_CALL → " + phone);
                    Intent callIntent = new Intent(Intent.ACTION_CALL, Uri.parse("tel:" + phone));
                    callIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    getApplicationContext().startActivity(callIntent);

                } else if ("whatsapp".equals(intentType) && whatsappPhone != null) {
                    String waUrl = "https://wa.me/" + whatsappPhone.replaceAll("[^0-9]", "");
                    if (whatsappMsg != null && !whatsappMsg.isEmpty()) {
                        try { waUrl += "?text=" + java.net.URLEncoder.encode(whatsappMsg, "UTF-8"); }
                        catch (Exception ignored) {}
                    }
                    Log.d(TAG, "auto_exec: WhatsApp → " + whatsappPhone);
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
                        Log.d(TAG, "auto_exec: navigation → " + mapsUri);
                        Intent navIntent = new Intent(Intent.ACTION_VIEW, Uri.parse(mapsUri));
                        navIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        getApplicationContext().startActivity(navIntent);
                    }
                }
            } else {
                // Non-2xx (except 401 handled above) — enqueue for retry
                Log.w(TAG, "postCapture: HTTP " + code + " — queuing transcript for retry");
                try { enqueueFailedTranscript(transcript); } catch (Exception ignored) {}
            }
            c.disconnect();

        } catch (java.io.IOException e) {
            // Fix 1: network timeout / connection failure — enqueue transcript for retry
            Log.w(TAG, "postCapture: IOException (" + e.getMessage() + ") — queuing transcript for retry");
            try { enqueueFailedTranscript(transcript); } catch (Exception ignored) {}
            try { if (c != null) c.disconnect(); } catch (Exception ignored) {}
        }
    }

    // ── v8: fetchSuggestions — non-blocking, called after every successful capture ────
    // Calls /api/agent/predict with the current authToken.
    // If workspace_id is set, the backend already handles business scoring.
    // On any failure (IOException, non-200, parse error) → silently returns.
    // SAFE: never modifies state, never throws, never blocks main flow.
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
                Log.d(TAG, "[SUGGEST] non-200: " + code + " (ignored)");
            }
            c.disconnect();
        } catch (Exception e) {
            // Completely silent — suggestion fetch is best-effort only
            Log.d(TAG, "[SUGGEST] fetch skipped (" + e.getMessage() + ")");
        }
    }

    // ── Feature 3: Auto-Save Guarantee ──────────────────────────────────────────
    // SharedPreferences retry queue: transcripts that got a non-2xx response
    // are saved here and flushed on the next successful 201.
    // Cap: 5 items × 500 chars to prevent unbounded growth.
    // All ops are try/catch — never throws, never breaks existing flow.
    private static final String PREFS_RETRY = "qk_voice_retry";
    private static final String PREFS_KEY   = "retry_queue";
    private static final int    QUEUE_MAX   = 5;

    // Max age for queued items: 24 hours. Stale items are silently dropped on flush.
    private static final long QUEUE_MAX_AGE_MS = 24 * 60 * 60 * 1000L;

    private void enqueueFailedTranscript(String transcript) {
        if (transcript == null || transcript.isEmpty()) return;
        try {
            SharedPreferences prefs = getSharedPreferences(PREFS_RETRY, MODE_PRIVATE);
            String raw = prefs.getString(PREFS_KEY, "[]");
            JSONArray arr = new JSONArray(raw);

            // Dedup: compute a simple hash of the truncated transcript text
            String text = transcript.substring(0, Math.min(transcript.length(), 500));
            int    hash = text.hashCode();

            // Check if this exact transcript is already queued (prevent double-enqueue)
            for (int i = 0; i < arr.length(); i++) {
                try {
                    JSONObject item = arr.getJSONObject(i);
                    if (item.optInt("hash", 0) == hash) {
                        Log.d(TAG, "enqueueFailedTranscript: duplicate skipped (hash=" + hash + ")");
                        return;
                    }
                } catch (Exception ignored) {}
            }

            if (arr.length() >= QUEUE_MAX) arr.remove(0); // drop oldest when full

            JSONObject entry = new JSONObject();
            entry.put("text",      text);
            entry.put("hash",      hash);
            entry.put("queued_at", System.currentTimeMillis());
            arr.put(entry);

            prefs.edit().putString(PREFS_KEY, arr.toString()).apply();
            Log.d(TAG, "enqueueFailedTranscript: queued (" + arr.length() + " pending, hash=" + hash + ")");
        } catch (Exception e) {
            Log.w(TAG, "enqueueFailedTranscript failed (non-fatal): " + e.getMessage());
        }
    }

    private void flushRetryQueue() {
        try {
            SharedPreferences prefs = getSharedPreferences(PREFS_RETRY, MODE_PRIVATE);
            String raw = prefs.getString(PREFS_KEY, "[]");
            JSONArray arr = new JSONArray(raw);
            if (arr.length() == 0) return;
            Log.d(TAG, "flushRetryQueue: flushing " + arr.length() + " queued transcript(s)");
            prefs.edit().putString(PREFS_KEY, "[]").apply(); // clear before sending

            long now = System.currentTimeMillis();
            for (int i = 0; i < arr.length(); i++) {
                try {
                    // Support both old format (plain string) and new format (JSONObject)
                    String t;
                    long queuedAt = now; // default: treat as fresh if no timestamp
                    Object item = arr.get(i);
                    if (item instanceof JSONObject) {
                        JSONObject obj = (JSONObject) item;
                        t        = obj.optString("text", "");
                        queuedAt = obj.optLong("queued_at", now);
                    } else {
                        t = item.toString();
                    }

                    // Drop stale items silently — no infinite retry across days
                    if (now - queuedAt > QUEUE_MAX_AGE_MS) {
                        Log.d(TAG, "flushRetryQueue: dropping stale item (age=" + (now - queuedAt) / 1000 + "s)");
                        continue;
                    }

                    if (t != null && !t.isEmpty()) {
                        postCapture(t, true);
                        Thread.sleep(300); // brief pause between retries
                    }
                } catch (Exception inner) {
                    Log.w(TAG, "flushRetryQueue item " + i + " failed: " + inner.getMessage());
                }
            }
        } catch (Exception e) {
            Log.w(TAG, "flushRetryQueue error (non-fatal): " + e.getMessage());
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

    /**
     * Build a valid 44-byte WAV header + PCM data.
     */
    private byte[] buildWav(byte[] pcm) {
        byte[] h  = new byte[44];
        int    dl = pcm.length;
        int    tl = dl + 36;
        h[0]='R'; h[1]='I'; h[2]='F'; h[3]='F';
        h[4]=(byte)tl;       h[5]=(byte)(tl>>8);  h[6]=(byte)(tl>>16); h[7]=(byte)(tl>>24);
        h[8]='W'; h[9]='A'; h[10]='V'; h[11]='E';
        h[12]='f'; h[13]='m'; h[14]='t'; h[15]=' ';
        h[16]=16;
        h[20]=1;
        h[22]=1;
        h[24]=(byte)SAMPLE_RATE;       h[25]=(byte)(SAMPLE_RATE>>8);
        h[26]=(byte)(SAMPLE_RATE>>16); h[27]=(byte)(SAMPLE_RATE>>24);
        int br = SAMPLE_RATE * 2;
        h[28]=(byte)br;       h[29]=(byte)(br>>8);
        h[30]=(byte)(br>>16); h[31]=(byte)(br>>24);
        h[32]=2;
        h[34]=16;
        h[36]='d'; h[37]='a'; h[38]='t'; h[39]='a';
        h[40]=(byte)dl; h[41]=(byte)(dl>>8); h[42]=(byte)(dl>>16); h[43]=(byte)(dl>>24);

        byte[] w = new byte[44 + dl];
        System.arraycopy(h, 0, w, 0, 44);
        System.arraycopy(pcm, 0, w, 44, dl);
        return w;
    }

    private void stopCapture() {
        Log.d(TAG, "VoiceService.stopCapture");
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
