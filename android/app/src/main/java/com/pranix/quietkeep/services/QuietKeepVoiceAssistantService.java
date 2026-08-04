package com.pranix.quietkeep.services;

import android.content.Intent;
import android.os.Build;
import android.service.voice.VoiceInteractionService;
import android.util.Log;
import androidx.annotation.RequiresApi;

import com.pranix.quietkeep.MainActivity;

/**
 * QuietKeepVoiceAssistantService — Track A3 Hardware Power Button / Assistant Mapping
 *
 * Implements VoiceInteractionService so QuietKeep can be set as default Assistant app.
 */
@RequiresApi(api = Build.VERSION_CODES.LOLLIPOP)
public class QuietKeepVoiceAssistantService extends VoiceInteractionService {
    private static final String TAG = "QK_ASSISTANT_SVC";

    @Override
    public void onReady() {
        super.onReady();
        Log.d(TAG, "QuietKeepVoiceAssistantService ready — registered as assistant component");
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && "ACTION_INVOKE_ASSISTANT".equals(intent.getAction())) {
            Intent mainIntent = new Intent(this, MainActivity.class);
            mainIntent.setAction("ACTION_ASSISTANT_INVOKE");
            mainIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            startActivity(mainIntent);
        }
        return super.onStartCommand(intent, flags, startId);
    }
}
