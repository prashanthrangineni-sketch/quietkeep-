package com.pranix.aariaedge;

import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * The wake check's tuning dials, by name, for Phase 1 tuning. Defaults are the values the code used before
 * the dials existed, so nothing changes unless a dial is set. Read from assets/wakeword/tuning.json at start;
 * the app may change them while running with setWakeTuning (kept until the app is closed).
 * A dial set to a value outside its allowed range is ignored and keeps its previous value.
 * The final wake gate in AariaEdgePlugin uses min(matchThreshold, shortNameThreshold), 0.8 at defaults.
 */
public final class WakeTuning {

    /** Extra greeting spellings the recogniser writes for "Hey" (measured 3 Oct 2026); added to prefixes.json. */
    public final List<String> looseGreetings;
    /** Score at or above which the name counts as heard. */
    public final float matchThreshold;
    /** Stricter score for short names (shortNameMaxLetters letters or fewer). */
    public final float shortNameThreshold;
    public final int shortNameMaxLetters;
    /** Learned spellings: heard at least this many times while teaching the name... */
    public final int learnMinTimesHeard;
    /** ...at least this similar to the typed name (0 to 1)... */
    public final float learnMinSimilarity;
    /** ...and at most this many kept. */
    public final int learnMaxSpellings;
    /** Speech shorter than this is not treated as speech. */
    public final int minSpeechMs;
    /** Pause that ends a piece of speech. */
    public final int minSilenceMs;
    /** How much of the start of a piece of speech is checked for the wake name. */
    public final int wakeWindowMs;
    /** Speech shorter than this is not checked for the name at all. */
    public final int minWakeSpeechMs;
    /** At most this much of one breath is used as a command. */
    public final int maxCommandMs;
    /** The name said on its own, as the whole phrase ("Aaria." / "Aarya"), wakes too (founder decision, 23 Nov 2026). */
    public final boolean nameAloneWakes;
    /** Diagnosis only: add the heard words to the per-speech log line. Off by default; never in the shipped file. */
    public final boolean diagnosticTranscripts;

    private WakeTuning(List<String> looseGreetings, float matchThreshold, float shortNameThreshold, int shortNameMaxLetters,
                       int learnMinTimesHeard, float learnMinSimilarity, int learnMaxSpellings,
                       int minSpeechMs, int minSilenceMs, int wakeWindowMs, int minWakeSpeechMs, int maxCommandMs,
                       boolean nameAloneWakes, boolean diagnosticTranscripts) {
        this.nameAloneWakes = nameAloneWakes;
        this.diagnosticTranscripts = diagnosticTranscripts;
        this.looseGreetings = Collections.unmodifiableList(new ArrayList<>(looseGreetings));
        this.matchThreshold = matchThreshold;
        this.shortNameThreshold = shortNameThreshold;
        this.shortNameMaxLetters = shortNameMaxLetters;
        this.learnMinTimesHeard = learnMinTimesHeard;
        this.learnMinSimilarity = learnMinSimilarity;
        this.learnMaxSpellings = learnMaxSpellings;
        this.minSpeechMs = minSpeechMs;
        this.minSilenceMs = minSilenceMs;
        this.wakeWindowMs = wakeWindowMs;
        this.minWakeSpeechMs = minWakeSpeechMs;
        this.maxCommandMs = maxCommandMs;
    }

    /** Today's values, exactly as they were written in the code before 2.3. */
    public static final WakeTuning DEFAULTS = new WakeTuning(
        java.util.Arrays.asList("a", "hay", "ay", "he", "eh", "high", "hai", "ari"),
        0.8f, 0.9f, 3,
        2, 0.6f, 5,
        250, 600, 1500, 300, 8000,
        true, false);

    private static volatile WakeTuning current = DEFAULTS;

    public static WakeTuning current() {
        return current;
    }

    static void set(WakeTuning t) {
        current = t == null ? DEFAULTS : t;
    }

    private static boolean assetRead = false;

    /** Reads the shipped file once per app start; later changes made with setWakeTuning are kept. */
    static synchronized void loadAssetOnce(android.content.Context context) {
        if (assetRead) return;
        assetRead = true;
        set(loadAsset(context));
    }

