// src/lib/obd/reader.js
// QuietKeep Car Reader (OBD-II over Bluetooth) - Task Card DRV-06
// High-level Car Reader API for live snapshots, fault diagnostic codes, VIN, and voice summaries.

import { Elm327 } from './elm327.js';
import {
  decodeMode01Response,
  decodeMode03Response,
  decodeMode09VinResponse,
} from './pids.js';
import {
  detectProfile,
  summaryFor,
  VEHICLE_PROFILES,
} from './profiles.js';

export { detectProfile, summaryFor, VEHICLE_PROFILES };


/**
 * Common Diagnostic Trouble Code (DTC) human-readable voice descriptions.
 * Covers 30+ of the most frequent P-codes seen across consumer vehicles.
 */
export const COMMON_DTC_DESCRIPTIONS = {
  // Misfires (P0300 - P0306)
  P0300: 'random or multiple cylinder misfire',
  P0301: 'misfire on cylinder 1',
  P0302: 'misfire on cylinder 2',
  P0303: 'misfire on cylinder 3',
  P0304: 'misfire on cylinder 4',
  P0305: 'misfire on cylinder 5',
  P0306: 'misfire on cylinder 6',

  // Fuel / Air Metering & Fuel Trim (P0171 - P0175, P0101, P0102, P0113, P0128)
  P0171: 'system too lean on bank 1',
  P0172: 'system too rich on bank 1',
  P0174: 'system too lean on bank 2',
  P0175: 'system too rich on bank 2',
  P0101: 'mass air flow sensor circuit range or performance',
  P0102: 'mass air flow sensor circuit low',
  P0113: 'intake air temperature sensor circuit high',
  P0128: 'coolant thermostat temperature below regulating temperature',

  // Catalytic Converter & Oxygen Sensors (P0420, P0430, P0130 - P0141)
  P0420: 'catalytic converter system efficiency below threshold',
  P0430: 'catalytic converter system efficiency below threshold on bank 2',
  P0130: 'oxygen sensor circuit malfunction on bank 1 sensor 1',
  P0133: 'oxygen sensor circuit slow response on bank 1 sensor 1',
  P0135: 'oxygen sensor heater circuit malfunction on bank 1 sensor 1',
  P0141: 'oxygen sensor heater circuit malfunction on bank 1 sensor 2',

  // Evaporative Emissions (P0440, P0442, P0455)
  P0440: 'evaporative emission system malfunction',
  P0442: 'evaporative emission system small leak detected',
  P0455: 'evaporative emission system gross leak detected',

  // Speed, Idle, Cam / Crank Sensors & Transmission (P0500, P0505, P0507, P0335, P0340, P0700)
  P0500: 'vehicle speed sensor malfunction',
  P0505: 'idle control system malfunction',
  P0507: 'idle air control system RPM higher than expected',
  P0700: 'transmission control system malfunction',
  P0335: 'crankshaft position sensor A circuit malfunction',
  P0340: 'camshaft position sensor circuit malfunction',
  P0115: 'engine coolant temperature circuit malfunction',
  P0401: 'exhaust gas recirculation flow insufficient detected',
};

/**
 * Returns a human-friendly voice description for a DTC code.
 */
export function describeFaultCode(code) {
  const clean = String(code || '').trim().toUpperCase();
  if (COMMON_DTC_DESCRIPTIONS[clean]) {
    return `${COMMON_DTC_DESCRIPTIONS[clean]} (${clean})`;
  }
  return `code ${clean}, needs a mechanic to read`;
}

/**
 * Creates a plain-English voice summary of the car snapshot and faults.
 * Examples:
 * "Engine is warm at 88 degrees, battery 14.1 volts, no warning lights."
 * "Check engine light is on: misfire on cylinder 1 (P0301)."
 */
