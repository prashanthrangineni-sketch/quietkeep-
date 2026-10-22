// src/lib/proof-kit.js
// QuietKeep Phase-2 Proof Kit (Task Card AG-04)
//
// Structured checklist, pure evaluation functions, and persistence helpers
// for the founder's field-test screen on real hardware.

import { decodeObdRecord } from './blackbox.js';
import { compareSpeeds } from './obd/blackbox-feed.js';

/**
 * Checklist steps for the Phase-2 field test (in specification order).
 */
export const CHECKLIST_STEPS = [
  {
    id: 'reader_genuine',
    num: '1',
    stepNumber: 1,
    title: 'Reader genuine',
    description: 'Vgate updater recognised it (genuine firmware & device check)',
    type: 'manual',
    prompt: 'Did the official Vgate updater recognise the reader as genuine?',
  },
  {
    id: 'desk_test_tilt',
    num: '2',
    stepNumber: 2,
    title: 'Desk test: tilt in test mode',
    description: 'Tilt in test mode → a black-box record appears and is sealed',
    type: 'auto',
    prompt: 'Run test mode, tilt device > 45°, and verify a sealed black-box record is created.',
  },
  {
    id: 'parked_car_reader',
    num: '3',
    stepNumber: 3,
    title: 'Parked car reader',
    description: 'Connect + "Read car now" → snapshot with rpm and voltage arrived',
    type: 'auto',
    prompt: 'Connect to vehicle reader in parked car and read telemetry (rpm and voltage).',
  },
  {
    id: 'voice_car_status',
    num: '4',
    stepNumber: 4,
    title: '"How is my car?" by voice',
    description: 'Ask Aaria "How is my car?" by voice and hear spoken car status',
    type: 'manual',
    prompt: 'Ask "How is my car?" and verify the spoken response matches car status.',
  },
  {
    id: 'proof_ride_brakes',
    num: '5a',
    stepNumber: 5,
    title: 'Proof ride: three firm brakes',
    description: 'Count new ride_road_events rows for user in last 30 min (≥ 3)',
    type: 'auto',
    prompt: 'Perform 3 firm decelerations during ride; verify ≥ 3 road brake events recorded.',
  },
  {
    id: 'proof_ride_fall_checkin',
    num: '5b',
    stepNumber: 5,
    title: 'Proof ride: staged fall check-in',
    description: 'Staged fall check-in appeared',
    type: 'manual',
    prompt: 'Did the staged fall/crash check-in dialog appear on phone?',
  },
  {
    id: 'proof_ride_save60',
    num: '5c',
    stepNumber: 5,
    title: 'Proof ride: "save last 60" with OBD',
    description: '"Save last 60" produced a record with obd_samples > 0',
    type: 'auto',
    prompt: 'Trigger "save last 60" and verify newest sealed record has obd_samples > 0.',
  },
  {
    id: 'speed_check',
    num: '6',
    stepNumber: 6,
    title: 'Speed check: OBD vs GPS',
    description: 'compareSpeeds on record OBD and GPS samples passes with maxDiffKmh ≤ 1',
    type: 'auto',
    prompt: 'Run speed comparison between OBD wheel speed and GPS speed; verify diff ≤ 1 km/h.',
  },
  {
    id: 'speed_rule',
    num: '7',
    stepNumber: 7,
    title: 'Speed rule: action deferral while moving',
    description: 'While moving, ask Aaria to pay someone → "I\'ll do that when you stop"',
    type: 'manual',
    prompt: 'While vehicle moving, ask to send money/pay someone; verify refusal until stopped.',
  },
  {
    id: 'indicator_reminder',
    num: '8',
    stepNumber: 8,
    title: 'Indicator reminder',
    description: 'Turn and leave the indicator on → "Your indicator is still on" (listening ON)',
    type: 'manual',
    prompt: 'Turn and keep indicator running; verify spoken reminder (if listening is enabled).',
  },
];

