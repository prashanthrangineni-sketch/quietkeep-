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

## 2. Data Safety & Privacy Declarations

### A. Clipboard Data Collection
* **Data Type:** Clipboard text
* **Collected & Transmitted:** Yes.
* **Justification:** QuietKeep reads copy events to support voice-triggered clipboard parsing commands (e.g., *"Aaria, add this clipboard link to my workspace"* or parsing phone numbers and invoices copied to the clipboard).
* **Transmission Details:**
  * **Code Reference:** `src/lib/capacitor/perception.ts` lines 61-69:
    ```typescript
    const clip = await P.getClipboardText?.();
    if (clip?.text && clip.text !== _lastClip && clip.text.length > 20
        && !clip.text.startsWith('http')) {
      _lastClip = clip.text;
      await _send(authToken, serverUrl, 'clipboard_changed',
        { content_length: clip.text.length, preview: clip.text.slice(0, 30) });
    }
    ```
  * **Server Endpoint:** `src/app/api/perception/signal/route.js`.
  * **Exposure:** A 30-character preview of the copied clipboard text is sent to the database via the perception API. This could capture sensitive inputs (passwords, OTPs, or card details) if they are copied to the clipboard. The listing declaration must state that clipboard contents are transmitted and processed.

### B. Location
* **Data Type:** Approximate location, Precise location
* **Collected:** Yes (when geo triggers are active or during check-in)
* **Shared:** No (only transmitted to secure user-owned DB for geofence evaluation)
* **Ephemeral:** No (coordinates of saved geo-triggered keeps are stored in database)
* **Users can delete:** Yes (via "Delete Account" or deleting individual keeps)

### C. Personal Info
* **Data Type:** Name, Email address, User IDs
* **Collected:** Yes (for Supabase passwordless magic link login)
* **Shared:** No
* **Processed:** Transmitted securely over HTTPS to Supabase databases.

### D. Financial Info
* **Data Type:** Purchase history, Expense logs, Ledger records
* **Collected:** Yes (user logs their expenses, bills, and GST invoices)
* **Shared:** No
* **Processed:** Transmitted securely to Supabase. Subscription payments are processed securely by Razorpay.

### E. Audio Files
* **Data Type:** Voice / Sound recordings
* **Collected:** Yes (3-second WAV voice chunks are captured to translate voice commands)
* **Shared:** Yes (sent to AI processors for transcription)
* **Subprocessors:** Sarvam AI (Indic speech recognition), OpenAI / OpenRouter / Groq (voice processing and LLM)
* **Ephemeral:** Yes (audio chunks are processed on-the-fly and are not persistently stored on servers)

### F. App Activity & Device Info
* **Data Type:** Package names (`PACKAGE_USAGE_STATS`), Device ID, OS version
* **Collected:** Yes
* **Shared:** No
* **Justification:** Used solely for passive perception analytics and debugging.

---

## 3. Google Play Reviewer Instructions

> [!IMPORTANT]
> **FOUNDER MUST SUPPLY THE FOLLOWING DETAILS IN THE PLAY CONSOLE:**
>
> 1. **Test Account Email:** `[FOUNDER MUST SUPPLY - e.g. playstore-reviewer@quietkeep.com]`
> 2. **Authentication Method:** `[FOUNDER MUST SUPPLY - e.g. Magic Link / Static OTP code]`
> 3. **Verification Code / Password:** `[FOUNDER MUST SUPPLY - e.g. Static code 999999 or test password]`
>
> Ensure that the specified test account exists in your Supabase Auth user table and is fully functional before submitting the app for review.
