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
import com.pranix.quietkeep.services.ActionExecutor;
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

        // Start 10-second countdown
        startCountdown();
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
