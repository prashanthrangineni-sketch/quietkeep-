package com.pranix.quietkeep.services;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.telecom.Call;
import android.telecom.CallScreeningService;
import android.util.Log;
import androidx.annotation.RequiresApi;

/**
 * QuietKeepCallScreeningService — Track A1 Flagship Caller Context Moat.
 *
 * Implements Android CallScreeningService to surface caller context (khata, notes, overdue balance)
 * on incoming calls without using floating overlays or reading SMS store.
 */
@RequiresApi(api = Build.VERSION_CODES.N)
public class QuietKeepCallScreeningService extends CallScreeningService {
    private static final String TAG = "QK_CALL_SCREEN";

    @Override
    public void onScreenCall(Call.Details callDetails) {
        if (callDetails == null) return;

        // Only screen incoming calls
        if (callDetails.getCallDirection() == Call.Details.DIRECTION_INCOMING) {
            Uri handle = callDetails.getHandle();
            if (handle != null) {
                String phoneNumber = handle.getSchemeSpecificPart();
                Log.d(TAG, "Incoming call detected from: " + phoneNumber);

                if (phoneNumber != null && !phoneNumber.trim().isEmpty()) {
                    launchCallerContextScreen(phoneNumber.trim());
                }
            }
        }

        // Always allow call to proceed normally
        CallResponse.Builder response = new CallResponse.Builder();
        response.setDisallowCall(false);
        response.setRejectCall(false);
        response.setSilenceCall(false);
        response.setSkipCallLog(false);
        response.setSkipNotification(false);

        respondToCall(callDetails, response.build());
    }

    private void launchCallerContextScreen(String phone) {
        try {
            Uri contextUri = Uri.parse("com.pranix.quietkeep://caller-context?phone=" + Uri.encode(phone));
            Intent intent = new Intent(Intent.ACTION_VIEW, contextUri);
            intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            startActivity(intent);
            Log.d(TAG, "Dispatched caller context screen for phone: " + phone);
        } catch (Exception e) {
            Log.e(TAG, "Failed to launch caller context screen: " + e.getMessage(), e);
        }
    }
}