/**
 * Get step definition by ID or number.
 */
export function getStep(stepIdOrNum) {
  return CHECKLIST_STEPS.find(s => s.id === stepIdOrNum || s.num === String(stepIdOrNum)) ?? null;
}

/**
 * Convert base64 string to Uint8Array safely across Node and Browser environments.
 */
export function base64ToBytes(b64) {
  if (typeof b64 !== 'string') return new Uint8Array(0);
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(b64, 'base64'));
  }
  if (typeof atob === 'function') {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  return new Uint8Array(0);
}

/**
 * Step 2 Evaluator: Desk test tilt in test mode.
 * Evaluates whether a new sealed blackbox record exists.
 *
 * @param {{ records?: Array, baselineIds?: Array<string> }} options
 * @returns {{ pass: boolean, reason?: string, evidence?: object }}
 */
export function evalDeskTest(options = {}) {
  const opts = options || {};
  const records = opts.records;
  const baselineIds = opts.baselineIds;
  if (!records || !Array.isArray(records) || records.length === 0) {
    return { pass: false, reason: 'missing_data', evidence: { recordsCount: 0 } };
  }
  const baseline = new Set(Array.isArray(baselineIds) ? baselineIds : []);
  const candidates = records.filter(r => r && r.id && !baseline.has(r.id));
  if (candidates.length === 0) {
    return {
      pass: false,
      reason: 'no_new_records',
      evidence: { recordsCount: records.length, baselineCount: baseline.size },
    };
  }

  const sealed = candidates.find(r => r.sealed === true || (typeof r.signature === 'string' && r.signature.trim().length > 0));
  if (!sealed) {
    return {
      pass: false,
      reason: 'record_not_sealed',
      evidence: { candidateCount: candidates.length },
    };
  }

  return {
    pass: true,
    evidence: {
      recordId: sealed.id,
      trigger: sealed.trigger || 'unknown',
      sealed: true,
      signatureLength: sealed.signature ? sealed.signature.length : undefined,
    },
  };
}

/**
 * Step 3 Evaluator: Parked car reader snapshot.
 * Passes if a snapshot with rpm and voltage arrived.
 *
 * @param {object} snapshot
 * @returns {{ pass: boolean, reason?: string, evidence?: object }}
 */
export function evalParkedCarSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') {
    return { pass: false, reason: 'missing_data', evidence: null };
  }

  const hasRpm = typeof snapshot.rpm === 'number' && Number.isFinite(snapshot.rpm);
  const hasVoltage = typeof snapshot.voltage === 'number' && Number.isFinite(snapshot.voltage);

  if (hasRpm && hasVoltage) {
    return {
      pass: true,
      evidence: {
        rpm: snapshot.rpm,
        voltage: snapshot.voltage,
        coolantC: Number.isFinite(snapshot.coolantC) ? snapshot.coolantC : null,
        mil: !!snapshot.mil,
      },
    };
  }

  const missing = [];
  if (!hasRpm) missing.push('rpm');
  if (!hasVoltage) missing.push('voltage');

  return {
    pass: false,
    reason: `missing_${missing.join('_and_')}`,
    evidence: {
      rpm: snapshot.rpm ?? null,
      voltage: snapshot.voltage ?? null,
    },
  };
}

/**
 * Step 5a Evaluator: Proof ride three firm brakes.
 * Passes if new ride_road_events count in the last 30 minutes ≥ minCount (default 3).
 *
 * @param {{ events?: Array, count?: number, minCount?: number, nowMs?: number, windowMs?: number }} options
 * @returns {{ pass: boolean, reason?: string, evidence?: object }}
 */
