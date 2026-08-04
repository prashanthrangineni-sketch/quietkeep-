package com.pranix.quietkeep.services;

import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;
import android.util.Log;
import android.app.Notification;

import org.json.JSONObject;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;

/**
 * PaymentNotificationListener — Track A5 Payment SMS / Banking Notification Auto-Capture
 *
 * Listens for incoming bank & UPI notifications (SBI, HDFC, ICICI, Axis, PhonePe, Paytm, GPay, BHIM)
 * and posts transaction text to /api/finance/sms-expense for auto-logging.
 */
public class PaymentNotificationListener extends NotificationListenerService {
    private static final String TAG = "QK_PAYMENT_NOTIF";

    private static final Set<String> BANK_PACKAGES = new HashSet<>(Arrays.asList(
        "com.phonepe.app",
        "net.one97.paytm",
        "com.google.android.apps.nfc.phone",
        "in.org.npci.upiapp",
        "com.sbi.SBIFreedomPlus",
        "com.snapwork.hdfc",
        "com.csam.icici.bank.imobile",
        "com.axis.mobile"
    ));

    private String lastTextHash = "";
    private long lastTextTime = 0;

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        if (sbn == null) return;
        String pkg = sbn.getPackageName();

        if (pkg != null && (BANK_PACKAGES.contains(pkg) || pkg.contains("bank") || pkg.contains("upi") || pkg.contains("pay"))) {
            Notification notification = sbn.getNotification();
            if (notification == null || notification.extras == null) return;

            CharSequence titleChar = notification.extras.getCharSequence(Notification.EXTRA_TITLE);
            CharSequence textChar = notification.extras.getCharSequence(Notification.EXTRA_TEXT);

            String title = titleChar != null ? titleChar.toString() : "";
            String text = textChar != null ? textChar.toString() : "";
            String combined = (title + " " + text).trim();

            if (combined.isEmpty()) return;

            Log.d(TAG, "Bank/UPI notification detected from " + pkg + ": " + combined);

            // Deduplicate within 1 minute window
            String currentHash = combined.hashCode() + "";
            long now = System.currentTimeMillis();
            if (currentHash.equals(lastTextHash) && (now - lastTextTime < 60000)) {
                Log.d(TAG, "Duplicate notification skipped");
                return;
            }

            lastTextHash = currentHash;
            lastTextTime = now;

            postNotificationToExpenseApi(combined);
        }
    }

    private void postNotificationToExpenseApi(final String text) {
        new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    URL url = new URL("https://quietkeep.com/api/finance/sms-expense");
                    HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                    conn.setRequestMethod("POST");
                    conn.setRequestProperty("Content-Type", "application/json");
                    conn.setDoOutput(true);

                    JSONObject body = new JSONObject();
                    body.put("text", text);
                    body.put("source", "notification");

                    try (OutputStream os = conn.getOutputStream()) {
                        byte[] input = body.toString().getBytes(StandardCharsets.UTF_8);
                        os.write(input, 0, input.length);
                    }

                    int code = conn.getResponseCode();
                    Log.d(TAG, "Posted payment notification to API, response code: " + code);
                } catch (Exception e) {
                    Log.e(TAG, "Error posting payment notification: " + e.getMessage());
                }
            }
        }).start();
    }
}
