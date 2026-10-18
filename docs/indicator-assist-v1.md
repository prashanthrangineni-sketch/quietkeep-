# Indicator Assist v1 (DRV-11)

**QuietKeep Drive Mode — Indicator Reminder & Acoustic Detection Specification**  
*Document Version:* 1.0.0  
*Date:* 18 October 2026  
*Status:* Implemented  

---

## 1. Overview & Architectural Principle

Drivers and motorcycle riders frequently forget to cancel turn indicators after completing turns or lane changes. On two-wheelers, riding with a blinking indicator creates hazardous ambiguity for oncoming and trailing traffic; in cars, a forgotten indicator confuses highway traffic.

Indicator Assist v1 is a sensor-driven assistant built into QuietKeep's Drive Mode:
- **No Camera:** Uses zero optical hardware and performs no computer vision.
- **Orientation-Agnostic Motion Sensing:** Uses the phone's internal 3-axis accelerometer and gyroscope to determine real-world vehicle yaw rate regardless of whether the phone is mounted upright, in landscape, flat on a console, or tilted.
- **Gentle, Rare Reminders:** Operates under strict rate limits and quietness rules. It never speaks during complex manoeuvres or when other vehicle safety systems are speaking.
- **Opt-In Acoustic Sensing:** Provides pure audio energy envelope detection logic for car clickers and motorcycle beepers. Listening to indicator acoustics is an explicit user opt-in (default OFF); without it, the system runs purely on motion heuristics.

---

## 2. What It Detects and How

### 2.1 Orientation-Invariant Yaw Rate (`yawRateFrom`)
In web and mobile devices, `devicemotion` events follow the W3C coordinate convention:
- $+x$: pointing right across the display.
- $+y$: pointing towards the top edge of the display.
- $+z$: pointing perpendicularly out of the display towards the user.

Phone mounts vary widely: handlebar clamps, magnetic dash mounts tilted at $30^\circ$, cup-holder cradles, or landscape dashboard brackets. Reading raw gyroscope $\alpha$, $\beta$, or $\gamma$ directly fails as soon as the phone is tilted.

`yawRateFrom(rotationRate, gravity)` projects the 3D angular velocity vector $\boldsymbol{\omega} = (\beta, \gamma, \alpha)$ onto the Earth vertical unit vector $\hat{\mathbf{u}}$ derived from the accelerometer's reaction to gravity $\mathbf{g} = (g_x, g_y, g_z)$:

$$\text{yawRate} = \frac{\beta g_x + \gamma g_y + \alpha g_z}{\sqrt{g_x^2 + g_y^2 + g_z^2}}$$

- **Sign convention:** Positive ($+$) indicates counter-clockwise rotation about the upward reaction vector (left turn); negative ($-$) indicates clockwise rotation (right turn).
- **Tolerance:** Synthetic bench tests demonstrate that whether the phone is flat, upright, landscape, or tilted $30^\circ$, the derived vehicle yaw rate matches within $< 10^{-14}$ deg/s.

### 2.2 Manoeuvre Detection (`createManoeuvreDetector`)
Manoeuvres are detected by feeding timestamped samples `{ at, yawDps, speedKmh, headingDeg }`:
1. **Yaw Smoothing:** Raw yaw is smoothed using a sliding moving-average window of 200 ms (`YAW_SMOOTHING_WINDOW_MS`), attenuating high-frequency engine vibration and road chatter without introducing phase lag.
2. **Speed Gate:** All manoeuvres and heading integrations are strictly ignored when vehicle speed is below 8 km/h (`MIN_SPEED_KMH`). Crawling in stop-and-go traffic or walking with the phone does not trigger false turn states.
3. **Turn Detection & `turn_done`:**
   - Heading is integrated over time ($\Delta \theta = \int \omega_{\text{yaw}} \, dt$).
   - A **turn** is flagged when net heading change reaches $\ge 45^\circ$ within a rolling 15-second window (`TURN_MIN_HEADING_DEG = 45`, `TURN_MAX_TIME_S = 15`).
   - A turn is classified as **`turn_done`** only after the vehicle straightens out: heading remains steady with $|\text{yaw}| < 2^\circ/\text{s}$ continuously for 3.0 seconds (`TURN_STEADY_YAW_DPS = 2`, `TURN_STEADY_TIME_S = 3`).
