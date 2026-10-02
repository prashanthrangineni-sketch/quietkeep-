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

        if (powerSave) {
            return new Result(true, "power_saver");
        }

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
