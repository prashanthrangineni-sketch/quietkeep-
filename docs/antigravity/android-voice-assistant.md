# QuietKeep — Android voice assistant: build brief

**For Antigravity.** Paste this whole file as the task, or open it in the IDE and
work through it top to bottom.

Repo: `prashanthrangineni-sketch/quietkeep-` · Base branch: `main` @ `a0648a4`
Stack: Next.js 15 + Supabase + Vercel + Capacitor (Android).

Two Android flavours, both loading the same web app through a WebView:

| Flavour | applicationId | `server.url` |
|---|---|---|
| personal | `com.pranix.quietkeep` | `https://quietkeep.com` |
| business | `com.pranix.quietkeep.business` | `https://quietkeep.com/?app=business` |

**Goal:** an assistant the user controls entirely by voice — it hears its name,
understands, confirms, and *performs the action*, including at a future time,
with the phone locked, in both flavours, in English/Hindi/Telugu.

Everything below was read out of the code on 14 Aug 2026. File and line
references are given so you verify rather than trust. **If a claim here does not
match what you find, stop and report the discrepancy — do not build on top of it.**

See also: [`docs/SOT.md`](../SOT.md) — the frozen source of truth for this project.

---

## GROUND RULES (non-negotiable)

1. **Verify before you build.** Open the referenced file and confirm the claim.
2. **Never split a syntactic pair across commits.** An intermediate commit that
   does not compile will be built by Vercel and will fail. Opening a `<div>`,
   a `{`, or a JSDoc `/**` in one commit and closing it in the next has already
   caused two red builds on this repo.
3. **After every push, compare trees, not SHAs.**
   `git rev-parse HEAD^{tree}` must equal the remote branch's tree. A push that
   silently truncated a block has already shipped a syntactically invalid file
   here. The diff must be empty.
4. Mark every commit in a batch `[skip ci]` **except the last** — the Vercel plan
   allows 1 concurrent build, 100/day.
5. **Open a PR. Do not merge.** The founder merges.
6. Do not touch `src/lib/aaria-router.js`, `src/lib/context/aaria.jsx`,
   `src/components/AariaDock.jsx`, `src/lib/aaria-watch.js`,
   `src/lib/aaria-hotword.js` without a failing test justifying it. They are
   covered by 94 assertions — run `node tests/aaria-router.test.mjs`,
   `aaria-hotword`, `aaria-watch`, `aaria-stream` before and after.
7. Report numbers, never the word "works". "False-accept rate 0.4/hour over
   30 min of shop ambience" is a result; "wake word works" is not.
8. Update `docs/SOT.md` in the same PR as the change it describes.

---

## PART A — The wake word is fake. Replace it.

**File:** `android/app/src/main/java/com/pranix/quietkeep/services/WakeWordEngine.java`

```java
private volatile String targetWakeWord = "Aaria";   // line 62 — NEVER READ BY THE DETECTOR
```

`computeDetectionScore()` scores three things and none of them is a word:

```java
double combined = (syllableScore * 0.5)   // TARGET_SYLLABLES = 2
                + (spectralScore * 0.3)   // spectral tilt tuned for the "Lo" vowel of LOTUS
                + (durationScore * 0.2);  // duration tuned for "lotus", ~400-700ms
// DETECTION_THRESHOLD = 0.60
```

`setTargetWakeWord()` (line 68) is **never called from any source file**. The log
line still reads `"WakeWordEngine: LOTUS DETECTED"`. This is a two-syllable-sound
detector wearing a wake word's name: "coffee", "hello", "amma", "papa" all fire it.

**This is a privacy defect, not only a quality one.** `VoiceService.java` (~line 330)
comments *"In always-on mode: only send audio AFTER wake word detected."* Because
the detector fires on ordinary speech, the app uploads audio to
`/api/voice/capture` during conversations the user never addressed to it, while
believing it waits for "Aaria".

**Do not tune the thresholds.** No threshold makes an energy-envelope heuristic
word-specific.

### Build
1. Integrate **openWakeWord** (Apache-2.0, custom keywords trainable from
   synthetic data — preferred over Porcupine, which needs a per-device licence).
