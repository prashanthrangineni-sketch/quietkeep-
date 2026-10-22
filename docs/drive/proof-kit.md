# Drive Phase-2 Proof Kit (AG-04)

**Owner:** Drive thread ("Honda and Maruti research").  
**Audience:** Founder (field executor) and Claude (post-run verifier).  
**Screen URL:** `/drive/proof` (unlisted route; not linked from any public screen or navigation).

---

## 1. Why this exists

When the hardware parcel (OBD reader, e.g. Vgate iCar Pro 2S BLE) arrives, the founder runs the field tests from a single dedicated screen (`/drive/proof`). Every result, timestamp, and piece of sensor evidence is persisted to `public.drive_proof_runs` in Supabase.

This ensures Claude can independently inspect and verify real hardware evidence from the database and git commit history instead of relying on subjective descriptions.

---

## 2. The Field Checklist

The checklist steps must be performed and recorded in this exact order:

| Step | ID | Type | Description | Success Criterion |
|---|---|---|---|---|
| **1** | `reader_genuine` | Manual | Vgate updater recognised it | Yes/No + note (firmware version recognized by manufacturer app). |
| **2** | `desk_test_tilt` | Auto | Desk test: tilt in test mode | Tilt device > 45° in test mode → a new sealed black-box record appears in `listBlackboxRecords()`. |
| **3** | `parked_car_reader` | Auto | Parked car reader connection | Connect + "Read car now" → snapshot containing valid numeric `rpm` and `voltage` arrives. |
| **4** | `voice_car_status` | Manual | "How is my car?" by voice | Speak "How is my car?" to Aaria; confirm she speaks car summary accurately. |
| **5a** | `proof_ride_brakes` | Auto | Proof ride: three firm brakes | Query `ride_road_events` for the user in the last 30 minutes; count must be ≥ 3. |
| **5b** | `proof_ride_fall_checkin` | Manual | Proof ride: staged fall check-in | Verify the staged fall/crash check-in dialog appeared on screen. |
| **5c** | `proof_ride_save60` | Auto | Proof ride: "save last 60" with OBD | Calling `saveLast60s` produced a record whose JSON header has `obd_samples > 0`. |
| **6** | `speed_check` | Auto | Speed check: OBD vs GPS | Run `compareSpeeds` on the record's OBD and GPS samples; `maxDiffKmh ≤ 1` km/h. |
| **7** | `speed_rule` | Manual | Speed rule: action deferral while moving | While moving, ask Aaria to pay someone; verify she defers: "I'll do that when you stop". |
| **8** | `indicator_reminder` | Manual | Indicator reminder | Turn and leave indicator on; verify spoken reminder "Your indicator is still on" (listening ON). |

---

## 3. Pure Evaluation Rules

Every automatic step is governed by a pure evaluator function in `src/lib/proof-kit.js`:

1. **`evalDeskTest({ records, baselineIds })`**:
   - Compares current records from `listBlackboxRecords()` against baseline.
   - Requires at least one new record with `sealed: true` (or non-empty signature).
   - Fails with `missing_data` if no records provided; never invents a pass.

2. **`evalParkedCarSnapshot(snapshot)`**:
   - Validates that `snapshot.rpm` and `snapshot.voltage` are finite numbers.
   - Fails if either is missing or non-numeric.

3. **`evalFirmBrakes({ events, count, minCount = 3, nowMs, windowMs = 30 min })`**:
   - Filters events created within the 30-minute window with `kind === 'hard_brake'`.
   - Requires count ≥ 3.

4. **`evalSave60Record(recordOrHeader)`**:
   - Parses the first-line JSON header of the `.qkedr` record (via base64 or raw bytes).
   - Validates `header.obd_samples > 0`. Fails if 0 or missing.

5. **`evalSpeedCheck({ obdSamples, gpsSamples, record, maxDiffAllowed = 1 })`**:
   - Unpacks binary GPS (40-byte LE) and OBD (32-byte LE) sample arrays from the packet.
   - Runs `compareSpeeds` from `src/lib/obd/blackbox-feed.js`.
   - Requires matched pairs (within 500 ms) and `maxDiffKmh ≤ 1`.

---

## 4. Evidence Persistence & Database Schema

Evidence is stored in `public.drive_proof_runs`:

```sql
create table if not exists public.drive_proof_runs (
  id            uuid primary key default gen_random_uuid(),
  owner         uuid not null references auth.users(id) on delete cascade,
  step          text not null,
  result        text not null check (result in ('pass', 'fail', 'skipped')),
  evidence      jsonb default '{}'::jsonb,
  note          text default '',
  created_at    timestamptz not null default now()
);
```

- **Row Level Security (RLS)** is enabled.
- Owner can select and insert their own rows (`auth.uid() = owner`).
- No update or delete policies: proof runs are append-only.
- **Migration rule:** File `supabase/migrations/20261020_drive_proof_runs.sql` is committed, but NOT applied to production until merged by the founder.

---

## 5. Screen Operation & Export

- The screen at `/drive/proof` provides **Run**, **Pass / Yes**, **Fail / No**, and **Skip** buttons for each step, along with a notes input.
- **Copy Summary**: Generates a standard formatted report with all evidence and notes, copying to the device clipboard so it can be pasted into Claude's review thread.
