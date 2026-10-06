package com.pranix.aariaedge;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.BatteryManager;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.content.pm.ApplicationInfo;

import androidx.core.app.NotificationCompat;

import org.json.JSONObject;

import java.io.InputStream;
import java.nio.charset.StandardCharsets;

public class AariaListenService extends Service {

    public static final String ACTION_STOP = "com.pranix.aariaedge.STOP_LISTENING";
    public static final String ACTION_UPDATE_STATE = "com.pranix.aariaedge.UPDATE_STATE";
    
    private static final int NOTIF_ID = 1432;
    private static final String CHANNEL_ID = "aaria_listen_channel";

    private BroadcastReceiver receiver;
    private ListenGate listenGate = new ListenGate();
    
    private int lastBatteryPct = 100;
    private boolean isCharging = false;
    private boolean isPowerSave = false;
    private int thermalStatus = 0;
    private boolean wakeOnBattery = false;
    
    private String lang = "en";
    private boolean isPaused = false;
    private String pauseReason = null;

    private boolean receiverRegistered = false;

    @Override
    public void onCreate() {
        try {
            super.onCreate();
            createNotificationChannel();
            
            receiver = new BroadcastReceiver() {
                @Override
                public void onReceive(Context context, Intent intent) {
                    String action = intent.getAction();
                    if (Intent.ACTION_BATTERY_CHANGED.equals(action)) {
                        int level = intent.getIntExtra(BatteryManager.EXTRA_LEVEL, -1);
                        int scale = intent.getIntExtra(BatteryManager.EXTRA_SCALE, -1);
                        if (level >= 0 && scale > 0) {
                            lastBatteryPct = (int) (level * 100f / scale);
                        }
                        int status = intent.getIntExtra(BatteryManager.EXTRA_STATUS, -1);
                        isCharging = (status == BatteryManager.BATTERY_STATUS_CHARGING ||
                                      status == BatteryManager.BATTERY_STATUS_FULL);
                        checkGate();
                    } else if (PowerManager.ACTION_POWER_SAVE_MODE_CHANGED.equals(action)) {
                        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
                        if (pm != null) {
                            isPowerSave = pm.isPowerSaveMode();
                            checkGate();
                        }
                    }
                }
            };
            IntentFilter filter = new IntentFilter();
            filter.addAction(Intent.ACTION_BATTERY_CHANGED);
            filter.addAction(PowerManager.ACTION_POWER_SAVE_MODE_CHANGED);
            Intent batteryIntent = androidx.core.content.ContextCompat.registerReceiver(this, receiver, filter, androidx.core.content.ContextCompat.RECEIVER_NOT_EXPORTED);
            if (batteryIntent != null && Intent.ACTION_BATTERY_CHANGED.equals(batteryIntent.getAction())) {
                int level = batteryIntent.getIntExtra(BatteryManager.EXTRA_LEVEL, -1);
                int scale = batteryIntent.getIntExtra(BatteryManager.EXTRA_SCALE, -1);
                if (level >= 0 && scale > 0) {
                    lastBatteryPct = (int) (level * 100f / scale);
                }
                int status = batteryIntent.getIntExtra(BatteryManager.EXTRA_STATUS, -1);
                isCharging = (status == BatteryManager.BATTERY_STATUS_CHARGING ||
                              status == BatteryManager.BATTERY_STATUS_FULL);
            }
            receiverRegistered = true;

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
                if (pm != null) {
                    isPowerSave = pm.isPowerSaveMode();
                    thermalStatus = pm.getCurrentThermalStatus();
                    pm.addThermalStatusListener(status -> {
                        thermalStatus = status;
                        checkGate();
                    });
                }
            }
        } catch (Throwable t) {
            stopSelf();
        }
    }

    private void checkGate() {
        if (AariaEdgePlugin.instance == null) return;
        
        DeviceState state = new DeviceState(lastBatteryPct, isCharging, isPowerSave, thermalStatus, wakeOnBattery);
        AariaEdgePlugin.instance.listenController.onDeviceState(state);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        try {
            if (intent != null && ACTION_STOP.equals(intent.getAction())) {
                if (AariaEdgePlugin.instance != null) {
                    AariaEdgePlugin.instance.onBackgroundListeningStopped();
                }
                stopForeground(true);
                stopSelf();
                return START_NOT_STICKY;
            }

            if (intent != null && intent.hasExtra("lang")) {
                lang = intent.getStringExtra("lang");
            }
            if (intent != null && intent.hasExtra("wakeOnBattery")) {
                wakeOnBattery = intent.getBooleanExtra("wakeOnBattery", false);
            }
            
            if (intent != null && ACTION_UPDATE_STATE.equals(intent.getAction())) {
                if (AariaEdgePlugin.instance == null || !AariaEdgePlugin.instance.listenController.isOn()) {
                    // This request to redraw the notice was sent while listening was on, but "Turn off" got
                    // here first. There is nothing to show: put no notice up, and take down any that is up.
                    stopForeground(true);
                    NotificationManager gone = getSystemService(NotificationManager.class);
                    if (gone != null) gone.cancel(NOTIF_ID);
                    // Only if nothing newer is waiting: a start that came in behind this request must still
                    // be allowed to bring the service up (Android insists that it does).
                    stopSelf(startId);
                    return START_NOT_STICKY;
                }
                if (intent.hasExtra("isPaused")) {
                    isPaused = intent.getBooleanExtra("isPaused", false);
                    pauseReason = intent.getStringExtra("pauseReason");
                    updateNotification();
                } else {
                    checkGate();
                }
                return START_STICKY;
            }

            if (AariaEdgePlugin.instance == null || !AariaEdgePlugin.instance.listenController.isOn()) {
                // The plugin is gone, or listening is off (a stop overtook this start): say "open the app",
                // never "listening".
                Notification notification = createNotificationForDeadPlugin();
                startForeground(NOTIF_ID, notification);
            } else {
                // Initial start - controller state was already initialized by startBackgroundListening,
                // we just read it back. Or we can just call checkGate() if we want.
                // Wait, the state is in plugin.listenController.
                // But the plugin doesn't give us the state. 
                // Actually, the plugin's Events.paused/resumed update isPaused/pauseReason and call updateNotification!
                // But we need to ensure the service knows the initial state for the first startForeground.
                // It might not have received a notificationChanged event yet.
                // I will just use the current state from the gate for the first notification, or call checkGate().
                // Show what is true now. The controller only announces changes, so a start (or a start again)
                // that changes nothing would otherwise leave this notice on whatever it showed before.
                String reasonNow = AariaEdgePlugin.instance.listenController.pauseReason();
                isPaused = (reasonNow != null);
                pauseReason = reasonNow;
                Notification notification = createNotification();
                startForeground(NOTIF_ID, notification);
                checkGate();
            }

            return START_STICKY;
        } catch (Throwable t) {
            stopSelf();
            return START_NOT_STICKY;
        }
    }

    public void updateNotification() {
        if (AariaEdgePlugin.instance == null) {
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) manager.notify(NOTIF_ID, createNotificationForDeadPlugin());
            return;
        }
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager != null) {
            manager.notify(NOTIF_ID, createNotification());
        }
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID,
                    "Aaria Background Listening",
                    NotificationManager.IMPORTANCE_LOW
            );
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) {
                manager.createNotificationChannel(channel);
            }
        }
    }

    private String getLocalizedString(String key, String fallback) {
        try {
            InputStream is = getAssets().open("ui/" + lang + ".json");
            byte[] buffer = new byte[is.available()];
            is.read(buffer);
            String json = new String(buffer, StandardCharsets.UTF_8);
            JSONObject strings = new JSONObject(json);
            return strings.optString(key, fallback);
        } catch (Exception e) {}
        return fallback;
    }
    
    private String getAppName() {
        try {
            ApplicationInfo ai = getApplicationInfo();
            return getPackageManager().getApplicationLabel(ai).toString();
        } catch (Exception e) {
            return "QuietKeep";
        }
    }

    private Notification createNotificationForDeadPlugin() {
        String title = getLocalizedString("s4_paused_title", "Listening is paused");
        String textTemplate = getLocalizedString("s4_paused_open_app", "Open {app} to start listening again.");
        String text = textTemplate.replace("{app}", getAppName());
        
        Intent launchIntent = getPackageManager().getLaunchIntentForPackage(getPackageName());
        PendingIntent pi = null;
        if (launchIntent != null) {
            pi = PendingIntent.getActivity(this, 0, launchIntent, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        }
        
        Intent stopIntent = new Intent(this, AariaListenService.class);
        stopIntent.setAction(ACTION_STOP);
        PendingIntent stopPendingIntent = PendingIntent.getService(
                this, 0, stopIntent, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
                
        String turnOff = getLocalizedString("s4_btn_stop", "Turn off");

        return new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle(title)
                .setContentText(text)
                .setContentIntent(pi)
                .setSmallIcon(android.R.drawable.ic_btn_speak_now)
                .addAction(android.R.drawable.ic_menu_close_clear_cancel, turnOff, stopPendingIntent)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .build();
    }

    private Notification createNotification() {
        String turnOff = getLocalizedString("s4_btn_stop", "Turn off");
        
        Intent stopIntent = new Intent(this, AariaListenService.class);
        stopIntent.setAction(ACTION_STOP);
        PendingIntent stopPendingIntent = PendingIntent.getService(
                this, 0, stopIntent, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
                
        NotificationCompat.Builder b = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.ic_btn_speak_now)
                .addAction(android.R.drawable.ic_menu_close_clear_cancel, turnOff, stopPendingIntent)
                .setPriority(NotificationCompat.PRIORITY_LOW);

        if (!isPaused) {
            String title = getLocalizedString("s4_title", "Aaria is listening");
            b.setContentTitle(title);
        } else {
            // Need canAutoResume ? If the reason is in the set, it can auto resume if we are testing it
            boolean canAutoResume = true;
            PausedText.Result p = PausedText.choose(pauseReason, canAutoResume);
            
            String title = getLocalizedString(p.titleKey, "Listening is paused");
            String reasonText = p.reasonKey.isEmpty() ? "" : getLocalizedString(p.reasonKey, pauseReason);
            String lastLineText = getLocalizedString(p.lastLineKey, "");
            lastLineText = lastLineText.replace("{app}", getAppName());
            
            b.setContentTitle(title);
            if (reasonText.isEmpty()) {
                b.setContentText(lastLineText);
            } else {
                b.setContentText(reasonText + " " + lastLineText);
            }
            
            if (p.lastLineKey.equals("s4_paused_open_app")) {
                Intent launchIntent = getPackageManager().getLaunchIntentForPackage(getPackageName());
                if (launchIntent != null) {
                    PendingIntent pi = PendingIntent.getActivity(this, 0, launchIntent, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
                    b.setContentIntent(pi);
                }
            }
        }

        return b.build();
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        if (receiverRegistered && receiver != null) {
            try {
                unregisterReceiver(receiver);
            } catch (Exception ignored) {}
            receiverRegistered = false;
        }
        if (AariaEdgePlugin.instance != null) {
            AariaEdgePlugin.instance.onBackgroundListeningStopped();
        }
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
