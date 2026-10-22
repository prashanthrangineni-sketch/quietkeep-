# QuietKeep Drive — Anomaly Watcher v1 (Architecture Step 8)

**Author:** Antigravity IDE Agent  
**Date:** 22 October 2026  
**Status:** Implemented (Report-Only)

---

## 1. Overview & Report-Only Principle

The Anomaly Watcher is a core component of QuietKeep's ride-safety architecture (Step 8). Its role is to observe kinematic, temporal, and spatial trip data to detect high-risk patterns:
- **Route Deviation**: Diverging from the destination corridor.
- **Phone Snatch**: Violent grab from a pedestrian followed by running pace.
- **Long Unexpected Stop**: Protracted stationary periods in unfamiliar locations at night.

### Hard Rule: Report-Only in v1
**The Anomaly Watcher never calls, messages, alerts family or starts SOS.**

In v1, all scorers are purely diagnostic:
- They compute risk levels (`none`, `watch`, `high`) and human-readable reasons.
- They update a bounded in-memory list (latest 20 events).
- They notify the driving screen via `onState('anomaly', { kind, level, reasons })`.
- **Nothing is spoken.** No voice talkback lines, no sirens, and no automatic dispatch.

Action policies (such as family notifications or automated check-ins) will be introduced only in later phases after the founder's road testing and deliberate policy definitions.

---

## 2. Scorers, Rules & Thresholds

### 2.1 Route Deviation (`routeDeviation`)
Detects when a vehicle appears to be moving off-course away from the intended destination.

* **Inputs:** `{ destination, fixes, origin }` (where `destination` is optional `{ lat, lng }`).
* **Thresholds:**
  - Distance from straight-line corridor grows for **3 minutes** while moving away from destination $\rightarrow$ `watch`.
  - Distance from straight-line corridor grows for **6 minutes** while moving away from destination $\rightarrow$ `high`.
  - Normal travel towards destination or stationary periods $\rightarrow$ `none`.
* **Rationale:**
  - In v1, third-party map providers (Mappls turn-by-turn routing graph) are not yet integrated. The straight line between trip origin and destination serves as an invariant travel corridor.
  - Ordinary city maneuvers (such as taking an alternate street, stopping at a red light, or executing a U-turn) take under 1–2 minutes before the vehicle moves towards the destination again.
  - Sustained divergence for $\ge 3$ minutes while increasing distance to destination indicates a deliberate or forced deviation (e.g., abduction, hijacking, or severe loss of navigation).
  - 6 minutes provides confirmation of high-severity diversion.

### 2.2 Phone Snatch (`phoneSnatch`)
Detects a pedestrian grab-and-run street theft.

* **Inputs:** `{ motion, speedKmh, speedBeforeKmh, now }`
* **Thresholds:**
  - Sharp jerk: acceleration magnitude $> 2.5\text{ g}$ for a duration $< 300\text{ ms}$.
  - Speed before or during jerk: $< 8\text{ km/h}$ (pedestrian/stationary, NOT in a vehicle).
  - Followed by running pace: speed $8\text{ to }20\text{ km/h}$ within $20\text{ seconds}$ after the jerk $\rightarrow$ `watch`.
  - Level is **never `high` in v1**.
* **Rationale:**
  - Snatching a phone from a person's hand or pocket creates a brief, high-acceleration impulse (typically $2.5\text{–}5\text{ g}$ lasting $50\text{–}200\text{ ms}$).
  - A victim walking or standing is travelling at $< 8\text{ km/h}$. If the rider is already moving at vehicular speeds ($\ge 8\text{ km/h}$), road bumps, potholes, or hard braking are excluded.
  - A thief fleeing on foot runs at $8\text{–}20\text{ km/h}$. If the phone remains stationary (dropped on ground) or moves at walking speed ($< 8\text{ km/h}$), it is not a snatch.
  - If speed is $> 20\text{ km/h}$, it falls into vehicular travel.
  - Kept strictly at `watch` to prevent false alarms until proven on road testing.

### 2.3 Long Unexpected Stop (`longUnexpectedStop`)
Detects prolonged stationary periods during late-night rides in isolated or unfamiliar areas.

* **Inputs:** `{ fixes, now, knownStops }`
* **Thresholds:**
  - Vehicle stopped for $> 10\text{ minutes}$ (all fixes within $40\text{ m}$ radius, speed $\le 3\text{ km/h}$).
  - Occurring **during a ride** (prior movement $\ge 10\text{ km/h}$ or $\ge 150\text{ m}$ traveled).
  - In an **unvisited location** (no location in `knownStops` within $150\text{ m}$).
  - At **night** between **23:00 and 05:00** local time $\rightarrow$ `watch`.
* **Rationale:**
  - Late-night travel carries heightened danger (breakdowns, ambushes, accidents). A stationary vehicle for over 10 minutes at 02:00 AM on an unfamiliar road is an anomaly warranting attention.
  - Daytime stops (such as stopping 15 minutes at a tea stall or fuel station at 14:00) are normal and produce `none`.
  - Stops at familiar locations (e.g. rider's home or workplace in `knownStops`) produce `none`.
  - If the app was opened on a bedside table with no prior riding activity, it produces `none`.

---

## 3. What the Watcher Cannot Know

The Anomaly Watcher is deliberately bounded by privacy, sensor limits, and hardware safety:
1. **No Camera / Computer Vision:** It cannot visually inspect traffic, road conditions, police barricades, or see who is holding the device.
2. **No Turn-by-Turn Routing Graph (v1):** The straight-line corridor does not know if geographical barriers (rivers, flyovers, one-way loops) require an initial detour. (Mappls integration in future phases will provide routing corridors).
3. **No Microphone Use:** Microphones belong strictly to the voice thread (`IndicatorEar` and `drive-energy.js`). The anomaly watcher does not listen to ambient audio.
4. **No Intent Assumptions:** It does not know if the driver voluntarily chose an alternate route to visit a friend unless reported or configured.

---

## 4. Integration into Ride Guard

`src/lib/ride-guard.js` wires in `createAnomalyWatcher`:
- Initialized on `startRideGuard({ destination, knownStops, onState })`.
- Fed with motion magnitude $g$ inside `onMotion(event)`.
- Fed with GPS updates and vehicle speeds inside `feedSpeed(kmh, fix)`.
- Emits state updates via `onState?.('anomaly', { kind, level, reasons })`.
- Provides `guard.getAnomalies()` to inspect the in-memory ring buffer.
- Cleared and reset upon `guard.stop()`.
- **Zero spoken talkback, zero external communications.**
