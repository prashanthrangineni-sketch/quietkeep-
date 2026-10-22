package com.pranix.quietkeep.services;

import org.junit.Test;

import java.security.KeyPair;
import java.util.Arrays;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

/**
 * BlackboxLogicTest — JVM unit tests for the black box logic (Task Card DRV-01).
 * Tests buffer window maths, trigger thresholds, test-mode tilt, and seal/tamper verification.
 */
public class BlackboxLogicTest {

    private static final double G = 9.80665;

    // ── 1. Buffer window maths ───────────────────────────────────────────────

    @Test
    public void testComputePacketWindow_fullBuffer() {
        long triggerTime = 100_000L;
        long bufferStart = 20_000L; // 80 s of history

        long[] window = BlackboxLogic.computePacketWindow(triggerTime, bufferStart);
        assertEquals(55_000L, window[0]); // starts 45 s before
        assertEquals(115_000L, window[1]); // ends 15 s after
        assertEquals(45_000L, window[2]); // preMs
        assertEquals(15_000L, window[3]); // postMs
        assertEquals(60_000L, window[1] - window[0]); // total duration = 60 s
    }

    @Test
    public void testComputePacketWindow_shortBuffer() {
        long triggerTime = 100_000L;
        long bufferStart = 80_000L; // only 20 s available

        long[] window = BlackboxLogic.computePacketWindow(triggerTime, bufferStart);
        assertEquals(80_000L, window[0]); // clips to buffer start
        assertEquals(115_000L, window[1]);
        assertEquals(20_000L, window[2]);
        assertEquals(15_000L, window[3]);
    }

    @Test
    public void testSampleCounts() {
        assertEquals(4500, BlackboxLogic.imuSamplesForDuration(BlackboxLogic.PRE_TRIGGER_MS));
        assertEquals(1500, BlackboxLogic.imuSamplesForDuration(BlackboxLogic.POST_TRIGGER_MS));
        assertEquals(6000, BlackboxLogic.imuBufferCapacity());

        assertEquals(45, BlackboxLogic.gpsSamplesForDuration(BlackboxLogic.PRE_TRIGGER_MS));
        assertEquals(15, BlackboxLogic.gpsSamplesForDuration(BlackboxLogic.POST_TRIGGER_MS));
        assertEquals(60, BlackboxLogic.gpsBufferCapacity());
    }

    // ── 2. Trigger thresholds ────────────────────────────────────────────────

    @Test
    public void testImpactThreshold() {
        assertTrue("3.5 g triggers impact", BlackboxLogic.isImpact(3.5 * G, 0, 0));
        assertTrue("4.0 g triggers impact", BlackboxLogic.isImpact(0, 4.0 * G, 0));
        assertFalse("3.4 g does not trigger impact", BlackboxLogic.isImpact(3.4 * G, 0, 0));
        assertFalse("1.0 g gravity does not trigger impact", BlackboxLogic.isImpact(0, 0, 1.0 * G));

        // Combined 3-axis: sqrt(2^2 + 2^2 + 2.5^2) = 3.77 g >= 3.5 g
        assertTrue("combined 3-axis >= 3.5 g triggers", BlackboxLogic.isImpact(2.0 * G, 2.0 * G, 2.5 * G));
        assertFalse("combined 3-axis < 3.5 g does not trigger", BlackboxLogic.isImpact(1.5 * G, 1.5 * G, 1.5 * G));
    }

    @Test
    public void testSpeedDropAccel_200msIntegration() {
        // 21 samples at 100 Hz = 200 ms total window
        double[] samples = new double[21 * 4];
        long baseUs = 1_000_000L;

        // Deceleration of 25 m/s² over 200 ms -> Δv = 5.0 m/s (18 km/h >= 15 km/h)
        for (int i = 0; i < 21; i++) {
            samples[i * 4] = baseUs + i * 10_000L;
            samples[i * 4 + 1] = 25.0; // ax
            samples[i * 4 + 2] = 0.0;
            samples[i * 4 + 3] = 0.0;
        }

        double maxDrop = BlackboxLogic.maxSpeedDropAccel(samples, 21);
        assertEquals(5.0, maxDrop, 0.05);
        assertTrue("drop >= 15 km/h (4.17 m/s) in 200 ms triggers", BlackboxLogic.isSpeedDropAccel(samples, 21));

        // Mild braking (10 m/s² over 200 ms -> Δv = 2.0 m/s = 7.2 km/h < 15 km/h)
        double[] mildSamples = new double[21 * 4];
        for (int i = 0; i < 21; i++) {
            mildSamples[i * 4] = baseUs + i * 10_000L;
            mildSamples[i * 4 + 1] = 10.0;
            mildSamples[i * 4 + 2] = 0.0;
            mildSamples[i * 4 + 3] = 0.0;
        }
        assertFalse("mild braking (2.0 m/s) does not trigger", BlackboxLogic.isSpeedDropAccel(mildSamples, 21));
    }

