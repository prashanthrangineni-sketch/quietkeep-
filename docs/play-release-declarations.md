# Google Play Store Release Declarations — QuietKeep

This document contains the exact declarations, justifications, and configurations required for the Google Play Console during the review process for both the **Personal** (`com.pranix.quietkeep`) and **Business** (`com.pranix.quietkeep.business`) flavours.

---

## 1. Restricted & Sensitive Permissions Justifications

### A. `PACKAGE_USAGE_STATS` (Usage Access)
* **Declared in:** `AndroidManifest.xml` (via `tools:ignore="ProtectedPermissions"`)
* **Used by:** `PerceptionPlugin.java` via `UsageStatsManager`.
* **Justification:** 
  QuietKeep is a voice-first life assistant that utilizes passive perception of device context to anticipate follow-up user tasks and compile context-rich notifications. The app uses `UsageStatsManager.queryEvents` to determine when the user transitions to a different foreground application (logging `app_foreground` events) to determine context-appropriate times to speak reminders or suggest tasks.
* **Data Transmission Details:**
  * **Code Reference:** `src/lib/capacitor/perception.ts` lines 49-53:
    ```typescript
    const app = await P.getForegroundApp?.();
    if (app?.app_name && app.app_name !== _lastApp) {
      _lastApp = app.app_name;
      await _send(authToken, serverUrl, 'app_foreground',
        { app: app.app_name, package: app.package_name });
    }
    ```
  * **Server Endpoint:** `src/app/api/perception/signal/route.js` lines 99-103.
  * **Storage:** Transmitted foreground app package names and names are securely sent to the server via HTTPS and persisted in the user's database (`ingest_passive_signal` RPC).

### B. `ACCESS_BACKGROUND_LOCATION` (Background Location)
* **Declared in:** `AndroidManifest.xml`
* **Used by:** `LocationService.java` via `FusedLocationProviderClient`.
* **Justification:**
  QuietKeep supports "Geo Triggers" (location-based keeps and reminders). When a user records a keep like *"Remind me to buy groceries when I arrive at the supermarket,"* the app requires continuous background location polling (every 5 minutes) to trigger the notification immediately upon entering the geofence. 
  For the Business flavour, it verifies employee attendance check-ins at designated job sites. This feature requires background location monitoring to verify the employee is physically present at the site when check-in is requested.

### C. `CALL_PHONE` (Direct Phone Calling)
* **Declared in:** `AndroidManifest.xml`
* **Used by:** `ActionExecutor.java` (using `Intent.ACTION_CALL`).
* **Justification:**
  The core value proposition of QuietKeep is a voice-first, hands-free assistant. When a user issues a voice command such as *"Aaria, call my doctor immediately,"* the app is designed to place the phone call directly without forcing the user to interact with a system dialer, supporting critical accessibility and emergency use cases (such as the hands-free Drive Mode).

### D. `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` (Ignore Battery Optimizations)
* **Declared in:** `AndroidManifest.xml`
* **Used by:** `MainActivity.java` / `VoicePlugin.java`.
* **Justification:**
  QuietKeep relies on a continuous background mic capture service (`VoiceService.java`) for hands-free wake word detection ("Aaria"). On modern Android systems and custom OEM battery managers (such as Oppo/Realme ColorOS and Xiaomi MIUI), background services are aggressively killed or frozen (e.g., via `OplusHansManager`) after a few minutes of screen-off. Requesting exemption from battery optimizations is critical to keep the background hotword listener active.

---

### E. USE_FULL_SCREEN_INTENT (Full-Screen Intent)
* **Declared in:** AndroidManifest.xml
* **Used by:** AlarmReceiver.java.
* **Justification:**
  QuietKeep delivers critical alarm-type reminder notifications (such as timer countdowns and scheduled tasks). To ensure the user is immediately notified and can interact with the alarm even when the device is locked, the app launches a full-screen notification intent (CountdownActivity.java). On Android 14+ (API 34+), this is guarded by runtime canUseFullScreenIntent() checks, with standard notifications as a fallback when the permission is not granted.

---

## 2. Data Safety & Privacy Declarations

### A. Location
* **Data Type:** Approximate location, Precise location
* **Collected:** Yes (when geo triggers are active or during check-in)
* **Shared:** No (only transmitted to secure user-owned DB for geofence evaluation)
* **Ephemeral:** No (coordinates of saved geo-triggered keeps are stored in database)
* **Users can delete:** Yes (via "Delete Account" or deleting individual keeps)

### B. Personal Info
* **Data Type:** Name, Email address, User IDs
* **Collected:** Yes (for Supabase passwordless magic link login)
* **Shared:** No
* **Processed:** Transmitted securely over HTTPS to Supabase databases.

### C. Financial Info
* **Data Type:** Purchase history, Expense logs, Ledger records
* **Collected:** Yes (user logs their expenses, bills, and GST invoices)
* **Shared:** No
* **Processed:** Transmitted securely to Supabase. Subscription payments are processed securely by Razorpay.

### D. Audio Files
* **Data Type:** Voice / Sound recordings
* **Collected:** Yes (3-second WAV voice chunks are captured to translate voice commands)
* **Shared:** Yes (sent to AI processors for transcription)
* **Subprocessors:** Sarvam AI (Indic speech recognition), OpenAI / OpenRouter / Groq (voice processing and LLM), ElevenLabs (text-to-speech voice generation)
* **Ephemeral:** Yes (audio chunks are processed on-the-fly and are not persistently stored on servers)

### E. App Activity & Device Info
* **Data Type:** Package names (`PACKAGE_USAGE_STATS`), Device ID, OS version
* **Collected:** Yes
* **Shared:** No
* **Justification:** Used solely for passive perception analytics and debugging.

---

## 3. Google Play Reviewer Instructions

> [!IMPORTANT]
> **Use the following test credentials to log in and review the application:**
>
> ### Personal App Flavor (`com.pranix.quietkeep`)
> * **Test Account Email:** `reviewer-demo@quietkeep.com`
> * **Authentication Method:** Email OTP Code (One-Time Password)
> * **Static OTP / Verification Code:** `888888`
>
> ### Business App Flavor (`com.pranix.quietkeep.business`)
> * **Test Account Email:** `reviewer-demo@quietkeep.com`
> * **Authentication Method:** Email / Password (using the "Sign in with Email / Beta Code" flow)
> * **Password:** `QuietKeepReviewer2026!`
>
> *Note to Founder: Configure `reviewer-demo@quietkeep.com` with the static OTP `888888` in the Supabase Dashboard under **Auth -> Settings -> Test OTPs** before submitting the Personal app for review.*
