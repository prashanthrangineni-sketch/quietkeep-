// src/lib/overtake-advisor.js
// TASK CARD AG-01: Overtaking advisor v1 (DRV-12a)
// Pure decision and curvature logic, no browser APIs, injectable clock.
//
// Safety rule: The app NEVER claims to see traffic. Never says "clear",
// "safe to overtake", or "you can overtake". It only reports known hazards
// and road curvature, giving gentle advice to check mirrors and oncoming traffic.

export const CONSTANTS = {
  HEADING_TOLERANCE_DEG: 30,             // ±30° of heading
  CURVATURE_BEND_DEG_PER_100M: 15,       // In bend if >= 15°/100m
  FIXES_WINDOW_MS: 20 * 1000,            // Last 20 seconds of GPS fixes
  AVOID_HAZARD_DISTANCE_M: 300,          // Hazard within 300 m ahead
  AVOID_MIN_SPEED_KMH: 15,               // Crawling traffic < 15 km/h
  AVOID_NIGHT_HAZARD_DISTANCE_M: 500,    // Night (23:00-05:00) and hazard within 500 m
  CAUTION_HAZARD_DISTANCE_MIN_M: 300,    // Hazard within 300-600 m
  CAUTION_HAZARD_DISTANCE_MAX_M: 600,
  DEFAULT_LOOKAHEAD_METRES: 500,         // Default lookahead for no_known_hazard
  WATCHER_MIN_SPEED_KMH: 40,             // Watcher triggers only at speed >= 40 km/h
  WATCHER_COOLDOWN_MS: 3 * 60 * 1000,    // At most once per 3 minutes
  WATCHER_SPEECH_QUIET_MS: 2 * 60 * 1000,// Never within 2 minutes of other speech
  WATCHER_MAX_PER_HOUR: 6,               // At most 6 unprompted warnings per hour
  NIGHT_START_HOUR: 23,                  // 23:00
  NIGHT_END_HOUR: 5,                     // 05:00
};

