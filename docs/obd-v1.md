# QuietKeep Car Reader (OBD-II over Bluetooth) v1

**Task Card**: DRV-06  
**Status**: Built and tested against in-memory simulator (`ObdSimulator`); ready for physical BLE hardware validation upon delivery.

---

## 1. Overview & Architecture

QuietKeep Car Reader v1 adds read-only vehicle diagnostic and telemetry capability over Bluetooth Low Energy (BLE) using standard ELM327 AT protocol.

The system is split into modular layers:
- `src/lib/obd/pids.js`: Pure decoders for Mode 01 (live engine data), Mode 03 (trouble codes), and Mode 09 (VIN), with zero dependencies.
- `src/lib/obd/profiles.js`: Vehicle profile detection and profile-specific voice summaries for petrol cars, diesel cars, hybrids (Honda, Toyota), and BS-6 two-wheelers.
- `src/lib/obd/elm327.js`: Transport-agnostic ELM327 protocol engine with command serialization, prompt synchronization (`>`), adaptive timeouts, ISO-TP multi-frame reassembly, and multi-ECU header sorting (prioritizing 7E8 engine ECU).
- `src/lib/obd/simulator.js`: In-memory ELM327 car simulator providing realistic varying telemetry (idle 750–850 RPM, speed 0–60 km/h, coolant warming 40 -> 90 °C, battery voltage ~14.1 V, fuel level, engine load, configurable faults, 5 distinct failure modes, and profile options for petrol, diesel, Honda hybrid, Toyota hybrid, and BS-6 two-wheeler).
- `src/lib/obd/reader.js`: High-level application API (`readSnapshot()`, `readFaults()`, `readVin()`, `supportedPids()`, `detectProfile()`, `summary()`) and a Capacitor plugin transport adapter.
- `android/app/src/main/java/com/pranix/quietkeep/plugins/QkObdPlugin.java`: Native Android BLE GATT plugin supporting background/foreground scanning, service discovery (FFF0 / 18F0 / generic notify+write pairs), and characteristic read/write.
- `supabase/migrations/20261018_vehicles_obd.sql`: Database schema extension adding nullable telemetry columns to `public.vehicles`.

---

## 2. What Works Now (Simulator-Proven)

All items below are proven by automated tests (`tests/obd.test.mjs`, 82 passing tests; `tests/obd-profiles.test.mjs`, 67 passing tests):

1. **Mode 01 Live Data Decoding**:
   - `010C` RPM: `((A * 256 + B) / 4)` rpm (e.g. `41 0C 1A F8` -> 1726 rpm).
   - `010D` Speed: `A` km/h (e.g. `41 0D 3C` -> 60 km/h).
   - `0105` Coolant Temperature: `A - 40` °C (e.g. `41 05 7B` -> 83 °C).
   - `0104` Engine Load: `(A * 100) / 255` % (e.g. `41 04 7F` -> 49.8%).
   - `0111` Throttle Position: `(A * 100) / 255` % (e.g. `41 11 4C` -> 29.8%).
   - `012F` Fuel Tank Level: `(A * 100) / 255` % (e.g. `41 2F A0` -> 62.7%).
   - `0142` Control Module Voltage: `((A * 256 + B) / 1000)` V (e.g. `41 42 37 14` -> 14.10 V).
   - `0146` Ambient Air Temperature: `A - 40` °C (e.g. `41 46 41` -> 25 °C).
   - `0151` Fuel Type: Standard SAE J1979 mapping (1 petrol, 4 diesel, 8 electric, 0x11 hybrid petrol, etc.).
   - `015B` Hybrid Battery Pack Remaining Life: `(A * 100) / 255` % (e.g. `41 5B C8` -> 78.4%).
   - `015C` Engine Oil Temperature: `A - 40` °C (e.g. `41 5C 82` -> 90 °C).
   - `0101` Monitor Status: MIL bit 7, DTC count bits 0–6 (e.g. `41 01 82 07 65 00` -> MIL ON, count 2).
   - `0100` / `0120` / `0140`: Supported PID bitmaps decoded into supported hex arrays.

