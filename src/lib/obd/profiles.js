// src/lib/obd/profiles.js
// QuietKeep Car Reader (OBD-II over Bluetooth) - Task Card DRV-07a / AG-02
// Vehicle profiles for petrol cars, diesel cars, hybrids (Honda, Toyota), and BS-6 two-wheelers.
// Zero external dependencies. Read-only by design.

import { describeFaultCode } from './reader.js';

export const VEHICLE_PROFILES = Object.freeze({
  PETROL_CAR: 'petrol_car',
  DIESEL_CAR: 'diesel_car',
  HONDA_HYBRID: 'honda_hybrid',
  TOYOTA_HYBRID: 'toyota_hybrid',
  BS6_TWO_WHEELER: 'bs6_two_wheeler',
});

/**
 * Detects the vehicle profile from supported PIDs, fuel type, and optional metadata (VIN/make).
 *
 * @param {string[]} [supportedPids=[]] Array of supported PID hex strings (e.g. ['01', '0C', '0D', ...])
 * @param {number|string|object} [fuelType=null] SAE J1979 fuel type code, name, or object { code, name }
 * @param {object} [options={}] Optional hint/metadata { vin, make, profile, isTwoWheeler }
 * @returns {string} One of the VEHICLE_PROFILES strings
 */
export function detectProfile(supportedPids = [], fuelType = null, options = {}) {
  // 1. Direct explicit profile option
  if (options && options.profile && Object.values(VEHICLE_PROFILES).includes(options.profile)) {
    return options.profile;
  }

  // 2. Direct string profile in fuelType parameter
  if (typeof fuelType === 'string' && Object.values(VEHICLE_PROFILES).includes(fuelType)) {
    return fuelType;
  }

  const pids = Array.isArray(supportedPids) ? supportedPids.map(p => String(p).toUpperCase()) : [];

  // Parse fuel type representation
  let fuelCode = null;
  let fuelName = '';

  if (typeof fuelType === 'number') {
    fuelCode = fuelType;
  } else if (typeof fuelType === 'string') {
    fuelName = fuelType.toLowerCase();
  } else if (fuelType && typeof fuelType === 'object') {
    fuelCode = typeof fuelType.code === 'number' ? fuelType.code : null;
    fuelName = String(fuelType.name || fuelType.type || '').toLowerCase();
  }

  // 3. Two-Wheeler detection
  // BS-6 two-wheelers support only a small handful of basic PIDs (RPM, Speed, Status, sometimes Temp/Throttle)
  // They do not support 5B (Hybrid battery), 2F (Fuel level), or 04 (Calculated load), and have <= 10 PIDs.
  const isTwoWheelerHint = options && (options.isTwoWheeler || options.profile === VEHICLE_PROFILES.BS6_TWO_WHEELER);
  const isTwoWheelerFuel = fuelName === 'bs6_two_wheeler' || fuelName === 'two_wheeler' || fuelName === 'motorcycle' || fuelName === 'scooter';
  const isTwoWheelerPids = pids.length > 0 && pids.length <= 10 && !pids.includes('5B') && !pids.includes('2F') && !pids.includes('04');

  if (isTwoWheelerHint || isTwoWheelerFuel || isTwoWheelerPids) {
    return VEHICLE_PROFILES.BS6_TWO_WHEELER;
  }

  // 4. Hybrid detection (Honda or Toyota)
  // SAE J1979 fuel type 0x11 (17) is Hybrid Petrol, or presence of PID 5B (Hybrid battery pack remaining life)
  const isHybridFuel = fuelCode === 0x11 || fuelName.includes('hybrid');
  const hasHybridBatteryPid = pids.includes('5B');

  if (isHybridFuel || hasHybridBatteryPid || fuelName === 'honda_hybrid' || fuelName === 'toyota_hybrid') {
    const make = (options.make || '').toLowerCase();
    const vin = (options.vin || '').toUpperCase();

    // Check Toyota identifiers (Toyota VIN prefix: MBJ for Toyota Kirloskar India, JT for Japan, 4T/5T)
    const isToyota = make.includes('toyota') ||
      fuelName.includes('toyota') ||
      /^MBJ/i.test(vin) ||
      /^JT[0-9A-Z]/i.test(vin) ||
      /^4T[0-9A-Z]/i.test(vin) ||
      /^5T[0-9A-Z]/i.test(vin);

    if (isToyota) {
      return VEHICLE_PROFILES.TOYOTA_HYBRID;
    }

    // Check Honda identifiers (Honda VIN prefix: MAK for Honda Cars India, JH for Japan, 1HG/2HG, SHH)
    const isHonda = make.includes('honda') ||
      fuelName.includes('honda') ||
      /^MAK/i.test(vin) ||
      /^JH[0-9A-Z]/i.test(vin) ||
      /^1HG/i.test(vin) ||
      /^2HG/i.test(vin) ||
      /^SHH/i.test(vin);

    if (isHonda) {
      return VEHICLE_PROFILES.HONDA_HYBRID;
    }

    // Distinctive PID hints if no make/VIN
    if (pids.includes('5C') && !pids.includes('46')) {
      return VEHICLE_PROFILES.TOYOTA_HYBRID;
    }

    // Default hybrid profile is Honda Hybrid (City e:HEV)
    return VEHICLE_PROFILES.HONDA_HYBRID;
  }

  // 5. Diesel detection (SAE J1979 code 0x04)
  if (fuelCode === 0x04 || fuelName === 'diesel' || fuelName === 'diesel_car') {
    return VEHICLE_PROFILES.DIESEL_CAR;
  }

  // 6. Default: Petrol car
  return VEHICLE_PROFILES.PETROL_CAR;
}

