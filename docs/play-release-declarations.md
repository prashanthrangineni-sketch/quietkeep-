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

### B. `ACCESS_BACKGROUND_LOCATION` (Background Location) — NOT DECLARED, DO NOT CLAIM
> **Status checked 17 Oct 2026 against `AndroidManifest.xml` on main:** this permission was removed for the v1.2.0 submission and `LocationService` is not declared. Do **not** fill in the Play background-location declaration for this release. The text below is kept only for when geo-triggers return (planned 1.3.0, with a prominent disclosure screen).
* **Declared in:** (not declared today)
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

### F. Foreground service types (Android 14+, Play Console → App content → Foreground service permissions)
Added by Drive card DRV-09 on 17 Oct 2026. Each line is a service that is really started in the app, checked against the manifest and code on main.

| Permission / type | Service | Started when | What the user sees | Play "task" to select | Use-case text to paste |
| --- | --- | --- | --- | --- | --- |
| `FOREGROUND_SERVICE_LOCATION` / `location` | `BlackboxService` | The user enters **Drive Mode** (`src/app/drive/page.jsx` calls `QkBlackbox.start()`); stopped when they leave it | Ongoing notification "Drive Mode Active — Recording crash data for your safety" | Location — "Navigation / safety while driving" (user-initiated) | "While the user has Drive Mode open, QuietKeep keeps a rolling 60-second record of the phone's motion sensors and GPS so that, if a crash or hard stop is detected, the last 45 seconds and next 15 seconds are saved as a sealed crash record the driver owns. The service starts only when the user opens Drive Mode and stops when they leave it. Nothing is kept unless a crash, hard stop or the user's own voice command triggers a save." |
| `FOREGROUND_SERVICE_MICROPHONE` / `microphone` | `BlackboxService` | Only if the user switched ON "Include the last 60 seconds of cabin audio…" **and** granted the microphone | Same notification | Microphone — user-initiated recording | **Do not declare this use for the Drive release:** v1 captures no audio (`audio_status: opted_in_not_captured_v1`, see `docs/qkedr-v1.md`). Declare it only in the release that ships cabin audio. |
| `FOREGROUND_SERVICE_MICROPHONE` / `microphone` | `VoiceService` | Wake-word listening ("Hey Aaria") | Ongoing listening notification | Owned by the **voice thread** — not filled by Drive | — |
| `FOREGROUND_SERVICE_DATA_SYNC` / `dataSync` | `KeepAliveService` | Owned by the existing app | — | Not part of Drive | — |

**Video for the reviewer (Play asks for one for the location type):** record on one phone: open QuietKeep → Drive Mode → notification appears → tilt the phone in the hidden desk-test mode → a record appears under "Last records" → leave Drive Mode → notification disappears. 30–45 seconds. (Recorded in phase 2, when the founder does the desk test.)