2. **Vehicle Profiles (`src/lib/obd/profiles.js`, DRV-07a / AG-02)**:
   - `petrol_car`: Standard internal combustion petrol vehicle.
   - `diesel_car`: Compression ignition engine, diesel fuel type, engine oil temperature telemetry.
   - `honda_hybrid`: City e:HEV style hybrid. Engine off at low speed / EV mode is NORMAL (0 RPM while moving is never reported as an engine stall or fault). Voice summary includes `"Hybrid battery at N percent"`.
   - `toyota_hybrid`: Hyryder / Hycross style hybrid, with the same EV mode normalcy rule and battery percentage voice summary.
   - `bs6_two_wheeler`: Minimal supported PIDs (RPM, speed, status, head temp; no fuel level 2F or load 04). Small 12–13.5 V battery is normal. Spoken summary is kept short and concise for two-wheeler riders (e.g. `"Battery 12.8 volts, no warning lights."`).
   - `detectProfile(supportedPids, fuelType, options)`: Pure detection from supported PIDs, fuel type code/name, and optional VIN/make.
   - `summaryFor(profile, snapshot, faults, lang)`: Localized profile summary with multilingual support (English, Hindi, Telugu).


2. **Mode 03 Trouble Code (DTC) Decoding**:
   - 2-byte DTC pairs decoded with correct prefix:
     - `00` -> `P` (Powertrain)
     - `01` -> `C` (Chassis)
     - `10` -> `B` (Body)
     - `11` -> `U` (Network)
   - Handles odd-length responses with item count byte and skips `00 00` padding.
   - Tested examples: `P0133`, `P0420`, `P0301`, `C0123`, `B0234`, `U0155`.

3. **Mode 09 PID 02 VIN Decoding & ISO-TP Multi-Frame Assembly**:
   - Assembles multi-line CAN frames (`7E8 10 14 ...`, `7E8 21 ...`, `7E8 22 ...`) and ELM numbered lines (`0: ...`, `1: ...`, `2: ...`).
   - Extracts clean 17-character VIN (e.g. `WVWZZZ3CZWE123456`).

4. **Command Queue & Prompt Synchronization**:
   - Commands are strictly serialized; a second command is never sent until the previous response's `>` prompt is received.
   - Adaptive timeouts: 5000 ms for `ATZ` and `0100` (which triggers CAN bus protocol negotiation), 2000 ms default for normal PIDs.

5. **Multi-ECU Header Filtering**:
   - With `ATH1` enabled, responses from primary engine ECU (`7E8`) are prioritized over transmission ECU (`7E9`) or secondary controllers.

6. **Simulator Failure Modes**:
   - Handled cleanly and safely in automated tests:
     - `'no_data'`: Sets `noData: true` without crashing.
     - `'unable_to_connect'`: Throws clear ELM connection error.
     - `'slow_replies'`: Properly triggers client-side command timeout.
     - `'dropped_prompt'`: Times out cleanly when `>` is missing.
     - `'garbage_bytes'`: Safely ignored/parsed as null without crashing.

7. **Voice Summary (`formatObdSummary`)**:
   - Healthy vehicle: `"Engine is warm at 88 degrees, battery 14.1 volts, no warning lights."`
   - Faults present: `"Check engine light is on: misfire on cylinder 1 (P0301), and catalytic converter system efficiency below threshold (P0420)."`
   - 30+ common diagnostic trouble codes mapped to plain-English descriptions (misfires P0300–P0306, catalyst P0420/P0430, fuel trim P0171/P0172, coolant P0128, sensors P0101, P0113, P0130, P0133, P0135, P0141, evap P0440/P0442/P0455, idle P0505/P0507, etc.).
   - Unrecognized codes fall back to: `"code P1234, needs a mechanic to read"`.

