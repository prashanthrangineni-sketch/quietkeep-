# QuietKeep 1.2.1 — pending work

Verified against the code on 2026-08-23. Every claim below cites the file it came from.

Machine-readable copy: `execution_memory`, project `quietkeep`, key prefix `pending:1.2.1:`.

---

## Read this before starting anything

**Both apps are with Google.** `com.pranix.quietkeep` and `com.pranix.quietkeep.business`,
versionCode 9 (versionName 1.2.0), submitted 2026-08-22, in review as of 2026-08-23.

**Do not upload a new bundle until review completes** — it replaces the submitted release.
Check Play Console first.

**Web changes are not gated.** The installed apps load `https://quietkeep.com` through
Capacitor `server.url`, so JS and API fixes ship through Vercel with no APK. They are still
worth keeping low-risk while review is open, because a reviewer opening the app sees them.

---

## Item 1 — the wake word never fires

Two unrelated causes wearing one symptom. The first is a small web fix. The second is not a
bug at all.

### 1a. Wiring — web-only, not blocked by review

`src/lib/wake-word-engine.js` resolves the native bridge as:

```js
function nativeBridge() { return (isBrowser() && window.__QK_WAKE__) || null; }
```

**Nothing anywhere assigns `window.__QK_WAKE__`.** The bridge does exist — under a different
name:

- `android/app/src/main/java/com/pranix/quietkeep/plugins/WakeWordPlugin.java` exposes
  `startHotword`, `stopHotword`, `ensureInvokeSurfaces`, `isWakeWordAvailable` — the same
  method names `wake-word-engine.js` already calls
- `MainActivity.java` `onCreate()` already contains `registerPlugin(WakeWordPlugin.class)`

So it is live in the shipped vc9 bundle, reachable at
`window.Capacitor.Plugins.WakeWordPlugin`. The JavaScript is simply looking in the wrong place.

**Fix**, in `nativeBridge()`:

```js
return (isBrowser() && (window.__QK_WAKE__ || window.Capacitor?.Plugins?.WakeWordPlugin)) || null;
```

Keep `__QK_WAKE__` first so a future native injection still takes precedence.

**Effect:** TIER 1 (`invoke` — default-assistant long-press, notification mic action, home
widget) starts working. TIER 2 correctly reports unavailable, for the reason below.

### 1b. No wake-word model — real work, not a patch

`android/app/src/main/java/com/pranix/quietkeep/services/WakeWordEngine.java`:

- the constructor logs *"aaria_wakeword.tflite is a text placeholder. Wake word detection is
  unavailable."*
- `detectWakeWord(byte[])` is `// Always return false` — the scoring code beneath it is
  retained but never reached
- `WakeWordPlugin.isWakeWordAvailable()` returns `available: false`, hardcoded
- `public/models/aaria_wakeword.tflite` is a placeholder text file

Acoustic hotword needs a real trained model, shipped, plus inference in `detectWakeWord`, plus
`isWakeWordAvailable` reflecting the truth. **Scope it as a feature, not a bug fix.**

> **Do not** stub `window.__QK_WAKE__` with a fake object to make the toggle look functional.
> `wake-word-engine.js` was written specifically to replace that behaviour — its own header
> calls honest degradation the point of the file. A setting that claims to be listening when
> nothing is listening is worse than one that is visibly greyed out.

### Acceptance

- On Android, `availableWakeModes()` includes `'invoke'`
- `isCounterModeSupported()` returns `false` while the model is a placeholder, and the UI shows
  counter mode as unavailable rather than selectable
- No JS error when `window.Capacitor` is absent (plain web)
- `setWakeMode('counter')` on a device without the model returns `'invoke'` or `'manual'`, and
  the UI reflects the **returned** value, not the requested one

---

## Item 2 — "QuietKeep · Active" never goes away

**Android-side. Needs a new bundle. Genuinely gated by review.**

`android/app/src/main/java/com/pranix/quietkeep/services/KeepAliveService.java` is started from
`MainActivity.onCreate()` *before* `super.onCreate()`, to stop ColorOS `OplusHansManager`
freezing the app UID during the Capacitor WebView cold-start window. It returns `START_STICKY`
and **there is no `stopSelf()` anywhere in the class**, nor any caller that stops it.

Its own header says:

> *"Once the app is loaded, VoiceService takes over the foreground signal."*

Nothing implements that handover. So the notification lives as long as the process does, and
users read it as the app permanently listening.

### The service itself is necessary — keep it

`IMPORTANCE_MIN` was invisible to Hans and the UID froze anyway; `IMPORTANCE_LOW` is the
minimum ColorOS 12+ accepts as a real foreground signal. That regression is already recorded in
the file as `FIX v2`. **Do not lower the importance again.**

### Fix

Bound the service to the cold-start window instead of the process lifetime:

1. Add a stop path — a static `stop(Context)` calling `stopForeground(true)` + `stopSelf()`
2. Signal readiness from the web app after first render (a small Capacitor plugin method, or
   reuse an existing bridge) and stop the service on that signal
3. Add a hard timeout floor in `onCreate` — `Handler.postDelayed(stopSelf, 90_000)` — so the
   service always dies even if the web app never signals
4. Whichever fires first wins

**Constraints**

- Do not stop so early that Hans re-freezes the UID. Do not go below roughly 20s on ColorOS.
- `VoiceService` posts its own separate microphone notification and is unaffected.
- Test on the ColorOS device (CPH2643, Android 14). This service exists because of that OEM.

### Play impact — positive

`FOREGROUND_SERVICE_DATA_SYNC` was declared to Google on 2026-08-22 with a demonstration video
showing this notification during cold start. Bounding the service to the startup window makes
the app match that declaration more closely, not less. No re-declaration needed.

### Acceptance

- Cold start on the ColorOS device still succeeds — no UID freeze, no blank WebView
- The notification disappears within ~90s of launch at the latest, sooner once rendered
- Voice capture still posts its own "QuietKeep is listening" notification independently
- `BootReceiver` behaviour unchanged

---

## Already shipped / in flight

**Telugu and Devanagari number parsing** — PR #81, web-only, open awaiting merge on 2026-08-23.
Fixes "పది read as 9".

Open question recorded on that PR: if the failing case was a spoken **time** rather than an
**amount**, `TIME_PATTERNS` is still ASCII-digit only and needs a separate fix.

---

## Working rules for this project

1. **Verify every claim against the live system.** Success reports here have repeatedly been
   false: fabricated store screenshots, a launcher icon "confirmed" against the wrong file, a
   Postgres migration that returned success and changed nothing because `anon` inherits
   `EXECUTE` from `PUBLIC`, and a regex fix that read correctly and failed on real Telugu
   because vowel signs are combining marks, not letters.
2. **Never fake a capability** to make a UI control appear functional.
3. **The founder is non-technical.** State his action, the IDE agent's action, and yours
   separately and explicitly.
4. **Writes to GitHub and to product databases need a founder-approved grant** via
   `mcp_access_request_grant`. Never self-approve.
