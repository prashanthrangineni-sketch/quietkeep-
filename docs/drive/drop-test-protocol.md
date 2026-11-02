# QuietKeep Drive — Drop and Fall Test Protocol (DRV-16 / AG-D3)

**Document Owner:** QuietKeep Drive Thread  
**Task Card:** AG-D3 (DRV-16)  
**Verification Target:** Founder Office Field Verification  
**Screen URL:** `/drive/proof` (unlisted, internal verification)

---

## 1. Purpose and Philosophy

QuietKeep's rider fall and crash detector (`src/lib/crash-detect.js`) uses a triple-condition architecture to avoid false emergency alerts:
1. **Context:** The vehicle was travelling at speed shortly before the event.
2. **Impact:** A high-g shock event (`≥ 3.2g`, with optional free-fall dip `< 0.35g`).
3. **Aftermath:** The phone and vehicle remain unnaturally still for at least 8 seconds (`stillnessG ≤ 0.22`, speed `≤ 6 km/h`).

Because physical testing from a moving two-wheeler would be dangerous and risk phone destruction, **staged verification occurs at a standstill**. The evaluation engine (`src/lib/drop-test.js`) runs `createCrashDetector` on the physical 15-second motion trace with a **simulated riding speed of 25 km/h before the impact and 0 km/h after**.

This allows rigorous verification of detector sensitivity, freefall detection, and stillness aftermath evaluation without endangering riders or hardware.

---

## 2. Safety Imperatives (Strict Rules)

> [!CAUTION]
> **SAFETY FIRST:** Never conduct drop tests while riding or from a moving vehicle.

1. **Stationary Staging Only:** All drop and fall trials must be conducted with the tester standing or sitting still in a safe staging area.
2. **Soft Surfaces Only:** Drops must land on a thick cushion, sofa cushion, gym foam mat, mattress, or thick carpet. Never drop phones onto bare concrete, asphalt, or sharp stone edges.
3. **Drill Only:** The test screen runs in drill/verification mode. It **never** calls emergency contacts, **never** sends SMS alerts, and **never** initiates SOS procedures.
4. **Protective Case:** Test phones should be fitted with a standard silicone or TPU bumper case to represent typical real-world rider carry conditions.

---

## 3. The 5 Trial Types (20 Trials per Type per Phone Model)

To prove reliability before release, each test phone model undergoes **100 total trials** (20 trials for each of the 5 categories):

| Trial Type | Identifier | Action | Target Acceleration | Expected Verdict |
| :--- | :--- | :--- | :--- | :--- |
| **Cushion Drop (1m)** | `cushion_drop_1m` | Drop phone from 1 m height onto a cushion | Freefall (< 0.35g) + Impact (≥ 3.2g) + 8s stillness | **DETECTED** (`true`) |
| **Pocket Fall** | `pocket_fall` | Phone slides out of trouser or jacket pocket to floor while stationary | Impact (≥ 3.2g) + 8s stillness | **DETECTED** (`true`) |
| **Bag Drop** | `bag_drop` | Backpack or sling bag containing phone dropped from waist height (~0.8m) | Impact (≥ 3.2g) + 8s stillness | **DETECTED** (`true`) |
| **Mount Knock** | `mount_knock` | Firm tap, bump, or knock on the bike phone mount or handlebars | Peak 3.0–4.5g, but motion/vibration continues | **NOT DETECTED** (`false`) |
| **Normal Handling** | `normal_handling` | Picking up phone, rotating, pocketing, gesturing | Gentle motion (peak < 2.0g) | **NOT DETECTED** (`false`) |

---

## 4. Step-by-Step Test Execution

1. Open `/drive/proof` in the browser or Capacitor webview on the test device.
2. Sign in with the founder/tester account.
3. Scroll down to the **Drop and Fall Test** section.
4. Select the desired trial type button (e.g. `Cushion drop (1m)`).
5. Prepare the physical setup:
   - For **Cushion Drop**: Hold the phone flat or vertical at 1 meter height above the cushion.
   - For **Pocket Fall**: Place phone in pocket, stand over the cushioned landing surface, and let it slip out.
   - For **Bag Drop**: Place phone inside bag, hold bag at waist level, and let go.
   - For **Mount Knock**: Mount phone in handlebar cradle and rap the mount firmly with knuckles.
   - For **Normal Handling**: Hold phone and perform everyday interactions (scrolling, rotating, picking up).
6. Tap **"▶ Start 15s Trial"**.
7. Perform the drop or action within the first **1 to 3 seconds**.
8. **Leave the phone completely untouched and still for the remaining 10 to 12 seconds**. Stillness aftermath requires 8 full seconds of undisturbed rest (`|g - 1| ≤ 0.22`).
9. When the 15-second timer completes, the screen automatically:
   - Evaluates the recorded accelerometer trace with `runDropTest(trace)`.
   - Compares the detection outcome against expectation with `evaluateTrialResult(type, evalResult)`.
   - Displays the verdict badge (✓ PASS or ✕ FAIL), peak G force, and detection latency (`msToDetect`).
   - Appends the result to `public.drive_proof_runs` with `step = 'drop_test:<type>'` and evidence JSON.
   - Updates the live running tallies on screen.

---

## 5. What Counts as Pass

### Per-Trial Evaluation
- **For `cushion_drop_1m`, `pocket_fall`, `bag_drop`**:
  - **PASS:** The detector emitted `'crash'` (`detected === true`) with `peakG ≥ 3.2g` and verified stillness (`msToDetect ≥ 8000 ms`).
  - **FAIL:** The detector failed to reach `'crash'` (`detected === false`), or `peakG < 3.2g`, or stillness was interrupted.
- **For `mount_knock`, `normal_handling`**:
  - **PASS:** The detector did **not** emit `'crash'` (`detected === false`).
  - **FAIL (False Alarm):** The detector incorrectly emitted `'crash'` (`detected === true`).
- **Missing Data Rule:**
  - If 0 motion samples were recorded (e.g. sensor permission denied, API failure), the trial is **strictly a FAIL**, even for non-detection types. **Missing data is NEVER a pass.**

### Aggregate Benchmark (Per Phone Model over 20 Trials)
- **Staged Falls Caught Rate:** **≥ 90%** (at least 18 out of 20 caught for cushion drop, pocket fall, and bag drop).
- **False Alarm Rate:** **0%** (0 false alarms out of 20 for mount knock and normal handling).
- Any phone model failing to meet these thresholds requires calibration of `impactG` or `stillnessG` before production release.

---

## 6. Data Storage & Downstream Stats

Each trial writes directly to the immutable verification table:
```sql
insert into public.drive_proof_runs (owner, step, result, evidence, note)
values (
  auth.uid(),
  'drop_test:cushion_drop_1m',
  'pass',
  '{"detected": true, "peakG": 4.62, "msToDetect": 8120, "phone_model": "Pixel 8", "sampleCount": 750}',
  'Field trial: 1m cushion drop'
);
```

Downstream systems (specifically **AG-D4 / DRV-17 False Alarm Page**) query rows where `step like 'drop_test:%'` to calculate device-specific catch rates and false alarm rates per 1,000 riding hours.
