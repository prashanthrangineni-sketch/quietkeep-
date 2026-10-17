package com.pranix.quietkeep.services;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.security.KeyFactory;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.MessageDigest;
import java.security.PublicKey;
import java.security.Signature;
import java.security.spec.X509EncodedKeySpec;
import java.util.Base64;

/**
 * BlackboxLogic — pure computational logic for the on-phone black box.
 *
 * Every method here is a plain function with no Android framework dependency,
 * so it can be tested in a JVM unit test without Robolectric or a device.
 *
 * The thresholds, buffer window maths, and seal verification all live here;
 * BlackboxService and QkBlackboxPlugin call into this class.
 */
public final class BlackboxLogic {

    private BlackboxLogic() {}

    // ── Constants ────────────────────────────────────────────────────────

    /** Pre-trigger buffer duration in milliseconds. */
    public static final long PRE_TRIGGER_MS  = 45_000L;
    /** Post-trigger recording duration in milliseconds. */
    public static final long POST_TRIGGER_MS = 15_000L;
    /** Total packet duration in milliseconds. */
    public static final long TOTAL_DURATION_MS = PRE_TRIGGER_MS + POST_TRIGGER_MS;

    /** Impact threshold in g (resultant linear acceleration). */
    public static final double IMPACT_G = 3.5;
    /** Speed-drop threshold in m/s (15 km/h). */
    public static final double SPEED_DROP_MS = 15.0 / 3.6;  // 4.1667 m/s
    /** Sliding window for accelerometer speed-drop integration in ms. */
    public static final long SPEED_DROP_WINDOW_MS = 200L;
    /** GPS speed-drop threshold in km/h between two consecutive fixes. */
    public static final double GPS_SPEED_DROP_KMH = 15.0;

    /** Test-mode tilt angle threshold in degrees from vertical. */
    public static final double TEST_TILT_DEGREES = 60.0;
    /** Test-mode tilt hold duration in milliseconds. */
    public static final long TEST_TILT_HOLD_MS = 3000L;

    /** IMU sample rate in Hz. */
    public static final int IMU_RATE_HZ = 100;
    /** GPS fix rate in Hz. */
    public static final int GPS_RATE_HZ = 1;
    /** OBD sample rate in Hz. */
    public static final int OBD_RATE_HZ = 2;

    /** Bytes per IMU sample record (timestamp_us + 3 accel + 3 gyro floats). */
    public static final int IMU_RECORD_BYTES = 8 + 6 * 4;  // 32 bytes
    /** Bytes per GPS sample record. */
    public static final int GPS_RECORD_BYTES = 8 + 2 * 8 + 4 * 4;  // 40 bytes
    /** Bytes per OBD sample record (timestamp_us + 5 floats + uint8 flags + 3 padding). */
    public static final int OBD_RECORD_BYTES = 32;

    /** OBD flag bit0: Check-engine light (MIL) is ON. */
    public static final int OBD_FLAG_MIL_ON = 0x01;
    /** OBD flag bit1: At least one field value is missing (NaN). */
    public static final int OBD_FLAG_VALUE_MISSING = 0x02;

    // ── Trigger checks ───────────────────────────────────────────────────

    /**
     * True when the resultant linear acceleration exceeds the impact threshold.
     * @param ax linear acceleration X in m/s²
     * @param ay linear acceleration Y in m/s²
     * @param az linear acceleration Z in m/s²
     */
    public static boolean isImpact(double ax, double ay, double az) {
        double gForce = Math.sqrt(ax * ax + ay * ay + az * az) / 9.80665;
        return gForce >= (IMPACT_G - 1e-6);
    }

    /**
     * Compute the resultant g-force from linear acceleration components.
     */
    public static double resultantG(double ax, double ay, double az) {
        return Math.sqrt(ax * ax + ay * ay + az * az) / 9.80665;
    }

