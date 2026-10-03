package com.pranix.quietkeep;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import android.content.Context;
import android.util.Log;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.filters.SdkSuppress;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.work.Data;
import androidx.work.ListenableWorker;
import androidx.work.testing.TestWorkerBuilder;

import com.pranix.aariaedge.CommandRecognizer;
import com.pranix.aariaedge.ModelStore;
import com.pranix.aariaedge.NightlySyncWorker;
import com.pranix.aariaedge.VadProcessor;
import com.pranix.aariaedge.WakeWordMatcher;

import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.InputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.Arrays;
import java.util.List;
import java.util.concurrent.Executors;

import ai.onnxruntime.OrtEnvironment;
import ai.onnxruntime.OrtSession;

/**
 * The on-phone speech engine, run on a real Android system (an emulator in the automatic checks).
 *
 * WHY THIS EXISTS
 * On 3 Oct 2026 the founder installed a build on which every automatic check was green. It could not
 * recognise one word: the recogniser had never been packed into the app, the downloaded settings file
 * was overwritten with wrong keys, and the wake check had only ever met tidy typed text. All three were
 * found by hand, on his phone, on his time. Desk tests cannot see any of them. This test can.
 *
 * WHAT IT DOES, in the order the app does it
 *   1. Downloads the English speech files with the app's own download job (same list, same signature
 *      check, same checksums).
 *   2. Checks the publisher's model.json is still the publisher's.
 *   3. Loads the recogniser. This fails if the speech engine is not packed into the app.
 *   4. Runs the speech detector over five recordings. This fails if the two native libraries the
 *      engine is built from do not work together.
 *   5. Lets the recogniser write down the first 1.5 seconds of each, as the plugin does, and puts that
 *      through the wake check. Recordings that say "Hey Aaria ..." must wake; the others must not.
 *
 * The recordings in androidTest/assets are computer voices (Piper text-to-speech, LibriTTS-R voices),
 * 16 kHz mono, each with half a second of silence before and 1.2 seconds after. They prove the chain
 * works. They do not say how well it catches real people; that needs real voices.
 */
@RunWith(AndroidJUnit4.class)
@SdkSuppress(minSdkVersion = 26)
public class AariaSpeechEngineTest {

    private static final String TAG = "AariaEngineTest";

    // The same list and key the set-up screen uses (src/app/aaria-consent/page.jsx).
    private static final String MANIFEST_URL =
            "https://github.com/PranixQuick/aaria-edge-models/releases/download/models-2026-10/manifest.json";
    private static final String MANIFEST_PUBLIC_KEY =
            "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE4hSD5nmqhyiuU76UNMOhBFAJDQDfkq3NqDpHB14Wc7Y9WjDqvQP2eBMyvQ05UdHDBDbr3sqinRzefOETbw2VXg==";

    private static final String[] WAKE = {"wake_what_is_the_time.wav", "wake_remind_me.wav", "wake_name_only.wav"};
    private static final String[] NOT_WAKE = {"not_wake_are_you_there.wav", "not_wake_please_remind.wav"};

    @Test
    public void speechEngineWorksOnARealAndroidSystem() throws Exception {
        Context app = InstrumentationRegistry.getInstrumentation().getTargetContext();
        Context test = InstrumentationRegistry.getInstrumentation().getContext();

        // 1. The app's own download job.
        Data input = new Data.Builder()
                .putString(NightlySyncWorker.KEY_MANIFEST_URL, MANIFEST_URL)
                .putString(NightlySyncWorker.KEY_ACTIVE_LANG, "en")
                .putString(NightlySyncWorker.KEY_VOICE_ID, "default")
                .putString(NightlySyncWorker.KEY_MANIFEST_PUBLIC_KEY, MANIFEST_PUBLIC_KEY)
                .build();
        NightlySyncWorker worker = TestWorkerBuilder
                .from(app, NightlySyncWorker.class, Executors.newSingleThreadExecutor())
                .setInputData(input)
                .build();
        ListenableWorker.Result result = worker.doWork();
        assertEquals("the download job did not finish successfully", ListenableWorker.Result.success(), result);

        // 2. The publisher's model.json, untouched.
        File modelDir = new File(app.getFilesDir(), "models/en");
        JSONObject modelJson = new JSONObject(new String(
                Files.readAllBytes(new File(modelDir, "model.json").toPath()), StandardCharsets.UTF_8));
        assertEquals("moonshine", modelJson.getString("type"));
        assertEquals("preprocess.onnx", modelJson.getString("preprocessor"));
        assertEquals("encode.int8.onnx", modelJson.getString("encoder"));

        // 3. The recogniser really loads.
        CommandRecognizer recognizer = new CommandRecognizer(app, new ModelStore(app));
        recognizer.setLanguage("en");
        assertNull("the recogniser did not load (engine_missing = not packed into the app)", recognizer.checkReady());

        // 4. The speech detector, on the same native library.
        OrtEnvironment env = OrtEnvironment.getEnvironment();
        OrtSession vad = env.createSession(readAll(app.getAssets().open("silero_vad.onnx")), new OrtSession.SessionOptions());

        // 5. Hear, then decide.
        WakeWordMatcher matcher = new WakeWordMatcher(Arrays.asList("hey", "hi", "hello"));
        StringBuilder report = new StringBuilder();
        int woke = 0;
        boolean oneBreathCommandKept = false;
        for (String name : WAKE) {
            Heard h = hear(test, env, vad, recognizer, name);
            boolean wake = matcher.match(h.first, "Aaria", null).isMatch;
            if (wake) woke++;
            String rest = matcher.stripWake(h.whole, "Aaria", null);
            if (wake && !rest.isEmpty()) oneBreathCommandKept = true;
            report.append("\n  ").append(name).append(" -> first 1.5 s: \"").append(h.first)
                    .append("\", whole: \"").append(h.whole).append("\", wake: ").append(wake)
                    .append(", command: \"").append(rest).append("\"");
        }
        int falseWakes = 0;
        for (String name : NOT_WAKE) {
            Heard h = hear(test, env, vad, recognizer, name);
            boolean wake = matcher.match(h.first, "Aaria", null).isMatch;
            if (wake) falseWakes++;
            report.append("\n  ").append(name).append(" -> first 1.5 s: \"").append(h.first).append("\", wake: ").append(wake);
        }
        Log.i(TAG, "what the engine heard:" + report);

        // Two of three, not three of three: the recogniser's arithmetic differs slightly between
        // processor types, and one recording sitting on the edge must not turn the check red by chance.
        assertTrue("fewer than 2 of 3 wake recordings woke it:" + report, woke >= 2);
        assertEquals("an ordinary sentence woke it:" + report, 0, falseWakes);
        assertTrue("no command survived after \"Hey Aaria\" in one breath:" + report, oneBreathCommandKept);
    }

