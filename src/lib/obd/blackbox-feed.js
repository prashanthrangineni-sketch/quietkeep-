// src/lib/obd/blackbox-feed.js
// QuietKeep OBD-to-Blackbox Live Feed - Task Card DRV-08

/**
 * Default push function invoking the native Capacitor plugin.
 */
async function defaultPush(sample) {
  if (typeof window !== 'undefined' && window.Capacitor?.Plugins?.QkBlackbox?.pushObd) {
    return await window.Capacitor.Plugins.QkBlackbox.pushObd(sample);
  }
  return { accepted: false, reason: 'not_native' };
}

/**
 * Start polling the Car Reader (OBD-II) and streaming readings into the black box.
 *
 * @param {object} reader - ObdReader instance
 * @param {object} [options]
 * @param {number} [options.intervalMs=500] - Polling interval in ms (nominal 2 Hz)
 * @param {number} [options.backoffMs=2000] - Failure backoff interval in ms (2 s)
 * @param {number} [options.maxConsecutiveFailures=5] - Failure threshold before backing off
 * @param {Function} [options.push] - Destination push function
 * @param {Function} [options.clock] - Injectable clock (() => epoch ms)
 * @param {Function} [options.setTimer] - Injectable setTimer ((fn, ms) => timerId)
 * @param {Function} [options.clearTimer] - Injectable clearTimer ((timerId) => void)
 * @param {string} [options.source] - Optional source name ('simulated', reader name, etc.)
 * @returns {Function} stop - Function to terminate the feed cleanly
 */
export function startObdFeed(reader, options = {}) {
  const {
    intervalMs = 500,
    backoffMs = 2000,
    maxConsecutiveFailures = 5,
    push = (typeof window !== 'undefined' && window.Capacitor?.Plugins?.QkBlackbox?.pushObd)
      ? (sample) => window.Capacitor.Plugins.QkBlackbox.pushObd(sample)
      : defaultPush,
    clock = () => Date.now(),
    setTimer = (fn, ms) => setTimeout(fn, ms),
    clearTimer = (id) => clearTimeout(id),
    source = null,
  } = options;

  let stopped = false;
  let inFlight = false;
  let consecutiveFailures = 0;
  let timerId = null;

  const resolvedSource = source !== null && source !== undefined ? source : (
    reader?.isSimulator || reader?.elm?.transport?.constructor?.name === 'ObdSimulator'
      ? 'simulated'
      : (reader?.deviceName || null)
  );

  function getInterval() {
    return consecutiveFailures >= maxConsecutiveFailures ? backoffMs : intervalMs;
  }

  function scheduleNext(delayMs) {
    if (stopped) return;
    const ms = typeof delayMs === 'number' ? delayMs : getInterval();
    timerId = setTimer(tick, ms);
  }

  async function tick() {
    if (stopped) return;

    if (inFlight) {
      // NEVER overlapping: skip this tick if the previous read has not finished
      return;
    }

    inFlight = true;
    try {
      const snapshot = await reader.readSnapshot();
      if (stopped) return;

      // On successful read, reset consecutive failure counter
      consecutiveFailures = 0;

      const sample = {
        at: snapshot?.at || new Date(clock()).toISOString(),
        speedKmh: (snapshot && typeof snapshot.speedKmh === 'number' && Number.isFinite(snapshot.speedKmh))
          ? snapshot.speedKmh : null,
        rpm: (snapshot && typeof snapshot.rpm === 'number' && Number.isFinite(snapshot.rpm))
          ? snapshot.rpm : null,
        loadPct: (snapshot && typeof snapshot.loadPct === 'number' && Number.isFinite(snapshot.loadPct))
          ? snapshot.loadPct : null,
        coolantC: (snapshot && typeof snapshot.coolantC === 'number' && Number.isFinite(snapshot.coolantC))
          ? snapshot.coolantC : null,
        voltage: (snapshot && typeof snapshot.voltage === 'number' && Number.isFinite(snapshot.voltage))
          ? snapshot.voltage : null,
        mil: !!(snapshot && snapshot.mil),
        source: resolvedSource,
      };

      try {
        await push(sample);
      } catch (pushErr) {
        // Push errors do not count as reader read failures
      }
    } catch (err) {
      if (stopped) return;
      consecutiveFailures++;
    } finally {
      inFlight = false;
      if (!stopped) {
        scheduleNext();
      }
    }
  }

  // Start polling immediately with first tick
  scheduleNext(0);

  return function stop() {
    stopped = true;
    if (timerId !== null) {
      clearTimer(timerId);
      timerId = null;
    }
  };
}

