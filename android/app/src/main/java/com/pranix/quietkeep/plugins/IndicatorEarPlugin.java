package com.pranix.quietkeep.plugins;

import android.Manifest;
import android.content.pm.PackageManager;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.util.Log;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import com.pranix.quietkeep.services.FrameEnergy;

/**
 * IndicatorEarPlugin - the microphone half of DRV-11b (indicator tick/beep).
 *
 * WHAT LEAVES THIS FILE: numbers only. Every 100 ms the page gets an "energy"
 * event with ten 10 ms frame levels (0..1). The samples are read into one
 * reused buffer and overwritten by the next read; nothing is stored, written
 * to disk or sent anywhere. Not even a level is kept here after it is sent.
 *
 * SHORT LISTENS ONLY. start({ seconds }) listens for at most 8 seconds and then
 * stops by itself - long enough for src/lib/indicator-sound.js's 4-second
 * window, short enough that Aaria's wake listener, which gives up the
 * microphone for the listen, is back within seconds. The page side
 * (src/lib/drive-energy.js) does the hand-off with the same qk_mic_claim /
 * qk_mic_release signals every other microphone user in QuietKeep uses
 * (see MicGuard), so this never fights the wake listener for the microphone.
 *
 * Only while the person has opted in (Drive Mode -> Indicator reminders ->
 * "Also listen for the indicator sound", default OFF). That setting is checked
 * by the page before start() is ever called.
 *
 * Android allows this while QuietKeep is on screen (Drive Mode), or while one
 * of QuietKeep's microphone foreground services is running.
 */
@CapacitorPlugin(name = "IndicatorEar")
public class IndicatorEarPlugin extends Plugin {

    private static final String TAG = "QK_INDICATOR_EAR";
    static final int MAX_SECONDS = 8;
    private static final int CHUNK_SAMPLES = FrameEnergy.SAMPLE_RATE / 10;   // 100 ms

    private volatile Thread worker = null;
    private volatile boolean running = false;

    @PluginMethod
    public void start(PluginCall call) {
        if (ContextCompat.checkSelfPermission(getContext(), Manifest.permission.RECORD_AUDIO)
                != PackageManager.PERMISSION_GRANTED) {
            call.reject("microphone_permission_missing");
            return;
        }
        int seconds = Math.max(1, Math.min(MAX_SECONDS, call.getInt("seconds", 5)));
        synchronized (this) {
            if (running) { call.reject("already_listening"); return; }
            running = true;
        }
        final long endAt = System.currentTimeMillis() + seconds * 1000L;
        worker = new Thread(() -> listen(endAt), "qk-indicator-ear");
        worker.start();
        JSObject res = new JSObject();
        res.put("seconds", seconds);
        res.put("hz", FrameEnergy.FRAMES_PER_SECOND);
        call.resolve(res);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        running = false;
        call.resolve();
    }

    private void listen(long endAt) {
        AudioRecord rec = null;
        String why = "done";
        FrameEnergy fe = new FrameEnergy();
        short[] buf = new short[CHUNK_SAMPLES];
        try {
            int min = AudioRecord.getMinBufferSize(FrameEnergy.SAMPLE_RATE,
                    AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
            rec = new AudioRecord(MediaRecorder.AudioSource.MIC, FrameEnergy.SAMPLE_RATE,
                    AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT,
                    Math.max(min, CHUNK_SAMPLES * 2 * 2));
            if (rec.getState() != AudioRecord.STATE_INITIALIZED) { why = "microphone_unavailable"; return; }
            rec.startRecording();
            while (running && System.currentTimeMillis() < endAt) {
                int n = rec.read(buf, 0, buf.length);
                if (n <= 0) continue;
                float[] frames = fe.push(buf, 0, n);
                if (frames.length == 0) continue;
                JSArray arr = new JSArray();
                for (float f : frames) arr.put((double) f);
                JSObject ev = new JSObject();
                ev.put("frames", arr);
                ev.put("hz", FrameEnergy.FRAMES_PER_SECOND);
                ev.put("t", System.currentTimeMillis());
                notifyListeners("energy", ev);
            }
            if (!running) why = "stopped";
        } catch (Throwable t) {
            Log.w(TAG, "indicator listen failed: " + t.getClass().getSimpleName());
            why = "error";
        } finally {
            try { if (rec != null) { rec.stop(); rec.release(); } } catch (Throwable ignored) {}
            java.util.Arrays.fill(buf, (short) 0);   // nothing of the sound stays behind
            fe.reset();
            running = false;
            worker = null;
            JSObject end = new JSObject();
            end.put("reason", why);
            notifyListeners("ended", end);
        }
    }

    @Override
    protected void handleOnDestroy() {
        running = false;
        super.handleOnDestroy();
    }
}