/**
 * Checks if engine off (RPM 0) while vehicle is moving is a normal operational state.
 * For hybrids (City e:HEV, Hyryder, etc.), electric-only drive at low/moderate speed is completely normal.
 */
export function isEngineOffNormal(profile, speedKmh = 0, rpm = 0) {
  if (profile === VEHICLE_PROFILES.HONDA_HYBRID || profile === VEHICLE_PROFILES.TOYOTA_HYBRID) {
    return true;
  }
  // For standard ICE vehicles, 0 RPM while moving indicates an engine stall
  return speedKmh <= 0 || rpm > 0;
}

/**
 * Creates a localized voice summary for the given vehicle profile, live snapshot, and diagnostic trouble codes.
 *
 * Requirements:
 * - Hybrid summary includes "Hybrid battery at N percent"
 * - Two-wheeler summary keeps it short (12-13.5V normal)
 * - Hybrids: RPM 0 while moving is normal, never reported as an engine fault
 * - Spoken lines available in English, Hindi, and Telugu
 *
 * @param {string} profile One of VEHICLE_PROFILES
 * @param {object} snapshot Live snapshot data (rpm, speedKmh, coolantC, voltage, hybridBatteryPct, etc.)
 * @param {string[]} [faults=[]] Diagnostic trouble codes
 * @param {string} [lang='en'] Language code ('en', 'hi', 'te')
 * @returns {string} Plain-text voice summary
 */
