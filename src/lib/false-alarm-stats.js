// src/lib/false-alarm-stats.js
// TASK CARD AG-D4: False-alarm page (DRV-17)
// Pure logic and read-only Supabase queries for ride safety false-alarm stats.
//
// Computes per phone model and totals:
// - Riding hours (from driving_sessions durations, open sessions ignored)
// - False alarms per 1,000 riding hours (10-hour floor: "not enough riding yet" when < 10h)
// - Check-ins cancelled (from clips with outcome 'cancelled_ok')
// - Staged falls caught / total (from drive_proof_runs drop_test:* steps)
// - Date range covered
//
// Special pairing rule for AG-D4:
// Crash and suspected clips come in pairs for one event (the detector emits 'suspected' then 'crash');
// count an ALARM only from clips of kind 'crash' (or manual 'suspected' clips whose outcome is set), never both.

export const CONSTANTS = {
  MIN_RIDING_HOURS_FOR_RATE: 10,
  NOT_ENOUGH_RIDING_MSG: 'not enough riding yet',
  RATE_PER_HOURS: 1000,
  PAIR_WINDOW_MS: 30000, // 30s window to pair suspected and crash clips
};

export const STAGED_FALL_TYPES = [
  'cushion_drop_1m',
  'pocket_fall',
  'bag_drop',
  'fall',
];

/**
 * Extracts a timestamp in epoch ms from various possible field names on a row.
 * @param {object} row
 * @returns {number|null}
 */
export function getRowTimestamp(row) {
  if (!row || typeof row !== 'object') return null;
  const val = row.started_at || row.startedAt || row.created_at || row.createdAt || row.ended_at || row.endedAt;
  if (!val) return null;
  if (typeof val === 'number' && !isNaN(val)) return val;
  const d = new Date(val);
  const ms = d.getTime();
  return isNaN(ms) ? null : ms;
}

/**
 * Extracts phone model from a row, evidence JSONB, or options.
 * @param {object} row
 * @returns {string|null}
 */
export function getRowPhoneModel(row) {
  if (!row || typeof row !== 'object') return null;
  if (typeof row.phone_model === 'string' && row.phone_model.trim()) {
    return row.phone_model.trim();
  }
  if (typeof row.phoneModel === 'string' && row.phoneModel.trim()) {
    return row.phoneModel.trim();
  }
  if (row.evidence && typeof row.evidence === 'object') {
    if (typeof row.evidence.phone_model === 'string' && row.evidence.phone_model.trim()) {
      return row.evidence.phone_model.trim();
    }
    if (typeof row.evidence.phoneModel === 'string' && row.evidence.phoneModel.trim()) {
      return row.evidence.phoneModel.trim();
    }
  }
  return null;
}

/**
 * Formats a Date object or timestamp as DD MMM YYYY.
 * @param {Date|number|string} date
 * @returns {string}
 */
export function formatDate(date) {
  if (!date) return '';
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return '';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const day = d.getUTCDate();
  const month = months[d.getUTCMonth()];
  const year = d.getUTCFullYear();
  return `${day} ${month} ${year}`;
}

/**
 * Filters and deduplicates alarm clips according to the AG-D4 pairing rule:
 * - Kind 'crash' clips are always alarms.
 * - Kind 'suspected' clips count as an alarm only when their outcome/label is set,
 *   AND they are not paired with a 'crash' clip for the same event.
 * - Kind 'normal_sample' is never an alarm.
 *
 * @param {Array<object>} clips
 * @returns {Array<object>} Deduplicated alarm clips
 */
