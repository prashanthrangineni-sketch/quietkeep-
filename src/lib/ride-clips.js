// src/lib/ride-clips.js
// TASK CARD AG-D2: Ride recorder for labelled clips (DRV-15)
// Pure logic, injectable clock and random, no hard browser dependencies.
//
// Keeps a rolling buffer of { at, g, kmh } during a ride.
// Freezes 10-second clips (5s before, 5s after) around candidate events
// (suspected crash, crash, normal sample) for false-alarm review and driver labeling.
//
// Privacy rule: No location coordinates (lat, lng, lon, accuracy, heading)
// are EVER stored in clips or samples. Speed and acceleration only.

export const CONSTANTS = {
  WINDOW_MS: 10000,                  // 10s total clip window
  PRE_EVENT_MS: 5000,                // 5s before event
  POST_EVENT_MS: 5000,               // 5s after event
  MAX_CLIPS_PER_RIDE: 30,            // At most 30 clips per ride
  NORMAL_SAMPLE_INTERVAL_MS: 600000, // 10 riding minutes = 600,000 ms
  RIDING_MIN_SPEED_KMH: 10,          // Riding threshold for normal sample timer
  DEFAULT_RATE_HZ: 50,               // 50 Hz default sensor rate
  BUFFER_RETENTION_MS: 25000,        // Retain 25s of samples in memory
};

export const ALLOWED_KINDS = ['suspected', 'crash', 'normal_sample'];
export const ALLOWED_OUTCOMES = ['pending', 'cancelled_ok', 'sent', 'drill'];
export const ALLOWED_LABELS = ['bump', 'fall', 'nothing'];

export function getPhoneModel() {
  if (typeof navigator !== 'undefined') {
    const ua = navigator.userAgent || '';
    const match = ua.match(/\(([^)]+)\)/);
    if (match && match[1]) {
      const parts = match[1].split(';').map(s => s.trim());
      const model = parts.find(p => !p.startsWith('Linux') && !p.startsWith('Android') && !p.startsWith('wv'));
      if (model) return model;
    }
    return ua.slice(0, 80) || 'unknown';
  }
  return 'unknown';
}

function generateId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Creates a rolling clip recorder for sensor data during a ride.
 * @param {object} options
 * @param {() => number} [options.clock] Injectable clock returning ms timestamp
 * @param {() => number} [options.random] Injectable random generator (0..1)
 * @param {number} [options.windowMs] Total window length in ms (default 10,000)
 * @param {number} [options.rateHz] Expected sample rate in Hz (default 50)
 * @param {number} [options.maxClips] Maximum clips per ride (default 30)
 * @param {boolean} [options.enabled] Explicit opt-in flag (defaults to localStorage check)
 * @param {string|null} [options.sessionId] Associated ride session ID
 * @param {string|null} [options.phoneModel] Device model string
 * @param {(clip: object) => void} [options.onClipCreated] Callback when a candidate is recorded
 * @param {(clip: object) => void} [options.onClipUpdated] Callback when outcome/label changes
 */
