# .qkedr v1 — QuietKeep Event Data Record

Version 1 · DRV-01 · October 2026

## Purpose

A sealed, driver-owned crash record stored on the phone. A rolling 60-second
buffer is frozen on impact or on the SOS phrase, signed with a key from the
Android Keystore, kept in app-private storage, and synced to Supabase when
online.

## File Layout

A `.qkedr` file is a concatenation of three sections, in order:

```
┌────────────────────────────────┐
│  JSON Header (UTF-8, newline)  │  variable length, terminated by 0x0A
├────────────────────────────────┤
│  Binary Sample Blocks          │  fixed-size records
├────────────────────────────────┤
│  Opus Audio (optional)         │  raw Opus packets, only if audio_opt_in
└────────────────────────────────┘
```

### 1. JSON Header

A single line of minified JSON, terminated by a newline (`0x0A`). Fields:

| Field             | Type     | Description                                        |
|-------------------|----------|----------------------------------------------------|
| `version`         | integer  | Always `1` for this spec.                          |
| `device_id`       | string   | `Settings.Secure.ANDROID_ID` or equivalent.        |
| `vehicle_id`      | string?  | Vehicle UUID from the app, or `null`.               |
| `trigger`         | string   | One of: `impact_g`, `speed_drop_accel`, `speed_drop_gps`, `crash_detector`, `voice_save`, `test_tilt`. |
| `started_at`      | string   | ISO 8601 UTC timestamp of the first sample.        |
| `ended_at`        | string   | ISO 8601 UTC timestamp of the last sample.         |
| `trigger_at`      | string   | ISO 8601 UTC timestamp of the trigger event.       |
| `pre_trigger_ms`  | integer  | Milliseconds of data before the trigger (≈ 45000). |
| `post_trigger_ms` | integer  | Milliseconds of data after the trigger (≈ 15000).  |
| `sample_rate_hz`  | integer  | IMU sample rate, nominally `100`.                  |
| `gps_rate_hz`     | integer  | GPS fix rate, nominally `1`.                       |
| `audio_opt_in`    | boolean  | Whether the driver opted in to cabin audio.        |
| `audio_status`    | string   | `off`, or `opted_in_not_captured_v1` (see below).  |
| `audio_codec`     | string?  | Always `null` in v1 (no audio is captured yet).    |
| `imu_clock_offset_us` | integer | Add to an IMU timestamp to get wall-clock µs.   |
| `last_fix`        | object?  | `{lat, lon, accuracy_m, speed_kmh}` of the newest GPS fix, or `null`. |
| `imu_samples`     | integer  | Number of IMU sample records in the binary block.  |
| `gps_samples`     | integer  | Number of GPS sample records in the binary block.  |
| `audio_bytes`     | integer  | Length of the audio section. Always `0` in v1.      |

### 2. Binary Sample Blocks

#### IMU block (immediately after header newline)

Each record is 32 bytes, little-endian:

| Offset | Size | Type    | Field          |
|--------|------|---------|----------------|
| 0      | 8    | int64   | timestamp_us   |
| 8      | 4    | float32 | accel_x (m/s²) |
| 12     | 4    | float32 | accel_y (m/s²) |
| 16     | 4    | float32 | accel_z (m/s²) |
| 20     | 4    | float32 | gyro_x (rad/s) |
| 24     | 4    | float32 | gyro_y (rad/s) |
| 28     | 4    | float32 | gyro_z (rad/s) |

Total IMU block size: `imu_samples × 32` bytes (8-byte timestamp + six 4-byte floats).

IMU `timestamp_us` is the sensor clock (time since boot). GPS `timestamp_us` is
wall-clock UTC. To put both on one timeline: `wall_us = imu_us + imu_clock_offset_us`.

#### GPS block (immediately after IMU block)

Each record is 40 bytes, little-endian:

| Offset | Size | Type    | Field                     |
|--------|------|---------|---------------------------|
| 0      | 8    | int64   | timestamp_us              |
| 8      | 8    | float64 | latitude (degrees)        |
| 16     | 8    | float64 | longitude (degrees)       |
| 24     | 4    | float32 | altitude (metres)         |
| 28     | 4    | float32 | speed (m/s)               |
| 32     | 4    | float32 | bearing (degrees)         |
| 36     | 4    | float32 | accuracy (metres)         |

Total GPS block size: `gps_samples × 40` bytes.