export function deduplicateAlarmClips(clips) {
  if (!Array.isArray(clips) || clips.length === 0) return [];

  const crashClips = [];
  const candidateSuspected = [];

  for (const c of clips) {
    if (!c || typeof c !== 'object') continue;
    if (c.kind === 'crash') {
      crashClips.push(c);
    } else if (c.kind === 'suspected') {
      const outcomeSet = (typeof c.outcome === 'string' && c.outcome !== 'pending') ||
                         (c.label !== null && c.label !== undefined);
      if (outcomeSet) {
        candidateSuspected.push(c);
      }
    }
  }

  // Crash clips are always counted
  const alarms = [...crashClips];

  // For each candidate suspected clip, check if it's paired with any crash clip
  for (const s of candidateSuspected) {
    const sTime = getRowTimestamp(s);
    const sSession = s.session_id || s.sessionId || null;

    let isPaired = false;
    for (const c of crashClips) {
      const cTime = getRowTimestamp(c);
      const cSession = c.session_id || c.sessionId || null;

      // Paired by session_id + close timestamp
      if (sSession && cSession && sSession === cSession) {
        if (sTime !== null && cTime !== null) {
          if (Math.abs(sTime - cTime) <= CONSTANTS.PAIR_WINDOW_MS) {
            isPaired = true;
            break;
          }
        } else {
          // Both in same session without distinct timestamps
          isPaired = true;
          break;
        }
      } else if (sTime !== null && cTime !== null) {
        // Paired by close timestamp across all events
        if (Math.abs(sTime - cTime) <= CONSTANTS.PAIR_WINDOW_MS) {
          isPaired = true;
          break;
        }
      }
    }

    if (!isPaired) {
      alarms.push(s);
    }
  }

  return alarms;
}

/**
 * Checks whether an alarm clip represents a false alarm.
 * Spec: outcome 'cancelled_ok' or label 'bump' / 'nothing' = false alarm.
 * @param {object} clip
 * @returns {boolean}
 */
export function isClipFalseAlarm(clip) {
  if (!clip || typeof clip !== 'object') return false;
  if (clip.outcome === 'cancelled_ok') return true;
  if (clip.label === 'bump' || clip.label === 'nothing') return true;
  return false;
}

/**
 * Checks whether an alarm clip represents a true event.
 * Spec: label 'fall' or outcome 'sent' without cancel = true event.
 * @param {object} clip
 * @returns {boolean}
 */
export function isClipTrueEvent(clip) {
  if (!clip || typeof clip !== 'object') return false;
  if (clip.label === 'fall') return true;
  if (clip.outcome === 'sent' && clip.outcome !== 'cancelled_ok' && clip.label !== 'bump' && clip.label !== 'nothing') {
    return true;
  }
  return false;
}

/**
 * Checks whether an alarm clip is a cancelled check-in.
 * @param {object} clip
 * @returns {boolean}
 */
export function isCheckInCancelled(clip) {
  if (!clip || typeof clip !== 'object') return false;
  return clip.outcome === 'cancelled_ok';
}

/**
 * Evaluates whether a drop-test proof run is a staged fall and whether it was caught.
 * @param {object} run
 * @returns {{ isStagedFall: boolean, caught: boolean }}
 */
export function evalProofRunDropTest(run) {
  if (!run || typeof run.step !== 'string' || !run.step.startsWith('drop_test:')) {
    return { isStagedFall: false, caught: false };
  }

  const typeKey = run.step.slice('drop_test:'.length);
  const evidence = run.evidence || {};

  // Determine if it is a staged fall trial
  const isStagedFall = STAGED_FALL_TYPES.includes(typeKey) ||
    evidence.expected === true ||
    (typeKey !== 'mount_knock' && typeKey !== 'normal_handling' && !typeKey.includes('knock') && !typeKey.includes('handling'));

  let caught = false;
  if (isStagedFall) {
    if (evidence.detected === true || run.detected === true) {
      caught = true;
    } else if (run.result === 'pass' && evidence.expected !== false) {
      caught = true;
    }
  }

  return { isStagedFall, caught };
}

/**
 * Pure statistical calculator for false alarms and ride safety performance.
 *
 * @param {object} data
 * @param {Array<object>} [data.drivingSessions]
 * @param {Array<object>} [data.blackboxEvents]
 * @param {Array<object>} [data.rideSensorClips]
 * @param {Array<object>} [data.driveProofRuns]
 * @returns {object} Calculated stats per phone model, totals, and date range
 */
