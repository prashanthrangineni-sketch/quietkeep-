## Summary

Implements **AG-D1: One-tap ride (DRV-14)**.
Wired the Drive Mode page directly to the ride session lifecycle and the ride guard crash/speed detector so riders never have to tap a separate "Driving -> Start ride" screen.

### What Was Built
1. **`src/lib/ride-session.js`**:
   - `openRideSession({ db, userId, clock, guard })`:
     - Pure and injectable.
     - Automatically expires and ends any open sessions (`ended_at` is null) for the user started > 12 hours ago (`ended_at = now`, `duration_seconds = null`).
     - Reuses any open row started within 12 hours.
     - Otherwise inserts a fresh row.
     - Strictly writes only real columns: `user_id`, `started_at`, `ended_at`, `duration_seconds`.
     - Returns `{ id, startedAt, ok }` and never throws.
   - `closeRideSession({ db, id, clock, startedAt, guard })`:
     - Updates `ended_at = now` and calculates `duration_seconds` from `startedAt`.
     - Returns `{ ok, error }` and never throws.
2. **`src/app/drive/page.jsx`**:
   - Drive Mode entry effect: calls `openRideSession({ db: supabase, userId: user.id })` and starts `startRideGuard({ getAccessToken, onState })`.
   - `getAccessToken`: reads session token at call time via `tokenRef` (mirroring `src/app/driving/page.jsx`).
   - `watchPosition` callback: passes speed and position to `feedRideSpeed(kmh, { lat, lng, accuracy, headingDeg })` (heading null when not a number).
   - Exit cleanup & `pagehide`: calls `stopRideGuard()` and `closeRideSession(...)`.
3. **`tests/ride-session.test.mjs`**:
   - 42 unit test assertions covering session creation, session reuse within 12 hours, expiration of stale sessions older than 12 hours, closing with duration calculations, failure recovery without throwing, and database column verification.

### Safety & Column Conformance
- Only valid `driving_sessions` table columns (`user_id`, `started_at`, `ended_at`, `duration_seconds`) are ever referenced or written. No phantom columns (`distance_km`, `start_lat`, etc.).
- Never crashes or throws on network or PostgREST failures.
- No modifications made outside allowed files.

### Changed Files
- `src/lib/ride-session.js` (created)
- `tests/ride-session.test.mjs` (created)
- `docs/drive/pr-bodies/AG-D1.md` (created)
- `src/app/drive/page.jsx` (Drive Mode start/stop effect and GPS watch integration only)

### Real Test Output
```
42 passed, 0 failed
```
All existing tests across the repository and bridge verification scripts pass with zero failures.