    /**
     * Integrate acceleration samples over a 200 ms sliding window to detect
     * a speed drop of >= 15 km/h (4.17 m/s).
     *
     * @param samples  array of {timestamp_us, ax, ay, az} tuples flattened:
     *                 [t0, ax0, ay0, az0, t1, ax1, ay1, az1, ...]
     * @param count    number of samples (length / 4)
     * @return the maximum integrated speed drop (m/s) found in any 200 ms window,
     *         or 0 if no window qualifies
     */
    public static double maxSpeedDropAccel(double[] samples, int count) {
        if (count < 2) return 0.0;

        double maxDrop = 0.0;

        // Sliding window: find contiguous samples within 200 ms
        for (int windowStart = 0; windowStart < count; windowStart++) {
            double sumVx = 0, sumVy = 0, sumVz = 0;
            long t0 = (long) samples[windowStart * 4];

            for (int j = windowStart + 1; j < count; j++) {
                long tj = (long) samples[j * 4];
                // Stop BEFORE integrating a sample that lies past the 200 ms
                // window (the first version added one sample too many).
                if (tj - t0 > SPEED_DROP_WINDOW_MS * 1000) break;
                long dt_us = tj - (long) samples[(j - 1) * 4];
                if (dt_us <= 0) continue;

                double dt_s = dt_us / 1_000_000.0;
                // Trapezoidal integration of acceleration
                double ax = (samples[(j - 1) * 4 + 1] + samples[j * 4 + 1]) / 2.0;
                double ay = (samples[(j - 1) * 4 + 2] + samples[j * 4 + 2]) / 2.0;
                double az = (samples[(j - 1) * 4 + 3] + samples[j * 4 + 3]) / 2.0;
                sumVx += ax * dt_s;
                sumVy += ay * dt_s;
                sumVz += az * dt_s;

                long elapsed = tj - t0;
                if (elapsed > SPEED_DROP_WINDOW_MS * 1000) break; // past 200 ms

                double deltaSpeed = Math.sqrt(sumVx * sumVx + sumVy * sumVy + sumVz * sumVz);
                if (deltaSpeed > maxDrop) maxDrop = deltaSpeed;
            }
        }
        return maxDrop;
    }

    /**
     * True when the accelerometer-integrated speed drop exceeds the threshold.
     */
    public static boolean isSpeedDropAccel(double[] samples, int count) {
        return maxSpeedDropAccel(samples, count) >= SPEED_DROP_MS;
    }

    /**
     * True when two consecutive GPS fixes show a speed drop >= 15 km/h.
     */
    public static boolean isSpeedDropGps(double prevSpeedKmh, double currSpeedKmh) {
        return (prevSpeedKmh - currSpeedKmh) >= GPS_SPEED_DROP_KMH;
    }

    /**
     * Compute the tilt angle from vertical (portrait upright phone Y-axis).
     * When upright in a dock, gravity is along Y (gy ~ 9.81 m/s²), tilt = 0°.
     * When tilted flat on a desk, gravity shifts to Z (gz ~ 9.81 m/s², gy ~ 0), tilt = 90°.
     *
     * @param gx gravity X component (m/s²)
     * @param gy gravity Y component (m/s²)
     * @param gz gravity Z component (m/s²)
     * @return tilt angle from vertical in degrees (0 = upright, 90 = flat)
     */
    public static double tiltFromVerticalDeg(double gx, double gy, double gz) {
        double mag = Math.sqrt(gx * gx + gy * gy + gz * gz);
        if (mag < 0.01) return 0;
        double cosAngle = Math.abs(gy) / mag;
        return Math.toDegrees(Math.acos(Math.min(1.0, cosAngle)));
    }

    /**
     * True when the tilt exceeds the test-mode threshold (60 degrees).
     */
    public static boolean isTiltPastThreshold(double gx, double gy, double gz) {
        return tiltFromVerticalDeg(gx, gy, gz) >= TEST_TILT_DEGREES;
    }

    // ── Buffer window maths ──────────────────────────────────────────────

    /**
     * Given a trigger timestamp and the current ring buffer state, compute
     * the start and end timestamps for the packet.
     *
     * @param triggerTimeMs  epoch millis when the trigger fired
     * @param bufferStartMs  epoch millis of the oldest sample in the buffer
     * @return {packetStartMs, packetEndMs, preMs, postMs}
     */
    public static long[] computePacketWindow(long triggerTimeMs, long bufferStartMs) {
        // Pre-trigger: up to 45 s before the trigger, but not before the buffer start
        long packetStart = Math.max(bufferStartMs, triggerTimeMs - PRE_TRIGGER_MS);
        long packetEnd = triggerTimeMs + POST_TRIGGER_MS;
        long preMs = triggerTimeMs - packetStart;
        long postMs = POST_TRIGGER_MS;
        return new long[] { packetStart, packetEnd, preMs, postMs };
    }