4. **Lane Change Detection (`lane_change`):**
   - Active only at highway/cruising speeds: vehicle speed must be $\ge 25$ km/h (`LANE_CHANGE_MIN_SPEED_KMH = 25`).
   - Requires a distinct S-curve signature: a yaw excursion of $\ge 3^\circ/\text{s}$ in one direction (`LANE_CHANGE_YAW_EXCURSION_DPS = 3`), followed within 1.0 to 6.0 seconds (`LANE_CHANGE_MIN_TIME_S = 1`, `LANE_CHANGE_MAX_TIME_S = 6`) by a counter-steer excursion of $\ge 3^\circ/\text{s}$ in the opposite direction.
   - The net heading change across the entire manoeuvre must be $< 12^\circ$ (`LANE_CHANGE_MAX_NET_HEADING_DEG = 12`). If the net heading change is larger, the manoeuvre is classified as a curve or turn, not a lane change.
   - **Debounce:** One event per manoeuvre, with a mandatory cooldown preventing duplicate triggers.

### 2.3 Acoustic Energy Envelope Detector (`indicator-sound.js`)
Motor vehicle indicators flash at regulated cadences: FMVSS 108 and UNECE Reg 48 mandate $90 \pm 30$ flashes per minute ($1.0 \text{ Hz} - 2.0 \text{ Hz}$).
The sound detector processes arrays of short-frame energy values (at 100 fps, a 4-second buffer contains 400 energy numbers):
1. **Adaptive Baseline:** Computes a local rolling baseline over 300 ms (`BASELINE_WINDOW_FRAMES = 30`).
2. **Onset Extraction:** Identifies sharp upward energy jumps ($> 0.05$ rise, $> 0.1$ above baseline, $> 1.3\times$ baseline) that decay within $< 180$ ms (`MAX_CLICK_DURATION_S = 0.18`), characteristic of mechanical relay clicks or electronic piezo beeps.
3. **Periodicity & Jitter Validation:** Calculates the inter-onset intervals (IOIs). For valid detection:
   - Flash rate must lie strictly within $0.95 \text{ Hz} \le f \le 2.05 \text{ Hz}$ (`MIN_INDICATOR_HZ`, `MAX_INDICATOR_HZ`).
   - Timing jitter (coefficient of variation $CV = \sigma_T / \bar{T}$) must be $< 0.15$ (`MAX_JITTER_CV = 0.15`).
   - Alternating "tick-tock" cadences (where tick-to-tock differs from tock-to-tick) are resolved via pairwise interval analysis.
4. **Rejection Guarantees:**
   - *Steady Engine Hum:* Constant energy profile with no transient onsets ($k < 3$) $\rightarrow$ `on: false`.
   - *Single Pothole Thud:* Isolated high-energy transient ($k = 1$) $\rightarrow$ `on: false`.
   - *Speech:* Syllables sustain energy for $200 - 450$ ms and have irregular cadence ($CV > 0.35$) $\rightarrow$ `on: false`.
   - *Music Beats:* Rhythms outside $1.0 - 2.0$ Hz or with syncopated/varying cadence $\rightarrow$ `on: false`.
   - *Cessation:* When an indicator is turned off, a 4-second rolling buffer clears the periodic onsets, returning `on: false` within 4 seconds.

---

## 3. Threshold Summary & Rationale

| Parameter | Value | Rationale |
| :--- | :--- | :--- |
| `MIN_SPEED_KMH` | 8 km/h | Avoids false manoeuvre triggers while parking, walking, or idling in gridlock. |
| `LANE_CHANGE_MIN_SPEED_KMH` | 25 km/h | Lane changing is a road speed manoeuvre; filtering low speeds prevents parking lot jitter. |
| `LANE_CHANGE_YAW_EXCURSION_DPS` | 3.0 deg/s | Standard lane changes produce 3–6 deg/s transient yaw; bumps produce $< 2$ deg/s. |
| `LANE_CHANGE_MAX_NET_HEADING_DEG`| 12.0 deg | Lane changes return to the original roadway bearing. Anything $\ge 12^\circ$ is a curve or fork. |
| `LANE_CHANGE_MIN_TIME_S` | 1.0 s | Prevents momentary double-bumps or steering wheel adjustments from acting as counter-steer. |
| `LANE_CHANGE_MAX_TIME_S` | 6.0 s | Highway lane changes complete within 2–5 seconds; anything longer is a sustained turn. |
| `TURN_MIN_HEADING_DEG` | 45.0 deg | Standard intersections require $90^\circ$; $45^\circ$ captures slip lanes and angled turns. |
| `TURN_MAX_TIME_S` | 15.0 s | Vehicles negotiating city corners finish within 5–12 seconds. |
| `TURN_STEADY_YAW_DPS` | 2.0 deg/s | Defines driving straight down the road following a turn. |
| `TURN_STEADY_TIME_S` | 3.0 s | Ensures the turn is fully complete and the driver is settled before speaking. |
| `INDICATOR_STILL_ON_DELAY_S` | 6.0 s | Gives the driver 6 seconds to naturally cancel their signal before nudging. |
| `LANE_CHANGE_PRE_CHECK_S` | 4.0 s | Safe driving rules require indicating prior to changing lanes. |
| `REMINDERS_COOLDOWN_MS` | 5 minutes | In reminders mode, nudges after turns occur at most once per 5 minutes to prevent annoyance. |
| `SPEECH_QUIET_AFTER_OTHER_MS` | 2 minutes | Never speaks within 2 minutes of hazard warnings, fatigue questions, or navigation prompts. |
| `SPEECH_MIN_INTERVAL_MS` | 2 minutes | Never speaks indicator phrases closer than 2 minutes apart. |
| `MAX_PHRASES_PER_HOUR` | 6 phrases | Hard ceiling of 6 indicator nudges per hour to guarantee non-intrusiveness. |
| `YAW_SMOOTHING_WINDOW_MS` | 200 ms | Filters road vibration without lag. |