export function computeFalseAlarmStats(data = {}) {
  const sessions = Array.isArray(data?.drivingSessions || data?.driving_sessions || data?.sessions)
    ? (data.drivingSessions || data.driving_sessions || data.sessions)
    : [];
  const blackbox = Array.isArray(data?.blackboxEvents || data?.blackbox_events || data?.blackbox)
    ? (data.blackboxEvents || data.blackbox_events || data.blackbox)
    : [];
  const clips = Array.isArray(data?.rideSensorClips || data?.ride_sensor_clips || data?.clips)
    ? (data.rideSensorClips || data.ride_sensor_clips || data.clips)
    : [];
  const proofRuns = Array.isArray(data?.driveProofRuns || data?.drive_proof_runs || data?.proofRuns)
    ? (data.driveProofRuns || data.drive_proof_runs || data.proofRuns)
    : [];

  // 1. Collect all timestamps to find the date range covered
  let minTime = null;
  let maxTime = null;

  function registerTime(t) {
    if (typeof t === 'number' && !isNaN(t)) {
      if (minTime === null || t < minTime) minTime = t;
      if (maxTime === null || t > maxTime) maxTime = t;
    }
  }

  // 2. Build map of session_id -> phone_model from clips, and collect known phone models
  const sessionPhoneMap = new Map();
  const knownPhoneModels = new Set();

  for (const c of clips) {
    const t = getRowTimestamp(c);
    registerTime(t);
    const m = getRowPhoneModel(c);
    if (m) knownPhoneModels.add(m);
    const sid = c.session_id || c.sessionId;
    if (sid && m) {
      sessionPhoneMap.set(sid, m);
    }
  }

  for (const b of blackbox) {
    registerTime(getRowTimestamp(b));
    const m = getRowPhoneModel(b);
    if (m) knownPhoneModels.add(m);
  }

  for (const p of proofRuns) {
    registerTime(getRowTimestamp(p));
    const m = getRowPhoneModel(p);
    if (m) knownPhoneModels.add(m);
  }

  for (const s of sessions) {
    registerTime(getRowTimestamp(s));
    const m = getRowPhoneModel(s);
    if (m) knownPhoneModels.add(m);
  }

  // If there is exactly one known phone model across all data, unmapped items map to it
  const singlePhoneModel = knownPhoneModels.size === 1 ? Array.from(knownPhoneModels)[0] : null;

  function resolveModel(row, fallbackSessionId = null) {
    const explicit = getRowPhoneModel(row);
    if (explicit) return explicit;
    if (fallbackSessionId && sessionPhoneMap.has(fallbackSessionId)) {
      return sessionPhoneMap.get(fallbackSessionId);
    }
    if (singlePhoneModel) return singlePhoneModel;
    return 'unknown';
  }

  // Helper to initialize accumulator per phone model
  function createModelAccumulator(modelName) {
    return {
      phoneModel: modelName,
      ridingSeconds: 0,
      falseAlarms: 0,
      trueEvents: 0,
      checkInsCancelled: 0,
      stagedFallsCaught: 0,
      stagedFallsTotal: 0,
    };
  }

  const modelMap = new Map();

  function getModelAcc(modelName) {
    const key = modelName || 'unknown';
    if (!modelMap.has(key)) {
      modelMap.set(key, createModelAccumulator(key));
    }
    return modelMap.get(key);
  }

  // Ensure any known phone models are registered in modelMap even if zero stats
  for (const m of knownPhoneModels) {
    getModelAcc(m);
  }

  // 3. Process driving_sessions: riding hours = sum of durations, open sessions ignored
  for (const s of sessions) {
    if (!s || typeof s !== 'object') continue;
    // Open sessions: ended_at is null or duration_seconds is null/undefined
    const isEnded = s.ended_at !== null && s.ended_at !== undefined && s.endedAt !== null;
    const dur = typeof s.duration_seconds === 'number' ? s.duration_seconds
              : typeof s.durationSeconds === 'number' ? s.durationSeconds
              : null;

    if (!isEnded || dur === null || dur <= 0) {
      continue; // Open or invalid session ignored
    }

    const modelName = resolveModel(s, s.id);
    const acc = getModelAcc(modelName);
    acc.ridingSeconds += dur;
  }

  // 4. Process ride_sensor_clips (deduplicated alarms)
  const alarmClips = deduplicateAlarmClips(clips);

  for (const clip of alarmClips) {
    const modelName = resolveModel(clip, clip.session_id || clip.sessionId);
    const acc = getModelAcc(modelName);

    if (isClipFalseAlarm(clip)) {
      acc.falseAlarms++;
    } else if (isClipTrueEvent(clip)) {
      acc.trueEvents++;
    }

    if (isCheckInCancelled(clip)) {
      acc.checkInsCancelled++;
    }
  }

  // 5. Process blackbox_events (confirmed vs not)
  for (const b of blackbox) {
    if (!b || typeof b !== 'object') continue;
    const modelName = resolveModel(b);
    const acc = getModelAcc(modelName);

    // confirmed === false indicates road jolt / calibration false trigger
    if (b.confirmed === false) {
      acc.falseAlarms++;
    } else if (b.confirmed === true || b.confirmed === undefined) {
      // confirmed crash record
      acc.trueEvents++;
    }
  }

  // 6. Process drive_proof_runs (staged falls caught / total)
  for (const p of proofRuns) {
    if (!p || typeof p !== 'object') continue;
    const { isStagedFall, caught } = evalProofRunDropTest(p);
    if (!isStagedFall) continue;

    const modelName = resolveModel(p);
    const acc = getModelAcc(modelName);

    acc.stagedFallsTotal++;
    if (caught) {
      acc.stagedFallsCaught++;
    }
  }

  // 7. Calculate rates, formatting, and Totals
  const totals = {
    phoneModel: 'Totals',
    ridingSeconds: 0,
    ridingHours: 0,
    ridingHoursDisplay: '0.0 hrs',
    falseAlarms: 0,
    trueEvents: 0,
    checkInsCancelled: 0,
    stagedFallsCaught: 0,
    stagedFallsTotal: 0,
    stagedFallsDisplay: '0 / 0',
    falseAlarmsPer1000Hours: null,
    rateDisplay: CONSTANTS.NOT_ENOUGH_RIDING_MSG,
    hasEnoughRiding: false,
  };

  const byModel = [];

  // Sort model keys alphabetically, keeping 'unknown' last if present
  const sortedKeys = Array.from(modelMap.keys()).sort((a, b) => {
    if (a === 'unknown') return 1;
    if (b === 'unknown') return -1;
    return a.localeCompare(b);
  });

  for (const key of sortedKeys) {
    const acc = modelMap.get(key);
    const ridingHours = acc.ridingSeconds / 3600;
    const roundedHours = Math.round(ridingHours * 10) / 10;
    const hasEnough = ridingHours >= CONSTANTS.MIN_RIDING_HOURS_FOR_RATE;

    let rate = null;
    let rateDisplay = CONSTANTS.NOT_ENOUGH_RIDING_MSG;

    if (hasEnough) {
      rate = Math.round(((acc.falseAlarms / ridingHours) * CONSTANTS.RATE_PER_HOURS) * 10) / 10;
      rateDisplay = String(rate);
    }

    const item = {
      phoneModel: acc.phoneModel,
      ridingSeconds: acc.ridingSeconds,
      ridingHours: roundedHours,
      ridingHoursDisplay: `${roundedHours.toFixed(1)} hrs`,
      falseAlarms: acc.falseAlarms,
      trueEvents: acc.trueEvents,
      checkInsCancelled: acc.checkInsCancelled,
      stagedFallsCaught: acc.stagedFallsCaught,
      stagedFallsTotal: acc.stagedFallsTotal,
      stagedFallsDisplay: `${acc.stagedFallsCaught} / ${acc.stagedFallsTotal}`,
      falseAlarmsPer1000Hours: rate,
      rateDisplay,
      hasEnoughRiding: hasEnough,
    };

    byModel.push(item);

    // Accumulate to totals
    totals.ridingSeconds += acc.ridingSeconds;
    totals.falseAlarms += acc.falseAlarms;
    totals.trueEvents += acc.trueEvents;
    totals.checkInsCancelled += acc.checkInsCancelled;
    totals.stagedFallsCaught += acc.stagedFallsCaught;
    totals.stagedFallsTotal += acc.stagedFallsTotal;
  }

  // Calculate totals rate
  const totalRidingHours = totals.ridingSeconds / 3600;
  totals.ridingHours = Math.round(totalRidingHours * 10) / 10;
  totals.ridingHoursDisplay = `${totals.ridingHours.toFixed(1)} hrs`;
  totals.hasEnoughRiding = totalRidingHours >= CONSTANTS.MIN_RIDING_HOURS_FOR_RATE;
  totals.stagedFallsDisplay = `${totals.stagedFallsCaught} / ${totals.stagedFallsTotal}`;

  if (totals.hasEnoughRiding) {
    totals.falseAlarmsPer1000Hours = Math.round(((totals.falseAlarms / totalRidingHours) * CONSTANTS.RATE_PER_HOURS) * 10) / 10;
    totals.rateDisplay = String(totals.falseAlarmsPer1000Hours);
  } else {
    totals.falseAlarmsPer1000Hours = null;
    totals.rateDisplay = CONSTANTS.NOT_ENOUGH_RIDING_MSG;
  }

  // Format date range
  let dateRange = {
    from: minTime !== null ? new Date(minTime).toISOString() : null,
    to: maxTime !== null ? new Date(maxTime).toISOString() : null,
    formatted: minTime !== null && maxTime !== null
      ? `${formatDate(minTime)} – ${formatDate(maxTime)}`
      : 'No activity recorded',
  };

  return {
    byModel,
    totals,
    dateRange,
  };
}

