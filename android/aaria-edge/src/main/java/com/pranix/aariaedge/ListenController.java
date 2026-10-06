package com.pranix.aariaedge;

public class ListenController {

    public interface Recorder {
        void start() throws Exception;
        void stop();
        boolean isRunning();
    }

    public interface Events {
        void paused(String reason);
        void resumed();
        void notificationChanged();
    }

    /** The time of day in milliseconds. It keeps counting while the phone sleeps, which a timer does not. */
    public interface Clock {
        long now();
    }

    public static class TurnOnResult {
        public final boolean paused;
        public final String reason;
        public TurnOnResult(boolean paused, String reason) {
            this.paused = paused;
            this.reason = reason;
        }
    }

    private final Recorder recorder;
    private final Events events;
    private final Clock clock;
    private final ListenGate gate = new ListenGate();

    private boolean isOn = false;
    private boolean isPaused = false;
    private String pauseReason = null;
    // True while the host app says it needs the microphone (its own listening, or it is about to speak).
    // It is one switch, not a count: the app says "I need it" several times in one conversation and
    // "it is free" once, when everything is quiet.
    private boolean heldByApp = false;
    // The hold ends by itself at this time, even if nobody says "it is free". Long.MAX_VALUE: no end set.
    private long holdUntil = Long.MAX_VALUE;
    private DeviceState lastState = null;

    /** The phone's own reasons come first. Only when the phone would listen does the app's hold count. */
    private ListenGate.Result check(DeviceState s) {
        if (heldByApp && clock.now() >= holdUntil) heldByApp = false;
        ListenGate.Result r = gate.check(s.batteryPct, s.charging, s.powerSave, s.thermalStatus, s.wakeOnBattery);
        if (!r.paused && heldByApp) return new ListenGate.Result(true, "in_use");
        return r;
    }

    public ListenController(Recorder recorder, Events events) {
        this(recorder, events, System::currentTimeMillis);
    }

    public ListenController(Recorder recorder, Events events, Clock clock) {
        this.recorder = recorder;
        this.events = events;
        this.clock = clock;
    }

    public synchronized TurnOnResult turnOn(DeviceState s) {
        boolean wasOn = isOn;
        boolean wasPaused = isPaused;
        String oldReason = pauseReason;

        isOn = true;
        heldByApp = false;
        holdUntil = Long.MAX_VALUE;
        lastState = s;
        ListenGate.Result gateResult = check(s);
        isPaused = gateResult.paused;
        pauseReason = gateResult.reason;

        if (!isPaused) {
            if (!recorder.isRunning()) {
                try {
                    recorder.start();
                } catch (Exception e) {
                    isPaused = true;
                    pauseReason = "mic_busy";
                }
            }
        } else if (recorder.isRunning()) {
            // Turned on again while running, and the phone now says "pause": do not go on recording.
            recorder.stop();
        }
        // Turned on again while already on (for example during an app's hold): if what is true has changed,
        // say so, or the notice would go on showing the old state.
        if (wasOn && (wasPaused != isPaused || !java.util.Objects.equals(oldReason, pauseReason))) {
            if (isPaused) events.paused(pauseReason); else events.resumed();
            events.notificationChanged();
        }
        return new TurnOnResult(isPaused, pauseReason);
    }

    public synchronized void onDeviceState(DeviceState s) {
        if (!isOn) return;
        lastState = s;

        ListenGate.Result gateResult = check(s);

        if (gateResult.paused) {
            boolean wasRunning = recorder.isRunning();
            if (wasRunning) recorder.stop();
            // Announce a pause whenever it is news: the recorder was running, or nothing said "paused" yet
            // (the recorder was stopped from somewhere else), or the reason is a different one now.
            if (wasRunning || !isPaused || !java.util.Objects.equals(pauseReason, gateResult.reason)) {
                isPaused = true;
                pauseReason = gateResult.reason;
                events.paused(pauseReason);
                events.notificationChanged();
            }
        } else {
            if (!recorder.isRunning()) {
                try {
                    recorder.start();
                    isPaused = false;
                    pauseReason = null;
                    events.resumed();
                    events.notificationChanged();
                } catch (Exception e) {
                    if (!isPaused || !"mic_busy".equals(pauseReason)) {
                        isPaused = true;
                        pauseReason = "mic_busy";
                        events.paused(pauseReason);
                        events.notificationChanged();
                    }
                }
            } else if (isPaused) {
                // Should run, is running, but state is paused? Clear state.
                isPaused = false;
                pauseReason = null;
                events.resumed();
                events.notificationChanged();
            }
        }
    }

    /**
     * The host app needs the microphone. Listening pauses with the reason "in_use"; the listening service and
     * its notice stay. The hold ends by itself after ceilingMs. Calling it again while held moves that end
     * forward. Returns false, and does nothing, when listening is off.
     */
    public synchronized boolean holdForApp(long ceilingMs) {
        if (!isOn) return false;
        long now = clock.now();
        holdUntil = (ceilingMs >= Long.MAX_VALUE - now) ? Long.MAX_VALUE : now + ceilingMs;
        heldByApp = true;
        if (lastState != null) onDeviceState(lastState);
        return true;
    }

    /** As above, with no end set. */
    public synchronized boolean holdForApp() {
        return holdForApp(Long.MAX_VALUE);
    }

    /** The host app is done with the microphone. Listening comes back by itself if the phone allows it. */
    public synchronized void releaseFromApp() {
        heldByApp = false;
        holdUntil = Long.MAX_VALUE;
        // Always look again, held or not: if the recorder was stopped from somewhere else meanwhile, this
        // is where listening (and the notice) is put right.
        if (isOn && lastState != null) onDeviceState(lastState);
    }

    /** Looks again with the last known state of the phone: ends a hold whose time is up, retries a busy microphone. */
    public synchronized void recheck() {
        if (isOn && lastState != null) onDeviceState(lastState);
    }

    public synchronized boolean isHeldByApp() {
        return heldByApp;
    }

    public synchronized boolean isOn() {
        return isOn;
    }

    /** Null when listening is not paused. */
    public synchronized String pauseReason() {
        return isPaused ? pauseReason : null;
    }

    public synchronized void turnOff() {
        heldByApp = false;
        holdUntil = Long.MAX_VALUE;
        if (isOn) {
            // Off first, then the recorder: if stopping it fails, listening is still off for good.
            isOn = false;
            isPaused = false;
            pauseReason = null;
            recorder.stop();
        }
    }
}