export function formatObdSummary(snapshot, faults = []) {
  if (!snapshot) return 'No vehicle data available.';

  const parts = [];

  // 1. Faults / MIL status (highest priority)
  const codeList = Array.isArray(faults) ? faults : [];
  if (snapshot.mil || codeList.length > 0) {
    if (codeList.length > 0) {
      const descriptions = codeList.map(c => describeFaultCode(c));
      const formattedList = descriptions.length === 1
        ? descriptions[0]
        : descriptions.slice(0, -1).join(', ') + ', and ' + descriptions[descriptions.length - 1];
      return `Check engine light is on: ${formattedList}.`;
    }
    return `Check engine light is on, with ${snapshot.dtcCount || 1} diagnostic trouble code${(snapshot.dtcCount || 1) > 1 ? 's' : ''}.`;
  }

  // 2. Normal status summary
  // Coolant status
  if (Number.isFinite(snapshot.coolantC)) {
    if (snapshot.coolantC >= 75 && snapshot.coolantC <= 105) {
      parts.push(`Engine is warm at ${snapshot.coolantC} degrees`);
    } else if (snapshot.coolantC > 105) {
      parts.push(`Engine running hot at ${snapshot.coolantC} degrees`);
    } else {
      parts.push(`Engine warming up at ${snapshot.coolantC} degrees`);
    }
  }

  // Battery voltage
  if (Number.isFinite(snapshot.voltage) && snapshot.voltage > 0) {
    parts.push(`battery ${snapshot.voltage.toFixed(1)} volts`);
  }

  // No warning lights confirmation
  parts.push('no warning lights');

  return parts.join(', ') + '.';
}

/**
 * High-level Car Reader Client.
 */
export class ObdReader {
  constructor(transport, options = {}) {
    this.elm = new Elm327(transport);
    this._supportedPidsCache = null;
    this._profile = options.profile || null;
  }

  setProfile(profile) {
    this._profile = profile;
  }

  getProfile() {
    return this._profile;
  }

  /**
   * Initializes connection with ELM327 protocol auto-detection.
   */
  async connect() {
    return await this.elm.init();
  }

  /**
   * Reads supported PID hex strings across modes.
   */
  async supportedPids() {
    if (this._supportedPidsCache) return this._supportedPidsCache;

    const supported = new Set();

    // Query 0100
    try {
      const res00 = await this.elm.send('0100');
      const dec00 = decodeMode01Response(res00.assembled || res00.raw);
      if (dec00 && dec00.supportedPids) {
        dec00.supportedPids.forEach(p => supported.add(p));
      }
    } catch {}

    // Query 0120 if supported
    if (supported.has('20')) {
      try {
        const res20 = await this.elm.send('0120');
        const dec20 = decodeMode01Response(res20.assembled || res20.raw);
        if (dec20 && dec20.supportedPids) {
          dec20.supportedPids.forEach(p => supported.add(p));
        }
      } catch {}
    }

    // Query 0140 if supported
    if (supported.has('40')) {
      try {
        const res40 = await this.elm.send('0140');
        const dec40 = decodeMode01Response(res40.assembled || res40.raw);
        if (dec40 && dec40.supportedPids) {
          dec40.supportedPids.forEach(p => supported.add(p));
        }
      } catch {}
    }

    this._supportedPidsCache = Array.from(supported).sort();
    return this._supportedPidsCache;
  }

  /**
   * Detects the vehicle profile from supported PIDs, fuel type, and optional VIN.
   */
  async detectProfile() {
    const pids = await this.supportedPids();
    let fuelType = null;
    if (pids.includes('51')) {
      try {
        const res51 = await this.elm.send('0151');
        const dec51 = decodeMode01Response(res51.assembled || res51.raw);
        if (dec51 && dec51.value) fuelType = dec51.value;
      } catch {}
    }
    let vin = null;
    try {
      vin = await this.readVin();
    } catch {}

    this._profile = detectProfile(pids, fuelType, { vin });
    return this._profile;
  }