export function createClipRecorder(options = {}) {
  const clock = options.clock || (() => Date.now());
  const windowMs = options.windowMs || CONSTANTS.WINDOW_MS;
  const preEventMs = options.preEventMs || (windowMs / 2);
  const postEventMs = options.postEventMs || (windowMs / 2);
  const maxClips = options.maxClips || CONSTANTS.MAX_CLIPS_PER_RIDE;
  const random = typeof options.random === 'function' ? options.random : Math.random;
  const sessionId = options.sessionId || null;
  const phoneModel = options.phoneModel || getPhoneModel();
  const onClipCreated = typeof options.onClipCreated === 'function' ? options.onClipCreated : null;
  const onClipUpdated = typeof options.onClipUpdated === 'function' ? options.onClipUpdated : null;

  // Opt-in resolution:
  // If explicitly provided in options.enabled, use it.
  // Otherwise, read from localStorage 'qk_ride_clips_opt_in' (default: false).
  let enabled = options.enabled !== undefined
    ? Boolean(options.enabled)
    : (typeof window !== 'undefined' && window.localStorage?.getItem('qk_ride_clips_opt_in') === 'true');

  let buffer = [];          // Rolling array of { at, g, kmh }
  let clips = [];           // Array of recorded clips
  let pendingEvents = [];   // Candidates awaiting post-event samples
  let currentSpeedKmh = null;
  let ridingMs = 0;
  let lastRidingAt = null;
  let normalIntervalIndex = 0;
  let nextNormalSampleRidingMs = Math.floor(random() * CONSTANTS.NORMAL_SAMPLE_INTERVAL_MS);

  function sanitizeSample(sample) {
    const at = typeof sample.at === 'number' ? sample.at : clock();
    const g = typeof sample.g === 'number' ? Math.round(sample.g * 1000) / 1000 : 1.0;
    const kmh = typeof sample.kmh === 'number'
      ? Math.round(sample.kmh * 10) / 10
      : (typeof currentSpeedKmh === 'number' ? Math.round(currentSpeedKmh * 10) / 10 : null);

    // STRICT PRIVACY: no location coordinates (lat, lng, lon, accuracy, heading)
    return { at, g, kmh };
  }

  function updateClipSamples(clip) {
    const startAt = clip.eventAt - preEventMs;
    const endAt = clip.eventAt + postEventMs;
    clip.samples = buffer
      .filter(s => s.at >= startAt && s.at <= endAt)
      .map(s => ({ at: s.at, g: s.g, kmh: s.kmh }));
    clip.peakG = clip.samples.length > 0
      ? Math.round(Math.max(...clip.samples.map(s => s.g || 0)) * 1000) / 1000
      : 0;
  }

  function finalizeClip(clip) {
    updateClipSamples(clip);
    clip.completed = true;
    pendingEvents = pendingEvents.filter(p => p.clip.id !== clip.id);
  }

  function checkPendingClips(currentAt) {
    for (const item of [...pendingEvents]) {
      if (currentAt >= item.endAt) {
        finalizeClip(item.clip);
      } else {
        updateClipSamples(item.clip);
      }
    }
  }

  function checkNormalSampleProgress(at, speedKmh) {
    if (!enabled || clips.length >= maxClips) return;
    const isRiding = typeof speedKmh === 'number' && speedKmh >= CONSTANTS.RIDING_MIN_SPEED_KMH;
    if (!isRiding) {
      lastRidingAt = null;
      return;
    }

    if (lastRidingAt !== null && at > lastRidingAt) {
      const deltaMs = Math.min(at - lastRidingAt, 5000);
      ridingMs += deltaMs;
    }
    lastRidingAt = at;

    if (ridingMs >= nextNormalSampleRidingMs) {
      onCandidate('normal_sample', { at, reason: 'scheduled_normal_sample' });
      normalIntervalIndex += 1;
      const offset = Math.floor(random() * CONSTANTS.NORMAL_SAMPLE_INTERVAL_MS);
      nextNormalSampleRidingMs = normalIntervalIndex * CONSTANTS.NORMAL_SAMPLE_INTERVAL_MS + offset;
    }
  }

  function recordSample(rawSample) {
    if (!enabled) return;
    const sample = sanitizeSample(rawSample);
    buffer.push(sample);

    // Prune buffer past retention window
    const cutoff = sample.at - CONSTANTS.BUFFER_RETENTION_MS;
    while (buffer.length > 0 && buffer[0].at < cutoff) {
      buffer.shift();
    }

    checkPendingClips(sample.at);
    checkNormalSampleProgress(sample.at, sample.kmh);
  }

  function onCandidate(kind, detail = {}) {
    if (!enabled) return null;
    if (!ALLOWED_KINDS.includes(kind)) {
      throw new Error(`Invalid candidate kind: ${kind}. Must be one of: ${ALLOWED_KINDS.join(', ')}`);
    }
    if (clips.length >= maxClips) {
      return null; // 30-clip cap per ride
    }

    const eventAt = typeof detail.at === 'number' ? detail.at : clock();
    const clipId = detail.id || generateId();
    const startAt = eventAt - preEventMs;
    const endAt = eventAt + postEventMs;

    const clip = {
      id: clipId,
      session_id: detail.sessionId || sessionId || null,
      kind,
      outcome: detail.outcome || 'pending',
      label: detail.label || null,
      startedAt: new Date(startAt).toISOString(),
      created_at: new Date(clock()).toISOString(),
      eventAt,
      endAt,
      samples: [],
      phone_model: detail.phoneModel || phoneModel,
      peakG: 0,
      completed: false,
    };

    clips.push(clip);

    const latestBufferAt = buffer.length > 0 ? buffer[buffer.length - 1].at : 0;
    if (latestBufferAt >= endAt) {
      finalizeClip(clip);
    } else {
      pendingEvents.push({ clip, endAt });
      updateClipSamples(clip);
    }

    onClipCreated?.(clip);
    return clip;
  }

  function setOutcome(id, outcome) {
    if (!ALLOWED_OUTCOMES.includes(outcome)) {
      throw new Error(`Invalid outcome: ${outcome}. Must be one of: ${ALLOWED_OUTCOMES.join(', ')}`);
    }
    const clip = clips.find(c => c.id === id);
    if (!clip) return null;
    clip.outcome = outcome;
    onClipUpdated?.(clip);
    return clip;
  }

  function label(id, labelVal) {
    if (labelVal !== null && !ALLOWED_LABELS.includes(labelVal)) {
      throw new Error(`Invalid label: ${labelVal}. Must be one of: ${ALLOWED_LABELS.join(', ')}`);
    }
    const clip = clips.find(c => c.id === id);
    if (!clip) return null;
    clip.label = labelVal;
    onClipUpdated?.(clip);
    return clip;
  }

  function feedMotion({ g, at }) {
    recordSample({ g, at, kmh: currentSpeedKmh });
  }

  function feedSpeed({ kmh, at }) {
    if (typeof kmh === 'number') currentSpeedKmh = kmh;
    recordSample({ g: 1.0, at, kmh });
  }

  function feedSample({ at, g, kmh }) {
    if (typeof kmh === 'number') currentSpeedKmh = kmh;
    recordSample({ at, g, kmh });
  }

  function flush() {
    const pending = [...pendingEvents];
    pendingEvents = [];
    for (const item of pending) {
      finalizeClip(item.clip);
    }
  }

  function stop() {
    flush();
  }

  return {
    feedMotion,
    feedSpeed,
    feedSample,
    onCandidate,
    setOutcome,
    label,
    getClips() { return [...clips]; },
    getUnlabelledClips() { return clips.filter(c => c.label === null); },
    getBuffer() { return [...buffer]; },
    flush,
    stop,
    isEnabled() { return enabled; },
    setEnabled(val) { enabled = Boolean(val); },
  };
}

