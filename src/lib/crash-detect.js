// src/lib/crash-detect.js
// Rider crash / fall detection — pure logic, no browser APIs.
//
// The screen feeds it two streams and nothing else:
//   feedMotion({ magnitudeG, at })  — total acceleration in g, from DeviceMotion
//   feedSpeed({ kmh, at })          — GPS speed, when available
// It answers with a state: 'idle' | 'riding' | 'suspected' | 'crash' | 'dismissed'.
//
// Why it is built this way
// ------------------------
// A phone that slips off a table also records a hard knock. The thing that
// separates a crash from a dropped phone is CONTEXT and AFTERMATH:
//   1. context  — the phone was moving like a vehicle shortly before the knock,
//   2. aftermath — the phone then goes unnaturally still, and the ride stops.
// Requiring all three (ride + impact + stillness) is what keeps this quiet.
// Apple's crash detection set off 134 false emergency calls in one Japanese
// ski area; REALRIDER got under 1% only after heavy real-world testing. We
// start deliberately conservative and will loosen only with logged evidence.

export const CRASH_DEFAULTS = {
  // A knock this hard is unusual in normal riding. 1g is gravity at rest.
  impactG: 3.2,
  // Free-fall dip that often precedes a fall. Optional evidence, never required.
  freefallG: 0.35,
  freefallMinMs: 100,
  // After the knock, the phone must stay this still for this long.
  stillnessG: 0.22,
  stillnessMs: 8000,
  // Context: it must have been travelling before the knock.
  ridingSpeedKmh: 12,
  ridingWindowMs: 90_000,
  // Aftermath: the ride must have effectively stopped.
  stoppedSpeedKmh: 6,
  // Motion can also prove riding when GPS is unavailable (tunnel, no fix):
  // sustained shake above this, seen this many times in the window.
  motionRidingG: 1.25,
  motionRidingHits: 12,
};

export function createCrashDetector(options = {}) {
  const cfg = { ...CRASH_DEFAULTS, ...options };

  let state = 'idle';
  let lastRidingAt = 0;        // when we last had evidence of travelling
  let motionHits = [];         // timestamps of vehicle-like motion
  let lastSpeed = null;        // { kmh, at }
  let freefallStart = 0;
  let sawFreefall = false;
  let impact = null;           // { at, magnitudeG, speedKmh, hadFreefall }
  let stillSince = 0;
  let listeners = [];

  function emit(next, detail) {
    if (next === state) return;
    state = next;
    for (const fn of listeners) {
      try { fn(state, detail || {}); } catch { /* a bad listener never stops detection */ }
    }
  }

  function wasRidingAt(at) {
    return at - lastRidingAt <= cfg.ridingWindowMs;
  }

  function feedSpeed({ kmh, at = Date.now() }) {
    if (typeof kmh !== 'number' || isNaN(kmh)) return state;
    lastSpeed = { kmh, at };
    if (kmh >= cfg.ridingSpeedKmh) {
      lastRidingAt = at;
      if (state === 'idle') emit('riding', { speedKmh: kmh });
    }
    // Riding away from a suspected crash is the clearest possible "I'm fine".
    if (state === 'suspected' && kmh >= cfg.stoppedSpeedKmh + 4) {
      impact = null;
      emit('dismissed', { reason: 'moving again', speedKmh: kmh });
      emit('riding', { speedKmh: kmh });
    }
    return state;
  }

  function feedMotion({ magnitudeG, at = Date.now() }) {
    if (typeof magnitudeG !== 'number' || isNaN(magnitudeG)) return state;
    const deviation = Math.abs(magnitudeG - 1);

    // ── Free-fall watch (evidence only) ──────────────────────────────────────
    if (magnitudeG < cfg.freefallG) {
      if (!freefallStart) freefallStart = at;
      if (at - freefallStart >= cfg.freefallMinMs) sawFreefall = true;
    } else if (freefallStart && at - freefallStart > 1500) {
      freefallStart = 0;
      sawFreefall = false;
    } else if (magnitudeG > cfg.freefallG + 0.2) {
      freefallStart = 0;
    }

    // ── Riding evidence from motion, for when GPS has no fix ─────────────────
    if (magnitudeG >= cfg.motionRidingG && magnitudeG < cfg.impactG) {
      motionHits.push(at);
      motionHits = motionHits.filter(t => at - t <= cfg.ridingWindowMs);
      if (motionHits.length >= cfg.motionRidingHits) {
        lastRidingAt = at;
        if (state === 'idle') emit('riding', { reason: 'motion' });
      }
    }

    // ── Impact ───────────────────────────────────────────────────────────────
    if (magnitudeG >= cfg.impactG && (state === 'idle' || state === 'riding' || state === 'dismissed')) {
      // The guard that stops a dropped phone from calling your family.
      if (!wasRidingAt(at)) return state;
      impact = { at, magnitudeG, speedKmh: lastSpeed?.kmh ?? null, hadFreefall: sawFreefall };
      stillSince = 0;
      sawFreefall = false;
      emit('suspected', { impact });
      return state;
    }

    // ── Aftermath: stillness after the impact ────────────────────────────────
    if (state === 'suspected' && impact) {
      if (deviation > cfg.stillnessG) {
        // Still being knocked about, or the rider is moving. Restart the clock.
        stillSince = 0;
        // Rider clearly riding on: treat as a bump in the road, not a crash.
        if (at - impact.at > cfg.stillnessMs * 2) {
          impact = null;
          emit('dismissed', { reason: 'movement continued' });
        }
        return state;
      }
      if (!stillSince) stillSince = at;
      const stillFor = at - stillSince;
      const speedOk = lastSpeed === null
        || lastSpeed.kmh <= cfg.stoppedSpeedKmh
        || at - lastSpeed.at > 20_000;
      if (stillFor >= cfg.stillnessMs && speedOk) {
        emit('crash', {
          impactG: impact.magnitudeG,
          hadFreefall: impact.hadFreefall,
          speedBeforeKmh: impact.speedKmh,
          stillForMs: stillFor,
        });
      }
    }
    return state;
  }

  return {
    feedMotion,
    feedSpeed,
    /** Pretend a crash happened — for the "test my crash detection" button. */
    simulateCrash(at = Date.now()) {
      impact = { at, magnitudeG: cfg.impactG, speedKmh: lastSpeed?.kmh ?? null, hadFreefall: false };
      emit('suspected', { impact, test: true });
      emit('crash', { test: true, impactG: cfg.impactG, stillForMs: cfg.stillnessMs });
      return state;
    },
    /** Rider said they are fine, or the alert was sent — go back to watching. */
    reset(keepRiding = true) {
      impact = null;
      stillSince = 0;
      freefallStart = 0;
      sawFreefall = false;
      state = keepRiding && wasRidingAt(Date.now()) ? 'riding' : 'idle';
      return state;
    },
    onChange(fn) {
      listeners.push(fn);
      return () => { listeners = listeners.filter(f => f !== fn); };
    },
    getState() { return state; },
    debug() {
      return { state, lastRidingAt, lastSpeed, impact, stillSince, motionHits: motionHits.length };
    },
  };
}

/** Total acceleration in g from a DeviceMotion reading (includes gravity). */
export function magnitudeFromMotionEvent(event) {
  const a = event?.accelerationIncludingGravity;
  if (!a || (a.x == null && a.y == null && a.z == null)) return null;
  const x = a.x || 0, y = a.y || 0, z = a.z || 0;
  return Math.sqrt(x * x + y * y + z * z) / 9.81;
}