export function evalFirmBrakes(options = {}) {
  const opts = options || {};
  const { events, count, minCount = 3, nowMs, windowMs = 30 * 60 * 1000 } = opts;
  if (count !== undefined && count !== null) {
    if (typeof count !== 'number' || !Number.isFinite(count)) {
      return { pass: false, reason: 'missing_data', evidence: { count } };
    }
    if (count >= minCount) {
      return { pass: true, evidence: { count, required: minCount } };
    }
    return { pass: false, reason: 'insufficient_brakes', evidence: { count, required: minCount } };
  }

  if (!events || !Array.isArray(events)) {
    return { pass: false, reason: 'missing_data', evidence: null };
  }

  const now = typeof nowMs === 'number' && Number.isFinite(nowMs) ? nowMs : Date.now();
  const cutoff = now - windowMs;

  const valid = events.filter(e => {
    if (!e) return false;
    if (e.created_at) {
      const t = typeof e.created_at === 'number' ? e.created_at : Date.parse(e.created_at);
      if (Number.isFinite(t) && t < cutoff) return false;
    }
    if (e.kind && e.kind !== 'hard_brake') return false;
    return true;
  });

  const n = valid.length;
  if (n >= minCount) {
    return {
      pass: true,
      evidence: {
        count: n,
        required: minCount,
        eventIds: valid.map(e => e.id).filter(Boolean).slice(0, 5),
      },
    };
  }

  return {
    pass: false,
    reason: 'insufficient_brakes',
    evidence: { count: n, required: minCount },
  };
}

/**
 * Extract and parse the first-line JSON header of a .qkedr packet.
 *
 * @param {string|Uint8Array|object} input - Base64 string, Uint8Array, or { data: string } record object
 * @returns {object|null} parsed JSON header object or null
 */
export function parsePacketHeader(input) {
  if (!input) return null;

  if (typeof input === 'object' && input.obd_samples !== undefined) {
    return input;
  }
  if (typeof input === 'object' && input.header && input.header.obd_samples !== undefined) {
    return input.header;
  }

  let bytes = null;
  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (trimmed.startsWith('{')) {
      try { return JSON.parse(trimmed); } catch { return null; }
    }
    bytes = base64ToBytes(input);
  } else if (input instanceof Uint8Array) {
    bytes = input;
  } else if (input && typeof input.data === 'string') {
    bytes = base64ToBytes(input.data);
  } else if (input && input.data instanceof Uint8Array) {
    bytes = input.data;
  }

  if (!bytes || bytes.length === 0) return null;

  let newline = -1;
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0x0A) {
      newline = i;
      break;
    }
  }

  const slice = newline > 0 ? bytes.slice(0, newline) : bytes;
  try {
    const text = typeof Buffer !== 'undefined'
      ? Buffer.from(slice).toString('utf8')
      : new TextDecoder('utf-8').decode(slice);
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Step 5c Evaluator: "Save last 60" produced a record with obd_samples > 0.
 *
 * @param {object|string} recordOrHeader
 * @returns {{ pass: boolean, reason?: string, evidence?: object }}
 */
export function evalSave60Record(recordOrHeader) {
  if (!recordOrHeader) {
    return { pass: false, reason: 'missing_data', evidence: null };
  }

  const header = parsePacketHeader(recordOrHeader);
  if (!header || typeof header !== 'object') {
    return { pass: false, reason: 'invalid_header', evidence: null };
  }

  const obdSamples = Number(header.obd_samples);
  if (Number.isFinite(obdSamples) && obdSamples > 0) {
    return {
      pass: true,
      evidence: {
        obdSamples,
        trigger: header.trigger || 'unknown',
        startedAt: header.started_at || '',
        endedAt: header.ended_at || '',
        gpsSamples: Number(header.gps_samples) || 0,
        imuSamples: Number(header.imu_samples) || 0,
      },
    };
  }

  return {
    pass: false,
    reason: 'no_obd_samples',
    evidence: {
      obdSamples: Number.isFinite(obdSamples) ? obdSamples : 0,
      trigger: header.trigger || 'unknown',
    },
  };
}

/**
 * Decode a 40-byte little-endian GPS sample from .qkedr binary layout.
 */
export function decodeGpsRecord(buffer, offset = 0) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset + offset, 40);
  const timestampUs = Number(view.getBigInt64(0, true));
  const lat = view.getFloat64(8, true);
  const lon = view.getFloat64(16, true);
  const alt = view.getFloat32(24, true);
  const speed = view.getFloat32(28, true); // m/s
  const bearing = view.getFloat32(32, true);
  const accuracy = view.getFloat32(36, true);
  return {
    timestampUs,
    lat,
    lon,
    alt,
    speed, // m/s (extractSpeedKmh in blackbox-feed.js converts speed * 3.6)
    speedKmh: speed * 3.6,
    bearing,
    accuracy,
  };
}

