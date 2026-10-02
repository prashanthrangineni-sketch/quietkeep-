package com.pranix.quietkeep.services;

import android.content.Context;
import android.content.Intent;

public class MicGuard {
    /**
     * Mic hand-off: Aaria Edge listen service and QuietKeep's VoiceService
     * must never hold the mic at the same time.
     * Call this before starting capture. 
     * Listening will resume when the web engine calls startHotword again.
     */
    public static void stopAariaListenService(Context context) {
        if (context == null) return;
        try {
            Intent stopIntent = new Intent();
            stopIntent.setClassName(context, "com.pranix.aariaedge.AariaListenService");
            stopIntent.setAction("com.pranix.aariaedge.STOP_LISTENING");
            context.startService(stopIntent);
        } catch (Exception ignored) {}
    }
}
