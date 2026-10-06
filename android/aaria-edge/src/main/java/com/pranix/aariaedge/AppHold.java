package com.pranix.aariaedge;

/**
 * The host app's hold on the microphone ("I am listening myself" or "I am about to speak").
 *
 * What this class promises:
 *  - a hold that nobody ends is ended after CEILING_MS, so listening is never lost for good;
 *  - a hold is never left in place when that ceiling could not be set, or when the recorder could not be
 *    paused: the hold is undone and the caller is told;
 *  - when the hold ends, the listener waits for the wake name again (never straight for a command);
 *  - if the microphone is still busy at the moment the hold ends, it is tried again a few times.
 */
public class AppHold {

    /** Runs a task once, later. Returns something that cancels it. Throws if it cannot be set. */
    public interface Timer {
        Runnable schedule(Runnable task, long delayMs) throws Exception;
    }

    public interface Listener {
        /** The next thing heard must be checked for the wake name. */
        void waitForNameAgain();
    }

    /** Where the controller is read from each time (the plugin's tests swap it). */
    public interface Source {
        ListenController controller();
    }

    public static final long CEILING_MS = 180000L;
    static final long BUSY_RETRY_MS = 2000L;
    static final int BUSY_RETRIES = 3;

    private final Source source;
    private final Timer timer;
    private final Listener listener;

    // Goes up on every hold, release and cancel. A timer set in an older turn does nothing when it fires.
    private long turn = 0;
    private Runnable cancelPending = null;

    public AppHold(Source source, Timer timer, Listener listener) {
        this.source = source;
        this.timer = timer;
        this.listener = listener;
    }

    /**
     * Returns true when listening was on and is now held; false when listening is off (nothing to hold).
     * Throws "hold_timer_failed" when the ceiling could not be set, and "hold_failed" when the recorder could
     * not be paused. In both cases the hold is undone first.
     */
    public synchronized boolean hold() throws Exception {
        turn++;
        dropPending();
        ListenController c = source.controller();
        boolean held;
        try {
            held = c.holdForApp(CEILING_MS);
        } catch (RuntimeException e) {
            // The recorder could not be paused. Do not leave a hold behind that nothing would end.
            try { c.releaseFromApp(); } catch (RuntimeException ignored) { /* the caller is told just below */ }
            throw new Exception("hold_failed");
        }
        if (!held) return false;
        listener.waitForNameAgain();
        final long mine = turn;
        try {
            cancelPending = timer.schedule(() -> onCeiling(mine), CEILING_MS);
        } catch (Exception e) {
            c.releaseFromApp();
            throw new Exception("hold_timer_failed");
        }
        return true;
    }

    /** The app is done. Safe to call when nothing is held. */
    public synchronized void release() {
        turn++;
        dropPending();
        end();
    }

    /** Listening was turned on or off: forget any timer. The controller clears its own hold. */
    public synchronized void cancel() {
        turn++;
        dropPending();
    }

    private synchronized void onCeiling(long mine) {
        if (mine != turn) return;
        cancelPending = null;
        // The hold has already ended by the controller's own deadline (this timer was late): nothing to end.
        // In particular the listener is not sent back to "wait for the name" in the middle of a new turn.
        if (!source.controller().isHeldByApp()) {
            // If the microphone was busy when the deadline ended the hold, it still gets its retries.
            retryWhileBusy(BUSY_RETRIES);
            return;
        }
        end();
    }

    private void end() {
        ListenController c = source.controller();
        if (c.isOn()) listener.waitForNameAgain();
        c.releaseFromApp();
        retryWhileBusy(BUSY_RETRIES);
    }

    private void retryWhileBusy(int left) {
        ListenController c = source.controller();
        if (left <= 0 || !c.isOn() || !"mic_busy".equals(c.pauseReason())) return;
        final long mine = turn;
        try {
            cancelPending = timer.schedule(() -> onRetry(mine, left), BUSY_RETRY_MS);
        } catch (Exception e) {
            // No timer: the next battery or charger change tries again, as before this class existed.
            cancelPending = null;
        }
    }

    private synchronized void onRetry(long mine, int left) {
        if (mine != turn) return;
        cancelPending = null;
        source.controller().recheck();
        retryWhileBusy(left - 1);
    }

    private void dropPending() {
        Runnable c = cancelPending;
        cancelPending = null;
        if (c != null) c.run();
    }
}
