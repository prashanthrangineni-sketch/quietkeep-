// src/lib/obd/active-reader.js
// The one car reader connected right now (DRV-06), shared with the rest of
// the app so "how is my car?" by voice answers from the same reader the
// Drive Mode screen connected — never a second connection to the car.
//
// Drive Mode sets it on connect and clears it on disconnect / leaving Drive.
// Voice (src/lib/drive-voice.js, Intent Layer lane) reads it through
// describeCar() / describeFaults(), which return null when no reader is
// connected so the caller can say "Connect the car reader first".
// Read-only by construction: it only calls the reader's read methods, which
// go through the elm327.js allow-list.

let active = null;

export function setActiveReader(reader) {
  active = reader || null;
}

export function getActiveReader() {
  return active;
}

export function isCarReaderConnected() {
  return !!active;
}

/** Plain-English health line from live readings, or null if no reader. */
export async function describeCar() {
  const r = active;
  if (!r) return null;
  const snapshot = await r.readSnapshot();
  let faults = [];
  if (snapshot && (snapshot.mil || snapshot.dtcCount > 0)) {
    try { faults = await r.readFaults(); } catch { faults = []; }
  }
  return r.summary(snapshot, faults);
}

/** Fault-code line ("No fault codes stored." or the summary with codes), or null. */
export async function describeFaults() {
  const r = active;
  if (!r) return null;
  const faults = await r.readFaults();
  if (!faults || faults.length === 0) return 'No fault codes are stored in the car.';
  const snapshot = await r.readSnapshot().catch(() => null);
  return r.summary(snapshot || { mil: true, dtcCount: faults.length }, faults);
}
