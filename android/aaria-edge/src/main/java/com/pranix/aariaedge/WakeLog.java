package com.pranix.aariaedge;

import java.util.Locale;

/**
 * One line in the phone's log each time the wake name is heard and the app is told, so wake timing can be
 * measured from the log. Tag "AariaEdge". The line holds only the time, the match score, which listener heard
 * the name and whether a command followed in the same breath. It never holds audio or any spoken words.
 */
final class WakeLog {
    static final String TAG = "AariaEdge";

    /** Where the line goes. The phone's log by default; tests swap in their own. */
    interface Sink {
        void info(String tag, String line);
    }

    static final Sink PHONE_LOG = (tag, line) -> android.util.Log.i(tag, line);

    static volatile Sink sink = PHONE_LOG;

    private WakeLog() {}

    /** The line itself. heardBy is a listener id such as "keyword_spotter" or "both", never words. */
    static String line(long t, float score, String heardBy, boolean hasCommand) {
        return String.format(
            Locale.ROOT,
            "wake t=%d score=%.3f heardBy=%s hasCommand=%b",
            t,
            score,
            safeId(heardBy),
            hasCommand
        );
    }

    /** Writes the line. Logging must never break a wake, so any failure here is ignored. */
    static void wake(long t, float score, String heardBy, boolean hasCommand) {
        try {
            sink.info(TAG, line(t, score, heardBy, hasCommand));
        } catch (Throwable ignored) {}
    }

    /**
     * One line for every piece of speech the listener finished hearing, whatever happened to it, so a real phone
     * shows where a wake was lost: how long the speech was, how loud (peak, in dB below full scale), what was
     * decided (outcome) and the name score. The spoken words are added only while the diagnostic dial
     * diagnosticTranscripts is on (off by default, never saved). Audio is never written.
     */
    static String segmentLine(long durationMs, int peakDb, String outcome, float score, String transcript) {
        String line = String.format(Locale.ROOT, "segment durMs=%d peakDb=%d outcome=%s score=%.3f",
            durationMs, peakDb, safeId(outcome), score);
        if (transcript != null) {
            String t = transcript.replace('\n', ' ').replace('\r', ' ').replace('"', '\'');
            if (t.length() > 120) t = t.substring(0, 120);
            line += " text=\"" + t + "\"";
        }
        return line;
    }

    /** Writes the segment line. Logging must never break listening, so any failure here is ignored. */
    static void segment(long durationMs, short[] audio, String outcome, float score, String transcript) {
        try {
            String words = WakeTuning.current().diagnosticTranscripts ? transcript : null;
            sink.info(TAG, segmentLine(durationMs, peakDb(audio), outcome, score, words));
        } catch (Throwable ignored) {}
    }

    /** The loudest sample in dB below full scale: 0 is clipping, -99 is silence. */
    static int peakDb(short[] audio) {
        if (audio == null) return -99;
        int peak = 0;
        for (short s : audio) {
            int a = Math.abs((int) s);
            if (a > peak) peak = a;
        }
        if (peak == 0) return -99;
        return (int) Math.round(20.0 * Math.log10(peak / 32768.0));
    }

    /** Listener ids are short internal names; anything else is replaced so nothing unexpected reaches the log. */
    static String safeId(String id) {
        if (id == null || id.isEmpty()) return "unknown";
        if (id.length() > 40 || !id.matches("[A-Za-z0-9_.-]+")) return "other";
        return id;
    }
}
