// src/lib/obd/pids.js
// QuietKeep Car Reader (OBD-II over Bluetooth) - Task Card DRV-06
// Pure decoders for OBD-II modes 01 (live data), 03 (fault codes), and 09 (vehicle info).
// Zero external dependencies. Read-only by design.

/**
 * Parses a hex string or array (with or without spaces/colons/CAN headers) into numeric byte values.
 * Handles CAN 11-bit ECU headers like 7E8, 7E9, 7DF.
 * e.g. "41 0C 1A F8" -> [0x41, 0x0C, 0x1A, 0xF8]
 * e.g. "7E8 04 41 0C 1A F8" -> [0x04, 0x41, 0x0C, 0x1A, 0xF8]
 */
export function parseHexBytes(input) {
  if (Array.isArray(input)) {
    const items = input.map(item => (typeof item === 'string' ? item.trim() : item)).filter(x => x !== undefined && x !== null && x !== '');
    // If first item is a 3-character CAN ID like 7E8, drop it
    if (items.length > 0 && typeof items[0] === 'string' && /^[0-9A-Fa-f]{3}$/.test(items[0])) {
      items.shift();
    }
    return items.map(b => (typeof b === 'number' ? b : parseInt(b, 16))).filter(n => Number.isFinite(n) && n >= 0 && n <= 255);
  }
  if (typeof input !== 'string') return [];

  const trimmed = input.trim();
  // Check if string contains spaces/newlines
  if (/\s+/.test(trimmed)) {
    const tokens = trimmed.split(/\s+/).filter(Boolean);
    // If first token is a 3-character CAN ID like 7E8 / 7E9 / 7DF, drop it
    if (tokens.length > 0 && /^[0-9A-Fa-f]{3}$/.test(tokens[0])) {
      tokens.shift();
    }
    const bytes = [];
    for (const token of tokens) {
      if (/^[0-9A-Fa-f]{2}$/.test(token)) {
        bytes.push(parseInt(token, 16));
      }
    }
    return bytes;
  }

  // Unspaced hex string
  let clean = trimmed.replace(/[^0-9A-Fa-f]/g, '');
  // If it starts with a 3-digit CAN ID like 7E8 / 7E9 / 7DF, strip it
  if (/^7E[0-9A-Fa-f]/i.test(clean) || /^7DF/i.test(clean)) {
    clean = clean.slice(3);
  }
  if (clean.length % 2 !== 0) return [];
  const bytes = [];
  for (let i = 0; i < clean.length; i += 2) {
    bytes.push(parseInt(clean.slice(i, i + 2), 16));
  }
  return bytes;
}

/**
 * Decode Supported PIDs Bitmaps (0100, 0120, 0140, 0160, 0180, 01A0, 01C0).
 * 4 bytes (A, B, C, D) -> array of supported PID hex strings (e.g. ['01', '04', '05', '0C', '0D', ...])
 * @param {string|number} baseHex Base PID (e.g. '00', '20', '40')
 * @param {number[]} bytes 4 data bytes
 */
export function decodeSupportedPids(baseHex, bytes) {
  const base = typeof baseHex === 'number' ? baseHex : parseInt(baseHex, 16);
  const supported = [];
  if (!bytes || bytes.length < 4) return supported;

  for (let byteIdx = 0; byteIdx < 4; byteIdx++) {
    const byte = bytes[byteIdx];
    for (let bitIdx = 0; bitIdx < 8; bitIdx++) {
      if ((byte & (0x80 >> bitIdx)) !== 0) {
        const pidNum = base + (byteIdx * 8) + (bitIdx + 1);
        const pidHex = pidNum.toString(16).toUpperCase().padStart(2, '0');
        supported.push(pidHex);
      }
    }
  }
  return supported;
}

/**
 * Individual Mode 01 PID decoders.
 * Input: data bytes (excluding mode 41 and PID echo if stripped).
 */
export const MODE_01_DECODERS = {
  // 0101: Monitor status since DTCs cleared
  '01': (bytes) => {
    if (!bytes || bytes.length < 1) return null;
    const a = bytes[0];
    return {
      mil: Boolean(a & 0x80),
      dtcCount: a & 0x7F,
      ignitionType: (a & 0x08) ? 'compression' : 'spark',
    };
  },

  // 0104: Calculated engine load (%)
  '04': (bytes) => {
    if (!bytes || bytes.length < 1) return null;
    return Number(((bytes[0] * 100) / 255).toFixed(1));
  },

  // 0105: Engine coolant temperature (°C)
  '05': (bytes) => {
    if (!bytes || bytes.length < 1) return null;
    return bytes[0] - 40;
  },

  // 010C: Engine RPM (rpm)
  '0C': (bytes) => {
    if (!bytes || bytes.length < 2) return null;
    return Math.round((bytes[0] * 256 + bytes[1]) / 4);
  },

  // 010D: Vehicle speed (km/h)
  '0D': (bytes) => {
    if (!bytes || bytes.length < 1) return null;
    return bytes[0];
  },

  // 012F: Fuel tank level input (%)
  '2F': (bytes) => {
    if (!bytes || bytes.length < 1) return null;
    return Number(((bytes[0] * 100) / 255).toFixed(1));
  },

  // 0142: Control module voltage (V)
  '42': (bytes) => {
    if (!bytes || bytes.length < 2) return null;
    return Number(((bytes[0] * 256 + bytes[1]) / 1000).toFixed(2));
  },
};

