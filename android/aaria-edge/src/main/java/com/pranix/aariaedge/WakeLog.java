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

    /** Listener ids are short internal names; anything else is replaced so nothing unexpected reaches the log. */
    static String safeId(String id) {
        if (id == null || id.isEmpty()) return "unknown";
        if (id.length() > 40 || !id.matches("[A-Za-z0-9_.-]+")) return "other";
        return id;
    }
}