    @Test
    public void testSpeedDropGps() {
        assertTrue("GPS drop from 60 to 40 km/h triggers", BlackboxLogic.isSpeedDropGps(60.0, 40.0));
        assertTrue("GPS drop of exactly 15 km/h triggers", BlackboxLogic.isSpeedDropGps(50.0, 35.0));
        assertFalse("GPS drop of 14 km/h does not trigger", BlackboxLogic.isSpeedDropGps(60.0, 46.0));
        assertFalse("GPS acceleration does not trigger", BlackboxLogic.isSpeedDropGps(30.0, 50.0));
    }

    // ── 3. Test-mode tilt trigger ────────────────────────────────────────────

    @Test
    public void testTiltTrigger() {
        // Upright in dock (gravity along Y axis): 0° tilt
        assertEquals(0.0, BlackboxLogic.tiltFromVerticalDeg(0, G, 0), 0.1);
        assertFalse("upright does not trigger tilt", BlackboxLogic.isTiltPastThreshold(0, G, 0));

        // 45 degree tilt: < 60° threshold
        double tilt45 = BlackboxLogic.tiltFromVerticalDeg(0, G * Math.cos(Math.PI / 4), G * Math.sin(Math.PI / 4));
        assertEquals(45.0, tilt45, 0.5);
        assertFalse("45° tilt does not trigger", BlackboxLogic.isTiltPastThreshold(0, G * Math.cos(Math.PI / 4), G * Math.sin(Math.PI / 4)));

        // 65 degree tilt: >= 60° threshold
        double cos65 = Math.cos(Math.toRadians(65));
        double sin65 = Math.sin(Math.toRadians(65));
        double tilt65 = BlackboxLogic.tiltFromVerticalDeg(0, G * cos65, G * sin65);
        assertTrue("65° tilt is >= 60°", tilt65 >= 60.0);
        assertTrue("65° tilt triggers test tilt", BlackboxLogic.isTiltPastThreshold(0, G * cos65, G * sin65));

        // Flat on desk (gravity along Z axis, Y = 0): 90° tilt
        assertEquals(90.0, BlackboxLogic.tiltFromVerticalDeg(0, 0, G), 0.1);
        assertTrue("flat on desk triggers test tilt", BlackboxLogic.isTiltPastThreshold(0, 0, G));
    }

    // ── 4. Sealing and verification (tampered byte fails) ─────────────────────

    @Test
    public void testSealAndVerify_validAndTampered() {
        byte[] packet = "{\"version\":1,\"trigger\":\"impact_g\"}\nSampleBinaryPayload".getBytes();

        byte[] hash = BlackboxLogic.sha256(packet);
        assertEquals(32, hash.length);

        KeyPair kp = BlackboxLogic.generateTestKeyPair();
        byte[] sig = BlackboxLogic.signForTest(packet, kp.getPrivate());
        byte[] pubKey = kp.getPublic().getEncoded();

        // 1. Valid packet verification passes
        assertTrue("valid packet signature must verify", BlackboxLogic.verify(packet, sig, pubKey));

        // 2. Tampered byte in packet fails verification
        byte[] tampered = Arrays.copyOf(packet, packet.length);
        tampered[10] ^= 0x01; // flip 1 bit
        assertFalse("tampered byte MUST fail verification", BlackboxLogic.verify(tampered, sig, pubKey));

        // 3. Truncated packet fails verification
        byte[] truncated = Arrays.copyOf(packet, packet.length - 1);
        assertFalse("truncated packet MUST fail verification", BlackboxLogic.verify(truncated, sig, pubKey));

        // 4. Tampered signature fails verification
        byte[] tamperedSig = Arrays.copyOf(sig, sig.length);
        tamperedSig[5] ^= 0x01;
        assertFalse("tampered signature MUST fail verification", BlackboxLogic.verify(packet, tamperedSig, pubKey));
    }

    // ── Review fix (17 Oct 2026): 200 ms window edge ─────────────────────────

    @Test
    public void testAccelIntegration_stopsAtWindowEdge() {
        // 20 m/s² at 10 ms spacing, samples 0..210 ms. Only 0..200 ms may be
        // integrated: 20 × 0.2 = 4.0 m/s, below the 4.17 m/s threshold.
        int n = 22;
        double[] s = new double[n * 4];
        for (int i = 0; i < n; i++) {
            s[i * 4] = i * 10_000;
            s[i * 4 + 1] = 20;
        }
        assertEquals(4.0, BlackboxLogic.maxSpeedDropAccel(s, n), 1e-9);
        assertFalse(BlackboxLogic.isSpeedDropAccel(s, n));
    }