2. Ship the model at `android/app/src/main/assets/wakeword/aaria.tflite`.
   Note `src/lib/wake-word-engine.js` line 31 points at
   `/models/aaria_wakeword.tflite` — **`public/models/` does not exist in this
   repo**. Either ship that file or delete the constant. Do not leave a URL
   pointing at nothing.
3. Rewrite `detectWakeWord(byte[] pcmBytes)` to run the model. **Keep the exact
   signature** — `VoiceService` line ~323 calls it.
4. Keep the RMS pre-filter and `COOLDOWN_MS = 2000`. Both are sensible.
5. Delete `computeDetectionScore`, `countSyllablePeaks`,
   `computeSpectralTiltScore`, `scoreDuration`, `TARGET_SYLLABLES`. Dead
   heuristics beside a real model invite someone to re-enable them.
6. Rename the event `lotus_wake` → `qk_wake`. Keep dispatching `lotus_wake` too
   for one release (older web bundles listen for it), then remove.

### Already correct — do not rewrite
- `WakeWordPlugin.java` → starts `VoiceService` with `START_HOTWORD`.
- `VoiceService.dispatchLotusWakeEvent()` → posts to the main looper, gets the
  Capacitor WebView, evaluates a `CustomEvent`. **This bridge works.**
- `src/lib/wake-word-engine.js` `registerNativeWake()` listens for `lotus_wake`.
- Since PR #68, `src/lib/context/aaria.jsx` calls `initWakeEngine()` on every
  page. Before that only the settings page imported it, so nothing listened
  anywhere. That half is fixed.

**The JS side is wired end to end. The detector is the only broken link.**

### Acceptance
- 50 spoken "Aaria" at 1 m, Telugu- and Hindi-accented English → report true-accept rate.
- 30 min of shop ambience, no wake word → report false-accepts per hour. **>1/hour is a fail.**
- Instrumented tests asserting "coffee", "hello", "amma", "papa" all return `false`.
  These four pass today. They are the regression that matters.

---

## PART B — "Call Ravi at 10pm" can call Ravi right now. Fix first.

**File:** `src/app/api/voice/capture/route.js` ~line 561

```js
const isAutoEligible = (
  parsed.confidence >= 0.82
  && AUTO_EXEC_TYPES.has(parsed.type)      // {'contact','navigation','trip','purchase'}
  && !BLOCKED_FROM_AUTO.has(parsed.type)
  && !followUp
  && !workspace_id
  && !(parsed.type === 'contact' && !keep.contact_phone)
  && !isSourcePrediction
)
```

`reminderAt` is computed at line 129 and **never consulted here**. If
"call Ravi at 10pm" parses as `contact` with confidence ≥ 0.82 and a phone
resolves, `auto_exec` is returned, `VoiceService` reads it (~line 473) and fires
`ACTION_CALL` after `delay_ms: 2500`.

The user said 10pm. The phone dials now.

**Fix:**
```js
// A stated future time is an instruction about WHEN. Acting now is not an
// approximation of acting later — for a phone call it is the wrong action,
// and the kind that wakes someone up.
&& !(reminderAt && new Date(reminderAt).getTime() > Date.now() + 60_000)
```

**Test:** `"call Ravi at 10pm"` → `auto_exec === null`, keep has `reminder_at`.
`"call Ravi"` → `auto_exec` still returned.

---

## PART C — Scheduled execution (the actual assistant gap)

### What exists
- `android/.../services/ReminderAlarmManager.java` — schedules exact alarms.
- `android/.../receivers/AlarmReceiver.java` — fires at the time.
- Declared already: `SCHEDULE_EXACT_ALARM`, `USE_EXACT_ALARM`, `RECEIVE_BOOT_COMPLETED`, `CALL_PHONE`.

### Why it is not enough
`AlarmReceiver.onReceive()` does exactly two things (~lines 52–57): shows a
notification, then starts `ReminderTTSService` to speak it. **It never executes.**
No `ACTION_CALL`, no intent dispatch. The alarm plumbing is right; the payload is
text instead of an action.

### Build
1. Extend alarm extras to carry `{type, payload}` where type ∈
   `call | whatsapp | navigate | media | open_app | sms | alarm`.
2. **`ActionExecutor`** — one class, entry point `execute(Context, ActionSpec)`,
   owning every device action. Both `VoiceService` (immediate) and `AlarmReceiver`
   (scheduled) call it. Today intent-building sits inline in `VoiceService`
   lines 481–504; move it out so the two paths cannot drift.
