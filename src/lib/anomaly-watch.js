// src/lib/anomaly-watch.js
// Anomaly watcher v1 (architecture step 8) — report-only scorers for ride anomalies.
//
// Report-only: it never calls, messages, alerts family or starts SOS.
// It only raises onState('anomaly', { kind, level, reasons }) and keeps
// a short in-memory list. Actions come later, after founder decisions and road proof.
//
// Pure scorers with injectable clocks:
//   1. routeDeviation({ destination, fixes })
//   2. phoneSnatch({ motion, speedKmh })
//   3. longUnexpectedStop({ fixes, now })

export const CONSTANTS = {
  // ── Route deviation ────────────────────────────────────────────────────────
  DEVIATION_WATCH_MS: 3 * 60 * 1000,    // 3 minutes of sustained divergence -> watch
  DEVIATION_HIGH_MS: 6 * 60 * 1000,     // 6 minutes of sustained divergence -> high
  DEVIATION_MIN_GROWTH_M: 30,           // min growth in metres to filter GPS jitter
  MIN_TRIP_METRES: 100,                 // trips shorter than 100 m ignored

  // ── Phone snatch ───────────────────────────────────────────────────────────
  SNATCH_JERK_MIN_G: 2.5,               // sharp jerk > 2.5 g
  SNATCH_JERK_MAX_MS: 300,              // jerk duration < 300 ms
  SNATCH_MAX_SPEED_BEFORE_KMH: 8,       // stationary or walking (< 8 km/h) before snatch
  SNATCH_RUN_MIN_KMH: 8,                // running pace min
  SNATCH_RUN_MAX_KMH: 20,               // running pace max
  SNATCH_WINDOW_MS: 20 * 1000,          // running pace within 20 s of jerk

  // ── Long unexpected stop ───────────────────────────────────────────────────
  STOP_MIN_DURATION_MS: 10 * 60 * 1000, // stopped > 10 minutes
  NIGHT_START_HOUR: 23,                 // 23:00 (11 PM)
  NIGHT_END_HOUR: 5,                    // 05:00 (5 AM)
  STOP_MAX_SPEED_KMH: 3,                // threshold for considering stopped
  STOP_RADIUS_M: 40,                    // max drift while stopped
  KNOWN_STOP_MATCH_RADIUS_M: 150,       // radius to consider location previously visited
  RIDE_MIN_DISTANCE_M: 150,             // must have ridden this far to be "during a ride"
  RIDE_MIN_SPEED_KMH: 10,               // or reached this speed

  // ── In-memory state ────────────────────────────────────────────────────────
  MAX_IN_MEMORY_ANOMALIES: 20,
};

const R = 6371000; // Earth radius in metres
const toRad = (d) => (d * Math.PI) / 180;

