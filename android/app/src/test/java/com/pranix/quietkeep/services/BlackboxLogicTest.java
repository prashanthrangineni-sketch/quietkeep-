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
}