3. Server: when a keep has a future `reminder_at` **and** an executable intent,
   persist the action spec and return it so the client registers an alarm.
   `execution_queue` exists (`src/lib/execution-queue-engine.js`) but has **no
   scheduled-time column** — add `scheduled_for timestamptz` + index.
4. Re-register pending alarms on `BOOT_COMPLETED`. An assistant that forgets its
   promises after a restart is worse than one that never promised.
5. **Confirm before acting.** At execution time show a 10-second full-screen
   "Calling Ravi — Cancel" countdown, reachable one-handed on the lock screen.
   Silent autonomous dialling loses a user permanently.

---

## PART D — Executing while the phone is locked

`AndroidManifest.xml` declares **no `SYSTEM_ALERT_WINDOW`**. On Android 10+,
starting an Activity from the background is blocked without it — so the call
screen will not appear when locked, which is the case the founder cares about.

**Do not request `SYSTEM_ALERT_WINDOW`** — Play treats it as high-risk and it
invites rejection. Instead:
1. Full-screen intent notification (`setFullScreenIntent`) on a high-importance
   channel — the sanctioned path for alarms and incoming calls, works from lock screen.
2. Declare `USE_FULL_SCREEN_INTENT` (auto-granted on Android 14+ to apps whose
   core function is alarms/calling; be ready to justify it).
3. That full-screen UI *is* the confirm/cancel countdown from Part C.5 — one
   surface satisfies both requirements.

**Test on:** Android 10, 12, 14, plus one Oppo/Realme/Vivo (ColorOS kills
background services aggressively; `src/components/VoiceCapture.jsx` documents the
permission-commit delay — keep that handling).

---

## PART E — The action registry

`ActionExecutor` must cover:

| Action | Mechanism | Status today |
|---|---|---|
| Call | `ACTION_CALL` | exists inline — move it |
| WhatsApp | `ACTION_VIEW` `wa.me` | exists inline — move it |
| Navigate | `ACTION_VIEW` `google.navigation:` | exists inline — move it |
| **Play music** | `ACTION_MEDIA_PLAY_FROM_SEARCH` | **nothing exists** |
| **Open an app** | `PackageManager.getLaunchIntentForPackage` | **nothing exists** |
| **Set alarm/timer** | `AlarmClock.ACTION_SET_ALARM` | **nothing exists** |
| **Send SMS** | `ACTION_SENDTO` `smsto:` | **nothing exists** |
| Torch / volume | `CameraManager` / `AudioManager` | optional, cheap, high perceived value |

For "play music": route to the user's default media app, fall back to a chooser.
Support "play <song>", "play <artist>", "play my music".
For "open an app": resolve spoken names against installed packages — expect
mispronunciation, so match fuzzily against `PackageManager` labels.

---

## PART F — Business version (do not skip; it is the weaker one)

**The Business app cannot perform a single device action today.**

`src/app/api/voice/capture/route.js` line 569, inside `isAutoEligible`:

```js
&& !workspace_id
```

Any utterance in a business workspace is excluded from `auto_exec` entirely. So
in the Business flavour, voice **only writes records** — it never calls, never
navigates, never opens WhatsApp.

That is backwards. Business is where device actions matter most: field staff
navigating to a delivery, an owner calling a customer about an overdue payment,
WhatsApping an invoice.

### What business voice *does* have (verified — build on it, don't duplicate)
- `src/lib/business-resolver.js` → `resolveBusinessIntent()` + `writeLedgerEntry()`,
  called from the capture route at lines 326 and 396. Ledger entries are written
  from speech and this works.
- `src/lib/businessIntentEngine.ts` recognises subtypes: `business_contact`,
  `business_expense`, `business_invoice`, `business_meeting`, `business_report`,
  `business_task`, `business_follow_up`, `business_cancel`.
- `src/lib/inventory-stock.js` writes `stock_movements`.
- `src/lib/agent-registry.js` reads `business_invoices` (overdue lookups).

