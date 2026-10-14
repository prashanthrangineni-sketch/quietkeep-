package com.pranix.quietkeep.activities;

import android.Manifest;
import android.app.Activity;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.location.Location;
import android.location.LocationManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.CountDownTimer;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.telephony.SmsManager;
import android.util.Log;
import android.view.Gravity;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * SOS ON ITS OWN PATH. (AARIA_ONE_PLAN item 3)
 *
 * No AI, no internet, no server: this screen takes over the phone (over the
 * lock screen), counts down ten seconds with one big CANCEL, and then sends
 * the emergency SMS itself through the phone's own SMS radio, to the contacts
 * the app saved on the phone earlier (SOSPlugin.syncContacts). The location
 * is whatever the phone last knew - asking for a fresh fix can take longer
 * than the whole countdown, and a stale position beats none.
 *
 * Everything it does is written to a small journal on the phone
 * (SharedPreferences "qk_sos"), with the time each SMS was handed to the
 * radio and the time the network confirmed delivery, so the item-3 numbers
 * ("at least 99% delivered, first SMS under 15 s") are MEASURED from real
 * runs rather than asserted.
 *
 * Trigger sources: the Emergency screen's hold button, the Aaria dock when
 * the whole utterance is an SOS word, and (later) the background listener.
 * Who triggered it is recorded but changes nothing here.
 */
public class SosCountdownActivity extends Activity {

    private static final String TAG = "QK_SOS";
    public static final String PREFS = "qk_sos";
    public static final String KEY_CONTACTS = "contacts";   // JSON [{name, phone}]
    public static final String KEY_JOURNAL  = "journal";    // JSON [event...], newest last, max 100
    public static final String EXTRA_SOURCE = "source";
    public static final int COUNTDOWN_MS = 10_000;
    private static final String ACTION_SENT = "com.pranix.quietkeep.SOS_SMS_SENT";
    private static final String ACTION_DELIVERED = "com.pranix.quietkeep.SOS_SMS_DELIVERED";

    private static volatile boolean active = false;
    public static boolean isActive() { return active; }

