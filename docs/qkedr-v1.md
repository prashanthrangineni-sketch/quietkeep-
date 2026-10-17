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
| `audio_opt_in`    | boolean  | Whether cabin audio was opted in and captured.     |
| `audio_codec`     | string?  | `"opus"` if audio present, else `null`.            |
| `imu_samples`     | integer  | Number of IMU sample records in the binary block.  |
| `gps_samples`     | integer  | Number of GPS sample records in the binary block.  |
| `audio_bytes`     | integer  | Length of the Opus audio section, or `0`.           |

### 2. Binary Sample Blocks

#### IMU block (immediately after header newline)

Each record is 28 bytes, little-endian:

| Offset | Size | Type    | Field          |
|--------|------|---------|----------------|
| 0      | 8    | int64   | timestamp_us   |
| 8      | 4    | float32 | accel_x (m/s²) |
| 12     | 4    | float32 | accel_y (m/s²) |
| 16     | 4    | float32 | accel_z (m/s²) |
| 20     | 4    | float32 | gyro_x (rad/s) |
| 24     | 4    | float32 | gyro_y (rad/s) |
| 28     | 4    | float32 | gyro_z (rad/s) |

Total IMU block size: `imu_samples × 28` bytes.

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

### 3. Opus Audio (optional)

Present only when `audio_opt_in` is `true` and `audio_bytes > 0`. Raw Opus
frames at 16 kHz mono, 32 kbps. Exactly `audio_bytes` bytes long.

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

## Sealing

1. Compute **SHA-256** of the entire `.qkedr` file (header + binary + audio).
2. Sign the hash with an RSA-2048 key generated in the **Android Keystore**
   (StrongBox when available, software-backed otherwise).
3. Store alongside the `.qkedr` file:
   - `<name>.qkedr.sig` — raw signature bytes (Base64-encoded)
   - `<name>.qkedr.pub` — X.509-encoded public key (Base64-encoded)

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
- **Upload policy**: upload when online; retry on network reconnect.

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
