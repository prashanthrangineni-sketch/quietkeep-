// src/lib/indicator-assist.js
// TASK CARD DRV-11: Indicator assist v1
// Pure decision and motion logic, no browser APIs, injectable clock.
//
// Motion sensors project rotation rate onto Earth's gravity axis to estimate
// yaw rate regardless of phone orientation. A manoeuvre detector identifies
// lane changes and turns, and the indicator assist provides gentle, rate-limited
// spoken reminders in English, Hindi, and Telugu.

export const CONSTANTS = {
  // Speed limits
  MIN_SPEED_KMH: 8,                  // Ignore all manoeuvres and reminders below 8 km/h
  LANE_CHANGE_MIN_SPEED_KMH: 25,     // Lane changes only recognized at >= 25 km/h

  // Yaw rate thresholds
  LANE_CHANGE_YAW_EXCURSION_DPS: 3,  // Yaw excursion >= 3 deg/s
  LANE_CHANGE_MAX_NET_HEADING_DEG: 12, // Net heading change < 12 deg over lane change
  LANE_CHANGE_MIN_TIME_S: 1,         // Counter-steer within 1-6 s
  LANE_CHANGE_MAX_TIME_S: 6,

  // Turn thresholds
  TURN_MIN_HEADING_DEG: 45,          // Net heading change >= 45 deg
  TURN_MAX_TIME_S: 15,               // Within 15 seconds
  TURN_STEADY_YAW_DPS: 2,            // Steady heading when |yaw| < 2 deg/s
  TURN_STEADY_TIME_S: 3,             // Steady for 3 seconds = 'turn_done'

  // Assist reminder delays and cooldowns
  INDICATOR_STILL_ON_DELAY_S: 6,     // Check indicator ticking 6 s after turn_done / lane_change
  LANE_CHANGE_PRE_CHECK_S: 4,        // Check indicator ticking in 4 s before lane change
  ON_DEMAND_GRACE_MS: 6000,          // DRV-11c: an on-demand listen result may land up to 6 s after the 6 s check point
  REMINDERS_COOLDOWN_MS: 5 * 60 * 1000,   // Reminders mode: at most once per 5 min after turn_done
  SPEECH_QUIET_AFTER_OTHER_MS: 2 * 60 * 1000, // Never within 2 min of other speech
  SPEECH_MIN_INTERVAL_MS: 2 * 60 * 1000,      // Never more than 1 indicator phrase per 2 min
  MAX_PHRASES_PER_HOUR: 6,           // At most 6 indicator phrases per hour

  // Smoothing
  YAW_SMOOTHING_WINDOW_MS: 200,      // 200 ms moving average window for yaw smoothing
};

export const PHRASES = {
  en: {
    indicator_still_on: 'Your indicator is still on.',
    indicate_before_lane_change: 'Indicate before changing lanes.',
    check_indicator_off: 'Check your indicator is off.',
  },
  hi: {
    indicator_still_on: 'आपका इंडिकेटर अभी भी चालू है।',
    indicate_before_lane_change: 'लेन बदलने से पहले इंडिकेटर दें।',
    check_indicator_off: 'चेक करें कि इंडिकेटर बंद है।',
  },
  te: {
    indicator_still_on: 'మీ ఇండికేటర్ ఇంకా ఆన్‌లో ఉంది.',
    indicate_before_lane_change: 'లేన్ మారే ముందు ఇండికేటర్ వేయండి.',
    check_indicator_off: 'ఇండికేటర్ ఆఫ్ చేశారో లేదో చూడండి.',
  },
};

