package com.pranix.quietkeep.services;

import android.app.Service;
import android.content.Intent;
import android.os.IBinder;
import android.speech.tts.TextToSpeech;
import android.util.Log;
import java.util.Locale;

/**
 * ReminderTTSService — Speaks fired reminders out loud using native Android TTS.
 * Fires when AlarmReceiver receives a scheduled reminder alarm.
 */
public class ReminderTTSService extends Service implements TextToSpeech.OnInitListener {
    private static final String TAG = "QK_REMINDER_TTS";
    private TextToSpeech tts;
    private String textToSpeak;

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null) {
            textToSpeak = intent.getStringExtra("text_to_speak");
        }
        Log.d(TAG, "ReminderTTSService onStartCommand text=" + textToSpeak);
        if (textToSpeak != null && !textToSpeak.trim().isEmpty()) {
            tts = new TextToSpeech(getApplicationContext(), this);
        } else {
            stopSelf();
        }
        return START_NOT_STICKY;
    }

    @Override
    public void onInit(int status) {
        if (status == TextToSpeech.SUCCESS && tts != null) {
            int result = tts.setLanguage(new Locale("en", "IN"));
            if (result == TextToSpeech.LANG_MISSING_DATA || result == TextToSpeech.LANG_NOT_SUPPORTED) {
                tts.setLanguage(Locale.US);
            }
            tts.setSpeechRate(0.95f);
            String phrase = "Reminder — " + textToSpeak;
            Log.d(TAG, "Speaking reminder out loud: " + phrase);
            tts.speak(phrase, TextToSpeech.QUEUE_FLUSH, null, "reminder_tts_id");

            new android.os.Handler(android.os.Looper.getMainLooper()).postDelayed(() -> {
                if (tts != null) {
                    try {
                        tts.stop();
                        tts.shutdown();
                    } catch (Exception ignored) {}
                }
                stopSelf();
            }, 9000L);
        } else {
            Log.w(TAG, "TTS initialization failed status=" + status);
            stopSelf();
        }
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onDestroy() {
        if (tts != null) {
            try {
                tts.stop();
                tts.shutdown();
            } catch (Exception ignored) {}
        }
        super.onDestroy();
    }
}
