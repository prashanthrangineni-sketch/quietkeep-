package com.pranix.quietkeep.services;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.location.GnssStatus;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;
import android.os.Looper;
import android.provider.Settings;
import android.util.Log;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.security.PrivateKey;
import java.security.PublicKey;
import java.security.Signature;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;

/**
 * BlackboxService — foreground service that runs the rolling 60-second sensor
 * buffer during Drive Mode.
 *
 * Started/stopped by QkBlackboxPlugin. Uses FOREGROUND_SERVICE_TYPE_LOCATION
 * by default; adds FOREGROUND_SERVICE_TYPE_MICROPHONE only when the audio
 * opt-in is true AND RECORD_AUDIO is granted at runtime.
 */
public class BlackboxService extends Service implements SensorEventListener, LocationListener {

    private static final String TAG = "QK_BLACKBOX";
    private static final String CHANNEL_ID = "qk_blackbox_channel";
    private static final int NOTIFICATION_ID = 9901;
    public static final String EXTRA_AUDIO_OPT_IN = "audio_opt_in";
    public static final String EXTRA_TEST_MODE = "test_mode";
    /** Intent action: freeze the running buffer (crash detector / SAVE_LAST_60S). */
    public static final String ACTION_FREEZE = "com.pranix.quietkeep.BLACKBOX_FREEZE";
    public static final String EXTRA_TRIGGER = "trigger";

    /** True while sensors are recording (between start and stop of Drive Mode). */
    private static volatile boolean running = false;
    public static boolean isRunning() { return running; }
    private static volatile BlackboxService activeInstance = null;

    // ── Ring buffers ─────────────────────────────────────────────────────
    // IMU: 100 Hz × 60 s = 6000 samples. Each: timestamp_us + 6 floats
    private static final int IMU_CAPACITY = BlackboxLogic.imuBufferCapacity();
    private final long[]   imuTimestamps = new long[IMU_CAPACITY];
    private final float[][] imuValues    = new float[IMU_CAPACITY][6]; // ax,ay,az,gx,gy,gz
    private int imuHead = 0, imuCount = 0;

    // GPS: 1 Hz × 60 s = 60 samples
    private static final int GPS_CAPACITY = BlackboxLogic.gpsBufferCapacity();
    private final long[]   gpsTimestamps = new long[GPS_CAPACITY];
    private final double[][] gpsValues   = new double[GPS_CAPACITY][6]; // lat,lon,alt,speed,bearing,accuracy
    private int gpsHead = 0, gpsCount = 0;

    // OBD: 2 Hz × 60 s = 120 samples
    private static final int OBD_CAPACITY = BlackboxLogic.obdBufferCapacity();
    private final long[]   obdTimestamps = new long[OBD_CAPACITY];
    private final float[][] obdValues    = new float[OBD_CAPACITY][5]; // speedKmh, rpm, loadPct, coolantC, voltage
    private final int[]    obdFlags      = new int[OBD_CAPACITY];
    private int obdHead = 0, obdCount = 0;
    private volatile String latestObdSource = null;

    // Speed tracking for GPS-based speed drop
    private double lastGpsSpeedKmh = 0;
    private double lastGpsAccuracyM = 999;

    // DRV-01c: strongest 30 ms-average impact seen around the current candidate
    // (from the trigger until the packet closes). Sensor thread only.
    private double candidatePeakG = 0;

    // Tilt detection for test mode
    private boolean testMode = false;
    private long tiltStartMs = 0;

    // ── State ────────────────────────────────────────────────────────────
    private final AtomicBoolean frozen = new AtomicBoolean(false);
    private final AtomicReference<String> pendingTrigger = new AtomicReference<>(null);
    private long freezeTriggerTimeMs = 0;
    private boolean audioOptIn = false;

    private SensorManager sensorManager;
    private LocationManager locationManager;
    private HandlerThread sensorThread;
    private Handler sensorHandler;

    // Post-trigger timer
    private Handler mainHandler;
    private Runnable postTriggerRunnable;

    /** The plugin sets this so a freeze can notify JS. */
    public static volatile Runnable onFreezeComplete;
    /** The latest freeze result, for the plugin to pick up. */
    public static volatile JSONObject lastFreezeResult;