    /** Reads assets/wakeword/tuning.json; on any problem the defaults stay. */
    static WakeTuning loadAsset(android.content.Context context) {
        try (InputStream is = context.getAssets().open("wakeword/tuning.json")) {
            java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
            byte[] buf = new byte[4096];
            int n;
            while ((n = is.read(buf)) > 0) out.write(buf, 0, n);
            return DEFAULTS.with(new JSONObject(new String(out.toByteArray(), StandardCharsets.UTF_8)));
        } catch (Throwable t) {
            return DEFAULTS;
        }
    }

    /** A copy with the dials named in the JSON changed. Unknown names and out-of-range values are ignored. */
    public WakeTuning with(JSONObject o) {
        if (o == null) return this;
        List<String> greetings = looseGreetings;
        JSONArray g = o.optJSONArray("looseGreetings");
        if (g != null) {
            List<String> list = new ArrayList<>();
            for (int i = 0; i < g.length(); i++) {
                String s = WakeWordMatcher.token(g.optString(i, ""));
                if (!s.isEmpty() && !list.contains(s)) list.add(s);
            }
            greetings = list;
        }
        return new WakeTuning(
            greetings,
            f(o, "matchThreshold", matchThreshold, 0.5f, 1.0f),
            f(o, "shortNameThreshold", shortNameThreshold, 0.5f, 1.0f),
            i(o, "shortNameMaxLetters", shortNameMaxLetters, 0, 10),
            i(o, "learnMinTimesHeard", learnMinTimesHeard, 1, 10),
            f(o, "learnMinSimilarity", learnMinSimilarity, 0.0f, 1.0f),
            i(o, "learnMaxSpellings", learnMaxSpellings, 1, 20),
            i(o, "minSpeechMs", minSpeechMs, 50, 2000),
            i(o, "minSilenceMs", minSilenceMs, 100, 3000),
            i(o, "wakeWindowMs", wakeWindowMs, 500, 5000),
            i(o, "minWakeSpeechMs", minWakeSpeechMs, 0, 2000),
            i(o, "maxCommandMs", maxCommandMs, 1000, 15000),
            b(o, "nameAloneWakes", nameAloneWakes),
            b(o, "diagnosticTranscripts", diagnosticTranscripts));
    }

    private static boolean b(JSONObject o, String k, boolean keep) {
        if (!o.has(k)) return keep;
        Object v = o.opt(k);
        return (v instanceof Boolean) ? (Boolean) v : keep;
    }

    public JSONObject toJson() {
        JSONObject o = new JSONObject();
        try {
            o.put("looseGreetings", new JSONArray(looseGreetings));
            o.put("matchThreshold", (double) matchThreshold);
            o.put("shortNameThreshold", (double) shortNameThreshold);
            o.put("shortNameMaxLetters", shortNameMaxLetters);
            o.put("learnMinTimesHeard", learnMinTimesHeard);
            o.put("learnMinSimilarity", (double) learnMinSimilarity);
            o.put("learnMaxSpellings", learnMaxSpellings);
            o.put("minSpeechMs", minSpeechMs);
            o.put("minSilenceMs", minSilenceMs);
            o.put("wakeWindowMs", wakeWindowMs);
            o.put("minWakeSpeechMs", minWakeSpeechMs);
            o.put("maxCommandMs", maxCommandMs);
            o.put("nameAloneWakes", nameAloneWakes);
            o.put("diagnosticTranscripts", diagnosticTranscripts);
        } catch (Exception ignored) {}
        return o;
    }

    private static float f(JSONObject o, String k, float keep, float lo, float hi) {
        if (!o.has(k)) return keep;
        double v = o.optDouble(k, Double.NaN);
        return (Double.isNaN(v) || v < lo || v > hi) ? keep : (float) v;
    }

    private static int i(JSONObject o, String k, int keep, int lo, int hi) {
        if (!o.has(k)) return keep;
        double v = o.optDouble(k, Double.NaN);
        if (Double.isNaN(v) || v != Math.rint(v) || v < lo || v > hi) return keep;
        return (int) v;
    }
}
