package com.pranix.quietkeep.services;

import org.junit.Test;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

/** FrameEnergy (DRV-11b): 10 ms frames, carried across buffers, 0..1 levels. */
public class FrameEnergyTest {

    private static short[] tone(int n, short amp) {
        short[] s = new short[n];
        for (int i = 0; i < n; i++) s[i] = (i % 2 == 0) ? amp : (short) -amp;
        return s;
    }

    @Test
    public void hundredFramesPerSecond() {
        assertEquals(100, FrameEnergy.FRAMES_PER_SECOND);
        FrameEnergy fe = new FrameEnergy();
        assertEquals(100, fe.push(new short[16000], 0, 16000).length);
    }

    @Test
    public void silenceIsZeroAndFullScaleIsNearOne() {
        FrameEnergy fe = new FrameEnergy();
        float[] quiet = fe.push(new short[160], 0, 160);
        assertEquals(1, quiet.length);
        assertEquals(0f, quiet[0], 1e-9f);
        float[] loud = fe.push(tone(160, Short.MAX_VALUE), 0, 160);
        assertEquals(1f, loud[0], 0.001f);
        float[] half = fe.push(tone(160, (short) 16384), 0, 160);
        assertEquals(0.5f, half[0], 0.001f);
    }

    @Test
    public void partFramesAreCarriedAcrossBuffers() {
        FrameEnergy fe = new FrameEnergy();
        short[] t = tone(160, (short) 16384);
        assertEquals(0, fe.push(t, 0, 100).length);      // 100 of 160
        float[] f = fe.push(t, 100, 60);                  // completes the frame
        assertEquals(1, f.length);
        assertEquals(0.5f, f[0], 0.001f);
    }

    @Test
    public void oddBufferSizesGiveTheSameFrames() {
        short[] t = tone(1600, (short) 8000);
        float[] whole = new FrameEnergy().push(t, 0, 1600);
        FrameEnergy fe = new FrameEnergy();
        int got = 0;
        for (int off = 0; off < 1600; off += 37) got += fe.push(t, off, Math.min(37, 1600 - off)).length;
        assertEquals(whole.length, got);
    }

    @Test
    public void resetDropsAPartFrame() {
        FrameEnergy fe = new FrameEnergy();
        fe.push(tone(100, Short.MAX_VALUE), 0, 100);
        fe.reset();
        float[] f = fe.push(new short[160], 0, 160);
        assertEquals(1, f.length);
        assertEquals(0f, f[0], 1e-9f);
    }

    @Test
    public void nothingForEmptyInput() {
        FrameEnergy fe = new FrameEnergy();
        assertEquals(0, fe.push(null, 0, 0).length);
        assertEquals(0, fe.push(new short[0], 0, 0).length);
        assertTrue(new FrameEnergy(80).push(new short[160], 0, 160).length == 2);
    }
}