    /**
     * How many IMU samples fit in a given duration.
     */
    public static int imuSamplesForDuration(long durationMs) {
        return (int) (durationMs * IMU_RATE_HZ / 1000);
    }

    /**
     * How many GPS samples fit in a given duration.
     */
    public static int gpsSamplesForDuration(long durationMs) {
        return (int) (durationMs * GPS_RATE_HZ / 1000);
    }

    /**
     * Ring buffer capacity: how many IMU samples the buffer must hold to
     * always have the full pre-trigger window.
     */
    public static int imuBufferCapacity() {
        // Buffer must hold at least 60 s worth to cover the full window
        return imuSamplesForDuration(TOTAL_DURATION_MS);
    }

    /**
     * Ring buffer capacity for GPS samples.
     */
    public static int gpsBufferCapacity() {
        return gpsSamplesForDuration(TOTAL_DURATION_MS);
    }

    /**
     * Bytes per OBD record.
     */
    public static int obdRecordBytes() {
        return OBD_RECORD_BYTES;
    }

    /**
     * How many OBD samples fit in a given duration.
     */
    public static int obdSamplesForDuration(long durationMs) {
        return (int) (durationMs * OBD_RATE_HZ / 1000);
    }

    /**
     * Ring buffer capacity for OBD samples (2 Hz x 60 s = 120 records).
     */
    public static int obdBufferCapacity() {
        return obdSamplesForDuration(TOTAL_DURATION_MS);
    }

    // ── OBD record encoding & decoding ───────────────────────────────────

    /**
     * POJO representing a single decoded OBD record from the black box ring buffer.
     */
    public static final class ObdRecord {
        public final long timestampUs;
        public final float speedKmh;
        public final float rpm;
        public final float loadPct;
        public final float coolantC;
        public final float voltage;
        public final int flags;

        public ObdRecord(long timestampUs, float speedKmh, float rpm, float loadPct, float coolantC, float voltage, int flags) {
            this.timestampUs = timestampUs;
            this.speedKmh = speedKmh;
            this.rpm = rpm;
            this.loadPct = loadPct;
            this.coolantC = coolantC;
            this.voltage = voltage;
            this.flags = flags;
        }

        public boolean isMilOn() {
            return (flags & OBD_FLAG_MIL_ON) != 0;
        }

        public boolean isValueMissing() {
            return (flags & OBD_FLAG_VALUE_MISSING) != 0;
        }

        @Override
        public boolean equals(Object o) {
            if (this == o) return true;
            if (o == null || getClass() != o.getClass()) return false;
            ObdRecord r = (ObdRecord) o;
            return timestampUs == r.timestampUs &&
                    Float.compare(r.speedKmh, speedKmh) == 0 &&
                    Float.compare(r.rpm, rpm) == 0 &&
                    Float.compare(r.loadPct, loadPct) == 0 &&
                    Float.compare(r.coolantC, coolantC) == 0 &&
                    Float.compare(r.voltage, voltage) == 0 &&
                    flags == r.flags;
        }

        @Override
        public int hashCode() {
            int result = Long.hashCode(timestampUs);
            result = 31 * result + Float.hashCode(speedKmh);
            result = 31 * result + Float.hashCode(rpm);
            result = 31 * result + Float.hashCode(loadPct);
            result = 31 * result + Float.hashCode(coolantC);
            result = 31 * result + Float.hashCode(voltage);
            result = 31 * result + flags;
            return result;
        }

        @Override
        public String toString() {
            return "ObdRecord{" +
                    "timestampUs=" + timestampUs +
                    ", speedKmh=" + speedKmh +
                    ", rpm=" + rpm +
                    ", loadPct=" + loadPct +
                    ", coolantC=" + coolantC +
                    ", voltage=" + voltage +
                    ", flags=" + flags +
                    '}';
        }
    }

