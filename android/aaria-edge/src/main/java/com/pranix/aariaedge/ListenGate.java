package com.pranix.aariaedge;

public class ListenGate {
    public static class Result {
        public boolean paused;
        public String reason;

        public Result(boolean paused, String reason) {
            this.paused = paused;
            this.reason = reason;
        }
    }

    private boolean wasLowBattery = false;
    private boolean wasHot = false;

    public Result check(int batteryPct, boolean charging, boolean powerSave, int thermalStatus, boolean wakeOnBattery) {
        if (!charging && !wakeOnBattery) {
            return new Result(true, "unplugged");
        }

        // Battery Saver no longer pauses listening (founder decision, 23 Nov 2026). The founder's phone keeps
        // Battery Saver on all the time, and the pause silently stopped every wake, even while charging (T16).
        // Listening on battery still needs the person's own "listen on battery" choice (above), and the
        // low-battery and heat pauses below still apply. powerSave stays in the signature for callers.

        if (thermalStatus >= android.os.PowerManager.THERMAL_STATUS_SEVERE) {
            wasHot = true;
            return new Result(true, "hot");
        } else if (thermalStatus <= android.os.PowerManager.THERMAL_STATUS_LIGHT) {
            wasHot = false;
        } else if (wasHot) {
            return new Result(true, "hot");
        }

        if (charging) {
            wasLowBattery = false;
        } else {
            if (batteryPct < 15) {
                wasLowBattery = true;
            } else if (batteryPct >= 20) {
                wasLowBattery = false;
            }
            if (wasLowBattery) {
                return new Result(true, "low_battery");
            }
        }

        return new Result(false, null);
    }
}