8. **Drive Mode Setup Overlay**:
   - "Car reader" card with live status indicator.
   - "Connect car reader" button (scans nearby BLE devices, shows picker if multiple found, or connects immediately).
   - "Read car now" button when connected: pulls snapshot + DTCs, updates summary card, and speaks aloud via `drivespeak()`.
   - Hidden developer switch (same 5-tap developer mode as DRV-01): `"Developer: Use simulated car"` switch stored in `localStorage` (`qk_obd_use_simulated`), allowing the founder or team to experience the full flow on the phone or browser today without the physical reader.

---

## 3. What Waits for the Real Reader (Field Proof)

Field verification once the Vgate iCar Pro 2S hardware arrives:
1. **Physical GATT Pairing & Range**: Verifying connection stability, RSSI levels, and reconnection time when stepping into a petrol car with the phone in pocket or dashboard mount.
2. **OEM Protocol Auto-Detection**: Field proof of `ATSP0` protocol negotiation against a physical petrol car (ISO 15765-4 CAN 11/500 vs 29-bit or older protocols).
3. **End-to-End Voice Field Proof**: Answering *"How is my car?"* while seated in the driver's seat using live telemetry from the OBD-II port.

---

## 4. Supported Readers & Hardware Scope

### Supported BLE Readers
- **Vgate iCar Pro 2S** (Bluetooth Low Energy) — Primary target hardware.
- **vLinker MC+** (Bluetooth Low Energy)
- Generic ELM327 BLE adapters with GATT services:
  - Service `FFF0` (`FFF1` notify, `FFF2` write)
  - Service `18F0` (`2AF0` notify, `2AF1` write)
  - Any standard BLE service exposing a `NOTIFY` + `WRITE` characteristic pair.

### Classic Bluetooth (SPP) Out of Scope for v1
Classic Bluetooth (SPP / RFCOMM / Bluetooth 2.0/3.0) is **intentionally out of scope** for v1:
- BLE does not require legacy OS PIN-pairing popups.
- BLE operates with significantly lower power consumption on the phone's battery.
- Android BLE GATT uses native asynchronous callbacks that do not hold open blocking socket threads.

---

## 5. The Read-Only Promise

QuietKeep provides an absolute architectural guarantee that it will **NEVER** write to, alter, or reflash any vehicle controller:

1. **Mode 04 Permanently Blocked**:
   - `04` (Clear Diagnostic Trouble Codes / reset MIL / clear freeze frames) is structurally blocked in `assertReadOnlyCommand()`. Any attempt to send Mode 04 immediately throws an error before reaching the transport.
2. **Non-Volatile Memory (NVM) AT Commands Blocked**:
   - AT commands that write to EEPROM or alter persistent adapter settings (`ATPP`, `ATSD`, `ATCS`) are structurally blocked.
3. **Restricted Modes**:
   - Only diagnostic reading modes `01` (live data), `03` (stored trouble codes), `09` (vehicle info / VIN), and harmless volatile AT query commands (`ATZ`, `ATE0`, `ATL0`, `ATS0`, `ATH1`, `ATSP0`, `ATDPN`, `ATRV`, `ATIGN`) are permitted.

---

## 6. Database Schema & RLS

Migration file: `supabase/migrations/20261018_vehicles_obd.sql`
Adds the following nullable columns to `public.vehicles`:
- `fuel_type text`
- `obd_protocol text`
- `vin text`
- `reader_name text`
- `supported_pids text`
- `last_obd_snapshot jsonb`
- `last_obd_at timestamptz`

**Row-Level Security (RLS)**:
- `public.vehicles` already has RLS enabled with `user_id = auth.uid()` ownership policies.
- No policy changes are introduced or needed.
- Note: This migration is committed but **NOT applied** to the database per the task rules (applied upon founder PR merge).

---

## 7. NOTE for the Intent Layer Owner

Regarding voice intents `READ_HEALTH` and `READ_FAULTS`:
- **Do not edit intent routing or intent handlers in this PR.**
- Once DRV-06 is merged, the Intent Layer can import `ObdReader` or query `last_obd_snapshot` / `formatObdSummary` to resolve queries such as:
  - *"How is my car?"* -> `formatObdSummary(snapshot, faults)`
  - *"Are there any engine codes?"* -> `readFaults()`