    /**
     * Encode an OBD record into 32 bytes little-endian.
     * Missing values (NaN) automatically have OBD_FLAG_VALUE_MISSING bit set.
     */
    public static byte[] encodeObdRecord(long timestampUs, float speedKmh, float rpm,
                                         float loadPct, float coolantC, float voltage, int flags) {
        ByteBuffer buf = ByteBuffer.allocate(OBD_RECORD_BYTES);
        buf.order(ByteOrder.LITTLE_ENDIAN);
        buf.putLong(timestampUs);
        buf.putFloat(speedKmh);
        buf.putFloat(rpm);
        buf.putFloat(loadPct);
        buf.putFloat(coolantC);
        buf.putFloat(voltage);
        int finalFlags = flags;
        if (Float.isNaN(speedKmh) || Float.isNaN(rpm) || Float.isNaN(loadPct)
                || Float.isNaN(coolantC) || Float.isNaN(voltage)) {
            finalFlags |= OBD_FLAG_VALUE_MISSING;
        }
        buf.put((byte) (finalFlags & 0xFF));
        buf.put((byte) 0);
        buf.put((byte) 0);
        buf.put((byte) 0);
        return buf.array();
    }

    /**
     * Encode an ObdRecord instance into 32 bytes little-endian.
     */
    public static byte[] encodeObdRecord(ObdRecord record) {
        return encodeObdRecord(record.timestampUs, record.speedKmh, record.rpm,
                record.loadPct, record.coolantC, record.voltage, record.flags);
    }

    /**
     * Decode a 32-byte little-endian OBD record starting at the specified offset.
     */
    public static ObdRecord decodeObdRecord(byte[] bytes, int offset) {
        ByteBuffer buf = ByteBuffer.wrap(bytes, offset, OBD_RECORD_BYTES);
        buf.order(ByteOrder.LITTLE_ENDIAN);
        long timestampUs = buf.getLong();
        float speedKmh = buf.getFloat();
        float rpm = buf.getFloat();
        float loadPct = buf.getFloat();
        float coolantC = buf.getFloat();
        float voltage = buf.getFloat();
        int flags = buf.get() & 0xFF;
        buf.get(); buf.get(); buf.get(); // 3 padding bytes
        return new ObdRecord(timestampUs, speedKmh, rpm, loadPct, coolantC, voltage, flags);
    }

    /**
     * Decode a 32-byte little-endian OBD record.
     */
    public static ObdRecord decodeObdRecord(byte[] bytes) {
        return decodeObdRecord(bytes, 0);
    }

    // ── Seal / verify ────────────────────────────────────────────────────

    /**
     * Compute SHA-256 of the given data.
     */
    public static byte[] sha256(byte[] data) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            return digest.digest(data);
        } catch (Exception e) {
            throw new RuntimeException("SHA-256 not available", e);
        }
    }

    /**
     * Verify a SHA256withRSA signature against a public key.
     *
     * @param data       the original data (the .qkedr packet bytes)
     * @param signature  the signature bytes
     * @param publicKey  the X.509-encoded public key bytes
     * @return true if the signature is valid
     */
    public static boolean verify(byte[] data, byte[] signature, byte[] publicKey) {
        try {
            KeyFactory keyFactory = KeyFactory.getInstance("RSA");
            PublicKey pubKey = keyFactory.generatePublic(new X509EncodedKeySpec(publicKey));
            Signature sig = Signature.getInstance("SHA256withRSA");
            sig.initVerify(pubKey);
            sig.update(data);
            return sig.verify(signature);
        } catch (Exception e) {
            return false;
        }
    }

    /**
     * Verify using Base64-encoded strings (for the JS wrapper and stored files).
     */
    public static boolean verifyBase64(byte[] data, String signatureB64, String publicKeyB64) {
        try {
            byte[] sig = Base64.getDecoder().decode(signatureB64);
            byte[] pub = Base64.getDecoder().decode(publicKeyB64);
            return verify(data, sig, pub);
        } catch (Exception e) {
            return false;
        }
    }

    /**
     * Generate a test RSA-2048 key pair (for unit tests — production uses
     * Android Keystore). Returns {privateKey, publicKey}.
     */
    public static KeyPair generateTestKeyPair() {
        try {
            KeyPairGenerator kpg = KeyPairGenerator.getInstance("RSA");
            kpg.initialize(2048);
            return kpg.generateKeyPair();
        } catch (Exception e) {
            throw new RuntimeException("Cannot generate test key pair", e);
        }
    }

    /**
     * Sign data with an RSA private key (for unit tests — production uses
     * Android Keystore).
     */
    public static byte[] signForTest(byte[] data, java.security.PrivateKey privateKey) {
        try {
            Signature sig = Signature.getInstance("SHA256withRSA");
            sig.initSign(privateKey);
            sig.update(data);
            return sig.sign();
        } catch (Exception e) {
            throw new RuntimeException("Cannot sign", e);
        }
    }
}
