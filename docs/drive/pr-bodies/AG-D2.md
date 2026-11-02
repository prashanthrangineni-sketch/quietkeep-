## Summary

Implements **AG-D2: Ride recorder for labelled clips (DRV-15)**.
Records rolling sensor motion clips around candidate ride events (suspected crashes, crashes, and periodic normal driving samples) for offline review, false-alarm analysis, and driver labeling.

### What Was Built

1. **`src/lib/ride-clips.js`**:
   - `createClipRecorder({ clock, random, windowMs = 10000, rateHz = 50, maxClips = 30, enabled })`:
     - Keeps a rolling buffer of `{ at, g, kmh }` sensor samples.
     - `onCandidate(kind, detail)`: Freezes the 10 s window around an event (5 s before, 5 s after) into a clip `{ kind: 'suspected'|'crash'|'normal_sample', samples, startedAt, outcome: 'pending' }`.
     - Automatically schedules one `normal_sample` clip at a random time per 10 riding minutes (riding speed >= 10 km/h; standstill does not advance timer).
     - Strict 30-clip cap per ride.
     - `setOutcome(id, 'cancelled_ok'|'sent'|'drill')`: Validates and updates candidate outcome.
     - `label(id, 'bump'|'fall'|'nothing')`: Validates and updates driver label.
   - Persistence helpers: `loadLastRideClips`, `saveLastRideClips`, `labelLastRideClip`.
   - Strict privacy: absolutely no location coordinates (`lat`, `lng`, `lon`, `accuracy`, `heading`) are stored in samples or clips.

2. **`supabase/migrations/20261102_ride_sensor_clips.sql`**:
   - Migration file only (never applied prior to merge).
   - Table `public.ride_sensor_clips`:
     - `id uuid primary key default gen_random_uuid()`
     - `owner uuid not null references auth.users(id) on delete cascade`
     - `session_id uuid null`
     - `kind text not null check (kind in ('suspected','crash','normal_sample'))`
     - `outcome text not null default 'pending'`
     - `label text null check (label is null or label in ('bump','fall','nothing'))`
     - `samples jsonb not null default '[]'::jsonb`
     - `phone_model text null`
     - `started_at timestamptz not null default now()`
     - `created_at timestamptz not null default now()`
   - RLS enabled:
     - `ride_sensor_clips_owner_select`
     - `ride_sensor_clips_owner_insert`
     - `ride_sensor_clips_owner_update` (label and outcome only)
     - No delete policy.

3. **`src/app/drive/page.jsx`**:
   - Setup overlay opt-in switch (default OFF): "Help improve crash detection — keep short motion clips from my rides (no audio, no video)" stored in `localStorage.getItem('qk_ride_clips_opt_in')`.
   - "Label last ride" card: renders when unlabelled clips exist from the previous ride, displaying time, kind, peak g, and three buttons: Bump / Fall / Nothing. Updates local storage and Supabase if authenticated.

4. **`src/lib/ride-guard.js`**:
   - Wire-in only: feeds recorder from existing `onMotion` acceleration and `feedSpeed`.
   - Hands detector state changes to recorder (`suspected`, `crash`).
   - Links rider actions to clip outcome (`cancelled_ok` on cancel, `drill` on test, `sent` on alert).
   - Unchanged thresholds and unchanged SOS logic.

5. **`tests/ride-clips.test.mjs`**:
   - Comprehensive unit test suite covering buffer window maths, 5s+5s freeze, normal-sample rate (1 per 10 riding minutes), 30-clip cap, opt-out behavior, label/outcome validation, coordinate stripping, and 10 simulated candidate events saved and labelled.

### Changed Files
- `src/lib/ride-clips.js` (created)
- `tests/ride-clips.test.mjs` (created)
- `supabase/migrations/20261102_ride_sensor_clips.sql` (created)
- `docs/drive/pr-bodies/AG-D2.md` (created)
- `src/app/drive/page.jsx` (modified)
- `src/lib/ride-guard.js` (modified)

### Test Output
```
PASS  CONSTANTS.WINDOW_MS is 10000 (10 seconds)
PASS  CONSTANTS.PRE_EVENT_MS is 5000 (5 seconds)
PASS  CONSTANTS.POST_EVENT_MS is 5000 (5 seconds)
PASS  CONSTANTS.MAX_CLIPS_PER_RIDE is 30
PASS  CONSTANTS.NORMAL_SAMPLE_INTERVAL_MS is 600000 (10 riding minutes)
PASS  ALLOWED_KINDS contains suspected, crash, normal_sample
PASS  ALLOWED_OUTCOMES contains pending, cancelled_ok, sent, drill
PASS  ALLOWED_LABELS contains bump, fall, nothing
PASS  candidate clip created
PASS  clip.kind is suspected
PASS  clip.outcome is pending
PASS  clip.label is null
PASS  clip.startedAt is 5s before event
PASS  clip is not yet completed at now + 10000
PASS  clip is completed once t reaches eventAt + 5000
PASS  earliest sample in clip is eventAt - 5000
PASS  latest sample in clip is eventAt + 5000
PASS  total span of clip samples is 10,000 ms
PASS  clip freezes immediately when window is in buffer
PASS  clip sample count matches window
PASS  no normal sample fired before 5 minutes
PASS  1st normal sample fired at 5 riding minutes
PASS  1st normal sample has kind normal_sample
PASS  stopped at signal does not trigger normal samples
PASS  2nd normal sample fired after 10 additional riding minutes
PASS  2nd normal sample has kind normal_sample
PASS  3rd normal sample fired at 25 riding minutes
...
PASS  total clips is strictly capped at 30
PASS  onCandidate returns null when opted out
PASS  getClips() returns empty array when opted out
PASS  buffer remains empty when opted out
PASS  default outcome is pending
PASS  setOutcome cancelled_ok updates clip
PASS  setOutcome sent updates clip
PASS  setOutcome drill updates clip
PASS  invalid outcome throws Error
PASS  default label is null
PASS  label bump updates clip
PASS  label fall updates clip
PASS  label nothing updates clip
PASS  invalid label throws Error
PASS  invalid candidate kind throws Error
PASS  buffer has 1 sample
PASS  sample has NO lat property
PASS  sample has NO lng property
PASS  sample has NO lon property
PASS  sample has NO accuracy property
PASS  sample has NO heading property
PASS  sample has NO coords property
PASS  clip sample has NO lat
PASS  clip sample has NO lng
PASS  clip sample has NO lon
PASS  clip sample has NO accuracy
PASS  clip sample has NO heading
PASS  exactly 10 candidate events recorded
PASS  initially all 10 clips are unlabelled
PASS  after labeling, 0 clips remain unlabelled
PASS  clip #1..#10 kind, label, outcome, captured samples, peakG verified
PASS  loaded clips count matches saved count
PASS  labelLastRideClip updates label to bump
PASS  persisted clip has updated label

159 passed, 0 failed
```
All existing and new test suites pass cleanly.