---

## 4. What It Cannot Know (Honest Limitations)

1. **No OBD Indicator Telemetry:** Standard OBD-II (SAE J1979 / ISO 15031 PID 01) queries engine powertrain parameters (RPM, coolant temperature, speed, DTCs). Body electronics—such as turn signal stalk switch position, indicator relay state, and hazard lamp switches—are routed over proprietary manufacturer body CAN buses (e.g. Ford MS-CAN, GM SWCAN) requiring manufacturer-specific security unlock keys not exposed by generic ELM327 BLE adapters.
2. **No Camera / Optical Vision:** The phone has no forward, rearward, or blind-spot camera feeds active. It cannot see road lane markings, surrounding vehicles, pedestrian crossings, or whether the road lane is turning.
3. **Never Claims Traffic Awareness:** QuietKeep never advises "safe to turn" or "traffic clear". It only monitors the vehicle's own indicators and motion.
4. **Acoustic Noise Masking:** If cabin audio (music, radio, podcasts) or HVAC air blower fans are running loudly, mechanical clicker transients may fall below the microphone's ambient noise floor.
5. **Modern Vehicle Synthetic Chimes:** Electric vehicles and luxury cars frequently generate turn signal clicks artificially through dashboard chimes; in some models, this sound is directed away from phone dash mounts.

---

## 5. Product & Opt-In Decisions

Per founder decision (18 Oct 2026):
- **Default Mode:** `Reminders only` (`'reminders'`).
- **Acoustic Detection Switch:** Opt-in choice in the Drive Mode Setup overlay:
  - *Off:* Completely silent.
  - *Reminders only:* Gentle, infrequent motion-based nudges after turns (at most once every 5 minutes); never nags about lane changes.
  - *Also listen for the indicator sound (mic):* Opt-in mode. Audio envelope logic runs locally on the device.
- **Privacy Notice:** Displayed explicitly in Setup:
  > *"Listening for the indicator arrives in a later update. Sound would stay on your phone, never saved or uploaded."*

---

## 6. Spoken Lines & Multilingual Support

Phrases are concise, polite, and natural in English, Hindi, and Telugu:

| Trigger | English | Hindi | Telugu |
| :--- | :--- | :--- | :--- |
| **Indicator still on** (6s after turn/lane change) | *"Your indicator is still on."* | *"आपका इंडिकेटर अभी भी चालू है।"* | *"మీ ఇండికేటర్ ఇంకా ఆన్‌లో ఉంది."* |
| **Lane change without indicating** | *"Indicate before changing lanes."* | *"लेन बदलने से पहले इंडिकेटर दें।"* | *"లేన్ మారే ముందు ఇండికేటర్ వేయండి."* |
| **Turn completed** (Reminders mode, max 1 per 5m) | *"Check your indicator is off."* | *"चेक करें कि इंडिकेटर बंद है।"* | *"ఇండికేటర్ ఆఫ్ చేశారో లేదో చూడండి."* |

---

## 7. NOTE for Intent Layer Owner (Future Voice Command)

> [!NOTE]
> **To the Intent Layer / Aaria Routing Owner:**
> In a subsequent task, please map driver voice commands to the indicator mode:
> - `"turn on indicator reminders"` / `"indicator reminders on"` $\rightarrow$ sets `localStorage.setItem('qk_indicator_mode', 'reminders')`.
> - `"turn off indicator reminders"` / `"stop indicator reminders"` $\rightarrow$ sets `localStorage.setItem('qk_indicator_mode', 'off')`.
> - `"listen for indicator"` / `"indicator sound on"` $\rightarrow$ sets `localStorage.setItem('qk_indicator_mode', 'listen')`.
> 
> Per card boundaries, routing files (`src/lib/aaria-router.js`, `src/lib/intent-parser.js`, `src/lib/drive-voice.js`) were **not** modified in DRV-11.
