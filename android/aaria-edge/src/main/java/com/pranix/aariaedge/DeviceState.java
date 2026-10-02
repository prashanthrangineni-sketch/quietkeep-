package com.pranix.aariaedge;

public class DeviceState {
    public final int batteryPct;
    public final boolean charging;
    public final boolean powerSave;
    public final int thermalStatus;
    public final boolean wakeOnBattery;

    public DeviceState(int batteryPct, boolean charging, boolean powerSave, int thermalStatus, boolean wakeOnBattery) {
        this.batteryPct = batteryPct;
        this.charging = charging;
        this.powerSave = powerSave;
        this.thermalStatus = thermalStatus;
        this.wakeOnBattery = wakeOnBattery;
    }
}