### Build
1. **Replace the blanket `!workspace_id` exclusion** with a business-aware policy.
   Business actions must be permitted, but gated harder than personal ones,
   because they touch customers and money:
   - `business_contact` → call/WhatsApp a **resolved customer** only. Never a raw
     number parsed out of speech.
   - `navigation` → allowed.
   - Anything that **moves money or issues a document** (invoice, payment,
     ledger write above a threshold) → **always confirm out loud first**, never
     auto-execute. Keep those in `BLOCKED_FROM_AUTO`.
2. Respect `requireBizPermission`. A staff member must not voice-trigger an
   action their role forbids. Check the existing permission helper before
   executing, not only before rendering.
3. `VoiceService` must pass `workspace_id` in the business flavour so
   "add 2000 for Ravi" lands on the workspace, not the owner's personal account.
   **Verify this end to end** — a misfiled entry is a silent accounting error.
4. Business voice targets worth wiring, in value order:
   "call the customer who owes the most" · "navigate to my next delivery" ·
   "WhatsApp the invoice to Ravi" · "how much did we sell today" ·
   "mark Ravi paid 5000" (confirm first) · "reduce stock of X by 3".

---

## PART G — Automatic language switching

`VoiceService.java` line 78 sets `languageCode = "en-IN"`, line 188 sets it once
at service start, line 405 sends it with every STT upload. **Fixed for the life
of the service.** Speak Telugu into a session started in English and recognition
collapses.

The understanding layer already detects language — `src/lib/aaria-llm.js` returns
`language_detected` and replies come back in the user's language. Only
*recognition* is stuck.

### Build
1. Use provider language auto-detection where available; read the detected
   language back from the STT response.
2. Feed `assistant.language` from `/api/voice/capture` back into `VoiceService`
   and update `languageCode` for subsequent chunks. A language switch should
   persist for the rest of the session.
3. Same on web: `src/lib/context/aaria.jsx` sets `rec.lang` from the stored voice
   language — update it when a reply returns a different language.
4. **Acceptance:** start in English, say one Telugu sentence, and the *next*
   utterance is recognised as Telugu with no settings change.

---

## PART H — Build, test, ship

```
./gradlew clean
./gradlew bundlePersonalRelease bundleBusinessRelease
```

Play requires a signed `.aab`; a debug APK is rejected. **Do not hardcode the
keystore password** — read it from an env var or `~/.gradle/gradle.properties`.

**Keystore, before any Play upload:** the signing password was committed and the
repo is public. Run
`git log --all --diff-filter=A --name-only -- '*.jks' '*.keystore'`.
Nothing printed → only the password leaked; rotate with `keytool -storepasswd`.
A filename printed → the key itself leaked; **stop and tell the founder** — it
needs a Play Console upload-key reset under his login.

### Manual matrix (report as a pass/fail table)
personal + business × {gesture nav, 3-button nav} × {screen on, locked, backgrounded}
× {en-IN, hi-IN, te-IN}.

### Also verify
- `AariaDock` renders on every route inside the WebView and is not hidden behind
  the Android nav bar (`env(safe-area-inset-bottom)`).
- **Microphone arbitration.** The web layer dispatches `qk_mic_claim` /
  `qk_mic_release` (see `src/lib/aaria-hotword.js`). `VoiceService` must respect
  it: dispatch `qk_mic_claim` into the WebView before opening `AudioRecord`, and
  `qk_mic_release` when it stops. Two recorders on one mic wedge it until restart.
- `window.__QK_TTS__` (injected in `MainActivity`) speaks replies on every page,
  not just the dashboard.

---

## DEFINITION OF DONE

The founder's own test, verbatim, on a **locked** phone:

> *"Hey Aaria, I want to call Ravi at 10pm today."*

1. Wakes on "Aaria", not on "coffee".
2. Acknowledges aloud, in the language spoken.
3. Saves the task and **calls no one now**.
4. At 22:00 the screen lights: "Calling Ravi — Cancel (10s)".
5. Uncancelled, the call is placed.
6. Survives a reboot between the request and 22:00.

Plus:
> *"Aaria, play my music"* → the user's music app starts playing.
> *"Aaria, navigate to my next delivery"* (**business** flavour) → Maps opens.
> Start in English, speak one Telugu sentence → next utterance recognised as Telugu.

Report each as pass/fail with device and OS version, plus the two wake-word rates
from Part A.

**Order of work: B → D → A → C → E → F → G.**
B is first because it can misdial today; D is second because without it nothing
executes while locked.