/**
 * Helper to extract millisecond epoch time from an OBD or GPS sample.
 */
function extractTimeMs(s) {
  if (!s) return NaN;
  if (typeof s.timestampUs === 'number' || typeof s.timestampUs === 'bigint') {
    return Number(s.timestampUs) / 1000;
  }
  if (s.at != null) {
    if (typeof s.at === 'number') {
      return s.at > 1e14 ? s.at / 1000 : s.at;
    }
    const t = new Date(s.at).getTime();
    if (!Number.isNaN(t)) return t;
  }
  if (typeof s.timeMs === 'number') return s.timeMs;
  return NaN;
}

/**
 * Helper to extract speed in km/h from an OBD or GPS sample.
 */
function extractSpeedKmh(s) {
  if (!s) return NaN;
  if (typeof s.speedKmh === 'number' && Number.isFinite(s.speedKmh)) {
    return s.speedKmh;
  }
  if (typeof s.speed_kmh === 'number' && Number.isFinite(s.speed_kmh)) {
    return s.speed_kmh;
  }
  if (typeof s.speed === 'number' && Number.isFinite(s.speed)) {
    // GPS standard records store speed in m/s; convert to km/h (1 m/s = 3.6 km/h)
    return s.speed * 3.6;
  }
  return NaN;
}

/**
 * Compare OBD speed readings against GPS speed fixes (Task Card DRV-08 Step 6).
 * Pairs each GPS fix with the nearest OBD sample within 500 ms.
 *
 * @param {Array} obdSamples
 * @param {Array} gpsSamples
 * @returns {{ pairs: Array, maxDiffKmh: number, meanDiffKmh: number }}
 */
export function compareSpeeds(obdSamples = [], gpsSamples = []) {
  const obdList = (obdSamples || []).map(s => ({
    raw: s,
    timeMs: extractTimeMs(s),
    speedKmh: extractSpeedKmh(s),
  })).filter(s => Number.isFinite(s.timeMs) && Number.isFinite(s.speedKmh));

  const matchedPairs = [];

  for (const gps of (gpsSamples || [])) {
    const gpsTime = extractTimeMs(gps);
    const gpsSpeed = extractSpeedKmh(gps);
    if (!Number.isFinite(gpsTime) || !Number.isFinite(gpsSpeed)) continue;

    let nearest = null;
    let minDelta = Infinity;

    for (const obd of obdList) {
      const delta = Math.abs(gpsTime - obd.timeMs);
      if (delta <= 500 && delta < minDelta) {
        minDelta = delta;
        nearest = obd;
      }
    }

    if (nearest) {
      const diffKmh = Math.abs(nearest.speedKmh - gpsSpeed);
      matchedPairs.push({
        gps,
        obd: nearest.raw,
        gpsSpeedKmh: gpsSpeed,
        obdSpeedKmh: nearest.speedKmh,
        diffKmh,
        timeDeltaMs: minDelta,
      });
    }
  }

  // Support numeric comparisons: pairs >= 10, pairs.length, etc.
  matchedPairs.valueOf = function() { return this.length; };

  if (matchedPairs.length === 0) {
    return {
      pairs: matchedPairs,
      maxDiffKmh: 0,
      meanDiffKmh: 0,
    };
  }

  let maxDiff = 0;
  let sumDiff = 0;
  for (const p of matchedPairs) {
    if (p.diffKmh > maxDiff) maxDiff = p.diffKmh;
    sumDiff += p.diffKmh;
  }

  const meanDiff = sumDiff / matchedPairs.length;

  return {
    pairs: matchedPairs,
    maxDiffKmh: Number(maxDiff.toFixed(4)),
    meanDiffKmh: Number(meanDiff.toFixed(4)),
  };
}