/**
 * Parse an entire .qkedr packet into header, decoded GPS samples, and decoded OBD samples.
 *
 * @param {string|Uint8Array|object} packet - Packet bytes, base64 string, or record object
 * @returns {{ header: object, gpsSamples: Array, obdSamples: Array } | null}
 */
export function parseBlackboxPacket(packet) {
  if (!packet) return null;

  let bytes = null;
  if (typeof packet === 'string') {
    bytes = base64ToBytes(packet);
  } else if (packet instanceof Uint8Array) {
    bytes = packet;
  } else if (packet && typeof packet.data === 'string') {
    bytes = base64ToBytes(packet.data);
  } else if (packet && packet.data instanceof Uint8Array) {
    bytes = packet.data;
  }

  if (!bytes || bytes.length === 0) return null;

  let newline = -1;
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0x0A) {
      newline = i;
      break;
    }
  }
  if (newline <= 0) return null;

  let header;
  try {
    const text = typeof Buffer !== 'undefined'
      ? Buffer.from(bytes.slice(0, newline)).toString('utf8')
      : new TextDecoder('utf-8').decode(bytes.slice(0, newline));
    header = JSON.parse(text);
  } catch {
    return null;
  }

  const imuCount = Number(header.imu_samples) || 0;
  const gpsCount = Number(header.gps_samples) || 0;
  const obdCount = Number(header.obd_samples) || 0;

  const imuStart = newline + 1;
  const gpsStart = imuStart + imuCount * 32;
  const obdStart = gpsStart + gpsCount * 40;

  const gpsSamples = [];
  if (bytes.length >= gpsStart + gpsCount * 40) {
    for (let i = 0; i < gpsCount; i++) {
      gpsSamples.push(decodeGpsRecord(bytes, gpsStart + i * 40));
    }
  }

  const obdSamples = [];
  if (bytes.length >= obdStart + obdCount * 32) {
    for (let i = 0; i < obdCount; i++) {
      obdSamples.push(decodeObdRecord(bytes, obdStart + i * 32));
    }
  }

  return {
    header,
    gpsSamples,
    obdSamples,
  };
}

/**
 * Step 6 Evaluator: Speed check OBD vs GPS.
 * Passes if compareSpeeds(obd, gps) produces matching pairs and maxDiffKmh ≤ maxDiffAllowed (default 1).
 *
 * @param {{ obdSamples?: Array, gpsSamples?: Array, record?: any, maxDiffAllowed?: number }} options
 * @returns {{ pass: boolean, reason?: string, evidence?: object }}
 */