  /**
   * Reads a complete live snapshot of vehicle state:
   * rpm, speedKmh, coolantC, loadPct, fuelPct, voltage, mil, dtcCount, at,
   * plus extended fields: throttlePct, ambientTempC, oilTempC, fuelType, hybridBatteryPct.
   */
  async readSnapshot() {
    const snapshot = {
      rpm: null,
      speedKmh: null,
      coolantC: null,
      loadPct: null,
      fuelPct: null,
      voltage: null,
      mil: false,
      dtcCount: 0,
      at: new Date().toISOString(),
      // Extended fields for DRV-07a / AG-02:
      throttlePct: null,
      ambientTempC: null,
      oilTempC: null,
      fuelType: null,
      hybridBatteryPct: null,
    };

    // 1. Status / MIL (0101)
    try {
      const res01 = await this.elm.send('0101');
      const dec01 = decodeMode01Response(res01.assembled || res01.raw);
      if (dec01 && dec01.value) {
        snapshot.mil = dec01.value.mil;
        snapshot.dtcCount = dec01.value.dtcCount;
      }
    } catch {}

    // 2. RPM (010C)
    if (!this._supportedPidsCache || this._supportedPidsCache.includes('0C')) {
      try {
        const res0c = await this.elm.send('010C');
        const dec0c = decodeMode01Response(res0c.assembled || res0c.raw);
        if (dec0c && dec0c.value !== undefined) {
          snapshot.rpm = dec0c.value;
        }
      } catch {}
    }

    // 3. Speed (010D)
    if (!this._supportedPidsCache || this._supportedPidsCache.includes('0D')) {
      try {
        const res0d = await this.elm.send('010D');
        const dec0d = decodeMode01Response(res0d.assembled || res0d.raw);
        if (dec0d && dec0d.value !== undefined) {
          snapshot.speedKmh = dec0d.value;
        }
      } catch {}
    }

    // 4. Coolant (0105)
    if (!this._supportedPidsCache || this._supportedPidsCache.includes('05')) {
      try {
        const res05 = await this.elm.send('0105');
        const dec05 = decodeMode01Response(res05.assembled || res05.raw);
        if (dec05 && dec05.value !== undefined) {
          snapshot.coolantC = dec05.value;
        }
      } catch {}
    }

    // 5. Engine load (0104)
    if (!this._supportedPidsCache || this._supportedPidsCache.includes('04')) {
      try {
        const res04 = await this.elm.send('0104');
        const dec04 = decodeMode01Response(res04.assembled || res04.raw);
        if (dec04 && dec04.value !== undefined) {
          snapshot.loadPct = dec04.value;
        }
      } catch {}
    }

    // 6. Fuel level (012F)
    if (!this._supportedPidsCache || this._supportedPidsCache.includes('2F')) {
      try {
        const res2f = await this.elm.send('012F');
        const dec2f = decodeMode01Response(res2f.assembled || res2f.raw);
        if (dec2f && dec2f.value !== undefined) {
          snapshot.fuelPct = dec2f.value;
        }
      } catch {}
    }

    // 7. Control module voltage (0142), fallback to ATRV
    if (!this._supportedPidsCache || this._supportedPidsCache.includes('42')) {
      try {
        const res42 = await this.elm.send('0142');
        const dec42 = decodeMode01Response(res42.assembled || res42.raw);
        if (dec42 && dec42.value !== undefined) {
          snapshot.voltage = dec42.value;
        } else {
          const resRv = await this.elm.send('ATRV');
          const vMatch = resRv.raw.match(/([\d.]+)\s*V/i);
          if (vMatch) snapshot.voltage = parseFloat(vMatch[1]);
        }
      } catch {
        try {
          const resRv = await this.elm.send('ATRV');
          const vMatch = resRv.raw.match(/([\d.]+)\s*V/i);
          if (vMatch) snapshot.voltage = parseFloat(vMatch[1]);
        } catch {}
      }
    } else {
      try {
        const resRv = await this.elm.send('ATRV');
        const vMatch = resRv.raw.match(/([\d.]+)\s*V/i);
        if (vMatch) snapshot.voltage = parseFloat(vMatch[1]);
      } catch {}
    }

    // 8. Throttle position (0111)
    if (!this._supportedPidsCache || this._supportedPidsCache.includes('11')) {
      try {
        const res11 = await this.elm.send('0111');
        const dec11 = decodeMode01Response(res11.assembled || res11.raw);
        if (dec11 && dec11.value !== undefined) {
          snapshot.throttlePct = dec11.value;
        }
      } catch {}
    }

    // 9. Ambient air temperature (0146)
    if (!this._supportedPidsCache || this._supportedPidsCache.includes('46')) {
      try {
        const res46 = await this.elm.send('0146');
        const dec46 = decodeMode01Response(res46.assembled || res46.raw);
        if (dec46 && dec46.value !== undefined) {
          snapshot.ambientTempC = dec46.value;
        }
      } catch {}
    }

    // 10. Fuel type (0151)
    if (!this._supportedPidsCache || this._supportedPidsCache.includes('51')) {
      try {
        const res51 = await this.elm.send('0151');
        const dec51 = decodeMode01Response(res51.assembled || res51.raw);
        if (dec51 && dec51.value !== undefined) {
          snapshot.fuelType = dec51.value;
        }
      } catch {}
    }

    // 11. Hybrid battery pack remaining life (015B)
    if (!this._supportedPidsCache || this._supportedPidsCache.includes('5B')) {
      try {
        const res5b = await this.elm.send('015B');
        const dec5b = decodeMode01Response(res5b.assembled || res5b.raw);
        if (dec5b && dec5b.value !== undefined) {
          snapshot.hybridBatteryPct = dec5b.value;
        }
      } catch {}
    }

    // 12. Engine oil temperature (015C)
    if (!this._supportedPidsCache || this._supportedPidsCache.includes('5C')) {
      try {
        const res5c = await this.elm.send('015C');
        const dec5c = decodeMode01Response(res5c.assembled || res5c.raw);
        if (dec5c && dec5c.value !== undefined) {
          snapshot.oilTempC = dec5c.value;
        }
      } catch {}
    }

    return snapshot;
  }