export function summaryFor(profile, snapshot, faults = [], lang = 'en') {
  if (!snapshot) {
    if (lang === 'hi') return 'वाहन का डेटा उपलब्ध नहीं है.';
    if (lang === 'te') return 'వాహనం డేటా అందుబాటులో లేదు.';
    return 'No vehicle data available.';
  }

  const isHybrid = profile === VEHICLE_PROFILES.HONDA_HYBRID || profile === VEHICLE_PROFILES.TOYOTA_HYBRID;
  const isTwoWheeler = profile === VEHICLE_PROFILES.BS6_TWO_WHEELER;
  const codeList = Array.isArray(faults) ? faults : [];

  // 1. Faults / MIL status (highest priority)
  if (snapshot.mil || codeList.length > 0) {
    if (codeList.length > 0) {
      const descriptions = codeList.map(c => describeFaultCode(c));
      const formattedList = descriptions.length === 1
        ? descriptions[0]
        : descriptions.slice(0, -1).join(', ') + ', and ' + descriptions[descriptions.length - 1];

      if (lang === 'hi') {
        return `चेक इंजन लाइट जल रही है: ${formattedList}.`;
      }
      if (lang === 'te') {
        return `చెక్ ఇంజిన్ లైట్ ఆన్‌లో ఉంది: ${formattedList}.`;
      }
      return `Check engine light is on: ${formattedList}.`;
    }

    const count = snapshot.dtcCount || 1;
    if (lang === 'hi') {
      return `चेक इंजन लाइट जल रही है, ${count} गड़बड़ी कोड के साथ.`;
    }
    if (lang === 'te') {
      return `చెక్ ఇంజిన్ లైట్ ఆన్‌లో ఉంది, ${count} సమస్య కోడ్‌లతో.`;
    }
    return `Check engine light is on, with ${count} diagnostic trouble code${count > 1 ? 's' : ''}.`;
  }

  // 2. Engine stall check for standard petrol/diesel cars
  // (Hybrids intentionally exempt: engine off while moving is NORMAL)
  if (!isHybrid && Number.isFinite(snapshot.speedKmh) && snapshot.speedKmh > 5 && snapshot.rpm === 0) {
    if (lang === 'hi') {
      return 'चेतावनी: चलते समय इंजन बंद हो गया है.';
    }
    if (lang === 'te') {
      return 'హెచ్చరిక: ప్రయాణిస్తున్నప్పుడు ఇంజిన్ ఆగిపోయింది.';
    }
    return 'Warning: Engine is off while moving.';
  }

  // 3. Two-Wheeler Summary (short, concise for riders)
  if (isTwoWheeler) {
    const parts = [];

    // Optional engine/coolant temp if supported
    if (Number.isFinite(snapshot.coolantC)) {
      if (lang === 'hi') {
        parts.push(`इंजन ${snapshot.coolantC} डिग्री`);
      } else if (lang === 'te') {
        parts.push(`ఇంజిన్ ${snapshot.coolantC} డిగ్రీలు`);
      } else {
        parts.push(`Engine warm at ${snapshot.coolantC} degrees`);
      }
    }

    // Battery voltage (12-13.5V normal for small motorcycle/scooter battery)
    if (Number.isFinite(snapshot.voltage) && snapshot.voltage > 0) {
      if (lang === 'hi') {
        parts.push(`बैटरी ${snapshot.voltage.toFixed(1)} वोल्ट`);
      } else if (lang === 'te') {
        parts.push(`బ్యాటరీ ${snapshot.voltage.toFixed(1)} వోల్ట్‌లు`);
      } else {
        parts.push(`battery ${snapshot.voltage.toFixed(1)} volts`);
      }
    }

    if (lang === 'hi') {
      parts.push('कोई चेतावनी लाइट नहीं');
      return parts.join(', ') + '.';
    }
    if (lang === 'te') {
      parts.push('హెచ్చరిక లైట్లు లేవు');
      return parts.join(', ') + '.';
    }
    parts.push('no warning lights');
    // If no temp was present, capitalize Battery for clean sentence
    const res = parts.join(', ') + '.';
    return res.charAt(0).toUpperCase() + res.slice(1);
  }

  // 4. Hybrid and Car Summary
  const parts = [];

  // Engine temperature or EV state
  if (Number.isFinite(snapshot.coolantC)) {
    if (lang === 'hi') {
      if (snapshot.coolantC >= 75 && snapshot.coolantC <= 105) {
        parts.push(`इंजन ${snapshot.coolantC} डिग्री पर गर्म है`);
      } else if (snapshot.coolantC > 105) {
        parts.push(`इंजन गर्म चल रहा है ${snapshot.coolantC} डिग्री पर`);
      } else {
        parts.push(`इंजन गर्म हो रहा है ${snapshot.coolantC} डिग्री पर`);
      }
    } else if (lang === 'te') {
      if (snapshot.coolantC >= 75 && snapshot.coolantC <= 105) {
        parts.push(`ఇంజన్ ${snapshot.coolantC} డిగ్రీల వద్ద వేడిగా ఉంది`);
      } else if (snapshot.coolantC > 105) {
        parts.push(`ఇంజన్ వేడెక్కింది ${snapshot.coolantC} డిగ్రీల వద్ద`);
      } else {
        parts.push(`ఇంజన్ వేడెక్కుతోంది ${snapshot.coolantC} డిగ్రీల వద్ద`);
      }
    } else {
      if (snapshot.coolantC >= 75 && snapshot.coolantC <= 105) {
        parts.push(`Engine is warm at ${snapshot.coolantC} degrees`);
      } else if (snapshot.coolantC > 105) {
        parts.push(`Engine running hot at ${snapshot.coolantC} degrees`);
      } else {
        parts.push(`Engine warming up at ${snapshot.coolantC} degrees`);
      }
    }
  }

  // Hybrid battery state ("Hybrid battery at N percent")
  if (isHybrid) {
    const batt = Number.isFinite(snapshot.hybridBatteryPct)
      ? Math.round(snapshot.hybridBatteryPct)
      : (Number.isFinite(snapshot.hybridBattery) ? Math.round(snapshot.hybridBattery) : null);

    if (batt !== null) {
      if (lang === 'hi') {
        parts.push(`हाइब्रिड बैटरी ${batt} प्रतिशत`);
      } else if (lang === 'te') {
        parts.push(`హైబ్రిడ్ బ్యాటరీ ${batt} శాతం`);
      } else {
        parts.push(`Hybrid battery at ${batt} percent`);
      }
    }
  }

  // 12V Auxiliary / Module battery voltage
  if (Number.isFinite(snapshot.voltage) && snapshot.voltage > 0) {
    if (lang === 'hi') {
      parts.push(`बैटरी ${snapshot.voltage.toFixed(1)} वोल्ट`);
    } else if (lang === 'te') {
      parts.push(`బ్యాటరీ ${snapshot.voltage.toFixed(1)} వోల్ట్‌లు`);
    } else {
      parts.push(`battery ${snapshot.voltage.toFixed(1)} volts`);
    }
  }

  // No warning lights confirmation
  if (lang === 'hi') {
    parts.push('कोई चेतावनी लाइट नहीं');
  } else if (lang === 'te') {
    parts.push('హెచ్చరిక లైట్లు లేవు');
  } else {
    parts.push('no warning lights');
  }

  return parts.join(', ') + '.';
}
