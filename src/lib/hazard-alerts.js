// src/lib/hazard-alerts.js
// Honda 2.0 step 4 — warn a rider about a risky spot BEFORE they reach it.
//
// The thing to beat here is not "no warnings", it is TOO MANY warnings.
// Riders abandon Mappls-style guidance because "sharp curve ahead" fires every
// hundred metres until it becomes noise. So every rule below exists to keep
// this quiet:
//
//   - Only spots the rider is actually heading towards (±55° of travel).
//   - Only while moving at a speed where a warning is useful (20 km/h+).
//   - The warning lands about seven seconds before the spot, so it arrives in
//     time to act on — the faster the rider, the earlier it speaks.
//   - One spot warns once per ride (and never twice within ten minutes).
//   - At least forty seconds of silence between any two warnings.
//   - A spot is only worth speaking about if several riders braked there, or
//     one braked very hard.
//
// Pure functions and a small state machine: no browser APIs, so this is tested
// with simulated rides rather than by riding a motorcycle into a pothole.

export const HAZARD_DEFAULTS = {
  minSpeedKmh: 20,
  leadSeconds: 7,
  minLeadMetres: 60,
  maxLeadMetres: 260,
  headingToleranceDeg: 55,
  perSpotCooldownMs: 10 * 60 * 1000,
  betweenWarningsMs: 40 * 1000,
  minReports: 2,          // two riders braking, or…
  severeCountsAs: 'severe', // …one severe braking event is enough on its own
};

const R = 6371000; // earth radius, metres
const toRad = d => (d * Math.PI) / 180;
const toDeg = r => (r * 180) / Math.PI;

export function metresBetween(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function bearingDeg(from, to) {
  const lat1 = toRad(from.lat), lat2 = toRad(to.lat);
  const dLng = toRad(to.lng - from.lng);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Smallest angle between two compass bearings, 0-180. */
export function angleBetween(a, b) {
  return Math.abs(((a - b + 540) % 360) - 180);
}

/** How far ahead the warning should land, given how fast the rider is going. */
export function leadMetresFor(speedKmh, cfg = HAZARD_DEFAULTS) {
  const metresPerSecond = (speedKmh * 1000) / 3600;
  return Math.max(cfg.minLeadMetres, Math.min(cfg.maxLeadMetres, metresPerSecond * cfg.leadSeconds));
}

/** Is this spot worth speaking about at all? */
export function spotIsWorthWarning(spot, cfg = HAZARD_DEFAULTS) {
  const reports = spot.reports ?? 1;
  return reports >= cfg.minReports || spot.severity === cfg.severeCountsAs;
}

/** The sentence Aaria says. Calm, short, and never an instruction to brake. */
export function phraseFor(spot) {
  const reports = spot.reports ?? 1;
  if (spot.kind === 'pothole') return 'Rough road reported just ahead.';
  if (spot.kind === 'swerve')  return 'Riders often swerve just ahead.';
  if (spot.severity === 'severe') return 'Careful. Riders brake hard just ahead.';
  if (reports >= 5) return 'This next stretch catches riders out. Take it easy.';
  return 'Riders often slow down suddenly just ahead.';
}

export function createHazardWarner(options = {}) {
  const cfg = { ...HAZARD_DEFAULTS, ...options };
  const warnedAt = new Map(); // spot id → when it last spoke
  let lastWarningAt = 0;

  /**
   * Feed the current position; get back a warning to speak, or null.
   * position: { lat, lng, headingDeg, speedKmh, at }
   * spots:    [{ id, lat, lng, kind, severity, reports }]
   */
  function update(position, spots = []) {
    const at = position.at ?? Date.now();
    if (!position || typeof position.lat !== 'number' || typeof position.lng !== 'number') return null;
    if (!(position.speedKmh >= cfg.minSpeedKmh)) return null;
    if (at - lastWarningAt < cfg.betweenWarningsMs) return null;

    const lead = leadMetresFor(position.speedKmh, cfg);
    let best = null;

    for (const spot of spots) {
      if (!spotIsWorthWarning(spot, cfg)) continue;
      const seen = warnedAt.get(spot.id);
      if (seen && at - seen < cfg.perSpotCooldownMs) continue;

      const distance = metresBetween(position, spot);
      // Too far to mention yet, or already passed it.
      if (distance > lead || distance < 15) continue;

      if (typeof position.headingDeg === 'number') {
        const offAxis = angleBetween(position.headingDeg, bearingDeg(position, spot));
        if (offAxis > cfg.headingToleranceDeg) continue; // behind, or across the divider
      }
      if (!best || distance < best.distance) best = { spot, distance };
    }

    if (!best) return null;
    warnedAt.set(best.spot.id, at);
    lastWarningAt = at;
    return {
      spotId: best.spot.id,
      distanceMetres: Math.round(best.distance),
      phrase: phraseFor(best.spot),
      spot: best.spot,
    };
  }

  function reset() { warnedAt.clear(); lastWarningAt = 0; }

  return { update, reset };
}
