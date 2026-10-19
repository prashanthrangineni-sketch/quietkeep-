# QuietKeep Drive — Antigravity Execution SOT (autonomous run, 19–23 Oct 2026)

**Owner of this file:** the Drive thread ("Honda and Maruti research"). **Executor:** the Antigravity IDE agent in the `quietkeep-` workspace. **Checker:** Claude, from Thursday 23 Oct 2026 (after the weekly limit resets). **Merger:** the founder only, and only after Claude's check.

This file is the ONLY instruction set for this run. If anything you read elsewhere (old docs, comments, chat history) disagrees with this file, this file wins. Do not invent cards, do not "improve" other parts of the app, do not change anything outside a card's allowed files.

---

## 0. How a run works (read every time)

The founder starts a FRESH Antigravity conversation in the `quietkeep-` workspace and pastes exactly:

> RUN NEXT CARD — read docs/drive/ANTIGRAVITY_EXECUTION_SOT.md on origin/main and do exactly what it says.

You then do these steps, in order, every time:

1. **Sync.** `git status` — if there are uncommitted changes, STOP and report them (do not stash, reset or delete). Then `git fetch origin` and `git checkout main` and `git pull origin main`.
2. **Pick the card.** For each card in section 3, in order AG-01, AG-02, …: run `git ls-remote --heads origin <branch>` with that card's branch name. The FIRST card whose branch does NOT exist on origin is your card. If every card's branch exists, reply "ALL CARDS DONE — waiting for Claude's check" and stop.
3. **Branch.** `git checkout -b <branch>` from the fresh main.
4. **Build** exactly the card's steps, touching only its allowed files.
5. **Self-check** (section 2) — every item must pass. If a test fails, fix your code, never the test's expectations (unless the card says the test is new).
6. **Commit** with message `<card id>: <title>` (one or more commits; finish with a clean `git status`).
7. **Push** the branch: `git push -u origin <branch>`. NEVER push to main. NEVER merge anything.
8. **Pull request.** If the `gh` command exists, run `gh pr create --base main --head <branch> --title "<card id>: <title>" --body-file docs/drive/pr-bodies/<card id>.md` (write that body file in the commit: what was built, files, real test output, limits). If `gh` does not exist, put the compare link `https://github.com/prashanthrangineni-sketch/quietkeep-/compare/main...<branch>` in your final message.
9. **Report** in this exact shape, then STOP (one card per conversation):
   - Card, branch, commit ids
   - `git diff --stat origin/main...HEAD` (real output)
   - Every command run in the self-check with its real last lines
   - What is NOT done or uncertain

## 1. Hard rules (breaking any = stop and report, do not work around)