/**
 * Upload a ride's finished clips to public.ride_sensor_clips (owner-only rows).
 * Runs as the signed-in user, so row-level rules keep each rider's clips private.
 * A duplicate id (already uploaded) counts as done. Never throws.
 * @returns {Promise<{ uploaded: number, failed: number, error?: string }>}
 */
export async function uploadRideClips({ db, userId, clips } = {}) {
  const result = { uploaded: 0, failed: 0 };
  if (!db || !userId || !Array.isArray(clips) || clips.length === 0) return result;
  const rows = clips
    .filter(c => c && c.id && ALLOWED_KINDS.includes(c.kind))
    .map(c => ({
      id: c.id,
      owner: userId,
      session_id: c.session_id || null,
      kind: c.kind,
      outcome: ALLOWED_OUTCOMES.includes(c.outcome) ? c.outcome : 'pending',
      label: ALLOWED_LABELS.includes(c.label) ? c.label : null,
      // speed and acceleration only; never coordinates
      samples: (c.samples || []).map(s => ({ at: s.at, g: s.g, kmh: s.kmh ?? null })),
      phone_model: c.phone_model || null,
      started_at: c.startedAt || new Date().toISOString(),
    }));
  for (const row of rows) {
    try {
      const { error } = await db.from('ride_sensor_clips').insert(row);
      if (error && error.code !== '23505') { result.failed++; result.error = error.message || String(error); }
      else result.uploaded++;
    } catch (e) {
      result.failed++; result.error = String(e?.message || e);
    }
  }
  return result;
}

export function saveLastRideClips(clips, storage = null) {
  const store = storage || (typeof window !== 'undefined' ? window.localStorage : null);
  if (!store) return;
  try {
    store.setItem('qk_last_ride_clips', JSON.stringify(clips || []));
  } catch {}
}

export function loadLastRideClips(storage = null) {
  const store = storage || (typeof window !== 'undefined' ? window.localStorage : null);
  if (!store) return [];
  try {
    const raw = store.getItem('qk_last_ride_clips');
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function labelLastRideClip(id, labelVal, storage = null) {
  if (labelVal !== null && !ALLOWED_LABELS.includes(labelVal)) {
    throw new Error(`Invalid label: ${labelVal}`);
  }
  const clips = loadLastRideClips(storage);
  const clip = clips.find(c => c.id === id);
  if (clip) {
    clip.label = labelVal;
    saveLastRideClips(clips, storage);
    return clip;
  }
  return null;
}