/**
 * Project phone rotation rate vector onto Earth's gravity vector to obtain
 * the true vehicle yaw rate (deg/s) about the vertical axis.
 *
 * W3C DeviceMotionEvent coordinate convention:
 *   +x: pointing right across the display
 *   +y: pointing up towards the top of the display
 *   +z: pointing perpendicularly out of the display towards the user
 *
 * rotationRate components:
 *   beta:  rotation rate around the x axis (pitch) [deg/s]
 *   gamma: rotation rate around the y axis (roll)  [deg/s]
 *   alpha: rotation rate around the z axis (yaw)   [deg/s]
 *
 * Gravity reference vector (from accelerationIncludingGravity):
 *   At rest, accelerometer measures reaction force (upwards, opposite gravity).
 *   Unit vector u = g / |g| points along the Earth vertical axis.
 *
 * Angular velocity vector:
 *   omega = (beta, gamma, alpha) corresponding to (x, y, z).
 *
 * The projection onto u gives the rotation rate about the vertical axis:
 *   yawRate = (beta * gx + gamma * gy + alpha * gz) / sqrt(gx^2 + gy^2 + gz^2)
 *
 * Sign convention:
 *   Positive (+) = counter-clockwise rotation about the upward reaction vector (left turn).
 *   Negative (-) = clockwise rotation (right turn).
 *
 * @param {{ alpha?: number, beta?: number, gamma?: number }} rotationRate
 * @param {{ x?: number, y?: number, z?: number }} gravity
 * @returns {number} yaw rate in deg/s
 */
export function yawRateFrom(rotationRate, gravity) {
  if (!rotationRate || !gravity) return 0;
  const alpha = Number(rotationRate.alpha) || 0;
  const beta = Number(rotationRate.beta) || 0;
  const gamma = Number(rotationRate.gamma) || 0;

  const gx = Number(gravity.x) || 0;
  const gy = Number(gravity.y) || 0;
  const gz = Number(gravity.z) || 0;

  const mag = Math.sqrt(gx * gx + gy * gy + gz * gz);
  if (mag < 1e-4) {
    // If gravity cannot be sensed (zero-g or invalid), assume flat phone (+z axis)
    return alpha;
  }
  return (beta * gx + gamma * gy + alpha * gz) / mag;
}

/**
 * Creates a manoeuvre detector that processes continuous motion and GPS feeds.
 *
 * Events emitted:
 *   - 'lane_change': { type, at, direction, speedKmh, netHeadingChange, startAt }
 *   - 'turn':        { type, at, direction, speedKmh, headingChange }
 *   - 'turn_done':   { type, at, direction, speedKmh, headingChange }
 *
 * @param {object} [opts]
 * @param {() => number} [opts.clock]
 * @param {(event: object) => void} [opts.onEvent]
 */