/**
 * Fetches false alarm data for a user across all 4 tables in Supabase,
 * handling missing tables gracefully without crashing.
 *
 * @param {object} supabase - Supabase client instance
 * @param {string} userId - Auth user ID
 * @returns {Promise<{ stats: object, raw: object, error: string|null }>}
 */
export async function fetchFalseAlarmData(supabase, userId) {
  if (!supabase || !userId) {
    return {
      stats: computeFalseAlarmStats({}),
      raw: { drivingSessions: [], blackboxEvents: [], rideSensorClips: [], driveProofRuns: [] },
      error: 'Missing supabase client or userId',
    };
  }

  let drivingSessions = [];
  let blackboxEvents = [];
  let rideSensorClips = [];
  let driveProofRuns = [];

  // Query driving_sessions (read-only)
  try {
    const { data, error } = await supabase
      .from('driving_sessions')
      .select('id, user_id, started_at, ended_at, duration_seconds, created_at')
      .eq('user_id', userId)
      .order('started_at', { ascending: false });
    if (!error && Array.isArray(data)) {
      drivingSessions = data;
    }
  } catch (err) {
    console.warn('[false-alarm-stats] driving_sessions query omitted:', err.message || err);
  }

  // Query blackbox_events (read-only)
  try {
    const { data, error } = await supabase
      .from('blackbox_events')
      .select('id, owner, trigger, confirmed, started_at, ended_at, created_at')
      .eq('owner', userId)
      .order('started_at', { ascending: false });
    if (!error && Array.isArray(data)) {
      blackboxEvents = data;
    }
  } catch (err) {
    console.warn('[false-alarm-stats] blackbox_events query omitted:', err.message || err);
  }

  // Query ride_sensor_clips (read-only, handle missing table)
  try {
    const { data, error } = await supabase
      .from('ride_sensor_clips')
      .select('id, owner, session_id, kind, outcome, label, phone_model, started_at, created_at')
      .eq('owner', userId)
      .order('started_at', { ascending: false });
    if (!error && Array.isArray(data)) {
      rideSensorClips = data;
    }
  } catch (err) {
    console.warn('[false-alarm-stats] ride_sensor_clips table unavailable:', err.message || err);
  }

  // Query drive_proof_runs (read-only)
  try {
    const { data, error } = await supabase
      .from('drive_proof_runs')
      .select('id, owner, step, result, evidence, note, created_at')
      .eq('owner', userId)
      .order('created_at', { ascending: false });
    if (!error && Array.isArray(data)) {
      driveProofRuns = data;
    }
  } catch (err) {
    console.warn('[false-alarm-stats] drive_proof_runs table unavailable:', err.message || err);
  }

  const raw = {
    drivingSessions,
    blackboxEvents,
    rideSensorClips,
    driveProofRuns,
  };

  const stats = computeFalseAlarmStats(raw);

  return {
    stats,
    raw,
    error: null,
  };
}