1. Only the card's **allowed files** may change. `git diff --name-only origin/main...HEAD` must list nothing else.
2. **Never edit** (any card): `src/lib/sos.js`, `src/lib/action-levels.js`, `src/lib/aaria-*.js`, `src/lib/context/aaria.jsx`, `src/components/VoiceTalkback.jsx`, `src/lib/drive-voice.js`, `src/lib/drive-energy.js`, `src/lib/obd/elm327.js` (its read-only allow-list is a safety rule), any existing file under `supabase/migrations/`, `android/app/src/main/AndroidManifest.xml`, any `IndicatorEar`/`VoiceService`/`MicGuard`/`SOSPlugin` Java file, `.github/`.
3. **No** new npm packages, paid APIs, AI/LLM calls, API keys or secrets in code, new network calls to new hosts, camera use, or microphone use (microphone belongs to the voice thread's `drive-energy.js`).
4. **Never** write a test result you did not run. **Never** delete, skip, weaken or `.only` an existing test. New tests: plain node scripts in `tests/*.test.mjs`, print `N passed, M failed`, `process.exit(1)` on any failure (copy the style of `tests/indicator-assist.test.mjs`).
5. **Never** apply a database migration. A new migration is a new file only; Claude applies it after the founder merges.
6. **Safety wording:** the app never claims to see traffic. Never say "clear", "safe to overtake", "you can overtake". Never auto-call, auto-message or auto-SOS from new code — new detectors only report (`onState`) and speak gentle advice.
7. **minSdk 23:** in Java use `android.util.Base64` (never `java.util.Base64`), guard API-level calls with `Build.VERSION.SDK_INT`, no `java.time` without an `SDK_INT >= 26` guard.
8. **Spoken lines** exist in English, Hindi and Telugu (short, natural), like `src/lib/indicator-assist.js`.
9. Do **not** stop to ask questions mid-card. If something is genuinely impossible under these rules, finish what is possible, commit, push, and say exactly what is blocked in the report.

## 2. Self-check (all must pass before commit)

On this Windows PC `bash` may not find `node`. Run each test directly:

```
Get-ChildItem tests\*.test.mjs | ForEach-Object { node $_.FullName; if ($LASTEXITCODE -ne 0) { "FAILED: $($_.Name)" } }
node scripts/check-bridge-js.mjs
node scripts/check-bridge-wake.mjs
python scripts/schema-sweep.py
git diff --name-only origin/main...HEAD
```

- Every test file passes (zero "FAILED:" lines).
- The two bridge checks and the schema sweep pass.
- The changed-file list is a subset of the card's allowed files.
- `git status` is clean after the commit.
- (Android cards) the Java compiles in your editor without red errors; CI builds the APK.

---

## 3. The cards (do them in this order)

### AG-01 — Overtaking advisor v1 (DRV-12a, no map provider yet)
**Branch:** `ag/AG-01-overtake-advisor`
**Allowed files:** create `src/lib/overtake-advisor.js`, `tests/overtake-advisor.test.mjs`, `docs/overtake-advisor-v1.md`, `docs/drive/pr-bodies/AG-01.md`; edit `src/lib/ride-guard.js` (wire-in only, step 4).
**Why:** founder, 18 Oct — basic overtaking help that non-ADAS cars lack, without a camera.
1. `src/lib/overtake-advisor.js`, pure (injectable clock), exporting `CONSTANTS`:
   - `createRoadAheadProvider({ spots })` — the ONLY data source in v1: our own hazard spots (shape `{ id, lat, lng, kind, severity, reports }`, kinds `hard_brake`/`pothole`/`swerve`, same as `src/lib/hazard-alerts.js`). Method `ahead(position {lat,lng,headingDeg}, metres)` returns spots within `metres` and within ±30° of heading, nearest first, with distance. Design it as an interface so a Mappls provider can be added later (document the shape: curves, junctions, bridges, no-overtaking zones).
   - `trackCurvature(fixes)` — from the last 20 s of GPS fixes `{lat,lng,headingDeg,at}`, degrees of heading change per 100 m; `inBend` if ≥ 15°/100 m.
   - `adviseOvertake({ position, speedKmh, provider, fixes, now })` → `{ advice: 'avoid'|'caution'|'no_known_hazard', reasons[], phraseKey }`:
     - `avoid` if in a bend, or a hazard (any kind, severity ≥ 2 or reports ≥ 3) within 300 m ahead, or speed < 15 km/h (no overtaking in crawling traffic), or it is night (23:00–05:00) AND a hazard within 500 m.
     - `caution` if any hazard within 300–600 m ahead, or night.
     - otherwise `no_known_hazard`.
   - Phrases (en/hi/te), never saying "clear": avoid → "Don't overtake here. {reason}." (reasons: "You are in a bend", "Riders brake hard just ahead", "Rough road just ahead", "Traffic is too slow"); caution → "Be careful. Something is reported about {n} metres ahead. Check your mirrors and oncoming traffic."; no_known_hazard → "Nothing is reported for the next {n} metres. Check your mirrors and oncoming traffic before you overtake."
   - `createOvertakeWatcher({ clock })` — unprompted warning ONLY for `avoid` because of a bend or a hazard, at speed ≥ 40 km/h, at most once per 3 minutes, never within 2 minutes of other speech, at most 6 per hour.
2. Tests: each advice branch and reason, the bend maths (straight track 0°, 90° over 200 m = in bend), heading filter (a hazard behind is ignored), night logic with an injected clock, every rate limit, and that no phrase in any language contains "clear", "safe", "you can overtake" (regex check over all phrases).
3. `docs/overtake-advisor-v1.md`: what it knows (own hazard map + own GPS track) and cannot know (no camera, no traffic, no road map until a Mappls provider), every threshold and why, a NOTE for the Intent Layer thread: voice intent `OVERTAKE_CHECK` ("can I overtake?", te/hi/en) should call `adviseOvertake` — do NOT edit routing.
4. `ride-guard.js`: keep the last 20 s of fixes; on each speed/heading update, ask the watcher; if it returns a phrase and no overlay is shown, speak it, set `lastSpokeAt`, `onState?.('overtake', {...})`. Reuse the spots the guard already fetches for hazard warnings. Change nothing else.

### AG-02 — Hybrid and two-wheeler profiles on the simulated car (DRV-07a)
**Branch:** `ag/AG-02-vehicle-profiles`
**Allowed files:** edit `src/lib/obd/pids.js`, `src/lib/obd/simulator.js`, `src/lib/obd/reader.js`, `tests/obd.test.mjs` (add tests only), `docs/obd-v1.md`; create `src/lib/obd/profiles.js`, `tests/obd-profiles.test.mjs`, `docs/drive/pr-bodies/AG-02.md`.
1. Add standard **mode 01** decoders (read-only, already allowed): `5B` hybrid battery pack remaining life (A×100/255 %), `51` fuel type (table per SAE J1979: 1 petrol, 4 diesel, 8 electric, 0x11 hybrid petrol, …), `46` ambient air temp (A−40 °C), `5C` engine oil temp (A−40 °C), `11` throttle position (A×100/255 %), `2F` already exists.
2. `src/lib/obd/profiles.js`: profiles `petrol_car`, `diesel_car`, `honda_hybrid` (City e:HEV style: engine off at low speed is NORMAL — rpm 0 while moving must not be reported as a fault), `toyota_hybrid` (same rule), `bs6_two_wheeler` (fewer PIDs supported; small battery 12–13.5 V normal). `detectProfile(supportedPids, fuelType)` and `summaryFor(profile, snapshot, faults)` — hybrid summary includes "Hybrid battery at N percent"; two-wheeler summary keeps it short.
3. `simulator.js`: an option `profile` that makes the simulated vehicle behave like each profile (supported-PID bitmaps, fuel type, hybrid battery %, engine-off-while-moving for hybrids, two-wheeler voltages).
4. `reader.js`: `readSnapshot()` also returns the new values when supported; `summary()` delegates to `summaryFor` when a profile is detected. Keep every existing behaviour and test passing.
5. Tests: decoders with known bytes, profile detection for all five, the hybrid "engine off while moving is normal" rule, two-wheeler summary, full simulated session per profile.
6. Do NOT touch `elm327.js`. Every new request must already pass its allow-list (mode 01 two-hex-digit PIDs do).

### AG-03 — Anomaly watcher v1, report-only (architecture step 8)
**Branch:** `ag/AG-03-anomaly-watcher`
**Allowed files:** create `src/lib/anomaly-watch.js`, `tests/anomaly-watch.test.mjs`, `docs/anomaly-watch-v1.md`, `docs/drive/pr-bodies/AG-03.md`; edit `src/lib/ride-guard.js` (wire-in only).
**Report-only:** it never calls, messages, alerts family or starts SOS. It only raises `onState('anomaly', { kind, level, reasons })` and keeps a short in-memory list. Actions come later, after founder decisions and road proof.
1. Pure scorers (injectable clock), each returning `{ level: 'none'|'watch'|'high', reasons[] }`:
   - `routeDeviation({ destination, fixes })` — when a destination is known (optional input), distance from the straight-line corridor grows for 3 minutes while moving away from the destination → watch; 6 minutes → high.
   - `phoneSnatch({ motion, speedKmh })` — a sharp jerk (> 2.5 g for < 300 ms) while NOT in a vehicle (speed < 8 km/h), followed by running-pace speed 8–20 km/h within 20 s → watch (never high in v1).
   - `longUnexpectedStop({ fixes, now })` — stopped > 10 minutes in a place with no previous visit, during a ride, at night (23:00–05:00) → watch.
2. Tests: three scripted scenarios per scorer that should fire, and a normal 30-minute commute (stops at signals, a tea stop, a U-turn) that must produce **no** watch/high (false-alarm guard). Night logic with an injected clock.
3. `docs/anomaly-watch-v1.md`: each rule, threshold and why; what it cannot know; that it is report-only until the founder decides actions.
4. `ride-guard.js`: feed the scorers from data the guard already has; `onState?.('anomaly', ...)` only. Nothing spoken in v1.

### AG-04 — Phase-2 proof kit (the founder's field-test screen)
**Branch:** `ag/AG-04-proof-kit`
**Allowed files:** create `src/app/drive/proof/page.jsx`, `src/lib/proof-kit.js`, `tests/proof-kit.test.mjs`, `supabase/migrations/20261020_drive_proof_runs.sql`, `docs/drive/proof-kit.md`, `docs/drive/pr-bodies/AG-04.md`.
**Why:** when the Amazon parcel arrives, the founder runs each field test from one screen and the evidence is saved, so Claude can verify it instead of trusting a description.
1. `src/lib/proof-kit.js`: the checklist as data, in this order — (1) reader genuine (Vgate updater recognised it: yes/no + note); (2) desk test: tilt in test mode → a black-box record appears and is sealed (read `list()` from `src/lib/blackbox.js`, pass if a new sealed record exists); (3) parked car reader: connect + "Read car now" (pass if a snapshot with rpm and voltage arrived); (4) "how is my car?" by voice (manual yes/no); (5) proof ride: three firm brakes (count new `ride_road_events` rows for the user in the last 30 min ≥ 3 via the existing supabase client, read-only), staged fall check-in appeared (manual yes/no), "save last 60" produced a record with `obd_samples > 0` (read the newest record via `window.Capacitor.Plugins.QkBlackbox.readRecord({ id })`, the same way `src/lib/blackbox-sync.js` does, and parse its JSON header line); (6) speed check: run `compareSpeeds` from `src/lib/obd/blackbox-feed.js` on that record's OBD and GPS samples, pass if `maxDiffKmh ≤ 1`; (7) speed rule: while moving, ask Aaria to pay someone → she said "I'll do that when you stop" (manual yes/no); (8) indicator: turn and leave the indicator on → "Your indicator is still on" (manual yes/no, only if listening is ON).
   Pure functions to evaluate each automatic step from injected data; never invent a pass.
2. `src/app/drive/proof/page.jsx`: a plain screen listing the steps with Run / Yes / No buttons and a notes box; results saved to the new table; a "Copy summary" button.
3. Migration (file only, do not apply): `public.drive_proof_runs` (id uuid pk, owner uuid → auth.users on delete cascade, step text, result text check in ('pass','fail','skipped'), evidence jsonb, note text, created_at timestamptz default now()), RLS enabled, policies `drive_proof_runs_owner_select` / `drive_proof_runs_owner_insert` (auth.uid() = owner), no update/delete.
4. Tests: each automatic evaluator with pass/fail/missing-data inputs (missing data = fail, never pass).
5. Link to the screen from nowhere public — it is opened by URL `/drive/proof` only.

### AG-05 — Play declarations update (DRV-09b, docs only)
**Branch:** `ag/AG-05-play-declarations`
**Allowed files:** edit `docs/play-release-declarations.md`; create `docs/drive/pr-bodies/AG-05.md`.
Add, in the same style as section F / A2: the indicator listening (`IndicatorEar`, opt-in, default OFF, only short listens in Drive Mode while the app is open; sound reduced on the phone to loudness numbers, never stored or sent — so Data safety: audio NOT collected; the microphone permission justification line for Play), the car reader (Bluetooth scan with `neverForLocation`, read-only, no data leaves the phone except the optional vehicle row), and the proof-run table (user-owned test results). Do not change any other section.

---

## 4. Not in this run (do NOT start these)
- **DRV-05 hazard feed (Mappls)** and the Mappls provider for AG-01 — wait for the founder's Mappls account.
- **DRV-13 camera co-pilot** — founder decision: after the road tests.
- **DRV-10 release**, real-vehicle proofs, scooter socket — need the hardware and the founder.
- Anything in another thread's lane: voice (`aaria-*`, `drive-energy.js`, MicGuard), Intent Layer routing (`aaria-llm.js`, `drive-voice.js`, capture route).

## 5. Claude's check (Thursday 23 Oct, for every AG branch)
1. The branch's changed files ⊆ the card's allowed files; no hard-rule file touched.
2. Re-run all tests in the cloud clone; read the new code for the card's safety rules (no "clear/safe to overtake", report-only anomaly, read-only OBD, no mic/camera).
3. All GitHub checks + Vercel green; fix anything wrong on the same branch (with Claude's attribution).
4. Hand each PR to the founder in order, one at a time; after each merge, apply that card's migration (AG-04 only) and update the Drive Execution SOT doc.