export function createManoeuvreDetector({ clock = () => Date.now(), onEvent } = {}) {
  // Yaw smoothing ring buffer (last 200 ms)
  const yawSamples = []; // { at, yawDps }

  let lastAt = null;
  let integratedHeading = 0; // accumulated heading in degrees

  // Turn state
  // Window of { at, heading } over the last 15 seconds
  const headingHistory = [];
  let currentTurn = null; // { direction, startHeading, startAt, maxHeadingDelta }
  let steadySinceAt = null;
  let turnDoneEmittedForCurrent = false;

  // Lane change state
  let laneChangeCandidate = null;
  let lastLaneChangeEmittedAt = -1000000;

  function smoothYaw(at, rawYaw) {
    yawSamples.push({ at, yawDps: rawYaw });
    const cutoff = at - CONSTANTS.YAW_SMOOTHING_WINDOW_MS;
    while (yawSamples.length > 0 && yawSamples[0].at < cutoff) {
      yawSamples.shift();
    }
    const sum = yawSamples.reduce((acc, s) => acc + s.yawDps, 0);
    return sum / (yawSamples.length || 1);
  }

  function reset() {
    yawSamples.length = 0;
    headingHistory.length = 0;
    lastAt = null;
    integratedHeading = 0;
    currentTurn = null;
    steadySinceAt = null;
    turnDoneEmittedForCurrent = false;
    laneChangeCandidate = null;
    lastLaneChangeEmittedAt = 0;
  }

  /**
   * Feed motion/GPS sample.
   * @param {{ at?: number, yawDps: number, speedKmh: number, headingDeg?: number }} sample
   * @returns {Array<object>} list of events detected on this tick
   */
  function feed({ at = clock(), yawDps = 0, speedKmh = 0, headingDeg = null } = {}) {
    const events = [];

    // Ignore everything below 8 km/h
    if (speedKmh == null || speedKmh < CONSTANTS.MIN_SPEED_KMH) {
      if (lastAt != null) {
        lastAt = at;
      }
      return events;
    }

    const smoothedYaw = smoothYaw(at, yawDps);

    // Integrate heading
    if (lastAt != null) {
      const dt = Math.max(0, (at - lastAt) / 1000);
      integratedHeading += smoothedYaw * dt;
    }
    lastAt = at;

    // Track heading history for 15s window
    headingHistory.push({ at, heading: integratedHeading });
    const windowCutoff = at - (CONSTANTS.TURN_MAX_TIME_S * 1000);
    while (headingHistory.length > 0 && headingHistory[0].at < windowCutoff) {
      headingHistory.shift();
    }

    // ── Turn Detection ────────────────────────────────────────────────────────
    // Net heading change >= 45 deg within 15 s at >= 8 km/h
    if (!currentTurn) {
      if (headingHistory.length >= 2) {
        const oldest = headingHistory[0];
        const headingDelta = integratedHeading - oldest.heading;
        if (Math.abs(headingDelta) >= CONSTANTS.TURN_MIN_HEADING_DEG) {
          currentTurn = {
            direction: headingDelta > 0 ? 'left' : 'right',
            startHeading: oldest.heading,
            startAt: oldest.at,
            maxHeadingDelta: headingDelta,
          };
          turnDoneEmittedForCurrent = false;
          steadySinceAt = null;

          const turnEvt = {
            type: 'turn',
            at,
            direction: currentTurn.direction,
            headingChange: Math.abs(headingDelta),
            speedKmh,
          };
          events.push(turnEvt);
          onEvent?.(turnEvt);
        }
      }
    } else {
      // In a turn: update max heading delta
      const deltaFromStart = integratedHeading - currentTurn.startHeading;
      if (Math.abs(deltaFromStart) > Math.abs(currentTurn.maxHeadingDelta)) {
        currentTurn.maxHeadingDelta = deltaFromStart;
      }

      // Check for heading steady (|yaw| < 2 deg/s) for 3 s = 'turn_done'
      if (Math.abs(smoothedYaw) < CONSTANTS.TURN_STEADY_YAW_DPS) {
        if (steadySinceAt == null) {
          steadySinceAt = at;
        } else if (at - steadySinceAt >= CONSTANTS.TURN_STEADY_TIME_S * 1000) {
          if (!turnDoneEmittedForCurrent) {
            turnDoneEmittedForCurrent = true;
            const doneEvt = {
              type: 'turn_done',
              at,
              direction: currentTurn.direction,
              headingChange: Math.abs(currentTurn.maxHeadingDelta),
              speedKmh,
            };
            events.push(doneEvt);
            onEvent?.(doneEvt);

            // Debounce: reset turn state and heading history so this turn is done
            currentTurn = null;
            steadySinceAt = null;
            headingHistory.length = 0;
            headingHistory.push({ at, heading: integratedHeading });
          }
        }
      } else {
        steadySinceAt = null;
      }
    }

    // ── Lane Change Detection ─────────────────────────────────────────────────
    // Speed >= 25 km/h; yaw excursion >= 3 deg/s one way followed within 1-6 s by
    // >= 3 deg/s the other way, with net heading change < 12 deg over the manoeuvre.
    if (speedKmh >= CONSTANTS.LANE_CHANGE_MIN_SPEED_KMH) {
      const cooldownActive = at - lastLaneChangeEmittedAt < 3000;

      if (!cooldownActive) {
        if (!laneChangeCandidate) {
          // Look for initial yaw excursion of >= 3 deg/s
          if (Math.abs(smoothedYaw) >= CONSTANTS.LANE_CHANGE_YAW_EXCURSION_DPS) {
            const dir = smoothedYaw > 0 ? 1 : -1;
            laneChangeCandidate = {
              phase: 'excursion_1',
              dir,
              t1: at,
              startHeading: integratedHeading,
              startAt: at,
              peak1: Math.abs(smoothedYaw),
            };
          }
        } else if (laneChangeCandidate.phase === 'excursion_1') {
          const elapsedSec = (at - laneChangeCandidate.t1) / 1000;

          // Track peak yaw in excursion 1
          if (Math.abs(smoothedYaw) > laneChangeCandidate.peak1) {
            laneChangeCandidate.peak1 = Math.abs(smoothedYaw);
          }

          if (elapsedSec > CONSTANTS.LANE_CHANGE_MAX_TIME_S) {
            // Timed out: excursion not followed by counter-steer within 6s
            laneChangeCandidate = null;
          } else if (elapsedSec >= CONSTANTS.LANE_CHANGE_MIN_TIME_S) {
            // Check for counter-steer >= 3 deg/s in opposite direction
            const requiredCounterDir = -laneChangeCandidate.dir;
            const counterYaw = smoothedYaw * requiredCounterDir;
            if (counterYaw >= CONSTANTS.LANE_CHANGE_YAW_EXCURSION_DPS) {
              laneChangeCandidate.phase = 'excursion_2';
              laneChangeCandidate.t2 = at;
            }
          }
        } else if (laneChangeCandidate.phase === 'excursion_2') {
          const elapsedFromT1Sec = (at - laneChangeCandidate.t1) / 1000;
          if (elapsedFromT1Sec > CONSTANTS.LANE_CHANGE_MAX_TIME_S + 2) {
            laneChangeCandidate = null;
          } else {
            // Manoeuvre finishes when vehicle settles back towards steady yaw (|yaw| < 2.0 dps)
            // or has executed the counter-steer
            const counterExcursionSettled = Math.abs(smoothedYaw) < CONSTANTS.TURN_STEADY_YAW_DPS;
            if (counterExcursionSettled) {
              const netHeadingChange = Math.abs(integratedHeading - laneChangeCandidate.startHeading);
              if (netHeadingChange < CONSTANTS.LANE_CHANGE_MAX_NET_HEADING_DEG) {
                const lcEvt = {
                  type: 'lane_change',
                  at,
                  direction: laneChangeCandidate.dir > 0 ? 'left' : 'right',
                  speedKmh,
                  netHeadingChange,
                  startAt: laneChangeCandidate.startAt,
                };
                events.push(lcEvt);
                onEvent?.(lcEvt);
                lastLaneChangeEmittedAt = at;
              }
              laneChangeCandidate = null;
            }
          }
        }
      }
    } else {
      // Speed dropped below 25 km/h: cancel any in-progress lane change
      laneChangeCandidate = null;
    }

    return events;
  }

  return {
    feed,
    reset,
  };
}

