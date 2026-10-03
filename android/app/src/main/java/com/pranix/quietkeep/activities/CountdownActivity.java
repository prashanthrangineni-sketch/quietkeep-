package com.pranix.quietkeep.activities;

import android.app.Activity;
import android.content.Context;
import android.graphics.Insets;
import android.os.Build;
import android.os.Bundle;
import android.os.CountDownTimer;
import android.util.Log;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.window.OnBackInvokedCallback;
import android.window.OnBackInvokedDispatcher;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import com.pranix.quietkeep.receivers.AlarmReceiver;
import com.pranix.quietkeep.services.ActionExecutor;
import com.pranix.quietkeep.services.AlarmTrail;
import com.pranix.quietkeep.services.ActionExecutor.ActionSpec;

public class CountdownActivity extends Activity {

    private TextView titleView;
    private TextView timerView;
    private Button cancelButton;
    private CountDownTimer countDownTimer;
    private ActionSpec actionSpec;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Show over lock screen
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        } else {
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                    | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
                    | WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD);
        }

        // The screen must stay lit for the ten seconds, or a phone with a short
        // screen timeout goes dark half-way and the person never sees what is
        // about to be dialled.
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        // The banner that brought us here has done its job.
        int notificationId = getIntent().getIntExtra("notification_id", -1);
        if (notificationId >= 0) {
            try {
                android.app.NotificationManager nm =
                        (android.app.NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
                if (nm != null) nm.cancel(notificationId);
            } catch (Exception ignored) { }
        }

        // TOO LATE IS NOT "NOW". If this screen is opened long after the alarm
        // fired - an old banner tapped, a screen restored from recents - it
        // must not start dialling. Close without doing anything.
        long firedAtMs = getIntent().getLongExtra("fired_at_ms", 0L);
        if (firedAtMs > 0 && System.currentTimeMillis() - firedAtMs > AlarmReceiver.ACTION_WINDOW_MS + 60 * 1000L) {
            Log.w("QK_COUNTDOWN", "Opened too long after the alarm - not acting.");
            AlarmTrail.note(this, "countdown_result", "too_late");
            finish();
            return;
        }
        AlarmTrail.note(this, "countdown_shown_at", String.valueOf(System.currentTimeMillis()));

        // Register predictive back gesture callback for API 33+ (Android 13+)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                OnBackInvokedDispatcher.PRIORITY_DEFAULT,
                new OnBackInvokedCallback() {
                    @Override
                    public void onBackInvoked() {
                        cancelAction();
                    }
                }
            );
        }

        // Parse ActionSpec from intent
        actionSpec = new ActionSpec();
        actionSpec.type = getIntent().getStringExtra("action_type");
        actionSpec.phone = getIntent().getStringExtra("phone");
        actionSpec.whatsappPhone = getIntent().getStringExtra("whatsapp_phone");
        actionSpec.whatsappMessage = getIntent().getStringExtra("whatsapp_message");
        actionSpec.navigationQuery = getIntent().getStringExtra("navigation_query");
        actionSpec.lat = getIntent().getStringExtra("lat");
        actionSpec.lng = getIntent().getStringExtra("lng");
        actionSpec.searchQuery = getIntent().getStringExtra("search_query");
        actionSpec.appName = getIntent().getStringExtra("app_name");
        actionSpec.alarmMessage = getIntent().getStringExtra("alarm_message");
        if (getIntent().hasExtra("alarm_hour")) {
            actionSpec.alarmHour = getIntent().getIntExtra("alarm_hour", 8);
        }
        if (getIntent().hasExtra("alarm_minutes")) {
            actionSpec.alarmMinutes = getIntent().getIntExtra("alarm_minutes", 0);
        }
        if (getIntent().hasExtra("timer_length_seconds")) {
            actionSpec.timerLengthSeconds = getIntent().getIntExtra("timer_length_seconds", 60);
        }
        actionSpec.smsMessage = getIntent().getStringExtra("sms_message");
        if (getIntent().hasExtra("torch_enable")) {
            actionSpec.torchEnable = getIntent().getBooleanExtra("torch_enable", false);
        }
        if (getIntent().hasExtra("volume_direction")) {
            actionSpec.volumeDirection = getIntent().getIntExtra("volume_direction", 0);
        }

        String displayName = getIntent().getStringExtra("display_name");
        if (displayName == null || displayName.isEmpty()) {
            displayName = "Action";
        }

        // Programmatic layout
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER);
        root.setBackgroundColor(0xFF121212); // sleek dark background
        root.setLayoutParams(new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
        ));

        // Handle edge-to-edge system bar insets (API 20+)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT_WATCH) {
            root.setOnApplyWindowInsetsListener(new View.OnApplyWindowInsetsListener() {
                @Override
                public WindowInsets onApplyWindowInsets(View v, WindowInsets insets) {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                        Insets systemBars = insets.getInsets(WindowInsets.Type.systemBars());
                        v.setPadding(systemBars.left, systemBars.top, systemBars.right, systemBars.bottom);
                    } else {
                        v.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                                     insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
                    }
                    return insets;
                }
            });
        }

        titleView = new TextView(this);
        titleView.setText("Calling " + displayName);
        if ("navigate".equals(actionSpec.type) || "navigation".equals(actionSpec.type)) {
            titleView.setText("Navigating to " + displayName);
        } else if ("whatsapp".equals(actionSpec.type)) {
            titleView.setText("WhatsApping " + displayName);
        } else if ("media".equals(actionSpec.type)) {
            titleView.setText("Playing Music");
        } else if ("open_app".equals(actionSpec.type)) {
            titleView.setText("Opening " + displayName);
        } else if ("sms".equals(actionSpec.type)) {
            titleView.setText("Sending SMS to " + displayName);
        }

        titleView.setTextSize(24);
        titleView.setTextColor(0xFFFFFFFF);
        titleView.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams titleParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
        );
        titleParams.setMargins(0, 0, 0, 50);
        root.addView(titleView, titleParams);

        timerView = new TextView(this);
        timerView.setText("10");
        timerView.setTextSize(80);
        timerView.setTextColor(0xFFFFC107); // Amber yellow color
        timerView.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams timerParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
        );
        timerParams.setMargins(0, 0, 0, 80);
        root.addView(timerView, timerParams);

        cancelButton = new Button(this);
        cancelButton.setText("CANCEL");
        cancelButton.setTextSize(20);
        cancelButton.setTextColor(0xFFFFFFFF);
        cancelButton.setBackgroundColor(0xFFD32F2F); // Dark Red
        cancelButton.setPadding(40, 20, 40, 20);
        LinearLayout.LayoutParams buttonParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
        );
        buttonParams.setMargins(100, 0, 100, 0);
        cancelButton.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                cancelAction();
            }
        });
        root.addView(cancelButton, buttonParams);

        setContentView(root);

        // ASK FOR THE ONE PERMISSION THE CALL NEEDS, WHILE THE COUNTDOWN RUNS.
        //
        // 30 September 2026: this screen appeared on the locked phone, counted
        // ten, nine ... zero, and placed no call. CALL_PHONE was declared in the
        // manifest and had never once been requested, so ACTION_CALL threw and
        // the executor's catch swallowed it. Asking here, on the first call this
        // phone ever tries, is the natural moment: the user is looking at
        // "Calling Surya Kiran" and the system dialog says why. If they refuse,
        // ActionExecutor opens the dialler with the number filled in instead.
        if (("call".equals(actionSpec.type) || "contact".equals(actionSpec.type))
                && Build.VERSION.SDK_INT >= Build.VERSION_CODES.M
                && checkSelfPermission(android.Manifest.permission.CALL_PHONE)
                        != android.content.pm.PackageManager.PERMISSION_GRANTED) {
            Log.d("QK_COUNTDOWN", "CALL_PHONE not granted - asking during the countdown");
            requestPermissions(new String[]{android.Manifest.permission.CALL_PHONE}, REQ_CALL_PHONE);
        }

        // Start 10-second countdown
        startCountdown();
    }

    private static final int REQ_CALL_PHONE = 4101;

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQ_CALL_PHONE) {
            boolean granted = grantResults.length > 0
                    && grantResults[0] == android.content.pm.PackageManager.PERMISSION_GRANTED;
            Log.d("QK_COUNTDOWN", "CALL_PHONE " + (granted ? "granted" : "refused - will open the dialler"));
        }
    }

    private void startCountdown() {
        countDownTimer = new CountDownTimer(10000, 1000) {
            @Override
            public void onTick(long millisUntilFinished) {
                int secondsRemaining = (int) (millisUntilFinished / 1000) + 1;
                timerView.setText(String.valueOf(secondsRemaining));
            }

            @Override
            public void onFinish() {
                timerView.setText("0");
                executeAction();
            }
        }.start();
    }

    private void executeAction() {
        Log.d("QK_COUNTDOWN", "Countdown finished. Executing action: " + actionSpec.type);
        ActionExecutor.execute(this, actionSpec);
        finish();
    }

    private void cancelAction() {
        Log.d("QK_COUNTDOWN", "Action cancelled by user.");
        if (countDownTimer != null) {
            countDownTimer.cancel();
        }
        finish();
    }

    @Override
    public void onBackPressed() {
        cancelAction();
        super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        if (countDownTimer != null) {
            countDownTimer.cancel();
        }
    }
}