    /**
     * Push an OBD reading into the running service's ring buffer.
     * Thread-safe: posts onto the sensor thread handler.
     * Returns false if the service is not currently running.
     */
    public static boolean pushObd(long timestampUs, float speedKmh, float rpm,
                                  float loadPct, float coolantC, float voltage,
                                  int flags, String source) {
        BlackboxService svc = activeInstance;
        if (svc == null || !running) return false;
        Handler h = svc.sensorHandler;
        if (h == null) return false;
        h.post(() -> svc.pushObdInternal(timestampUs, speedKmh, rpm, loadPct, coolantC, voltage, flags, source));
        return true;
    }

    /** Readings whose wall-clock time falls inside the packet window. */
    private int countObdInWindow(long windowStartUs) {
        int n = 0;
        for (int i = 0; i < obdCount; i++) {
            int idx = ((obdHead - obdCount + i) % OBD_CAPACITY + OBD_CAPACITY) % OBD_CAPACITY;
            if (obdTimestamps[idx] >= windowStartUs) n++;
        }
        return n;
    }

    private void pushObdInternal(long timestampUs, float speedKmh, float rpm,
                                 float loadPct, float coolantC, float voltage,
                                 int flags, String source) {
        if (source != null && !source.isEmpty()) {
            latestObdSource = source;
        }
        int idx = obdHead % OBD_CAPACITY;
        obdTimestamps[idx] = timestampUs;
        obdValues[idx][0] = speedKmh;
        obdValues[idx][1] = rpm;
        obdValues[idx][2] = loadPct;
        obdValues[idx][3] = coolantC;
        obdValues[idx][4] = voltage;
        obdFlags[idx] = flags;
        obdHead++;
        if (obdCount < OBD_CAPACITY) obdCount++;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        activeInstance = this;
        mainHandler = new Handler(Looper.getMainLooper());
        sensorThread = new HandlerThread("BlackboxSensor");
        sensorThread.start();
        sensorHandler = new Handler(sensorThread.getLooper());
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        // Freeze request from the plugin (crash detector or voice SAVE_LAST_60S).
        // Handled here, via startService, because the service never registered
        // a broadcast receiver — the broadcast the first version sent was lost.
        if (intent != null && ACTION_FREEZE.equals(intent.getAction())) {
            if (running) {
                String trigger = intent.getStringExtra(EXTRA_TRIGGER);
                final String t = trigger != null ? trigger : "voice_save";
                sensorHandler.post(() -> triggerFreeze(t));
            } else {
                Log.w(TAG, "Freeze requested but Drive Mode recording is not running");
                if (!running) stopSelf(startId);
            }
            return START_STICKY;
        }
        if (intent != null) {
            audioOptIn = intent.getBooleanExtra(EXTRA_AUDIO_OPT_IN, false);
            testMode = intent.getBooleanExtra(EXTRA_TEST_MODE, false);
        }

        createNotificationChannel();
        startForegroundWithTypes();
        startSensors();
        startGps();
        Log.d(TAG, "BlackboxService started (audio=" + audioOptIn + " test=" + testMode + ")");
        return START_STICKY;
    }

    @Nullable @Override
    public IBinder onBind(Intent intent) { return null; }

    @Override
    public void onDestroy() {
        activeInstance = null;
        stopSensors();
        stopGps();
        running = false;
        // Drive Mode stopped inside the 15 s post-trigger window: close the
        // packet now with what was recorded, rather than losing the crash.
        if (postTriggerRunnable != null && frozen.get()) {
            sensorHandler.removeCallbacks(postTriggerRunnable);
            sensorHandler.post(postTriggerRunnable);
        }
        if (sensorThread != null) sensorThread.quitSafely();
        Log.d(TAG, "BlackboxService destroyed");
        super.onDestroy();
    }

    // ── Foreground service types ─────────────────────────────────────────