/**
 * Creates the Indicator Assistant.
 * Modes:
 *   - 'off': silent.
 *   - 'reminders': motion-based reminders only (no microphone/sound used).
 *   - 'listen': opt-in sound detection mode. Before indicator sound detection is wired
 *               in via mic, behaves like 'reminders', but immediately processes
 *               indicatorOn(true/false, at) calls when provided.
 *
 * @param {object} [opts]
 * @param {() => number} [opts.clock]
 * @param {'off'|'reminders'|'listen'} [opts.mode]
 * @param {'en'|'hi'|'te'} [opts.lang]
 */
export function createIndicatorAssist({
  clock = () => Date.now(),
  mode = 'reminders',
  lang = 'en',
  // DRV-11c. 'on_demand' (the phone): the microphone listens for a few
  // seconds AFTER a turn or lane change (DRV-11b IndicatorEar, at most 8 s,
  // so Aaria's wake word is only paused briefly). Then only "still on" can be
  // known; whether the driver indicated BEFORE a lane change cannot, so that
  // nag is never said. 'continuous' is for a future always-on sound source.
  soundCoverage = 'on_demand',
} = {}) {
  let currentMode = mode;
  let lastReadingAt = -Infinity;   // when the latest indicator reading was taken
  let currentLang = lang;

  // Spoken phrase tracking
  let lastSpokeAt = -1000000;
  let lastTurnReminderAt = -1000000;
  const phraseTimestamps = []; // for max 6 per hour limit

  // Indicator signal tracking (fed by indicatorOn)
  let hasIndicatorSignal = false;
  let isIndicatorOn = false;
  const indicatorOnTimestamps = []; // timestamps when indicator was confirmed ON

  // Pending reminder check for 'listen' mode:
  // e.g. 6 seconds after turn_done or lane_change
  let pendingStillOnCheck = null; // { checkAt, reason, eventAt }

  function setMode(m) {
    currentMode = m;
  }

  function setLang(l) {
    currentLang = l;
  }

  /**
   * Feed indicator acoustic state (from sound detector or future mic thread).
   * @param {boolean} on
   * @param {number} [at]
   */
  function indicatorOn(on, at = clock()) {
    hasIndicatorSignal = true;
    isIndicatorOn = Boolean(on);
    lastReadingAt = at;
    if (isIndicatorOn) {
      indicatorOnTimestamps.push(at);
      // Prune old entries (> 30s)
      const cutoff = at - 30000;
      while (indicatorOnTimestamps.length > 0 && indicatorOnTimestamps[0] < cutoff) {
        indicatorOnTimestamps.shift();
      }
    }
  }

  function reset() {
    lastSpokeAt = -1000000;
    lastTurnReminderAt = -1000000;
    phraseTimestamps.length = 0;
    hasIndicatorSignal = false;
    isIndicatorOn = false;
    indicatorOnTimestamps.length = 0;
    pendingStillOnCheck = null;
    lastReadingAt = -Infinity;
  }

  /**
   * Checks whether global rate limits permit speaking right now.
   * @param {number} at
   * @param {number} somethingElseSpokeAt
   * @param {number|null} speedKmh
   * @returns {boolean}
   */
  function canSpeak(at, somethingElseSpokeAt, speedKmh) {
    if (currentMode === 'off') return false;

    // Nothing while speed < 8 km/h
    if (speedKmh != null && speedKmh < CONSTANTS.MIN_SPEED_KMH) return false;

    // Never within 2 minutes of other speech
    if (somethingElseSpokeAt && at - somethingElseSpokeAt < CONSTANTS.SPEECH_QUIET_AFTER_OTHER_MS) {
      return false;
    }

    // Never more than 1 indicator phrase per 2 minutes
    if (lastSpokeAt && at - lastSpokeAt < CONSTANTS.SPEECH_MIN_INTERVAL_MS) {
      return false;
    }

    // At most 6 phrases per hour
    const hourCutoff = at - 60 * 60 * 1000;
    while (phraseTimestamps.length > 0 && phraseTimestamps[0] < hourCutoff) {
      phraseTimestamps.shift();
    }
    if (phraseTimestamps.length >= CONSTANTS.MAX_PHRASES_PER_HOUR) {
      return false;
    }

    return true;
  }

  function recordSpoke(at) {
    lastSpokeAt = at;
    phraseTimestamps.push(at);
  }

  /**
   * Process manoeuvre events and return a spoken phrase or null.
   *
   * @param {Array<object>} events list of events from manoeuvreDetector.feed(...)
   * @param {object} [context]
   * @param {number} [context.somethingElseSpokeAt] timestamp of last other speech
   * @param {number} [context.speedKmh] current speed in km/h
   * @param {number} [context.at] current timestamp
   * @param {'en'|'hi'|'te'} [context.lang] override language
   * @returns {string|null}
   */
  function update(events = [], {
    somethingElseSpokeAt = 0,
    speedKmh = null,
    at = clock(),
    lang = currentLang,
  } = {}) {
    if (currentMode === 'off') return null;

    const phrases = PHRASES[lang] || PHRASES.en;

    // Process incoming events to update pending state
    for (const evt of events) {
      if (evt.type === 'turn_done' || evt.type === 'lane_change') {
        if (currentMode === 'listen') {
          // Schedule check for 6 seconds later
          pendingStillOnCheck = {
            checkAt: at + (CONSTANTS.INDICATOR_STILL_ON_DELAY_S * 1000),
            reason: evt.type,
            eventAt: at,
          };
        }
      }
    }

    // ── Check A: Pending 6s check in 'listen' mode with sound known ──────────
    if (currentMode === 'listen' && hasIndicatorSignal && pendingStillOnCheck) {
      // On demand: only a reading taken AFTER this manoeuvre counts - never
      // a stale "on" from an earlier listen. Wait for it within the grace.
      const fresh = soundCoverage !== 'on_demand' || lastReadingAt >= pendingStillOnCheck.eventAt;
      const graceMs = soundCoverage === 'on_demand' ? CONSTANTS.ON_DEMAND_GRACE_MS : 3000;
      if (at >= pendingStillOnCheck.checkAt && !fresh && at > pendingStillOnCheck.checkAt + graceMs) {
        // The listen never reported (mic busy, denied, error). After a turn,
        // fall back to the plain reminder, under its own 5-minute cooldown.
        const wasTurn = pendingStillOnCheck.reason === 'turn_done';
        pendingStillOnCheck = null;
        if (wasTurn && at - lastTurnReminderAt >= CONSTANTS.REMINDERS_COOLDOWN_MS
            && canSpeak(at, somethingElseSpokeAt, speedKmh)) {
          lastTurnReminderAt = at;
          recordSpoke(at);
          return phrases.check_indicator_off;
        }
      } else if (at >= pendingStillOnCheck.checkAt && fresh) {
        if (at <= pendingStillOnCheck.checkAt + graceMs) {
          if (isIndicatorOn) {
            pendingStillOnCheck = null;
            if (canSpeak(at, somethingElseSpokeAt, speedKmh)) {
              recordSpoke(at);
              return phrases.indicator_still_on;
            }
          } else {
            pendingStillOnCheck = null;
          }
        } else {
          // Expired check
          pendingStillOnCheck = null;
        }
      }
    }

    // ── Check B: Incoming event triggers ─────────────────────────────────────
    for (const evt of events) {
      if (evt.type === 'lane_change') {
        // 'listen' mode with indicator sound known:
        // Lane change with NO ticking in the 4 s before it -> "Indicate before changing lanes."
        if (currentMode === 'listen' && hasIndicatorSignal && soundCoverage === 'continuous') {
          const lcStartAt = evt.startAt || at;
          const preCheckWindowStart = lcStartAt - (CONSTANTS.LANE_CHANGE_PRE_CHECK_S * 1000);

          // Did indicator tick between [lcStartAt - 4s, lcStartAt]?
          const tickedBefore = indicatorOnTimestamps.some(
            (t) => t >= preCheckWindowStart && t <= lcStartAt + 500
          );

          if (!tickedBefore) {
            if (canSpeak(at, somethingElseSpokeAt, speedKmh)) {
              recordSpoke(at);
              return phrases.indicate_before_lane_change;
            }
          }
        }
        // In 'reminders' mode: lane changes -> no nag (we cannot know)
      } else if (evt.type === 'turn_done') {
        // 'reminders' mode (or 'listen' mode before sound is known):
        // after 'turn_done' -> "Check your indicator is off." at most once per 5 minutes
        // On-demand listening decides at the check point instead (a listen is
        // about to run; if it fails, Check A falls back to this reminder).
        const actAsReminders = (currentMode === 'reminders')
          || (currentMode === 'listen' && !hasIndicatorSignal && soundCoverage !== 'on_demand');
        if (actAsReminders) {
          const cooldownElapsed = at - lastTurnReminderAt >= CONSTANTS.REMINDERS_COOLDOWN_MS;
          if (cooldownElapsed && canSpeak(at, somethingElseSpokeAt, speedKmh)) {
            lastTurnReminderAt = at;
            recordSpoke(at);
            return phrases.check_indicator_off;
          }
        }
      }
    }

    return null;
  }

  return {
    update,
    indicatorOn,
    setMode,
    setLang,
    reset,
  };
}