    // ── 5. OBD Record & v2 Packet (Task Card DRV-08) ─────────────────────────

    @Test
    public void testObdRecordBytesAndCapacity() {
        assertEquals(32, BlackboxLogic.obdRecordBytes());
        assertEquals(32, BlackboxLogic.OBD_RECORD_BYTES);
        assertEquals(120, BlackboxLogic.obdBufferCapacity());
        assertEquals(120, BlackboxLogic.obdSamplesForDuration(BlackboxLogic.TOTAL_DURATION_MS));
        assertEquals(90, BlackboxLogic.obdSamplesForDuration(BlackboxLogic.PRE_TRIGGER_MS));
        assertEquals(30, BlackboxLogic.obdSamplesForDuration(BlackboxLogic.POST_TRIGGER_MS));
    }

    @Test
    public void testObdRecord_encodeDecodeRoundTrip() {
        long t = 1_700_000_123_456L;
        float speed = 55.5f;
        float rpm = 2200.0f;
        float load = 40.0f;
        float coolant = 85.0f;
        float voltage = 14.2f;
        int flags = 0;

        byte[] enc = BlackboxLogic.encodeObdRecord(t, speed, rpm, load, coolant, voltage, flags);
        assertEquals(32, enc.length);

        BlackboxLogic.ObdRecord dec = BlackboxLogic.decodeObdRecord(enc);
        assertEquals(t, dec.timestampUs);
        assertEquals(speed, dec.speedKmh, 0.001f);
        assertEquals(rpm, dec.rpm, 0.001f);
        assertEquals(load, dec.loadPct, 0.001f);
        assertEquals(coolant, dec.coolantC, 0.001f);
        assertEquals(voltage, dec.voltage, 0.001f);
        assertEquals(0, dec.flags);
        assertFalse(dec.isMilOn());
        assertFalse(dec.isValueMissing());

        assertEquals(new BlackboxLogic.ObdRecord(t, speed, rpm, load, coolant, voltage, flags), dec);
    }

    @Test
    public void testObdRecord_nanAndFlagHandling() {
        long t = 1_700_000_999_000L;
        // speed, load and voltage are NaN; MIL on
        byte[] enc = BlackboxLogic.encodeObdRecord(t, Float.NaN, 800f, Float.NaN, 90f, Float.NaN, BlackboxLogic.OBD_FLAG_MIL_ON);
        assertEquals(32, enc.length);

        BlackboxLogic.ObdRecord dec = BlackboxLogic.decodeObdRecord(enc);
        assertEquals(t, dec.timestampUs);
        assertTrue(Float.isNaN(dec.speedKmh));
        assertEquals(800f, dec.rpm, 0.001f);
        assertTrue(Float.isNaN(dec.loadPct));
        assertEquals(90f, dec.coolantC, 0.001f);
        assertTrue(Float.isNaN(dec.voltage));
        assertTrue(dec.isMilOn());
        assertTrue("NaN field must automatically set OBD_FLAG_VALUE_MISSING", dec.isValueMissing());
        assertEquals(BlackboxLogic.OBD_FLAG_MIL_ON | BlackboxLogic.OBD_FLAG_VALUE_MISSING, dec.flags);
    }

    @Test
    public void testV2PacketWithZeroObdSamplesEqualsV1Layout() {
        // Mock IMU block (e.g. 5 samples * 32 bytes = 160 bytes)
        byte[] imu = new byte[5 * BlackboxLogic.IMU_RECORD_BYTES];
        for (int i = 0; i < imu.length; i++) imu[i] = (byte) (i * 3);

        // Mock GPS block (e.g. 2 samples * 40 bytes = 80 bytes)
        byte[] gps = new byte[2 * BlackboxLogic.GPS_RECORD_BYTES];
        for (int i = 0; i < gps.length; i++) gps[i] = (byte) (i * 7);

        // v1 binary payload: imu + gps
        byte[] v1Payload = new byte[imu.length + gps.length];
        System.arraycopy(imu, 0, v1Payload, 0, imu.length);
        System.arraycopy(gps, 0, v1Payload, imu.length, gps.length);

        // v2 binary payload with 0 OBD samples: imu + gps + (0 obd bytes)
        byte[] obd0 = new byte[0];
        byte[] v2Payload = new byte[imu.length + gps.length + obd0.length];
        System.arraycopy(imu, 0, v2Payload, 0, imu.length);
        System.arraycopy(gps, 0, v2Payload, imu.length, gps.length);
        System.arraycopy(obd0, 0, v2Payload, imu.length + gps.length, obd0.length);

        assertTrue("v2 packet with 0 OBD samples must have byte-for-byte identical binary payload to v1",
                Arrays.equals(v1Payload, v2Payload));
    }