export const PHRASES = {
  en: {
    avoid: "Don't overtake here. {reason}.",
    caution: "Be careful. Something is reported about {n} metres ahead. Check your mirrors and oncoming traffic.",
    caution_night: "Be careful. It is night. Check your mirrors and oncoming traffic.",
    no_known_hazard: "Nothing is reported for the next {n} metres. Check your mirrors and oncoming traffic before you overtake.",
    reasons: {
      bend: "You are in a bend",
      hard_brake: "Riders brake hard just ahead",
      rough_road: "Rough road just ahead",
      traffic_slow: "Traffic is too slow",
    },
  },
  hi: {
    avoid: "यहाँ ओवरटेक न करें। {reason}।",
    caution: "सावधान रहें। आगे लगभग {n} मीटर पर कुछ रिपोर्ट हुआ है। अपने शीशे और सामने का ट्रैफिक देखें।",
    caution_night: "सावधान रहें। रात का समय है। अपने शीशे और सामने का ट्रैफिक देखें।",
    no_known_hazard: "अगले {n} मीटर तक कुछ भी रिपोर्ट नहीं है। ओवरटेक करने से पहले अपने शीशे और सामने का ट्रैफिक देखें।",
    reasons: {
      bend: "आगे मोड़ है",
      hard_brake: "आगे अचानक ब्रेक लगते हैं",
      rough_road: "आगे खराब सड़क है",
      traffic_slow: "ट्रैफिक बहुत धीमा है",
    },
  },
  te: {
    avoid: "ఇక్కడ ఓవర్‌టేక్ చేయవద్దు. {reason}.",
    caution: "జాగ్రత్త. ముందు దాదాపు {n} మీటర్లలో ఏదో రిపోర్ట్ అయింది. మీ అద్దాలు మరియు ఎదురుగా వచ్చే ట్రాఫిక్ చూడండి.",
    caution_night: "జాగ్రత్త. రాత్రి సమయం. మీ అద్దాలు మరియు ఎదురుగా వచ్చే ట్రాఫిక్ చూడండి.",
    no_known_hazard: "తదుపరి {n} మీటర్ల వరకు ఏమీ రిపోర్ట్ కాలేదు. ఓవర్‌టేక్ చేసే ముందు మీ అద్దాలు మరియు ఎదురుగా వచ్చే ట్రాఫిక్ చూడండి.",
    reasons: {
      bend: "ముందు మలుపు ఉంది",
      hard_brake: "ముందు వాహనాలు హఠాత్తుగా బ్రేక్ వేస్తాయి",
      rough_road: "ముందు రోడ్డు బాగాలేదు",
      traffic_slow: "ట్రాఫిక్ చాలా నెమ్మదిగా ఉంది",
    },
  },
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

export function angleBetween(a, b) {
  return Math.abs(((a - b + 540) % 360) - 180);
}

export function isNight(now = Date.now()) {
  const d = typeof now === 'number' ? new Date(now) : (now instanceof Date ? now : new Date(now));
  const h = d.getHours();
  return h >= CONSTANTS.NIGHT_START_HOUR || h < CONSTANTS.NIGHT_END_HOUR;
}

/**
 * RoadAheadProvider Interface
 * Shape of items returned: { id, lat, lng, kind, severity, reports, distance }
 * Kinds in v1: 'hard_brake', 'pothole', 'swerve'.
 * Future Mappls provider can support: 'curve', 'junction', 'bridge', 'no_overtaking_zone'.
 */
export function createRoadAheadProvider({ spots = [] } = {}) {
  return {
    ahead(position, metres = CONSTANTS.DEFAULT_LOOKAHEAD_METRES) {
      if (!position || typeof position.lat !== 'number' || typeof position.lng !== 'number') {
        return [];
      }
      const heading = position.headingDeg ?? position.heading ?? 0;
      const matched = [];

      for (const spot of spots) {
        if (!spot || typeof spot.lat !== 'number' || typeof spot.lng !== 'number') continue;
        const d = metresBetween(position, spot);
        if (d > metres) continue;

        const b = bearingDeg(position, spot);
        const angleDiff = angleBetween(heading, b);
        if (angleDiff <= CONSTANTS.HEADING_TOLERANCE_DEG) {
          matched.push({
            ...spot,
            distance: d,
          });
        }
      }

      matched.sort((a, b) => a.distance - b.distance);
      return matched;
    },
  };
}

/**
 * Calculate track curvature from GPS fixes in the last 20 seconds.
 * Returns degrees of heading change per 100 m; inBend if >= 15°/100m.
 */
export function trackCurvature(fixes = []) {
  if (!Array.isArray(fixes) || fixes.length < 2) {
    return { degPer100m: 0, inBend: false, distanceMetres: 0, headingChangeDeg: 0 };
  }

  const latestAt = fixes[fixes.length - 1].at ?? Date.now();
  const windowFixes = fixes.filter(f => (f.at == null) || (latestAt - f.at <= CONSTANTS.FIXES_WINDOW_MS));

  if (windowFixes.length < 2) {
    return { degPer100m: 0, inBend: false, distanceMetres: 0, headingChangeDeg: 0 };
  }

  let totalDist = 0;
  let totalHeadingChange = 0;

  for (let i = 1; i < windowFixes.length; i++) {
    const prev = windowFixes[i - 1];
    const curr = windowFixes[i];
    totalDist += metresBetween(prev, curr);
    const hPrev = prev.headingDeg ?? prev.heading ?? 0;
    const hCurr = curr.headingDeg ?? curr.heading ?? 0;
    totalHeadingChange += angleBetween(hPrev, hCurr);
  }

  if (totalDist < 1) {
    return { degPer100m: 0, inBend: false, distanceMetres: totalDist, headingChangeDeg: totalHeadingChange };
  }

  const degPer100m = (totalHeadingChange / totalDist) * 100;
  const inBend = degPer100m >= CONSTANTS.CURVATURE_BEND_DEG_PER_100M;

  return {
    degPer100m,
    inBend,
    distanceMetres: totalDist,
    headingChangeDeg: totalHeadingChange,
  };
}

export function formatPhrase(adviceResult, lang = 'en') {
  const dict = PHRASES[lang] || PHRASES.en;
  if (!adviceResult) return '';
  const { advice, reasons, reasonKeys, hazardDistance, lookaheadMetres = CONSTANTS.DEFAULT_LOOKAHEAD_METRES } = adviceResult;

  if (advice === 'avoid') {
    const key = reasonKeys?.[0] || 'bend';
    const reasonText = dict.reasons?.[key] || reasons?.[0] || 'Hazard ahead';
    return dict.avoid.replace('{reason}', reasonText);
  }

  if (advice === 'caution') {
    if (hazardDistance != null) {
      const n = Math.round(hazardDistance / 50) * 50 || Math.round(hazardDistance);
      return dict.caution.replace('{n}', String(n));
    }
    if (dict.caution_night) {
      return dict.caution_night;
    }
    return dict.caution.replace('{n}', String(lookaheadMetres));
  }

  if (advice === 'no_known_hazard') {
    return dict.no_known_hazard.replace('{n}', String(lookaheadMetres));
  }

  return '';
}

/**
 * Pure overtaking advice evaluator.
 * advice: 'avoid' | 'caution' | 'no_known_hazard'
 * reasons: string[]
 * phraseKey: string
 * phrase: string (formatted spoken advice)
 */
export function adviseOvertake({
  position,
  speedKmh,
  provider,
  fixes = [],
  now = Date.now(),
  lookaheadMetres = CONSTANTS.DEFAULT_LOOKAHEAD_METRES,
  lang = 'en',
} = {}) {
  const curvature = trackCurvature(fixes);
  const night = isNight(now);

  const spotsAhead = provider?.ahead ? provider.ahead(position, CONSTANTS.CAUTION_HAZARD_DISTANCE_MAX_M) : [];

  const avoidReasons = [];
  const avoidReasonKeys = [];

  // Rule 1: in a bend
  if (curvature.inBend) {
    avoidReasons.push('You are in a bend');
    avoidReasonKeys.push('bend');
  }

  // Rule 2: hazard within 300 m ahead (severity >= 2 or reports >= 3)
  const immediateHazard = spotsAhead.find(s => {
    if (s.distance > CONSTANTS.AVOID_HAZARD_DISTANCE_M) return false;
    const isSevere = s.severity >= 2 || s.severity === 'severe';
    const hasReports = (s.reports ?? 1) >= 3;
    return isSevere || hasReports;
  });

  if (immediateHazard) {
    if (immediateHazard.kind === 'pothole') {
      avoidReasons.push('Rough road just ahead');
      avoidReasonKeys.push('rough_road');
    } else {
      avoidReasons.push('Riders brake hard just ahead');
      avoidReasonKeys.push('hard_brake');
    }
  }

  // Rule 3: speed < 15 km/h (crawling traffic)
  if (typeof speedKmh === 'number' && speedKmh < CONSTANTS.AVOID_MIN_SPEED_KMH) {
    avoidReasons.push('Traffic is too slow');
    avoidReasonKeys.push('traffic_slow');
  }

  // Rule 4: night (23:00-05:00) AND hazard within 500 m
  if (night && !immediateHazard) {
    const nightHazard = spotsAhead.find(s => s.distance <= CONSTANTS.AVOID_NIGHT_HAZARD_DISTANCE_M);
    if (nightHazard) {
      if (nightHazard.kind === 'pothole') {
        avoidReasons.push('Rough road just ahead');
        avoidReasonKeys.push('rough_road');
      } else {
        avoidReasons.push('Riders brake hard just ahead');
        avoidReasonKeys.push('hard_brake');
      }
    }
  }

  if (avoidReasons.length > 0) {
    const result = {
      advice: 'avoid',
      reasons: avoidReasons,
      reasonKeys: avoidReasonKeys,
      phraseKey: 'avoid',
      curvature,
      hazardDistance: immediateHazard?.distance,
      lookaheadMetres,
    };
    result.phrase = formatPhrase(result, lang);
    return result;
  }

  // Caution rule: any hazard within 300-600 m ahead, or night
  const cautionHazard = spotsAhead.find(s => s.distance > CONSTANTS.AVOID_HAZARD_DISTANCE_M && s.distance <= CONSTANTS.CAUTION_HAZARD_DISTANCE_MAX_M);

  if (cautionHazard || night) {
    const cautionReasons = [];
    if (cautionHazard) {
      cautionReasons.push(cautionHazard.kind === 'pothole' ? 'Rough road reported ahead' : 'Hazard reported ahead');
    }
    if (night) {
      cautionReasons.push('Night');
    }
    const result = {
      advice: 'caution',
      reasons: cautionReasons,
      reasonKeys: cautionHazard ? ['hazard_ahead'] : ['night'],
      phraseKey: 'caution',
      curvature,
      hazardDistance: cautionHazard?.distance,
      lookaheadMetres,
    };
    result.phrase = formatPhrase(result, lang);
    return result;
  }

  // Otherwise: no known hazard
  const result = {
    advice: 'no_known_hazard',
    reasons: [],
    reasonKeys: [],
    phraseKey: 'no_known_hazard',
    curvature,
    hazardDistance: null,
    lookaheadMetres,
  };
  result.phrase = formatPhrase(result, lang);
  return result;
}

/**
 * createOvertakeWatcher({ clock, lang })
 * Unprompted warning ONLY for avoid because of a bend or a hazard,
 * at speed >= 40 km/h, at most once per 3 minutes,
 * never within 2 minutes of other speech, at most 6 per hour.
 */
export function createOvertakeWatcher(options = {}) {
  const getTime = options.clock?.now ?? (typeof options.clock === 'function' ? options.clock : () => Date.now());
  let lastWarnedAt = 0;
  let warningHistory = []; // timestamps within the last hour

  function update(params = {}) {
    const {
      position,
      speedKmh,
      provider,
      fixes,
      now: explicitNow,
      somethingElseSpokeAt = 0,
      lang = options.lang || 'en',
    } = params;

    const currentTime = explicitNow ?? getTime();

    // Rate limit 1: speed >= 40 km/h
    if (typeof speedKmh !== 'number' || speedKmh < CONSTANTS.WATCHER_MIN_SPEED_KMH) {
      return null;
    }

    // Rate limit 2: at most once per 3 minutes
    if (currentTime - lastWarnedAt < CONSTANTS.WATCHER_COOLDOWN_MS) {
      return null;
    }

    // Rate limit 3: never within 2 minutes of other speech
    if (somethingElseSpokeAt > 0 && currentTime - somethingElseSpokeAt < CONSTANTS.WATCHER_SPEECH_QUIET_MS) {
      return null;
    }

    // Rate limit 4: at most 6 per hour
    const oneHourAgo = currentTime - 60 * 60 * 1000;
    warningHistory = warningHistory.filter(t => t > oneHourAgo);
    if (warningHistory.length >= CONSTANTS.WATCHER_MAX_PER_HOUR) {
      return null;
    }

    // Evaluate advice
    const result = adviseOvertake({
      position,
      speedKmh,
      provider,
      fixes,
      now: currentTime,
      lang,
    });

    // Unprompted warning ONLY for avoid because of a bend or a hazard
    if (result.advice !== 'avoid') {
      return null;
    }

    const isBendOrHazard = result.reasonKeys?.some(k => k === 'bend' || k === 'hard_brake' || k === 'rough_road');
    if (!isBendOrHazard) {
      return null;
    }

    // Record warning
    lastWarnedAt = currentTime;
    warningHistory.push(currentTime);

    return {
      ...result,
      at: currentTime,
    };
  }

  function reset() {
    lastWarnedAt = 0;
    warningHistory = [];
  }

  return {
    update,
    reset,
  };
}
