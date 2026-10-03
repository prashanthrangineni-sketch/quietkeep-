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
    private final ListenGate gate = new ListenGate();
    
    private boolean isOn = false;
    private boolean isPaused = false;
    private String pauseReason = null;

    public ListenController(Recorder recorder, Events events) {
        this.recorder = recorder;
        this.events = events;
    }

    public TurnOnResult turnOn(DeviceState s) {
        isOn = true;
        ListenGate.Result gateResult = gate.check(s.batteryPct, s.charging, s.powerSave, s.thermalStatus, s.wakeOnBattery);
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
        }
        return new TurnOnResult(isPaused, pauseReason);
    }

    public void onDeviceState(DeviceState s) {
        if (!isOn) return;
        
        ListenGate.Result gateResult = gate.check(s.batteryPct, s.charging, s.powerSave, s.thermalStatus, s.wakeOnBattery);
        
        if (gateResult.paused) {
            if (recorder.isRunning()) {
                recorder.stop();
                isPaused = true;
                pauseReason = gateResult.reason;
                events.paused(pauseReason);
                events.notificationChanged();
            } else if (isPaused && !java.util.Objects.equals(pauseReason, gateResult.reason)) {
                // If it was already paused but the reason changed, maybe notify?
                pauseReason = gateResult.reason;
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

    public void turnOff() {
        if (isOn) {
            recorder.stop();
            isOn = false;
            isPaused = false;
            pauseReason = null;
        }
    }
}