### 3. Audio section — RESERVED, NOT IMPLEMENTED IN v1

v1 captures **no audio**, even when the driver opts in. The opt-in choice is
stored and written to the header (`audio_status: "opted_in_not_captured_v1"`)
so the setting is ready, but there is no microphone ring buffer yet and
`audio_bytes` is always `0`. A later card adds a 60-second Opus ring
(planned: 16 kHz mono, ~32 kbps) and fills this section; until then no codec
is claimed in the header.

## Trigger Conditions

A freeze is initiated when **any** of these fire:

| ID                  | Condition                                                                 |
|---------------------|---------------------------------------------------------------------------|
| `impact_g`          | Resultant linear acceleration ≥ 3.5 g.                                  |
| `speed_drop_accel`  | Speed drop ≥ 15 km/h (4.17 m/s) within 200 ms, computed by integrating the 100 Hz linear accelerometer over a sliding window. |
| `speed_drop_gps`    | Speed drop ≥ 15 km/h between two consecutive 1 Hz GPS fixes.           |
| `crash_detector`    | The existing crash/fall detector in Drive Mode fires.                   |
| `voice_save`        | The voice intent `SAVE_LAST_60S` is received.                           |
| `test_tilt`         | TEST MODE only: phone tilted past 60° from vertical, held for 3 s, at 0 km/h. |

### Freeze Window

On trigger:
- **Keep**: the most recent 45 seconds of buffered data (pre-trigger).
- **Continue**: record 15 more seconds of post-trigger data.
- **Close**: assemble the packet and seal it.

Total packet duration: 60 seconds.

How this is achieved: the ring buffer holds exactly 60 s and keeps recording
after the trigger. The 15 s written after the trigger overwrite the oldest 15 s,
so when the packet closes the ring holds 45 s before + 15 s after. New triggers
are ignored until the packet closes. If Drive Mode stops inside the 15 s
window, the packet is closed immediately with what was recorded.

## Sealing

1. Compute **SHA-256** of the entire `.qkedr` file (header + binary + audio).
2. Sign the hash with an RSA-2048 key generated in the **Android Keystore**
   (StrongBox when available, software-backed otherwise).
3. Store alongside the `.qkedr` file:
   - `<name>.qkedr.sig` — raw signature bytes (Base64-encoded)
   - `<name>.qkedr.pub` — X.509-encoded public key (Base64-encoded)
4. If the Keystore refuses (rare, old or broken devices), the record is still
   kept — a crash record beats none — but it is **flagged** `sealed: false` in
   the freeze result, in `list()`, in the UI ("NOT sealed") and in the
   `blackbox_events.sealed` column, and `verify()` returns `valid: false`.

### Verification

```
verify(packet_bytes, signature, public_key) → boolean
```

Re-hash the packet bytes with SHA-256, then verify the signature against the
public key using `SHA256withRSA`. A packet with even one changed byte must
produce a different hash and fail verification.

## Storage

- **On-device**: app-private storage (`Context.getFilesDir()/blackbox/`).
- **Supabase table**: `blackbox_events` (see migration).
- **Supabase bucket**: `blackbox-records` (private, owner-only).
- **Upload policy**: upload when online; retry on network reconnect
  (`src/lib/blackbox-sync.js`, started by Drive Mode). File path in the bucket:
  `<user id>/<record id>.qkedr`. An already-uploaded file or an existing row
  counts as done, so retries converge. Synced ids are remembered on the phone.
- **Supabase row** also carries `public_key` and `sealed`, so a record can be
  verified off the phone.

## Intent Layer — NOTE for the Intent Layer owner

The following intents are used by this card and should be added to the intent
routing when the Intent Layer is updated. **Do NOT edit the brain prompt or
intent routing as part of DRV-01.**

| Intent           | Description                                        |
|------------------|----------------------------------------------------|
| `SAVE_LAST_60S`  | Freeze the current 60-second buffer and seal it.  |
| `SHARE_RECORD`   | Share a sealed record (not wired yet — later card).|

## Audio Opt-In

Audio is **never** captured unless:
1. The user explicitly turned on the opt-in toggle in Drive Mode setup.
2. The Android `RECORD_AUDIO` permission is granted at runtime.

The toggle text is exactly:
> "Include the last 60 seconds of cabin audio if a crash happens? Never saved
> or uploaded unless an impact is detected."

Default: **OFF**.
