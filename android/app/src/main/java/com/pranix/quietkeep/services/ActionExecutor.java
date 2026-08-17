package com.pranix.quietkeep.services;

import android.app.SearchManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.hardware.camera2.CameraManager;
import android.media.AudioManager;
import android.net.Uri;
import android.provider.AlarmClock;
import android.provider.MediaStore;
import android.util.Log;
import java.util.List;

public class ActionExecutor {
    private static final String TAG = "QK_ACTION_EXEC";

    public static class ActionSpec {
        public String type;
        public String phone;
        public String whatsappPhone;
        public String whatsappMessage;
        public String navigationQuery;
        public String lat;
        public String lng;
        public String searchQuery;       // For play music
        public String appName;           // For open app
        public String alarmMessage;      // For set alarm/timer
        public Integer alarmHour;
        public Integer alarmMinutes;
        public Integer timerLengthSeconds;
        public String smsMessage;
        public Boolean torchEnable;
        public Integer volumeDirection;  // 1 = raise, -1 = lower
    }

    public static void execute(Context context, ActionSpec spec) {
        if (spec == null || spec.type == null) {
            Log.w(TAG, "execute: ActionSpec or ActionType is null, skipping");
            return;
        }
        Log.d(TAG, "Executing action type: " + spec.type);
        try {
            switch (spec.type) {
                case "contact":
                case "call":
                    if (spec.phone != null && !spec.phone.isEmpty()) {
                        Intent intent = new Intent(Intent.ACTION_CALL, Uri.parse("tel:" + spec.phone));
                        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        context.startActivity(intent);
                    }
                    break;
                case "whatsapp":
                    if (spec.whatsappPhone != null) {
                        String waUrl = "https://wa.me/" + spec.whatsappPhone.replaceAll("[^0-9]", "");
                        if (spec.whatsappMessage != null && !spec.whatsappMessage.isEmpty()) {
                            waUrl += "?text=" + Uri.encode(spec.whatsappMessage);
                        }
                        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(waUrl));
                        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        context.startActivity(intent);
                    }
                    break;
                case "navigation":
                case "navigate":
                    String mapsUri = null;
                    if (spec.lat != null && spec.lng != null) {
                        mapsUri = "geo:" + spec.lat + "," + spec.lng
                            + (spec.navigationQuery != null ? "?q=" + Uri.encode(spec.navigationQuery) : "");
                    } else if (spec.navigationQuery != null) {
                        mapsUri = "geo:0,0?q=" + Uri.encode(spec.navigationQuery);
                    }
                    if (mapsUri != null) {
                        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(mapsUri));
                        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        context.startActivity(intent);
                    }
                    break;
                case "media":
                    // Play music
                    Intent mediaIntent = new Intent(MediaStore.INTENT_ACTION_MEDIA_PLAY_FROM_SEARCH);
                    mediaIntent.putExtra(MediaStore.EXTRA_MEDIA_FOCUS, MediaStore.Audio.Playlists.ENTRY_CONTENT_TYPE);
                    mediaIntent.putExtra(SearchManager.QUERY, spec.searchQuery != null ? spec.searchQuery : "");
                    mediaIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    context.startActivity(mediaIntent);
                    break;
                case "open_app":
                    if (spec.appName != null) {
                        String pkg = findPackageFuzzily(context, spec.appName);
                        if (pkg != null) {
                            Intent intent = context.getPackageManager().getLaunchIntentForPackage(pkg);
                            if (intent != null) {
                                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                                context.startActivity(intent);
                            }
                        } else {
                            Log.w(TAG, "Could not find package matching app name: " + spec.appName);
                        }
                    }
                    break;
                case "alarm":
                    Intent alarmIntent = new Intent(AlarmClock.ACTION_SET_ALARM);
                    alarmIntent.putExtra(AlarmClock.EXTRA_HOUR, spec.alarmHour != null ? spec.alarmHour : 8);
                    alarmIntent.putExtra(AlarmClock.EXTRA_MINUTES, spec.alarmMinutes != null ? spec.alarmMinutes : 0);
                    alarmIntent.putExtra(AlarmClock.EXTRA_MESSAGE, spec.alarmMessage != null ? spec.alarmMessage : "QuietKeep Alarm");
                    alarmIntent.putExtra(AlarmClock.EXTRA_SKIP_UI, true);
                    alarmIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    context.startActivity(alarmIntent);
                    break;
                case "timer":
                    Intent timerIntent = new Intent(AlarmClock.ACTION_SET_TIMER);
                    timerIntent.putExtra(AlarmClock.EXTRA_LENGTH, spec.timerLengthSeconds != null ? spec.timerLengthSeconds : 60);
                    timerIntent.putExtra(AlarmClock.EXTRA_MESSAGE, spec.alarmMessage != null ? spec.alarmMessage : "QuietKeep Timer");
                    timerIntent.putExtra(AlarmClock.EXTRA_SKIP_UI, true);
                    timerIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    context.startActivity(timerIntent);
                    break;
                case "sms":
                    if (spec.phone != null) {
                        Intent smsIntent = new Intent(Intent.ACTION_SENDTO);
                        smsIntent.setData(Uri.parse("smsto:" + spec.phone));
                        smsIntent.putExtra("sms_body", spec.smsMessage != null ? spec.smsMessage : "");
                        smsIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        context.startActivity(smsIntent);
                    }
                    break;
                case "torch":
                    if (spec.torchEnable != null) {
                        CameraManager cm = (CameraManager) context.getSystemService(Context.CAMERA_SERVICE);
                        if (cm != null && cm.getCameraIdList().length > 0) {
                            String cameraId = cm.getCameraIdList()[0];
                            cm.setTorchMode(cameraId, spec.torchEnable);
                        }
                    }
                    break;
                case "volume":
                    if (spec.volumeDirection != null) {
                        AudioManager am = (AudioManager) context.getSystemService(Context.AUDIO_SERVICE);
                        if (am != null) {
                            int direction = spec.volumeDirection > 0 ? AudioManager.ADJUST_RAISE : AudioManager.ADJUST_LOWER;
                            am.adjustStreamVolume(AudioManager.STREAM_MUSIC, direction, AudioManager.FLAG_SHOW_UI);
                        }
                    }
                    break;
                default:
                    Log.w(TAG, "Unsupported action type: " + spec.type);
                    break;
            }
        } catch (Exception e) {
            Log.e(TAG, "Error executing action " + spec.type + ": " + e.getMessage());
        }
    }

    private static String findPackageFuzzily(Context context, String appName) {
        PackageManager pm = context.getPackageManager();
        List<ApplicationInfo> apps = pm.getInstalledApplications(PackageManager.GET_META_DATA);
        String bestPackage = null;
        double bestScore = 0.0;
        String query = appName.toLowerCase().trim();
        for (ApplicationInfo app : apps) {
            CharSequence labelSeq = pm.getApplicationLabel(app);
            if (labelSeq == null) continue;
            String label = labelSeq.toString().toLowerCase().trim();
            if (label.equals(query)) {
                return app.packageName; // Perfect match
            }
            if (label.contains(query) || query.contains(label)) {
                double score = (double) Math.min(label.length(), query.length()) / Math.max(label.length(), query.length());
                if (score > bestScore) {
                    bestScore = score;
                    bestPackage = app.packageName;
                }
            }
        }
        return bestPackage;
    }
}
