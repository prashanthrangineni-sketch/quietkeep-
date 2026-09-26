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
 *
 * WHY THE LANGUAGE IS READ OFF THE TEXT
 *
 * This service used to call setLanguage(new Locale("en","IN")) unconditionally,
 * with a fallback to US English, and prefixed every utterance with the English
 * word "Reminder". QuietKeep's reminders are frequently in Telugu:
 *
 *     "రేపు 9:00-కి Ashok-కి call చేయమని గుర్తు చెయ్యి."
 *
 * Handed to an English voice, Telugu script produces gibberish or nothing at
 * all. It is the same failure as the greeting that read a phone number out: a
 * default that was never revisited once the product became multilingual.
 *
 * A caller MAY pass a "language" extra. When it does not — and no caller does
 * today — the language is judged from the script of the reminder text, which is
 * reliable here because the text is the user's own words in their own language.
 * That choice is deliberate: it means the fix works with the JavaScript that
 * already exists, rather than only after every caller is updated.
 *
 * NOTE ON DEVICE VOICE DATA: if the phone has no Telugu (or Hindi, Tamil,
 * Kannada, Malayalam) text-to-speech voice installed, setLanguage reports
 * LANG_MISSING_DATA and Android has nothing to speak with. That is logged
 * loudly rather than silently degraded, because a silent reminder is the exact
 * bug this file is being changed to stop.
 */
public class ReminderTTSService extends Service implements TextToSpeech.OnInitListener {
    private static final String TAG = "QK_REMINDER_TTS";

    private TextToSpeech tts;
    private String textToSpeak;
    private Locale spokenLocale = new Locale("en", "IN");
    private String spokenPrefix = "Reminder — ";

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null) {
            textToSpeak = intent.getStringExtra("text_to_speak");
            applyLanguage(intent.getStringExtra("language"), textToSpeak);
        }
        Log.d(TAG, "ReminderTTSService onStartCommand lang=" + spokenLocale + " text=" + textToSpeak);
        if (textToSpeak != null && !textToSpeak.trim().isEmpty()) {
            tts = new TextToSpeech(getApplicationContext(), this);
        } else {
            stopSelf();
        }
        return START_NOT_STICKY;
    }

    /**
     * Decide the voice. An explicit "language" extra wins; otherwise the script
     * of the reminder decides.
     */
    private void applyLanguage(String language, String text) {
        String code = (language != null && language.length() >= 2)
                ? language.substring(0, 2).toLowerCase(Locale.ROOT)
                : scriptOf(text);

        switch (code) {
            case "te":
                spokenLocale = new Locale("te", "IN");
                spokenPrefix = "గుర్తు — ";      // గుర్తు —
                break;
            case "hi":
                spokenLocale = new Locale("hi", "IN");
                spokenPrefix = "याद — ";                        // याद —
                break;
            case "ta":
                spokenLocale = new Locale("ta", "IN");
                spokenPrefix = "நினைவூட்டல் — ";
                break;
            case "kn":
                spokenLocale = new Locale("kn", "IN");
                spokenPrefix = "ಜ್ನಾಪನೆ — ";
                break;
            case "ml":
                spokenLocale = new Locale("ml", "IN");
                spokenPrefix = "ഓർമ്മ — ";
                break;
            default:
                spokenLocale = new Locale("en", "IN");
                spokenPrefix = "Reminder — ";
        }
    }

    /**
     * Which language the reminder is written in, judged by the first Indic
     * character in it. Code-mixed text ("రేపు 9:00-కి Ashok-కి call చేయమని")
     * is the normal case, so the FIRST Indic character decides rather than a
     * majority count — a Telugu sentence with English words in it is a Telugu
     * sentence.
     */
    private static String scriptOf(String text) {
        if (text == null) return "en";
        for (int i = 0; i < text.length(); i++) {
            char c = text.charAt(i);
            if (c >= 0x0C00 && c <= 0x0C7F) return "te";   // Telugu
            if (c >= 0x0900 && c <= 0x097F) return "hi";   // Devanagari
            if (c >= 0x0B80 && c <= 0x0BFF) return "ta";   // Tamil
            if (c >= 0x0C80 && c <= 0x0CFF) return "kn";   // Kannada
            if (c >= 0x0D00 && c <= 0x0D7F) return "ml";   // Malayalam
        }
        return "en";
    }

    @Override
    public void onInit(int status) {
        if (status == TextToSpeech.SUCCESS && tts != null) {
            int result = tts.setLanguage(spokenLocale);
            if (result == TextToSpeech.LANG_MISSING_DATA || result == TextToSpeech.LANG_NOT_SUPPORTED) {
                // Said out loud in the log, because the consequence is a reminder
                // the user never hears. The device needs that voice installed
                // under Settings > Text-to-speech.
                Log.e(TAG, "NO VOICE DATA for " + spokenLocale
                        + " — this reminder cannot be spoken correctly on this device");
                int fallback = tts.setLanguage(new Locale("en", "IN"));
                if (fallback == TextToSpeech.LANG_MISSING_DATA || fallback == TextToSpeech.LANG_NOT_SUPPORTED) {
                    tts.setLanguage(Locale.US);
                }
            }
            tts.setSpeechRate(0.95f);
            String phrase = spokenPrefix + textToSpeak;
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