### G. `SEND_SMS` (SOS)
Owned by the voice thread (SOS countdown, PR #161). Drive calls the existing SOS and adds no SMS of its own. Listed here only so the Drive release does not ship without it: the Play "SMS and Call Log" declaration must use the **emergency / SOS exception** before any release that includes `SosCountdownActivity`.

### H. `RECORD_AUDIO` (Microphone — Indicator Assist Acoustic Sensing, DRV-11)
* **Declared in:** `AndroidManifest.xml` (`<uses-permission android:name="android.permission.RECORD_AUDIO" />`)
* **Used by:** `IndicatorEarPlugin.java` (`IndicatorEar`) for turn indicator clicker/beeper detection during Drive Mode. (Voice commands and wake-word listening are owned separately by `VoiceService.java`.)
* **Play Console Justification Line (to paste into Play Console permission declarations):**
  "QuietKeep uses the microphone in Drive Mode to listen for turn indicator clicker sounds so the app can remind drivers if their turn signal remains blinking after completing a turn. Listening is strictly opt-in (default OFF) and only runs for short 5-second intervals while Drive Mode is open on screen. Audio is never recorded, stored, or transmitted; it is immediately reduced on-device into acoustic energy levels and discarded."
* **Operating Rules & Privacy Guarantees:**
  * **Strictly Opt-In (Default OFF):** Acoustic sensing is disabled by default. The driver must explicitly choose "Also listen for the indicator sound" in Drive Mode Setup (`src/lib/indicator-assist.js`).
  * **Short, Bounded Listens:** The microphone is opened only for 5 seconds, starting about 1.5 seconds after a detected turn or lane change, rate-limited to at most one listen per minute. It never listens continuously.
  * **Foreground Screen-Only:** Runs only while QuietKeep is active on screen in Drive Mode. It does not start or require a foreground service.
  * **Local Reduction, Zero Audio Retained:** Audio samples are read into a single reused buffer, converted in real time on the phone to dimensionless loudness energy numbers (100 per second), and immediately overwritten and discarded. No audio recordings, WAV files, or voice samples are ever saved to storage, cached, or transmitted to any server.
  * **Data Safety Impact:** Because sound is reduced entirely on-device to energy numbers and discarded instantly, in Google Play Data Safety: **Audio is NOT collected**.

### I. `BLUETOOTH_SCAN` & `BLUETOOTH_CONNECT` (Nearby Devices — OBD-II Car Reader, DRV-06)
* **Declared in:** `AndroidManifest.xml`:
  * `<uses-permission android:name="android.permission.BLUETOOTH_SCAN" android:usesPermissionFlags="neverForLocation" tools:targetApi="s" />`
  * `<uses-permission android:name="android.permission.BLUETOOTH_CONNECT" />`
  * `<uses-permission android:name="android.permission.BLUETOOTH" android:maxSdkVersion="30" />`
  * `<uses-permission android:name="android.permission.BLUETOOTH_ADMIN" android:maxSdkVersion="30" />`
  * `<uses-feature android:name="android.hardware.bluetooth_le" android:required="false" />`
* **Used by:** `QkObdPlugin.java` via standard Android Bluetooth Low Energy (BLE) GATT.
* **Play Console Justification Line (to paste into Play Console permission declarations):**
  "QuietKeep uses Bluetooth Low Energy to connect to standard OBD-II vehicle diagnostic adapters (such as Vgate iCar Pro 2S or vLinker MC+) to read engine status, speed, fuel type, and battery voltage when the driver chooses to connect their vehicle in Drive Mode. Bluetooth scanning is declared with `neverForLocation` because it is used exclusively to discover vehicle diagnostic adapters and is never used to derive device location. The connection is strictly read-only: no commands that modify vehicle state or clear trouble codes are permitted, and no data leaves the phone except the optional vehicle telemetry row saved to the user's private account."
* **Operating Rules & Privacy Guarantees:**
  * **`neverForLocation` Guarantee:** Strong Android declaration that Bluetooth scanning is never used to track, derive, or approximate physical location.
  * **Strictly Read-Only:** The app only queries standard Mode 01 (live data), Mode 03 (trouble codes), and Mode 09 (VIN). Every command must pass an allow-list in code (`assertReadOnlyCommand()` in `elm327.js`, mirrored by `QkObdPlugin.isAllowedReadOnly`); anything else, including Mode 04 (clear trouble codes) and settings-writing AT commands such as `ATPP`/`ATSD`, is refused.
  * **Data Minimization:** Raw diagnostic frames stay strictly on the phone. Only an optional vehicle summary snapshot row is stored in the user's private account.

---

## 2. Data Safety & Privacy Declarations

### A. Location
* **Data Type:** Approximate location, Precise location
* **Collected:** Yes (when geo triggers are active or during check-in)
* **Shared:** No (only transmitted to secure user-owned DB for geofence evaluation)
* **Ephemeral:** No (coordinates of saved geo-triggered keeps are stored in database)
* **Users can delete:** Yes (via "Delete Account" or deleting individual keeps)

### A2. Drive Mode crash records (DRV-01, added 17 Oct 2026)
* **Data types:** Precise location (GPS fixes in the record), App activity → "Other actions" (motion-sensor readings around a crash), Device or other IDs (Android ID in the record header).
* **Collected:** Yes — only while Drive Mode is open, and only **kept** when a crash, hard stop or the user's own "save last 60" triggers a record. The rolling buffer itself lives in phone memory and is overwritten every 60 seconds.
* **Shared:** No. Uploaded only to the user's own private storage (`blackbox-records` bucket, owner-only access, checked 17 Oct 2026: another user and a signed-out visitor both see 0 rows).
* **Encrypted in transit:** Yes (HTTPS). Each record is also signed with a key held in the phone's Android Keystore so tampering is detectable.
* **Optional:** Yes — Drive Mode is optional; cabin audio is a separate opt-in and is **not captured in this version**.
* **Users can delete:** Yes, by request — the `/delete-account` page asks the user to email the deletion request (it is handled by hand today). Whoever handles it must remove both the database rows (they go automatically when the user account is deleted, `on delete cascade`) **and** the files under `blackbox-records/<user id>/` in storage, which do not go automatically. There is no per-record delete in the app yet — a crash record is append-only by design. **State this honestly in the Data safety form.**

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

### D2. Indicator listening acoustic sensing (DRV-11, IndicatorEar)
* **Data Type:** Audio / Sound recordings
* **Collected:** **No — Audio is NOT collected.**
* **Explanation for Data Safety form:** The indicator listening feature (`IndicatorEar`) is strictly opt-in (default OFF) and only performs short listens (at most 5 seconds, max once per minute) while Drive Mode is open on screen. The audio signal is reduced in memory on the phone into loudness/energy numbers (100 fps) and immediately discarded. Raw sound is never stored, written to disk, or sent to any server. In the Google Play Data Safety form: **Audio is NOT collected**.
* **Shared:** No.
* **Ephemeral:** Yes — raw audio samples are processed in memory and discarded immediately within native code.
* **Optional:** Yes — opt-in, default OFF in Drive Mode settings.

### E. App Activity & Device Info
* **Data Type:** Package names (`PACKAGE_USAGE_STATS`), Device ID, OS version
* **Collected:** Yes
* **Shared:** No
* **Justification:** Used solely for passive perception analytics and debugging.

### F. Car reader vehicle diagnostics (DRV-06 / AG-02, OBD-II over BLE)
* **Data types:** Device or other IDs (Bluetooth adapter name/MAC, optional VIN), App activity → "Other actions" / Vehicle telemetry (engine RPM, vehicle speed, coolant temperature, fuel type, hybrid battery percentage, battery voltage, diagnostic trouble codes).
* **Collected:** Yes — only when the user explicitly chooses to pair and connect an OBD-II Bluetooth adapter in Drive Mode.
* **Shared:** No. Data is never shared with third parties or external services.
* **Read-only over BLE:** Bluetooth scanning is declared with `neverForLocation`. Telemetry is processed locally on the phone. The app is strictly read-only and cannot alter vehicle state or clear diagnostic trouble codes.
* **Storage:** No diagnostic data leaves the phone except the optional vehicle record (`public.vehicles` table in Supabase) holding `last_obd_snapshot`, `last_obd_at`, `fuel_type`, `vin`, and `supported_pids`.
* **Encrypted in transit:** Yes (HTTPS to private Supabase backend).
* **Optional:** Yes — Drive Mode functions fully without an OBD reader; connecting a reader is entirely optional.
* **Users can delete:** Yes — the vehicle record is owned by the user (`user_id = auth.uid()`), editable/deletable by the user, and deleted automatically on account deletion (`on delete cascade`).

### G. Field test proof runs (AG-04, Phase-2 Proof Kit)
* **Data types:** App activity / Diagnostic logs (checklist step identifier, test result `'pass'|'fail'|'skipped'`, verification evidence JSON object, manual tester notes).
* **Collected:** Yes — only when the user or tester conducts hardware verification tests at the unlisted route `/drive/proof`.
* **Shared:** No.
* **Storage & Transmission:** Saved directly to the user's private database table `public.drive_proof_runs` over HTTPS.
* **Access & Security:** Secured by PostgreSQL Row-Level Security (RLS) policies (`drive_proof_runs_owner_select` and `drive_proof_runs_owner_insert` restricted to `auth.uid() = owner`). The table is append-only with no public update or delete policies.
* **Optional:** Yes — unlisted diagnostic utility used for field verification of OBD reader and sensor accuracy.
* **Users can delete:** Yes — proof run rows are linked via foreign key to `auth.users(id) on delete cascade` and are purged automatically when the user account is deleted.

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
