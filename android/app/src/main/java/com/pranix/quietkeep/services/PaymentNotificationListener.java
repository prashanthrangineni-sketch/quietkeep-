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
import java.util.Collections;
import java.util.HashSet;
import java.util.Set;

/**
 * PaymentNotificationListener — Track A5 Payment / Banking Notification Auto-Capture
 *
 * Strictly listens for incoming bank & UPI notifications from verified financial apps
 * and posts transaction text to /api/finance/sms-expense for auto-logging.
 *
 * Whitelist covers top Indian UPI apps and scheduled commercial banks.
 */
public class PaymentNotificationListener extends NotificationListenerService {
    private static final String TAG = "QK_PAYMENT_NOTIF";

    public static final Set<String> ALLOWED_BANK_PACKAGES = Collections.unmodifiableSet(new HashSet<>(Arrays.asList(
        // UPI & Wallet Apps
        "com.phonepe.app",                    // PhonePe
        "net.one97.paytm",                    // Paytm
        "com.google.android.apps.nfc.phone",   // Google Pay (GPay)
        "in.org.npci.upiapp",                 // BHIM NPCI
        "com.dreamplug.androidapp",           // CRED
        "in.amazon.mShop.android.shopping",   // Amazon Pay
        "com.mobikwik_new",                   // MobiKwik
        "com.freecharge.android",             // Freecharge
        "com.tatadigital.tcp",                // Tata Neu / Tata Pay
        "com.naviapp",                        // Navi UPI
        "money.jupiter",                      // Jupiter Money
        "money.fi",                           // Fi Money

        // Major Public & Private Sector Indian Banks
        "com.sbi.SBIFreedomPlus",             // SBI Yono Lite
        "com.sbi.lotusintouch",               // SBI Yono
        "com.snapwork.hdfc",                  // HDFC MobileBanking
        "com.enstage.wibmo.hdfc",             // HDFC PayZapp
        "com.csam.icici.bank.imobile",        // ICICI iMobile Pay
        "com.icicibank.pockets",              // ICICI Pockets
        "com.axis.mobile",                    // Axis Mobile
        "com.msf.kbank.mobile",               // Kotak 811
        "com.bankofbaroda.mconnect",          // bob World (Bank of Baroda)
        "com.pnb.one",                        // PNB ONE (Punjab National Bank)
        "com.canarabank.mobility",            // Canara ai1
        "com.infrasofttech.uboi",             // Union Bank Vyom
        "com.idfcfirstbank.optimus",          // IDFC FIRST Bank
        "com.rblbank.mobank",                 // RBL MoBank
        "com.fss.indus",                      // IndusInd Bank INDIE
        "com.sc.mobile.in",                   // Standard Chartered India
        "com.citibank.mobile.in"              // Citi Mobile India
    )));

    private String lastTextHash = "";
    private long lastTextTime = 0;

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        if (sbn == null) return;
        String pkg = sbn.getPackageName();

        // STRICT PACKAGE FILTER: Must match approved banking/UPI whitelist only.
        // No broad substring matching.
        if (pkg != null && ALLOWED_BANK_PACKAGES.contains(pkg)) {
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