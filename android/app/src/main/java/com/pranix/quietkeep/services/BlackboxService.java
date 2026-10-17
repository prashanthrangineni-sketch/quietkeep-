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
import java.util.Base64;
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

    // Speed tracking for GPS-based speed drop
    private double lastGpsSpeedKmh = 0;

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

    @Override
    public void onCreate() {
        super.onCreate();
        mainHandler = new Handler(Looper.getMainLooper());
        sensorThread = new HandlerThread("BlackboxSensor");
        sensorThread.start();
        sensorHandler = new Handler(sensorThread.getLooper());
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
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
        stopSensors();
        stopGps();
        if (sensorThread != null) sensorThread.quitSafely();
        if (postTriggerRunnable != null) mainHandler.removeCallbacks(postTriggerRunnable);
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
        sensorManager = (SensorManager) getSystemService(Context.SENSOR_SERVICE);
        if (sensorManager == null) return;

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
        if (frozen.get()) return; // don't overwrite while freezing pre-trigger

        int type = event.sensor.getType();

        if (type == Sensor.TYPE_LINEAR_ACCELERATION) {
            System.arraycopy(event.values, 0, lastAccel, 0, 3);
            lastAccelTime = event.timestamp;
            pushImuSample(event.timestamp / 1000, lastAccel, lastGyro);
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
        if (frozen.get()) return;

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

        // GPS speed-drop check
        if (BlackboxLogic.isSpeedDropGps(lastGpsSpeedKmh, speedKmh)) {
            triggerFreeze("speed_drop_gps");
        }
        lastGpsSpeedKmh = speedKmh;
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

        // (a) Impact >= 3.5 g
        if (BlackboxLogic.isImpact(accel[0], accel[1], accel[2])) {
            triggerFreeze("impact_g");
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
            try {
                closePacket(triggerType);
            } catch (Exception e) {
                Log.e(TAG, "Failed to close packet: " + e.getMessage(), e);
            }
            frozen.set(false);
            pendingTrigger.set(null);
        };
        mainHandler.postDelayed(postTriggerRunnable, BlackboxLogic.POST_TRIGGER_MS);
    }

    // ── Packet assembly ──────────────────────────────────────────────────

    private void closePacket(String triggerType) {
        try {
            long now = System.currentTimeMillis();
            long[] window = BlackboxLogic.computePacketWindow(freezeTriggerTimeMs, now - BlackboxLogic.TOTAL_DURATION_MS);

            // Build JSON header
            JSONObject header = new JSONObject();
            header.put("version", 1);
            header.put("device_id", Settings.Secure.getString(getContentResolver(), Settings.Secure.ANDROID_ID));
            header.put("vehicle_id", JSONObject.NULL);
            header.put("trigger", triggerType);
            header.put("started_at", isoUtc(window[0]));
            header.put("ended_at", isoUtc(now));
            header.put("trigger_at", isoUtc(freezeTriggerTimeMs));
            header.put("pre_trigger_ms", window[2]);
            header.put("post_trigger_ms", window[3]);
            header.put("sample_rate_hz", BlackboxLogic.IMU_RATE_HZ);
            header.put("gps_rate_hz", BlackboxLogic.GPS_RATE_HZ);
            header.put("audio_opt_in", audioOptIn);
            header.put("audio_codec", audioOptIn ? "opus" : JSONObject.NULL);
            header.put("imu_samples", imuCount);
            header.put("gps_samples", gpsCount);
            header.put("audio_bytes", 0); // Audio capture placeholder

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

            // Assemble packet
            byte[] packet = new byte[headerBytes.length + imuBuf.position() + gpsBuf.position()];
            System.arraycopy(headerBytes, 0, packet, 0, headerBytes.length);
            System.arraycopy(imuBuf.array(), 0, packet, headerBytes.length, imuBuf.position());
            System.arraycopy(gpsBuf.array(), 0, packet, headerBytes.length + imuBuf.position(), gpsBuf.position());

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

            try {
                // Use Android Keystore if available
                KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
                ks.load(null);
                String alias = "qk_blackbox_seal";
                if (!ks.containsAlias(alias)) {
                    // Generate key in Keystore
                    android.security.keystore.KeyGenParameterSpec spec =
                        new android.security.keystore.KeyGenParameterSpec.Builder(
                            alias,
                            android.security.keystore.KeyProperties.PURPOSE_SIGN
                                | android.security.keystore.KeyProperties.PURPOSE_VERIFY)
                            .setDigests(android.security.keystore.KeyProperties.DIGEST_SHA256)
                            .setSignaturePaddings(android.security.keystore.KeyProperties.SIGNATURE_PADDING_RSA_PKCS1)
                            .setKeySize(2048)
                            .setIsStrongBoxBacked(hasStrongBox())
                            .build();
                    KeyPairGenerator kpg = KeyPairGenerator.getInstance(
                        android.security.keystore.KeyProperties.KEY_ALGORITHM_RSA, "AndroidKeyStore");
                    kpg.initialize(spec);
                    kpg.generateKeyPair();
                }
                PrivateKey privKey = (PrivateKey) ks.getKey(alias, null);
                PublicKey pubKey = ks.getCertificate(alias).getPublicKey();
                Signature sig = Signature.getInstance("SHA256withRSA");
                sig.initSign(privKey);
                sig.update(packet);
                byte[] signature = sig.sign();

                sigB64 = Base64.getEncoder().encodeToString(signature);
                pubB64 = Base64.getEncoder().encodeToString(pubKey.getEncoded());

                // Write signature and public key files
                writeText(new File(dir, filename + ".qkedr.sig"), sigB64);
                writeText(new File(dir, filename + ".qkedr.pub"), pubB64);

            } catch (Exception e) {
                Log.w(TAG, "Keystore sealing failed, falling back to unsigned: " + e.getMessage());
            }

            // Build result for the JS layer
            JSONObject result = new JSONObject();
            result.put("id", filename);
            result.put("trigger", triggerType);
            result.put("started_at", header.getString("started_at"));
            result.put("ended_at", header.getString("ended_at"));
            result.put("hash", hashHex);
            result.put("signature", sigB64);
            result.put("path", packetFile.getAbsolutePath());
            lastFreezeResult = result;

            Runnable cb = onFreezeComplete;
            if (cb != null) mainHandler.post(cb);

            Log.d(TAG, "Packet sealed: " + packetFile.getName() + " (" + packet.length + " bytes)");

        } catch (Exception e) {
            Log.e(TAG, "closePacket failed: " + e.getMessage(), e);
        }
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