export function evalSpeedCheck(options = {}) {
  const opts = options || {};
  let { obdSamples, gpsSamples, record, maxDiffAllowed = 1 } = opts;
  let obd = obdSamples;
  let gps = gpsSamples;

  if ((!obd || !gps) && record) {
    const parsed = parseBlackboxPacket(record);
    if (parsed) {
      obd = obd || parsed.obdSamples;
      gps = gps || parsed.gpsSamples;
    }
  }

  if (!obd || !gps || !Array.isArray(obd) || !Array.isArray(gps)) {
    return {
      pass: false,
      reason: 'missing_data',
      evidence: {
        obdCount: Array.isArray(obd) ? obd.length : 0,
        gpsCount: Array.isArray(gps) ? gps.length : 0,
      },
    };
  }

  if (obd.length === 0 || gps.length === 0) {
    return {
      pass: false,
      reason: 'empty_samples',
      evidence: { obdCount: obd.length, gpsCount: gps.length },
    };
  }

  const comp = compareSpeeds(obd, gps);
  const pairCount = Array.isArray(comp?.pairs) ? comp.pairs.length : Number(comp?.pairs || 0);

  if (pairCount === 0) {
    return {
      pass: false,
      reason: 'no_matching_pairs',
      evidence: { obdCount: obd.length, gpsCount: gps.length, pairCount: 0 },
    };
  }

  if (comp.maxDiffKmh <= maxDiffAllowed) {
    return {
      pass: true,
      evidence: {
        maxDiffKmh: comp.maxDiffKmh,
        meanDiffKmh: comp.meanDiffKmh,
        pairCount,
        threshold: maxDiffAllowed,
      },
    };
  }

  return {
    pass: false,
    reason: 'speed_diff_exceeded',
    evidence: {
      maxDiffKmh: comp.maxDiffKmh,
      meanDiffKmh: comp.meanDiffKmh,
      pairCount,
      threshold: maxDiffAllowed,
    },
  };
}

/**
 * Format a comprehensive plain-text proof summary for copying to clipboard.
 *
 * @param {Array} steps - Checklist steps
 * @param {object} results - Map of stepId -> { result, note, evidence }
 * @returns {string} Formatted summary text
 */
export function formatProofSummary(steps = CHECKLIST_STEPS, results = {}) {
  const lines = [
    '=== QuietKeep Drive Phase-2 Proof Run Summary ===',
    `Timestamp: ${new Date().toISOString()}`,
    '',
  ];

  let passed = 0;
  const total = steps.length;

  for (const s of steps) {
    const res = results[s.id] || { result: 'pending' };
    const outcome = (res.result || 'pending').toUpperCase();
    if (outcome === 'PASS') passed++;

    let line = `${s.num}. [${outcome}] ${s.title}`;
    if (res.note) line += ` | Note: ${res.note}`;
    if (res.evidence && Object.keys(res.evidence).length > 0) {
      line += ` | Evidence: ${JSON.stringify(res.evidence)}`;
    }
    lines.push(line);
  }

  lines.push('');
  lines.push(`Total Passed: ${passed} / ${total}`);
  return lines.join('\n');
}

/**
 * Save a proof run step result to public.drive_proof_runs in Supabase.
 *
 * @param {object} supabase - Supabase client
 * @param {{ step: string, result: 'pass'|'fail'|'skipped', evidence?: object, note?: string }} payload
 * @returns {Promise<{ saved: boolean, reason?: string, record?: object }>}
 */
export async function saveProofResult(supabase, { step, result, evidence = {}, note = '' }) {
  if (!supabase) return { saved: false, reason: 'missing_supabase_client' };

  try {
    const { data: authData } = await supabase.auth.getUser();
    const userId = authData?.user?.id;
    if (!userId) return { saved: false, reason: 'not_authenticated' };

    const row = {
      owner: userId,
      step: String(step),
      result: String(result),
      evidence: evidence || {},
      note: String(note || ''),
    };

    const { data, error } = await supabase.from('drive_proof_runs').insert(row).select().single();
    if (error) {
      return { saved: false, reason: error.message || String(error) };
    }
    return { saved: true, record: data };
  } catch (err) {
    return { saved: false, reason: String(err?.message || err) };
  }
}

/**
 * Fetch existing proof runs for the current user.
 *
 * @param {object} supabase - Supabase client
 * @returns {Promise<Array>}
 */
export async function fetchProofRuns(supabase) {
  if (!supabase) return [];
  try {
    const { data, error } = await supabase
      .from('drive_proof_runs')
      .select('*')
      .order('created_at', { ascending: false });
    if (error || !data) return [];
    return data;
  } catch {
    return [];
  }
}
