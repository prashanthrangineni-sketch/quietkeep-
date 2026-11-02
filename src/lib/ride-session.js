// src/lib/ride-session.js
// Pure ride session manager for driving_sessions table.
// Ensures exactly one active session row per ride.
//
// Columns allowed in driving_sessions (PostgREST rejects phantom columns):
//   user_id, started_at, ended_at, duration_seconds

const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;

function getNow(clock) {
  try {
    if (typeof clock === 'function') {
      const val = clock();
      if (typeof val === 'number' || typeof val === 'string' || val instanceof Date) {
        const d = new Date(val);
        if (!isNaN(d.getTime())) return d;
      }
    } else if (clock) {
      if (typeof clock === 'number' || typeof clock === 'string' || clock instanceof Date) {
        const d = new Date(clock);
        if (!isNaN(d.getTime())) return d;
      }
    }
  } catch {}
  return new Date();
}

/**
 * Opens a ride session for a user.
 * 1. Ends any open sessions (ended_at null) started > 12 h ago (ended_at = now, duration_seconds = null).
 * 2. Reuses an open session started within 12 h.
 * 3. Otherwise inserts a new session row.
 * Returns { id, startedAt, ok }. Never throws.
 */
export async function openRideSession({ db, userId, clock, guard } = {}) {
  if (!db || !userId) {
    return { id: null, ok: false, error: 'Missing db or userId' };
  }

  try {
    const now = getNow(clock);
    const nowMs = now.getTime();
    const nowIso = now.toISOString();
    const staleThresholdIso = new Date(nowMs - TWELVE_HOURS_MS).toISOString();

    // 1. End any stale sessions older than 12 hours
    const { error: endStaleErr } = await db
      .from('driving_sessions')
      .update({
        ended_at: nowIso,
        duration_seconds: null,
      })
      .eq('user_id', userId)
      .is('ended_at', null)
      .lt('started_at', staleThresholdIso);

    if (endStaleErr) {
      return { id: null, ok: false, error: endStaleErr.message || String(endStaleErr) };
    }

    // 2. Reuse an open row started within 12 h
    const { data: openRows, error: findErr } = await db
      .from('driving_sessions')
      .select('id, started_at')
      .eq('user_id', userId)
      .is('ended_at', null)
      .gte('started_at', staleThresholdIso)
      .order('started_at', { ascending: false })
      .limit(1);

    if (findErr) {
      return { id: null, ok: false, error: findErr.message || String(findErr) };
    }

    const openRow = Array.isArray(openRows) ? openRows[0] : openRows;
    if (openRow && openRow.id) {
      return {
        id: openRow.id,
        startedAt: openRow.started_at,
        ok: true,
      };
    }

    // 3. Else insert a new row
    const { data: inserted, error: insertErr } = await db
      .from('driving_sessions')
      .insert({
        user_id: userId,
        started_at: nowIso,
      })
      .select('id, started_at')
      .single();

    if (insertErr) {
      return { id: null, ok: false, error: insertErr.message || String(insertErr) };
    }

    const newRow = Array.isArray(inserted) ? inserted[0] : inserted;
    return {
      id: newRow?.id || null,
      startedAt: newRow?.started_at || nowIso,
      ok: true,
    };
  } catch (err) {
    return { id: null, ok: false, error: err?.message || String(err) };
  }
}

/**
 * Closes a ride session.
 * Sets ended_at and duration_seconds.
 * Returns { ok, error }. Never throws.
 */
export async function closeRideSession({ db, id, clock, startedAt, guard } = {}) {
  if (!db || !id) {
    return { ok: false, error: 'Missing db or id' };
  }

  try {
    const now = getNow(clock);
    const nowMs = now.getTime();
    const nowIso = now.toISOString();

    let duration_seconds = null;
    if (startedAt != null) {
      const startMs = typeof startedAt === 'number'
        ? startedAt
        : (startedAt instanceof Date ? startedAt.getTime() : new Date(startedAt).getTime());
      if (Number.isFinite(startMs)) {
        duration_seconds = Math.max(0, Math.floor((nowMs - startMs) / 1000));
      }
    }

    const { error: updateErr } = await db
      .from('driving_sessions')
      .update({
        ended_at: nowIso,
        duration_seconds,
      })
      .eq('id', id);

    if (updateErr) {
      return { ok: false, error: updateErr.message || String(updateErr) };
    }

    return { ok: true, error: null };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
}