/** Great-circle distance between two {lat, lng} coordinates in metres. */
export function metresBetween(a, b) {
  if (!a || !b || typeof a.lat !== 'number' || typeof b.lat !== 'number') return 0;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Cross-track (perpendicular) distance in metres from point P to the straight line AB.
 */
export function corridorDistance(p, a, b) {
  if (!p || !a || !b) return 0;
  const rad = Math.PI / 180;
  const lat0 = a.lat * rad;
  const cosLat = Math.cos(lat0);

  const xB = (b.lng - a.lng) * rad * R * cosLat;
  const yB = (b.lat - a.lat) * rad * R;
  const xP = (p.lng - a.lng) * rad * R * cosLat;
  const yP = (p.lat - a.lat) * rad * R;

  const lenSq = xB * xB + yB * yB;
  if (lenSq === 0) return Math.hypot(xP, yP);

  const cross = Math.abs(xB * yP - yB * xP);
  return cross / Math.sqrt(lenSq);
}

/**
 * Scorer 1: routeDeviation({ destination, fixes, origin })
 * When a destination is known (optional input), distance from the straight-line
 * corridor grows for 3 minutes while moving away from the destination -> watch;
 * 6 minutes -> high.
 *
 * @param {object} params
 * @param {{lat: number, lng: number}} [params.destination]
 * @param {Array<{lat: number, lng: number, at: number, speedKmh?: number}>} params.fixes
 * @param {{lat: number, lng: number}} [params.origin]  Defaults to fixes[0]
 * @returns {{ level: 'none'|'watch'|'high', reasons: string[], kind: 'route_deviation' }}
 */
export function routeDeviation({ destination, fixes, origin } = {}) {
  const result = { kind: 'route_deviation', level: 'none', reasons: [] };

  if (!destination || typeof destination.lat !== 'number' || typeof destination.lng !== 'number') {
    return result;
  }
  if (!Array.isArray(fixes) || fixes.length < 2) {
    return result;
  }

  const startFix = origin || fixes[0];
  if (!startFix || typeof startFix.lat !== 'number' || typeof startFix.lng !== 'number') {
    return result;
  }

  const tripLen = metresBetween(startFix, destination);
  if (tripLen < CONSTANTS.MIN_TRIP_METRES) {
    return result;
  }

  const evaluated = fixes.map((f) => ({
    lat: f.lat,
    lng: f.lng,
    at: f.at,
    speedKmh: f.speedKmh ?? 0,
    dDest: metresBetween(f, destination),
    dCorr: corridorDistance(f, startFix, destination),
  }));

  const last = evaluated[evaluated.length - 1];

  // Must currently be moving away from destination (not approaching it)
  // Check the last few fixes to verify recent movement is not heading towards destination
  if (evaluated.length >= 2) {
    const prev = evaluated[evaluated.length - 2];
    if (last.dDest < prev.dDest - 10) {
      // Currently moving closer to destination -> no active deviation
      return result;
    }
  }

  // Walk backwards from last to find the start of the continuous diverging segment
  let deviatingDurationMs = 0;

  for (let i = evaluated.length - 2; i >= 0; i--) {
    const candidateStart = evaluated[i];
    const duration = last.at - candidateStart.at;
    if (duration <= 0) continue;

    const corrGrowth = last.dCorr - candidateStart.dCorr;
    const destGrowth = last.dDest - candidateStart.dDest;

    // Both corridor distance and distance to destination must grow significantly
    if (corrGrowth >= CONSTANTS.DEVIATION_MIN_GROWTH_M && destGrowth >= CONSTANTS.DEVIATION_MIN_GROWTH_M) {
      // Sustained check: throughout [i, last], the vehicle must have stayed further
      // from destination than candidateStart (no return towards destination)
      let sustained = true;
      for (let j = i + 1; j < evaluated.length; j++) {
        if (evaluated[j].dDest < candidateStart.dDest - 15) {
          sustained = false;
          break;
        }
      }
      if (sustained) {
        deviatingDurationMs = Math.max(deviatingDurationMs, duration);
      } else {
        // Break once sustained segment ends
        break;
      }
    } else if (last.dDest < candidateStart.dDest - 10) {
      // Reached a point where the vehicle was further from destination
      break;
    }
  }

  if (deviatingDurationMs >= CONSTANTS.DEVIATION_HIGH_MS) {
    const mins = Math.round(deviatingDurationMs / 60000);
    return {
      kind: 'route_deviation',
      level: 'high',
      reasons: [`Distance from corridor grew for ${mins} minutes while moving away from destination`],
    };
  }

  if (deviatingDurationMs >= CONSTANTS.DEVIATION_WATCH_MS) {
    const mins = Math.round(deviatingDurationMs / 60000);
    return {
      kind: 'route_deviation',
      level: 'watch',
      reasons: [`Distance from corridor grew for ${mins} minutes while moving away from destination`],
    };
  }

  return result;
}

/**
 * Scorer 2: phoneSnatch({ motion, speedKmh, speedBeforeKmh, now })
 * A sharp jerk (> 2.5 g for < 300 ms) while NOT in a vehicle (speed < 8 km/h),
 * followed by running-pace speed 8–20 km/h within 20 s -> watch (never high in v1).
 *
 * @param {object} params
 * @param {Array|object} params.motion  Motion samples or jerk event object
 * @param {number} [params.speedKmh]  Current speed
 * @param {number} [params.speedBeforeKmh]  Speed before or during the jerk
 * @param {number|Date} [params.now]  Current timestamp (injectable)
 * @returns {{ level: 'none'|'watch'|'high', reasons: string[], kind: 'phone_snatch' }}
 */
export function phoneSnatch({ motion, speedKmh, speedBeforeKmh, now } = {}) {
  const result = { kind: 'phone_snatch', level: 'none', reasons: [] };

  const currentSpeed = typeof speedKmh === 'number' ? speedKmh : 0;
  const currentTime = now instanceof Date ? now.getTime() : (typeof now === 'number' ? now : Date.now());

  // Running-pace speed check (8–20 km/h)
  if (currentSpeed < CONSTANTS.SNATCH_RUN_MIN_KMH || currentSpeed > CONSTANTS.SNATCH_RUN_MAX_KMH) {
    return result;
  }

  let jerkDetected = false;
  let jerkAt = null;
  let speedAtJerk = speedBeforeKmh;

  if (Array.isArray(motion)) {
    // Array of motion samples: [{ g, at, speedKmh }]
    for (let i = 0; i < motion.length; i++) {
      const s = motion[i];
      const g = s.g ?? s.magnitudeG ?? (
        s.x != null ? Math.hypot(s.x, s.y, s.z) / 9.80665 : 0
      );
      if (g > CONSTANTS.SNATCH_JERK_MIN_G) {
        const spikeStart = s.at;
        let spikeEnd = spikeStart;
        let peakG = g;
        let j = i;
        while (j < motion.length && (motion[j].g ?? motion[j].magnitudeG ?? 0) > CONSTANTS.SNATCH_JERK_MIN_G) {
          peakG = Math.max(peakG, motion[j].g ?? motion[j].magnitudeG ?? 0);
          spikeEnd = motion[j].at;
          j++;
        }
        const duration = spikeEnd - spikeStart;
        if (duration < CONSTANTS.SNATCH_JERK_MAX_MS) {
          const sampleSpeed = s.speedKmh ?? s.speedBeforeKmh ?? speedBeforeKmh;
          if (sampleSpeed == null || sampleSpeed < CONSTANTS.SNATCH_MAX_SPEED_BEFORE_KMH) {
            jerkDetected = true;
            jerkAt = spikeStart;
            speedAtJerk = sampleSpeed ?? 0;
            break;
          }
        }
      }
    }
  } else if (motion && typeof motion === 'object') {
    // Jerk event or candidate object
    const peakG = motion.peakG ?? motion.jerkG ?? motion.g ?? motion.magnitudeG ?? 0;
    const durationMs = motion.durationMs ?? motion.jerkDurationMs ?? 0;
    const at = motion.at ?? motion.jerkAt ?? (currentTime - 5000);
    const speedBefore = motion.speedBeforeKmh ?? motion.speedAtJerk ?? speedBeforeKmh ?? 0;

    if (
      peakG > CONSTANTS.SNATCH_JERK_MIN_G &&
      durationMs < CONSTANTS.SNATCH_JERK_MAX_MS &&
      speedBefore < CONSTANTS.SNATCH_MAX_SPEED_BEFORE_KMH
    ) {
      jerkDetected = true;
      jerkAt = at;
      speedAtJerk = speedBefore;
    }
  }

  if (!jerkDetected || jerkAt == null) {
    return result;
  }

  const elapsedSinceJerk = currentTime - jerkAt;
  if (elapsedSinceJerk >= 0 && elapsedSinceJerk <= CONSTANTS.SNATCH_WINDOW_MS) {
    return {
      kind: 'phone_snatch',
      level: 'watch', // never high in v1
      reasons: [
        `Sharp jerk while stationary/walking (${Number(speedAtJerk).toFixed(0)} km/h) followed by running speed (${currentSpeed.toFixed(0)} km/h) within 20s`,
      ],
    };
  }

  return result;
}

/**
 * Scorer 3: longUnexpectedStop({ fixes, now, knownStops })
 * Stopped > 10 minutes in a place with no previous visit, during a ride,
 * at night (23:00–05:00) -> watch.
 *
 * @param {object} params
 * @param {Array<{lat: number, lng: number, at: number, speedKmh?: number}>} params.fixes
 * @param {number|Date} [params.now]  Current timestamp (injectable)
 * @param {Array<{lat: number, lng: number}>} [params.knownStops]  Previously visited locations
 * @returns {{ level: 'none'|'watch'|'high', reasons: string[], kind: 'unexpected_stop' }}
 */
export function longUnexpectedStop({ fixes, now, knownStops = [] } = {}) {
  const result = { kind: 'unexpected_stop', level: 'none', reasons: [] };

  if (!Array.isArray(fixes) || fixes.length < 2) {
    return result;
  }

  const currentTime = now instanceof Date
    ? now.getTime()
    : (typeof now === 'number' ? now : (fixes[fixes.length - 1]?.at ?? Date.now()));
  const date = new Date(currentTime);
  const hour = date.getHours();

  // Night window check: 23:00 to 05:00
  const isNight = hour >= CONSTANTS.NIGHT_START_HOUR || hour < CONSTANTS.NIGHT_END_HOUR;
  if (!isNight) {
    return result;
  }

  // 1. Verify "during a ride": must have demonstrated significant riding activity prior to stopping
  let hadRideActivity = false;
  let totalDistance = 0;
  for (let i = 1; i < fixes.length; i++) {
    const step = metresBetween(fixes[i - 1], fixes[i]);
    totalDistance += step;
    if ((fixes[i].speedKmh ?? 0) >= CONSTANTS.RIDE_MIN_SPEED_KMH || totalDistance >= CONSTANTS.RIDE_MIN_DISTANCE_M) {
      hadRideActivity = true;
      break;
    }
  }

  if (!hadRideActivity) {
    return result;
  }

  // 2. Verify "stopped > 10 minutes"
  const lastFix = fixes[fixes.length - 1];
  let stopStartAt = null;

  for (let i = fixes.length - 1; i >= 0; i--) {
    const f = fixes[i];
    const distFromLast = metresBetween(f, lastFix);
    const speed = f.speedKmh ?? 0;

    if (distFromLast <= CONSTANTS.STOP_RADIUS_M && speed <= CONSTANTS.STOP_MAX_SPEED_KMH) {
      stopStartAt = f.at;
    } else {
      break;
    }
  }

  if (stopStartAt == null) {
    return result;
  }

  const stopDurationMs = currentTime - stopStartAt;
  if (stopDurationMs <= CONSTANTS.STOP_MIN_DURATION_MS) {
    return result;
  }

  // 3. Verify "place with no previous visit"
  if (Array.isArray(knownStops) && knownStops.length > 0) {
    for (const known of knownStops) {
      if (metresBetween(lastFix, known) <= CONSTANTS.KNOWN_STOP_MATCH_RADIUS_M) {
        return result; // familiar place
      }
    }
  }

  const stopMins = Math.round(stopDurationMs / 60000);
  return {
    kind: 'unexpected_stop',
    level: 'watch',
    reasons: [`Stopped ${stopMins} minutes at night in an unfamiliar location`],
  };
}

/**
 * Stateful anomaly watcher for integration into ride-guard.
 * Keeps a short in-memory list and notifies via onAnomaly callback.
 * Report-only: never calls, messages, alerts family or starts SOS.
 */
export function createAnomalyWatcher({
  destination = null,
  knownStops = [],
  clock = () => Date.now(),
  onAnomaly = null,
  maxInMemory = CONSTANTS.MAX_IN_MEMORY_ANOMALIES,
} = {}) {
  const anomalies = [];
  let recentFixes = [];
  let currentDestination = destination;
  let currentKnownStops = [...knownStops];
  let currentSpeedKmh = 0;

  let recentJerk = null;
  let spikeStart = null;
  let spikePeakG = 0;

  const lastReported = {
    route_deviation: 'none',
    phone_snatch: 'none',
    unexpected_stop: 'none',
  };

  function recordAnomaly(kind, level, reasons, extra = {}) {
    if (level === 'none') return;
    const item = {
      kind,
      level,
      reasons,
      at: clock(),
      ...extra,
    };
    anomalies.push(item);
    if (anomalies.length > maxInMemory) {
      anomalies.shift();
    }
    onAnomaly?.(item);
    return item;
  }

  function runChecks(nowMs = clock()) {
    // 1. Route deviation
    if (currentDestination && recentFixes.length >= 2) {
      const res = routeDeviation({
        destination: currentDestination,
        fixes: recentFixes,
      });
      if (res.level !== lastReported.route_deviation) {
        lastReported.route_deviation = res.level;
        if (res.level !== 'none') {
          recordAnomaly('route_deviation', res.level, res.reasons);
        }
      }
    }

    // 2. Phone snatch
    if (recentJerk) {
      const res = phoneSnatch({
        motion: recentJerk,
        speedKmh: currentSpeedKmh,
        now: nowMs,
      });
      if (res.level !== lastReported.phone_snatch) {
        lastReported.phone_snatch = res.level;
        if (res.level !== 'none') {
          recordAnomaly('phone_snatch', res.level, res.reasons);
        }
      }
      if (nowMs - recentJerk.at > CONSTANTS.SNATCH_WINDOW_MS) {
        recentJerk = null;
      }
    }

    // 3. Long unexpected stop
    if (recentFixes.length >= 2) {
      const res = longUnexpectedStop({
        fixes: recentFixes,
        now: nowMs,
        knownStops: currentKnownStops,
      });
      if (res.level !== lastReported.unexpected_stop) {
        lastReported.unexpected_stop = res.level;
        if (res.level !== 'none') {
          recordAnomaly('unexpected_stop', res.level, res.reasons);
        }
      }
    }
  }

  return {
    feedFix(fix) {
      if (!fix || typeof fix.lat !== 'number' || typeof fix.lng !== 'number') return;
      const at = fix.at ?? clock();
      const speedKmh = typeof fix.speedKmh === 'number' ? fix.speedKmh : currentSpeedKmh;
      recentFixes.push({ ...fix, at, speedKmh });

      // Keep recent 20 minutes of fixes
      const cutoff = at - 20 * 60 * 1000;
      if (recentFixes.length > 600 || (recentFixes[0] && recentFixes[0].at < cutoff)) {
        recentFixes = recentFixes.filter((f) => f.at >= cutoff);
      }

      runChecks(at);
    },

    feedSpeed(kmh, fix) {
      if (typeof kmh === 'number') currentSpeedKmh = kmh;
      if (fix && typeof fix.lat === 'number') {
        this.feedFix({ ...fix, speedKmh: currentSpeedKmh });
      } else {
        runChecks(clock());
      }
    },

    feedMotion(motion) {
      const nowMs = motion?.at ?? clock();
      const g = motion?.g ?? motion?.magnitudeG ?? (
        motion?.acceleration
          ? Math.hypot(motion.acceleration.x || 0, motion.acceleration.y || 0, motion.acceleration.z || 0) / 9.80665
          : 0
      );

      if (g > CONSTANTS.SNATCH_JERK_MIN_G) {
        if (!spikeStart) {
          spikeStart = nowMs;
          spikePeakG = g;
        } else {
          spikePeakG = Math.max(spikePeakG, g);
        }
      } else if (spikeStart) {
        const duration = nowMs - spikeStart;
        if (duration < CONSTANTS.SNATCH_JERK_MAX_MS && currentSpeedKmh < CONSTANTS.SNATCH_MAX_SPEED_BEFORE_KMH) {
          recentJerk = {
            at: spikeStart,
            peakG: spikePeakG,
            durationMs: duration,
            speedBeforeKmh: currentSpeedKmh,
          };
        }
        spikeStart = null;
        spikePeakG = 0;
      }
    },

    setDestination(dest) {
      currentDestination = dest;
    },

    setKnownStops(stops) {
      currentKnownStops = Array.isArray(stops) ? [...stops] : [];
    },

    getAnomalies() {
      return [...anomalies];
    },

    reset() {
      anomalies.length = 0;
      recentFixes = [];
      recentJerk = null;
      spikeStart = null;
      spikePeakG = 0;
      lastReported.route_deviation = 'none';
      lastReported.phone_snatch = 'none';
      lastReported.unexpected_stop = 'none';
    },
  };
}