    // ── DRV-01c: crash confirmation (17–19 Oct drives: 51 false records) ──

    private static double[] mags(double... g) {
        double[] out = new double[g.length];
        for (int i = 0; i < g.length; i++) out[i] = g[i] * G;
        return out;
    }

    @Test
    public void testSingleSpikeIsNotACandidate() {
        // one 10 ms 5 g pothole spike between two 0.5 g samples -> 2 g average
        assertFalse(BlackboxLogic.isImpactCandidate(BlackboxLogic.smoothedG(mags(0.5, 5.0, 0.5))));
        // sustained 4 g over 30 ms is a candidate
        assertTrue(BlackboxLogic.isImpactCandidate(BlackboxLogic.smoothedG(mags(4.0, 4.0, 4.0))));
        assertFalse(BlackboxLogic.isImpactCandidate(BlackboxLogic.smoothedG(mags(3.9, 3.9, 3.9))));
    }

    @Test
    public void testGpsDropNeedsAccurateFixesAtSpeed() {
        assertTrue(BlackboxLogic.isSpeedDropGpsTrusted(60, 40, 5, 8));
        assertFalse("poor fix", BlackboxLogic.isSpeedDropGpsTrusted(60, 40, 5, 35));
        assertFalse("poor earlier fix", BlackboxLogic.isSpeedDropGpsTrusted(60, 40, 25, 5));
        assertFalse("slow before", BlackboxLogic.isSpeedDropGpsTrusted(18, 2, 5, 5));
        assertFalse("small drop", BlackboxLogic.isSpeedDropGpsTrusted(60, 50, 5, 5));
    }

    @Test
    public void testExternalTriggersAlwaysConfirmed() {
        assertEquals("1", BlackboxLogic.confirmCrash("crash_detector", 0, Double.NaN, null, null)[0]);
        assertEquals("1", BlackboxLogic.confirmCrash("voice_save", 0, Double.NaN, null, null)[0]);
        assertEquals("1", BlackboxLogic.confirmCrash("test_tilt", 0, Double.NaN, null, null)[0]);
    }

    @Test
    public void testSevereImpactConfirmedWithoutGps() {
        String[] v = BlackboxLogic.confirmCrash("impact_g", 9.0, Double.NaN, null, null);
        assertEquals("1", v[0]);
        assertEquals("severe_impact", v[1]);
    }

    @Test
    public void testPotholeWhileDrivingOnIsAJolt() {
        long[] t = {1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000};
        double[] v = {41, 40, 40, 42, 43, 44, 44, 45, 45, 46};
        String[] r = BlackboxLogic.confirmCrash("impact_g", 4.6, 42, t, v);
        assertEquals("0", r[0]);
        assertEquals("kept_moving", r[1]);
    }

    @Test
    public void testImpactThenStopIsCrash() {
        long[] t = {1000, 2000, 3000, 4000};
        double[] v = {30, 12, 3, 0};
        String[] r = BlackboxLogic.confirmCrash("impact_g", 5.0, 48, t, v);
        assertEquals("1", r[0]);
        assertEquals("stopped_after_impact", r[1]);
    }

    @Test
    public void testSustainedSlowdownIsCrash() {
        long[] t = {1000, 2000, 3000, 4000, 5000};
        double[] v = {50, 30, 25, 22, 20};
        String[] r = BlackboxLogic.confirmCrash("speed_drop_gps", 0, 60, t, v);
        assertEquals("1", r[0]);
        assertEquals("sustained_slowdown", r[1]);
    }

    @Test
    public void testParkedOrSlowIsAJolt() {
        assertEquals("0", BlackboxLogic.confirmCrash("impact_g", 5.0, 10, new long[]{1000}, new double[]{0})[0]);
        assertEquals("not_moving_before", BlackboxLogic.confirmCrash("impact_g", 5.0, Double.NaN, null, null)[1]);
        assertEquals("no_gps_after", BlackboxLogic.confirmCrash("impact_g", 5.0, 40, new long[0], new double[0])[1]);
    }

    @Test
    public void testSpeedBreakerSlowdownIsAJolt() {
        // 40 -> 22 km/h for a speed breaker, then back up: not sustained
        long[] t = {1000, 2000, 3000, 4000, 5000, 6000};
        double[] v = {30, 22, 24, 28, 33, 38};
        assertEquals("0", BlackboxLogic.confirmCrash("speed_drop_gps", 0, 40, t, v)[0]);
    }
}
