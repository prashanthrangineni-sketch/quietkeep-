package com.pranix.aariaedge;

import java.io.File;

/**
 * Used only when the second listener is on. Both detectors are asked about the same piece of speech, and the
 * higher score is the answer, so a piece of speech wakes Aaria at most once, whichever listener heard the name,
 * or both. (After a wake the plugin also ignores everything for 1.5 s, as it always has.)
 *
 * The first detector is the existing wake check and is asked exactly as before. The second one is asked first,
 * and anything that goes wrong in it is kept away from the first.
 */
public class EitherWakeWord implements WakeWordDetector {

    /** The score at which the plugin wakes. */
    static final float WAKES = 0.8f;

    private final WakeWordDetector first;
    private final WakeWordDetector second;
    private volatile String heardBy;

    public EitherWakeWord(WakeWordDetector first, WakeWordDetector second) {
        this.first = first;
        this.second = second;
    }

    @Override
    public void load(File modelDir) {
        first.load(modelDir);
        second.load(modelDir);
    }

    @Override
    public float score(short[] frame16k) {
        float b;
        try {
            b = second.score(frame16k);
        } catch (Throwable t) {
            KeywordSpotterWake.log.problem("Second listener failed while listening", t);
            b = 0.0f;
        }
        float a = first.score(frame16k);
        boolean firstHeard = a >= WAKES;
        boolean secondHeard = b >= WAKES;
        heardBy = firstHeard && secondHeard ? "both" : firstHeard ? first.id() : secondHeard ? second.id() : null;
        return Math.max(a, b);
    }

    /** The id of the existing wake check, so the app is told the same id as before. */
    @Override
    public String id() {
        return first.id();
    }

    /** Who heard the name in the last piece of speech: the first's id, the second's id, "both", or null. */
    public String heardBy() {
        return heardBy;
    }

    public WakeWordDetector first() {
        return first;
    }

    public WakeWordDetector second() {
        return second;
    }
}