    private TextView titleView, timerView, detailView;
    private Button cancelButton;
    private CountDownTimer timer;
    private boolean fired = false;
    private long startedAt;
    private String eventId;
    private BroadcastReceiver smsReceiver;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        active = true;
        startedAt = System.currentTimeMillis();
        eventId = "sos-" + startedAt;

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        } else {
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                    | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
        }
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        buildUi();
        vibrate(new long[]{0, 300, 150, 300});
        journal("triggered", new JSONObject(), null);

        timer = new CountDownTimer(COUNTDOWN_MS, 250) {
            @Override public void onTick(long left) {
                timerView.setText(String.valueOf((left + 999) / 1000));
            }
            @Override public void onFinish() {
                timerView.setText("0");
                fire();
            }
        }.start();
    }

    private void buildUi() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER);
        root.setBackgroundColor(Color.parseColor("#B3140F"));
        int pad = dp(24);
        root.setPadding(pad, pad, pad, pad);

        titleView = new TextView(this);
        titleView.setText("SOS");
        titleView.setTextColor(Color.WHITE);
        titleView.setTextSize(40);
        titleView.setGravity(Gravity.CENTER);
        root.addView(titleView, wrap());

        detailView = new TextView(this);
        detailView.setText("Sending your location to your emergency contacts in");
        detailView.setTextColor(Color.WHITE);
        detailView.setTextSize(18);
        detailView.setGravity(Gravity.CENTER);
        detailView.setPadding(0, dp(12), 0, dp(12));
        root.addView(detailView, wrap());

        timerView = new TextView(this);
        timerView.setText("10");
        timerView.setTextColor(Color.WHITE);
        timerView.setTextSize(96);
        timerView.setGravity(Gravity.CENTER);
        root.addView(timerView, wrap());

        cancelButton = new Button(this);
        cancelButton.setText("CANCEL - I am OK");
        cancelButton.setTextSize(22);
        cancelButton.setAllCaps(false);
        cancelButton.setTextColor(Color.parseColor("#B3140F"));
        cancelButton.setBackgroundColor(Color.WHITE);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(96));
        lp.topMargin = dp(24);
        cancelButton.setLayoutParams(lp);
        cancelButton.setOnClickListener(v -> cancel());
        root.addView(cancelButton);

        setContentView(root);
    }

    private void cancel() {
        if (fired) { finish(); return; }
        if (timer != null) timer.cancel();
        journal("cancelled", new JSONObject(), null);
        active = false;
        finish();
    }

    /** The countdown ended: send. Runs once. */
    private void fire() {
        if (fired) return;
        fired = true;
        cancelButton.setText("Close");
        detailView.setText("Sending...");

        List<JSONObject> contacts = loadContacts(this);
        if (contacts.isEmpty()) {
            detailView.setText("No emergency contacts saved. Add them on the Emergency screen.");
            journal("not_sent", kv("reason", "no_contacts"), null);
            active = false;
            return;
        }
        if (androidx.core.content.ContextCompat.checkSelfPermission(this, Manifest.permission.SEND_SMS) != PackageManager.PERMISSION_GRANTED) {
            // No permission to send on the person's behalf: open the SMS app with
            // the message ready for the first contact. The person presses Send.
            detailView.setText("Opening your SMS app - press Send.");
            journal("not_sent", kv("reason", "no_sms_permission"), null);
            try {
                JSONObject c = contacts.get(0);
                Intent i = new Intent(Intent.ACTION_SENDTO, Uri.parse("smsto:" + c.optString("phone")));
                i.putExtra("sms_body", buildMessage(lastKnown()));
                i.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(i);
            } catch (Exception e) { Log.e(TAG, "composer fallback failed", e); }
            active = false;
            return;
        }

        registerSmsReceiver();
        Location loc = lastKnown();
        String message = buildMessage(loc);
        SmsManager sms = SmsManager.getDefault();
        int n = 0;
        for (JSONObject c : contacts) {
            String phone = c.optString("phone", "").trim();
            if (phone.isEmpty()) continue;
            try {
                ArrayList<String> parts = sms.divideMessage(message);
                ArrayList<PendingIntent> sentPIs = new ArrayList<>();
                ArrayList<PendingIntent> deliveredPIs = new ArrayList<>();
                for (int p = 0; p < parts.size(); p++) {
                    sentPIs.add(pending(ACTION_SENT, phone, p));
                    deliveredPIs.add(pending(ACTION_DELIVERED, phone, p));
                }
                sms.sendMultipartTextMessage(phone, null, parts, sentPIs, deliveredPIs);
                n++;
                journal("handed_to_radio", with(with(kv("phone", tail(phone)), "parts", parts.size()),
                        "ms_after_trigger", System.currentTimeMillis() - startedAt), null);
            } catch (Exception e) {
                Log.e(TAG, "send failed for " + tail(phone), e);
                journal("send_failed", with(kv("phone", tail(phone)), "error", String.valueOf(e.getMessage())), null);
            }
        }
        detailView.setText(n > 0
                ? "SOS sent to " + n + " contact" + (n == 1 ? "" : "s") + (loc != null ? " with your location." : ". Location was not available.")
                : "Could not send the SOS. Call 112.");
        vibrate(new long[]{0, 600});
        // Leave the screen up so the person sees what happened; closing is manual.
    }

    private PendingIntent pending(String action, String phone, int part) {
        Intent i = new Intent(action);
        i.setPackage(getPackageName());
        i.putExtra("phone", phone);
        i.putExtra("part", part);
        i.putExtra("event", eventId);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT
                | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ? PendingIntent.FLAG_MUTABLE : 0);
        int req = (action + phone + part).hashCode();
        return PendingIntent.getBroadcast(this, req, i, flags);
    }

    private void registerSmsReceiver() {
        smsReceiver = new BroadcastReceiver() {
            @Override public void onReceive(Context ctx, Intent intent) {
                String what = ACTION_SENT.equals(intent.getAction()) ? "sent" : "delivered";
                String phone = intent.getStringExtra("phone");
                int code = getResultCode();
                boolean ok = code == Activity.RESULT_OK;
                JSONObject d = kv("phone", tail(phone));
                with(d, "part", intent.getIntExtra("part", 0));
                with(d, "code", code);
                with(d, "ms_after_trigger", System.currentTimeMillis() - startedAt);
                journal(ok ? what : what + "_failed", d, null);
                if (!ok && detailView != null) detailView.setText("The SMS to ..." + tail(phone) + " was not " + what + ". Call 112.");
            }
        };
        IntentFilter f = new IntentFilter();
        f.addAction(ACTION_SENT);
        f.addAction(ACTION_DELIVERED);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(smsReceiver, f, Context.RECEIVER_NOT_EXPORTED);
        } else {
            registerReceiver(smsReceiver, f);
        }
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        if (timer != null) timer.cancel();
        if (smsReceiver != null) { try { unregisterReceiver(smsReceiver); } catch (Exception ignored) { } }
        // Whether cancelled, fired, or closed: once this screen is gone, a new
        // trigger may start a new countdown.
        active = false;
    }

    @Override
    public void onBackPressed() {
        // Back must not silently cancel an SOS; the big button is the way out.
        if (fired) super.onBackPressed();
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    private Location lastKnown() {
        try {
            if (androidx.core.content.ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED
                    && androidx.core.content.ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) != PackageManager.PERMISSION_GRANTED) return null;
            LocationManager lm = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
            if (lm == null) return null;
            Location best = null;
            for (String p : new String[]{LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER, LocationManager.PASSIVE_PROVIDER}) {
                try {
                    Location l = lm.getLastKnownLocation(p);
                    if (l != null && (best == null || l.getTime() > best.getTime())) best = l;
                } catch (Exception ignored) { }
            }
            return best;
        } catch (Exception e) { return null; }
    }

    static String buildMessage(Location loc) {
        StringBuilder sb = new StringBuilder("EMERGENCY - I need help. ");
        if (loc != null) {
            sb.append("My location: https://maps.google.com/?q=")
              .append(String.format(java.util.Locale.US, "%.5f,%.5f", loc.getLatitude(), loc.getLongitude()));
            long ageMin = (System.currentTimeMillis() - loc.getTime()) / 60000;
            if (ageMin > 2) sb.append(" (as of ").append(ageMin).append(" min ago)");
            sb.append(". ");
        } else {
            sb.append("Location not available. ");
        }
        sb.append("Sent by QuietKeep SOS.");
        return sb.toString();
    }

    public static List<JSONObject> loadContacts(Context ctx) {
        List<JSONObject> out = new ArrayList<>();
        try {
            String raw = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_CONTACTS, "[]");
            JSONArray arr = new JSONArray(raw);
            for (int i = 0; i < arr.length(); i++) out.add(arr.getJSONObject(i));
        } catch (Exception e) { Log.e(TAG, "contacts unreadable", e); }
        return out;
    }

    private static JSONObject kv(String k, String v) {
        JSONObject o = new JSONObject();
        try { o.put(k, v); } catch (Exception ignored) { }
        return o;
    }

    /** put() without the checked exception; returns the same object. */
    private static JSONObject with(JSONObject o, String k, Object v) {
        try { o.put(k, v); } catch (Exception ignored) { }
        return o;
    }

    /** Append one event to the on-phone journal (newest last, capped at 100). */
    private void journal(String kind, JSONObject data, String unused) {
        try {
            SharedPreferences sp = getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            JSONArray arr = new JSONArray(sp.getString(KEY_JOURNAL, "[]"));
            JSONObject e = new JSONObject();
            e.put("event", eventId);
            e.put("kind", kind);
            e.put("at", System.currentTimeMillis());
            e.put("source", String.valueOf(getIntent().getStringExtra(EXTRA_SOURCE)));
            e.put("data", data);
            arr.put(e);
            while (arr.length() > 100) arr.remove(0);
            sp.edit().putString(KEY_JOURNAL, arr.toString()).apply();
        } catch (Exception ex) { Log.e(TAG, "journal write failed", ex); }
    }

    private static String tail(String phone) {
        if (phone == null) return "";
        String d = phone.replaceAll("\\D", "");
        return d.length() > 4 ? d.substring(d.length() - 4) : d;
    }

    private void vibrate(long[] pattern) {
        try {
            Vibrator v = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
            if (v == null) return;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) v.vibrate(VibrationEffect.createWaveform(pattern, -1));
            else v.vibrate(pattern, -1);
        } catch (Exception ignored) { }
    }

    private int dp(int v) { return Math.round(v * getResources().getDisplayMetrics().density); }
    private LinearLayout.LayoutParams wrap() {
        return new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
    }
}