    private void startForegroundWithTypes() {
        Notification notification = buildNotification();

        if (Build.VERSION.SDK_INT >= 34) {
            int types = ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION;

            // Add microphone type ONLY when audio is opted in AND permission is granted.
            // Declaring FOREGROUND_SERVICE_TYPE_MICROPHONE without RECORD_AUDIO
            // crashes the app on launch on Android 14+.
            if (audioOptIn && hasMicPermission()) {
                types |= ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE;
            }

            startForeground(NOTIFICATION_ID, notification, types);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
    }

    private boolean hasMicPermission() {
        return ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
                == PackageManager.PERMISSION_GRANTED;
    }

    // ── Sensors ──────────────────────────────────────────────────────────

    private void startSensors() {
        // Idempotent: Drive Mode re-sends start() when a setting changes.
        stopSensors();
        sensorManager = (SensorManager) getSystemService(Context.SENSOR_SERVICE);
        if (sensorManager == null) return;
        running = true;

        // Linear accelerometer (gravity removed)
        Sensor accel = sensorManager.getDefaultSensor(Sensor.TYPE_LINEAR_ACCELERATION);
        if (accel != null) {
            // SensorManager.SENSOR_DELAY_FASTEST is ~200 Hz on most phones;
            // we request 10 ms (100 Hz).
            sensorManager.registerListener(this, accel, 10_000, sensorHandler);
        }

        // Gyroscope
        Sensor gyro = sensorManager.getDefaultSensor(Sensor.TYPE_GYROSCOPE);
        if (gyro != null) {
            sensorManager.registerListener(this, gyro, 10_000, sensorHandler);
        }

        // Gravity sensor for tilt detection in test mode
        if (testMode) {
            Sensor gravity = sensorManager.getDefaultSensor(Sensor.TYPE_GRAVITY);
            if (gravity != null) {
                sensorManager.registerListener(this, gravity, 50_000, sensorHandler);
            }
        }
    }

    private void stopSensors() {
        if (sensorManager != null) sensorManager.unregisterListener(this);
    }

    // ── GPS ───────────────────────────────────────────────────────────────

    private void startGps() {
        stopGps();
        locationManager = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
        if (locationManager == null) return;

        try {
            // Request GNSS provider so NavIC is used where the phone supports it
            String provider = LocationManager.GPS_PROVIDER;
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION)
                    == PackageManager.PERMISSION_GRANTED) {
                locationManager.requestLocationUpdates(provider, 1000, 0, this, sensorThread.getLooper());
            }
        } catch (Exception e) {
            Log.w(TAG, "GPS start failed: " + e.getMessage());
        }
    }

    private void stopGps() {
        if (locationManager != null) {
            try { locationManager.removeUpdates(this); } catch (Exception e) { /* ok */ }
        }
    }

    // ── Sensor callbacks ─────────────────────────────────────────────────

    // Temporary holders for combining accel + gyro into one IMU sample
    private final float[] lastAccel = new float[3];
    private final float[] lastGyro = new float[3];
    private long lastAccelTime = 0;

    @Override
    public void onSensorChanged(SensorEvent event) {
        // Keep recording while frozen: the ring holds exactly 60 s, so the
        // 15 s written after the trigger overwrite only the oldest 15 s and
        // the packet ends up as 45 s before + 15 s after (spec step 4).
        int type = event.sensor.getType();

        if (type == Sensor.TYPE_LINEAR_ACCELERATION) {
            System.arraycopy(event.values, 0, lastAccel, 0, 3);
            lastAccelTime = event.timestamp;
            pushImuSample(event.timestamp / 1000, lastAccel, lastGyro);
            if (frozen.get()) {
                candidatePeakG = Math.max(candidatePeakG, recentSmoothedG());
            }
            checkTriggers(lastAccel);
        } else if (type == Sensor.TYPE_GYROSCOPE) {
            System.arraycopy(event.values, 0, lastGyro, 0, 3);
        } else if (type == Sensor.TYPE_GRAVITY && testMode) {
            checkTestTilt(event.values);
        }
    }

    @Override public void onAccuracyChanged(Sensor sensor, int accuracy) { /* unused */ }

    @Override
    public void onLocationChanged(Location location) {

        double speedMs = location.hasSpeed() ? location.getSpeed() : 0;
        double speedKmh = speedMs * 3.6;

        pushGpsSample(
            System.currentTimeMillis() * 1000,
            location.getLatitude(), location.getLongitude(),
            location.hasAltitude() ? location.getAltitude() : 0,
            speedMs,
            location.hasBearing() ? location.getBearing() : 0,
            location.hasAccuracy() ? location.getAccuracy() : 999
        );

        // GPS speed-drop check (not while a packet is already being recorded).
        // DRV-01c: only between two accurate fixes at speed — GPS jitter at
        // low speed or in a poor fix was producing false records.
        double accuracyM = location.hasAccuracy() ? location.getAccuracy() : 999;
        if (!frozen.get() && BlackboxLogic.isSpeedDropGpsTrusted(
                lastGpsSpeedKmh, speedKmh, lastGpsAccuracyM, accuracyM)) {
            triggerFreeze("speed_drop_gps");
        }
        lastGpsSpeedKmh = speedKmh;
        lastGpsAccuracyM = accuracyM;
    }

    // ── Ring buffer writes ───────────────────────────────────────────────

    private void pushImuSample(long timestampUs, float[] accel, float[] gyro) {
        int idx = imuHead % IMU_CAPACITY;
        imuTimestamps[idx] = timestampUs;
        imuValues[idx][0] = accel[0];
        imuValues[idx][1] = accel[1];
        imuValues[idx][2] = accel[2];
        imuValues[idx][3] = gyro[0];
        imuValues[idx][4] = gyro[1];
        imuValues[idx][5] = gyro[2];
        imuHead++;
        if (imuCount < IMU_CAPACITY) imuCount++;
    }

    private void pushGpsSample(long timestampUs, double lat, double lon,
                                double alt, double speed, double bearing, double accuracy) {
        int idx = gpsHead % GPS_CAPACITY;
        gpsTimestamps[idx] = timestampUs;
        gpsValues[idx][0] = lat;
        gpsValues[idx][1] = lon;
        gpsValues[idx][2] = alt;
        gpsValues[idx][3] = speed;
        gpsValues[idx][4] = bearing;
        gpsValues[idx][5] = accuracy;
        gpsHead++;
        if (gpsCount < GPS_CAPACITY) gpsCount++;
    }

    // ── Trigger checks ───────────────────────────────────────────────────

    private void checkTriggers(float[] accel) {
        if (frozen.get()) return;

        // (a) Impact candidate: 30 ms average >= 4 g (DRV-01c). A single
        // 10 ms spike (pothole, speed breaker, phone knocked in its mount) no
        // longer opens a record; the packet is then confirmed or kept as a
        // jolt at close time (see confirmAndFinish).
        double smoothed = recentSmoothedG();
        if (BlackboxLogic.isImpactCandidate(smoothed)) {
            triggerFreeze("impact_g");
            candidatePeakG = Math.max(candidatePeakG, smoothed);
            return;
        }

        // (b) Accelerometer-integrated speed drop >= 15 km/h in 200 ms
        // Build samples array from the last 200 ms of the buffer
        int samplesNeeded = (int) (BlackboxLogic.SPEED_DROP_WINDOW_MS * BlackboxLogic.IMU_RATE_HZ / 1000) + 1;
        if (imuCount >= samplesNeeded) {
            double[] windowSamples = new double[samplesNeeded * 4];
            for (int i = 0; i < samplesNeeded; i++) {
                int bufIdx = ((imuHead - samplesNeeded + i) % IMU_CAPACITY + IMU_CAPACITY) % IMU_CAPACITY;
                windowSamples[i * 4]     = imuTimestamps[bufIdx];
                windowSamples[i * 4 + 1] = imuValues[bufIdx][0];
                windowSamples[i * 4 + 2] = imuValues[bufIdx][1];
                windowSamples[i * 4 + 3] = imuValues[bufIdx][2];
            }
            if (BlackboxLogic.isSpeedDropAccel(windowSamples, samplesNeeded)) {
                triggerFreeze("speed_drop_accel");
            }
        }
    }

    /** 30 ms-average resultant linear acceleration of the newest IMU samples, in g. */
    private double recentSmoothedG() {
        int n = BlackboxLogic.IMPACT_SMOOTH_SAMPLES;
        if (imuCount < n) return 0;
        double[] mags = new double[n];
        for (int i = 0; i < n; i++) {
            int idx = ((imuHead - n + i) % IMU_CAPACITY + IMU_CAPACITY) % IMU_CAPACITY;
            float x = imuValues[idx][0], y = imuValues[idx][1], z = imuValues[idx][2];
            mags[i] = Math.sqrt(x * x + y * y + z * z);
        }
        return BlackboxLogic.smoothedG(mags);
    }

    /**
     * DRV-01c: decide from the ring (sensor thread, packet window still in it)
     * whether the candidate looks like a crash. Returns {confirmed, reason,
     * speedBeforeKmh, minSpeedAfterKmh}.
     */
    private Object[] confirmCandidate(String triggerType) {
        long trigUs = freezeTriggerTimeMs * 1000L;
        double speedBefore = Double.NaN;
        java.util.ArrayList<Long> offs = new java.util.ArrayList<>();
        java.util.ArrayList<Double> speeds = new java.util.ArrayList<>();
        double minAfter = Double.NaN;
        for (int i = 0; i < gpsCount; i++) {
            int idx = ((gpsHead - gpsCount + i) % GPS_CAPACITY + GPS_CAPACITY) % GPS_CAPACITY;
            if (gpsValues[idx][5] > BlackboxLogic.MAX_GPS_ACCURACY_M) continue;
            long dtUs = gpsTimestamps[idx] - trigUs;
            double kmh = gpsValues[idx][3] * 3.6;
            if (dtUs >= -5_000_000L && dtUs <= 0) {
                speedBefore = Double.isNaN(speedBefore) ? kmh : Math.max(speedBefore, kmh);
            } else if (dtUs > 0 && dtUs <= 10_000_000L) {
                offs.add(dtUs / 1000L);
                speeds.add(kmh);
                minAfter = Double.isNaN(minAfter) ? kmh : Math.min(minAfter, kmh);
            }
        }
        long[] o = new long[offs.size()];
        double[] v = new double[speeds.size()];
        for (int i = 0; i < o.length; i++) { o[i] = offs.get(i); v[i] = speeds.get(i); }
        String[] verdict = BlackboxLogic.confirmCrash(triggerType, candidatePeakG, speedBefore, o, v);
        return new Object[] { "1".equals(verdict[0]), verdict[1], speedBefore, minAfter };
    }

    /** Keep only the newest MAX_JOLTS_KEPT unconfirmed packets (with their .sig/.pub). */
    private void pruneJolts(File dir) {
        File[] files = dir.listFiles((d, name) -> name.endsWith(".qkedr"));
        if (files == null) return;
        java.util.ArrayList<File> jolts = new java.util.ArrayList<>();
        for (File f : files) {
            if (isUnconfirmedPacket(f)) jolts.add(f);
        }
        if (jolts.size() <= BlackboxLogic.MAX_JOLTS_KEPT) return;
        java.util.Collections.sort(jolts, (a, b) -> Long.compare(b.lastModified(), a.lastModified()));
        for (int i = BlackboxLogic.MAX_JOLTS_KEPT; i < jolts.size(); i++) {
            File f = jolts.get(i);
            new File(dir, f.getName() + ".sig").delete();
            new File(dir, f.getName() + ".pub").delete();
            f.delete();
        }
    }

    /** Reads only the header line; old packets without the field are confirmed. */
    public static boolean isUnconfirmedPacket(File f) {
        try (java.io.BufferedReader r = new java.io.BufferedReader(
                new java.io.InputStreamReader(new java.io.FileInputStream(f), "UTF-8"))) {
            String line = r.readLine();
            if (line == null) return false;
            return !new JSONObject(line).optBoolean("confirmed", true);
        } catch (Exception e) {
            return false;
        }
    }

    private void checkTestTilt(float[] gravity) {
        if (frozen.get() || !testMode) return;
        // Only trigger at 0 km/h (parked desk test)
        if (lastGpsSpeedKmh > 2) { tiltStartMs = 0; return; }

        boolean tilted = BlackboxLogic.isTiltPastThreshold(gravity[0], gravity[1], gravity[2]);
        if (tilted) {
            if (tiltStartMs == 0) tiltStartMs = System.currentTimeMillis();
            else if (System.currentTimeMillis() - tiltStartMs >= BlackboxLogic.TEST_TILT_HOLD_MS) {
                tiltStartMs = 0;
                triggerFreeze("test_tilt");
            }
        } else {
            tiltStartMs = 0;
        }
    }

    /**
     * Called externally by the existing crash detector in Drive Mode (trigger c)
     * or by the SAVE_LAST_60S voice intent (trigger d).
     */
    public void externalTrigger(String type) {
        triggerFreeze(type);
    }

    private void triggerFreeze(String triggerType) {
        if (!frozen.compareAndSet(false, true)) return; // already frozen
        freezeTriggerTimeMs = System.currentTimeMillis();
        pendingTrigger.set(triggerType);
        Log.d(TAG, "FREEZE triggered: " + triggerType);

        // Stop overwriting the pre-trigger buffer. Continue recording for 15 s.
        postTriggerRunnable = () -> {
            if (!frozen.get()) return; // already closed (stop during window)
            try {
                closePacket(triggerType);
            } catch (Exception e) {
                Log.e(TAG, "Failed to close packet: " + e.getMessage(), e);
            }
            frozen.set(false);
            pendingTrigger.set(null);
            candidatePeakG = 0;
        };
        // Posted on the sensor thread so the packet is read on the same thread
        // that writes the ring — no torn samples.
        sensorHandler.postDelayed(postTriggerRunnable, BlackboxLogic.POST_TRIGGER_MS);
    }

    // ── Packet assembly ──────────────────────────────────────────────────

    private void closePacket(String triggerType) {
        try {
            long now = System.currentTimeMillis();
            long[] window = BlackboxLogic.computePacketWindow(freezeTriggerTimeMs, now - BlackboxLogic.TOTAL_DURATION_MS);

            // DRV-01c: confirm the candidate before writing (header is sealed).
            Object[] verdict = confirmCandidate(triggerType);
            boolean confirmed = (Boolean) verdict[0];

            // Build JSON header
            JSONObject header = new JSONObject();
            header.put("version", 1);
            header.put("format_version", 2);
            header.put("device_id", Settings.Secure.getString(getContentResolver(), Settings.Secure.ANDROID_ID));
            header.put("vehicle_id", JSONObject.NULL);
            header.put("trigger", triggerType);
            header.put("confirmed", confirmed);
            header.put("confirm_reason", (String) verdict[1]);
            header.put("peak_g", Math.round(candidatePeakG * 100.0) / 100.0);
            double sb = (Double) verdict[2], ma = (Double) verdict[3];
            header.put("speed_before_kmh", Double.isNaN(sb) ? JSONObject.NULL : (Object) (Math.round(sb * 10.0) / 10.0));
            header.put("min_speed_after_kmh", Double.isNaN(ma) ? JSONObject.NULL : (Object) (Math.round(ma * 10.0) / 10.0));
            header.put("started_at", isoUtc(window[0]));
            header.put("ended_at", isoUtc(now));
            header.put("trigger_at", isoUtc(freezeTriggerTimeMs));
            header.put("pre_trigger_ms", window[2]);
            header.put("post_trigger_ms", window[3]);
            header.put("sample_rate_hz", BlackboxLogic.IMU_RATE_HZ);
            header.put("gps_rate_hz", BlackboxLogic.GPS_RATE_HZ);
            // IMU timestamps are the sensor clock (boot time, µs); GPS ones are
            // wall clock (µs). wall_us = imu_us + imu_clock_offset_us.
            header.put("imu_clock_offset_us",
                System.currentTimeMillis() * 1000L - android.os.SystemClock.elapsedRealtimeNanos() / 1000L);
            header.put("audio_opt_in", audioOptIn);
            // Audio capture is NOT built in v1 (see docs/qkedr-v1.md). The
            // opt-in is recorded honestly; no codec is claimed.
            header.put("audio_codec", JSONObject.NULL);
            header.put("audio_status", audioOptIn ? "opted_in_not_captured_v1" : "off");
            header.put("imu_samples", imuCount);
            header.put("gps_samples", gpsCount);
            header.put("obd_samples", countObdInWindow(window[0] * 1000L));
            header.put("obd_record_bytes", BlackboxLogic.OBD_RECORD_BYTES);
            header.put("obd_source", latestObdSource != null ? latestObdSource : JSONObject.NULL);
            header.put("audio_bytes", 0);
            if (gpsCount > 0) {
                int last = ((gpsHead - 1) % GPS_CAPACITY + GPS_CAPACITY) % GPS_CAPACITY;
                JSONObject fix = new JSONObject();
                fix.put("lat", gpsValues[last][0]);
                fix.put("lon", gpsValues[last][1]);
                fix.put("accuracy_m", gpsValues[last][5]);
                fix.put("speed_kmh", gpsValues[last][3] * 3.6);
                header.put("last_fix", fix);
            } else {
                header.put("last_fix", JSONObject.NULL);
            }

            byte[] headerBytes = (header.toString() + "\n").getBytes("UTF-8");

            // Binary IMU block
            ByteBuffer imuBuf = ByteBuffer.allocate(imuCount * BlackboxLogic.IMU_RECORD_BYTES);
            imuBuf.order(ByteOrder.LITTLE_ENDIAN);
            for (int i = 0; i < imuCount; i++) {
                int idx = ((imuHead - imuCount + i) % IMU_CAPACITY + IMU_CAPACITY) % IMU_CAPACITY;
                imuBuf.putLong(imuTimestamps[idx]);
                for (int j = 0; j < 6; j++) imuBuf.putFloat(imuValues[idx][j]);
            }

            // Binary GPS block
            ByteBuffer gpsBuf = ByteBuffer.allocate(gpsCount * BlackboxLogic.GPS_RECORD_BYTES);
            gpsBuf.order(ByteOrder.LITTLE_ENDIAN);
            for (int i = 0; i < gpsCount; i++) {
                int idx = ((gpsHead - gpsCount + i) % GPS_CAPACITY + GPS_CAPACITY) % GPS_CAPACITY;
                gpsBuf.putLong(gpsTimestamps[idx]);
                gpsBuf.putDouble(gpsValues[idx][0]); // lat
                gpsBuf.putDouble(gpsValues[idx][1]); // lon
                gpsBuf.putFloat((float) gpsValues[idx][2]); // alt
                gpsBuf.putFloat((float) gpsValues[idx][3]); // speed
                gpsBuf.putFloat((float) gpsValues[idx][4]); // bearing
                gpsBuf.putFloat((float) gpsValues[idx][5]); // accuracy
            }

            // Binary OBD block (format_version 2)
            ByteBuffer obdBuf = ByteBuffer.allocate(obdCount * BlackboxLogic.OBD_RECORD_BYTES);
            obdBuf.order(ByteOrder.LITTLE_ENDIAN);
            // Only car readings inside this packet's 60 s window. The ring keeps
            // the last 120 readings whatever their age, so if the reader
            // dropped out minutes ago its old readings must not be presented
            // as if they belonged to this crash.
            long obdWindowStartUs = window[0] * 1000L;
            int obdIncluded = 0;
            for (int i = 0; i < obdCount; i++) {
                int idx = ((obdHead - obdCount + i) % OBD_CAPACITY + OBD_CAPACITY) % OBD_CAPACITY;
                if (obdTimestamps[idx] < obdWindowStartUs) continue;
                obdIncluded++;
                byte[] rec = BlackboxLogic.encodeObdRecord(
                    obdTimestamps[idx],
                    obdValues[idx][0],
                    obdValues[idx][1],
                    obdValues[idx][2],
                    obdValues[idx][3],
                    obdValues[idx][4],
                    obdFlags[idx]
                );
                obdBuf.put(rec);
            }

            // Assemble packet: header + IMU + GPS + OBD
            byte[] packet = new byte[headerBytes.length + imuBuf.position() + gpsBuf.position() + obdBuf.position()];
            System.arraycopy(headerBytes, 0, packet, 0, headerBytes.length);
            System.arraycopy(imuBuf.array(), 0, packet, headerBytes.length, imuBuf.position());
            System.arraycopy(gpsBuf.array(), 0, packet, headerBytes.length + imuBuf.position(), gpsBuf.position());
            System.arraycopy(obdBuf.array(), 0, packet, headerBytes.length + imuBuf.position() + gpsBuf.position(), obdBuf.position());

            // Write to app-private storage
            File dir = new File(getFilesDir(), "blackbox");
            if (!dir.exists()) dir.mkdirs();
            String filename = "event_" + freezeTriggerTimeMs;
            File packetFile = new File(dir, filename + ".qkedr");
            try (FileOutputStream fos = new FileOutputStream(packetFile)) {
                fos.write(packet);
            }

            // Seal: SHA-256 + sign
            byte[] hash = BlackboxLogic.sha256(packet);
            String hashHex = bytesToHex(hash);
            String sigB64 = "";
            String pubB64 = "";
            boolean sealed = false;
            String sealError = null;

            try {
                // Use Android Keystore if available
                KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
                ks.load(null);
                String alias = "qk_blackbox_seal";
                if (!ks.containsAlias(alias)) {
                    boolean strongBox = hasStrongBox();
                    try {
                        generateSealKey(alias, strongBox);
                    } catch (Exception sbErr) {
                        if (!strongBox) throw sbErr;
                        // StrongBox present but refused the key — fall back to TEE.
                        Log.w(TAG, "StrongBox key failed, using TEE: " + sbErr.getMessage());
                        generateSealKey(alias, false);
                    }
                }
                PrivateKey privKey = (PrivateKey) ks.getKey(alias, null);
                PublicKey pubKey = ks.getCertificate(alias).getPublicKey();
                Signature sig = Signature.getInstance("SHA256withRSA");
                sig.initSign(privKey);
                sig.update(packet);
                byte[] signature = sig.sign();

                // android.util.Base64: java.util.Base64 needs API 26, minSdk is 23.
                sigB64 = android.util.Base64.encodeToString(signature, android.util.Base64.NO_WRAP);
                pubB64 = android.util.Base64.encodeToString(pubKey.getEncoded(), android.util.Base64.NO_WRAP);

                // Write signature and public key files
                writeText(new File(dir, filename + ".qkedr.sig"), sigB64);
                writeText(new File(dir, filename + ".qkedr.pub"), pubB64);
                sealed = true;

            } catch (Exception e) {
                // Not silent: the record is kept (a crash record beats none) but
                // it is flagged sealed=false everywhere it surfaces, and verify()
                // will report it as not valid.
                sealError = e.getClass().getSimpleName() + ": " + e.getMessage();
                Log.e(TAG, "Keystore sealing FAILED — record kept UNSEALED: " + sealError);
            }

            // Build result for the JS layer
            JSONObject result = new JSONObject();
            result.put("id", filename);
            result.put("trigger", triggerType);
            result.put("confirmed", confirmed);
            result.put("confirm_reason", (String) verdict[1]);
            result.put("started_at", header.getString("started_at"));
            result.put("ended_at", header.getString("ended_at"));
            result.put("hash", hashHex);
            result.put("signature", sigB64);
            result.put("public_key", pubB64);
            result.put("sealed", sealed);
            if (sealError != null) result.put("seal_error", sealError);
            result.put("path", packetFile.getAbsolutePath());
            lastFreezeResult = result;
            if (!confirmed) pruneJolts(dir);

            Runnable cb = onFreezeComplete;
            if (cb != null) mainHandler.post(cb);

            Log.d(TAG, "Packet sealed: " + packetFile.getName() + " (" + packet.length + " bytes)");

        } catch (Exception e) {
            Log.e(TAG, "closePacket failed: " + e.getMessage(), e);
        }
    }

    private void generateSealKey(String alias, boolean strongBox) throws Exception {
        android.security.keystore.KeyGenParameterSpec.Builder b =
            new android.security.keystore.KeyGenParameterSpec.Builder(
                alias,
                android.security.keystore.KeyProperties.PURPOSE_SIGN
                    | android.security.keystore.KeyProperties.PURPOSE_VERIFY)
                .setDigests(android.security.keystore.KeyProperties.DIGEST_SHA256)
                .setSignaturePaddings(android.security.keystore.KeyProperties.SIGNATURE_PADDING_RSA_PKCS1)
                .setKeySize(2048);
        // setIsStrongBoxBacked exists only on API 28+; calling it on 23–27
        // throws NoSuchMethodError (an Error, not caught as Exception).
        if (Build.VERSION.SDK_INT >= 28) b.setIsStrongBoxBacked(strongBox);
        KeyPairGenerator kpg = KeyPairGenerator.getInstance(
            android.security.keystore.KeyProperties.KEY_ALGORITHM_RSA, "AndroidKeyStore");
        kpg.initialize(b.build());
        kpg.generateKeyPair();
    }

    private boolean hasStrongBox() {
        if (Build.VERSION.SDK_INT >= 28) {
            return getPackageManager().hasSystemFeature(PackageManager.FEATURE_STRONGBOX_KEYSTORE);
        }
        return false;
    }

    private static String isoUtc(long epochMs) {
        if (Build.VERSION.SDK_INT >= 26) {
            return DateTimeFormatter.ISO_INSTANT.format(Instant.ofEpochMilli(epochMs));
        }
        return new java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",
                java.util.Locale.US).format(new java.util.Date(epochMs));
    }

    private static String bytesToHex(byte[] bytes) {
        StringBuilder sb = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) sb.append(String.format("%02x", b));
        return sb.toString();
    }

    private static void writeText(File file, String text) throws Exception {
        try (FileOutputStream fos = new FileOutputStream(file)) {
            fos.write(text.getBytes("UTF-8"));
        }
    }

    // ── Notification ─────────────────────────────────────────────────────

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID, "Drive Mode Recording",
                NotificationManager.IMPORTANCE_LOW);
            channel.setDescription("Active while Drive Mode is recording sensor data.");
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm != null) nm.createNotificationChannel(channel);
        }
    }

    private Notification buildNotification() {
        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Drive Mode Active")
            .setContentText("Recording crash data for your safety")
            .setSmallIcon(android.R.drawable.ic_menu_compass)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setOngoing(true)
            .build();
    }
}