    private static final class Heard {
        String first = "";
        String whole = "";
    }

    /** One recording through the speech detector and the recogniser, cut the way the plugin cuts it. */
    private static Heard hear(Context test, OrtEnvironment env, OrtSession vad, CommandRecognizer recognizer,
                              String asset) throws Exception {
        short[] pcm = readWav(test.getAssets().open(asset));
        VadProcessor detector = new VadProcessor(env, vad, 16000, 250, 600);   // the plugin's own settings
        long startMs = -1;
        long endMs = -1;
        for (int at = 0; at + 512 <= pcm.length && endMs < 0; at += 512) {
            List<VadProcessor.Event> events = detector.process(Arrays.copyOfRange(pcm, at, at + 512), at / 16);
            for (VadProcessor.Event ev : events) {
                if (ev.type == VadProcessor.EventType.SPEECH_START && startMs < 0) startMs = ev.t;
                if (ev.type == VadProcessor.EventType.SPEECH_END && startMs >= 0) endMs = ev.t;
            }
        }
        assertTrue("the speech detector heard no speech in " + asset + " (highest likelihood "
                + detector.maxProbability + ")", startMs >= 0);
        assertTrue("the speech detector never heard " + asset + " end", endMs > startMs);

        // The plugin hands over 0.3 s from before the speech began, up to where it ended.
        int from = Math.max(0, (int) (startMs * 16) - 4800);
        int to = Math.min(pcm.length, (int) (endMs * 16));
        short[] segment = Arrays.copyOfRange(pcm, from, to);
        short[] firstPart = segment.length > 24000 ? Arrays.copyOf(segment, 24000) : segment;

        Heard h = new Heard();
        CommandRecognizer.RecognizeResult a = recognizer.recognizeCommand(firstPart, 16000);
        assertNotNull("the recogniser returned nothing for " + asset, a);
        h.first = a.transcript == null ? "" : a.transcript;
        CommandRecognizer.RecognizeResult b = recognizer.recognizeCommand(segment, 16000);
        h.whole = b == null || b.transcript == null ? "" : b.transcript;
        assertFalse("the recogniser wrote nothing at all for " + asset, h.whole.trim().isEmpty());
        return h;
    }

    private static byte[] readAll(InputStream in) throws Exception {
        try (InputStream is = in) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = is.read(buf)) != -1) out.write(buf, 0, n);
            return out.toByteArray();
        }
    }

    /** 16-bit mono PCM samples from a .wav file. */
    private static short[] readWav(InputStream in) throws Exception {
        byte[] all = readAll(in);
        ByteBuffer buf = ByteBuffer.wrap(all).order(ByteOrder.LITTLE_ENDIAN);
        int pos = 12;                                   // after "RIFF", size, "WAVE"
        while (pos + 8 <= all.length) {
            String id = new String(all, pos, 4, StandardCharsets.US_ASCII);
            int size = buf.getInt(pos + 4);
            if ("data".equals(id)) {
                int count = Math.min(size, all.length - pos - 8) / 2;
                short[] pcm = new short[count];
                for (int i = 0; i < count; i++) pcm[i] = buf.getShort(pos + 8 + 2 * i);
                return pcm;
            }
            pos += 8 + size + (size & 1);
        }
        throw new IllegalStateException("no audio data in the .wav file");
    }
}