/**
 * Decodes a raw Mode 01 response payload.
 * Can take a full response string like "41 0C 1A F8" or a byte array.
 */
export function decodeMode01Response(input) {
  const bytes = parseHexBytes(input);
  if (bytes.length < 2) return null;

  let startIdx = 0;
  // Look for 0x41 (positive response to Mode 01)
  const modeIdx = bytes.indexOf(0x41);
  if (modeIdx >= 0) {
    startIdx = modeIdx;
  }

  if (bytes[startIdx] !== 0x41 || bytes.length <= startIdx + 1) {
    return null;
  }

  const pidHex = bytes[startIdx + 1].toString(16).toUpperCase().padStart(2, '0');
  const dataBytes = bytes.slice(startIdx + 2);

  // Supported PIDs bitmaps
  if (['00', '20', '40', '60', '80', 'A0', 'C0'].includes(pidHex)) {
    return {
      pid: pidHex,
      supportedPids: decodeSupportedPids(pidHex, dataBytes),
    };
  }

  const decoder = MODE_01_DECODERS[pidHex];
  if (!decoder) {
    return { pid: pidHex, raw: dataBytes };
  }

  const value = decoder(dataBytes);
  return { pid: pidHex, value };
}

/**
 * Mode 03 Diagnostic Trouble Codes (DTC) decoder.
 * 2 bytes per DTC.
 * First 2 bits: 00 -> P, 01 -> C, 10 -> B, 11 -> U.
 * Next 2 bits: 0, 1, 2, or 3.
 * Remaining 12 bits: 3 hex characters.
 * Example: [0x01, 0x33] -> "P0133"
 * Example: [0x04, 0x20] -> "P0420"
 * Example: [0x00, 0x00] -> null (no DTC / filler)
 *
 * @param {string|number[]} input Raw response string or byte array
 * @returns {string[]} List of DTC codes (e.g. ['P0301', 'P0420'])
 */
export function decodeMode03Response(input) {
  const bytes = parseHexBytes(input);
  if (!bytes || bytes.length === 0) return [];

  // Find 0x43 (positive response to Mode 03)
  let startIdx = bytes.indexOf(0x43);
  let dtcBytes;
  if (startIdx >= 0) {
    dtcBytes = bytes.slice(startIdx + 1);
    // If odd length, the first byte is the DTC count (or item count)
    if (dtcBytes.length % 2 !== 0) {
      dtcBytes = dtcBytes.slice(1);
    }
  } else {
    dtcBytes = bytes;
    if (dtcBytes.length % 2 !== 0) {
      dtcBytes = dtcBytes.slice(1);
    }
  }

  const PREFIXES = ['P', 'C', 'B', 'U'];
  const dtcs = [];

  for (let i = 0; i + 1 < dtcBytes.length; i += 2) {
    const b1 = dtcBytes[i];
    const b2 = dtcBytes[i + 1];

    // 00 00 is padding / no code
    if (b1 === 0x00 && b2 === 0x00) continue;

    const prefix = PREFIXES[(b1 >> 6) & 0x03];
    const second = ((b1 >> 4) & 0x03).toString();
    const third = (b1 & 0x0F).toString(16).toUpperCase();
    const fourth = ((b2 >> 4) & 0x0F).toString(16).toUpperCase();
    const fifth = (b2 & 0x0F).toString(16).toUpperCase();

    dtcs.push(`${prefix}${second}${third}${fourth}${fifth}`);
  }

  return dtcs;
}

/**
 * Mode 09 PID 02 VIN Decoder.
 * Decodes 17-character Vehicle Identification Number from Mode 09 PID 02 response.
 * Handles single-line or multi-frame extracted ASCII bytes.
 *
 * @param {string|number[]} input Hex string or byte array
 * @returns {string|null} 17-character VIN string or null if invalid
 */
export function decodeMode09VinResponse(input) {
  const bytes = parseHexBytes(input);
  if (!bytes || bytes.length === 0) return null;

  // Mode 09 PID 02 positive response starts with 49 02
  let candidateBytes = bytes;
  const modeIdx = bytes.indexOf(0x49);
  if (modeIdx >= 0 && bytes[modeIdx + 1] === 0x02) {
    candidateBytes = bytes.slice(modeIdx + 2);
    // Sometimes there is a message count or item count byte (e.g. 0x01) before VIN ascii
    if (candidateBytes.length > 17 && candidateBytes[0] < 0x20) {
      candidateBytes = candidateBytes.slice(1);
    }
  }

  // Filter for valid ASCII characters typically found in VIN (A-Z, 0-9 except I, O, Q)
  const chars = [];
  for (const b of candidateBytes) {
    if ((b >= 0x30 && b <= 0x39) || (b >= 0x41 && b <= 0x5A)) { // 0-9, A-Z
      chars.push(String.fromCharCode(b));
    }
  }

  const vinCandidate = chars.join('');
  // Look for a 17-character alphanumeric sequence
  const match = vinCandidate.match(/[A-HJ-NPR-Z0-9]{17}/i);
  if (match) return match[0].toUpperCase();

  if (vinCandidate.length === 17) return vinCandidate.toUpperCase();

  return null;
}