  /**
   * Reads diagnostic trouble codes (DTCs) using Mode 03.
   * @returns {Promise<string[]>}
   */
  async readFaults() {
    try {
      const res = await this.elm.send('03');
      if (res.noData) return [];
      return decodeMode03Response(res.assembled || res.raw);
    } catch (err) {
      if (err && err.message && err.message.includes('NO DATA')) {
        return [];
      }
      throw err;
    }
  }

  /**
   * Reads 17-character VIN using Mode 09 PID 02.
   * @returns {Promise<string|null>}
   */
  async readVin() {
    try {
      const res = await this.elm.send('0902');
      if (res.noData) return null;
      return decodeMode09VinResponse(res.assembled || res.raw);
    } catch {
      return null;
    }
  }

  /**
   * Formats a voice summary string for a snapshot and faults.
   * Delegates to summaryFor when a profile is detected.
   */
  summary(snapshot, faults, lang = 'en') {
    const profile = this._profile || (this._supportedPidsCache || snapshot?.fuelType
      ? detectProfile(this._supportedPidsCache || [], snapshot?.fuelType)
      : null);

    if (profile) {
      return summaryFor(profile, snapshot, faults, lang);
    }
    return formatObdSummary(snapshot, faults);
  }

  destroy() {
    if (this.elm) {
      this.elm.destroy();
    }
  }
}

/**
 * JS transport adapter wrapping native Capacitor QkObd plugin into { write, onData }.
 */
export function createPluginTransport(plugin) {
  if (!plugin) throw new Error('QkObd plugin is null or undefined');

  return {
    async write(str) {
      await plugin.write({ command: str });
    },
    onData(cb) {
      let handle = null;
      plugin.addListener('data', (data) => {
        if (data && typeof data.text === 'string') {
          cb(data.text);
        }
      }).then(h => {
        handle = h;
      });

      return () => {
        if (handle && typeof handle.remove === 'function') {
          handle.remove();
        }
      };
    },
  };
}

/**
 * Helper to connect to either the simulated transport or the native plugin transport.
 */
export function connectReader(transport) {
  const reader = new ObdReader(transport);
  return reader;
}
