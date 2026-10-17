// src/lib/drive-speed.js
// The phone's latest GPS speed while Drive Mode (or a ride) is running —
// one shared value, so Aaria can send it to the server's safety check
// (src/lib/action-levels.js, speed gate DRV-02, context.speedKmh).
//
// Writers: the Drive Mode screen (its own GPS watch) and the ride guard
// (feedRideSpeed). Reader: the Aaria dock, which adds speed_kmh to each
// capture request. A reading older than FRESH_MS, or none at all, gives null:
// the gate then does nothing (unknown is never assumed to be driving).

export const FRESH_MS = 15_000;

let last = null; // { kmh, at }

export function setDriveSpeed(kmh, at = Date.now()) {
  if (typeof kmh !== 'number' || !Number.isFinite(kmh) || kmh < 0 || kmh > 400) return;
  last = { kmh: Math.round(kmh * 10) / 10, at };
}

export function clearDriveSpeed() {
  last = null;
}

/** Latest speed in km/h, or null when unknown or stale. */
export function getDriveSpeedKmh(now = Date.now()) {
  if (!last || now - last.at > FRESH_MS) return null;
  return last.kmh;
}

/** Sanitise a speed received from a client: a finite number 0..400, else null. */
export function cleanSpeedKmh(v) {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 400 ? v : null;
}
