// src/lib/drive-voice.js
//
// Drive intents through the Intent Layer (hand-off DRV-03 from the QuietKeep
// Drive thread, 17 Oct 2026). The brain names them; this file decides what
// each one is allowed to do and what Aaria says. The Drive features themselves
// stay where the Drive thread built them:
//   save_last_60s  src/lib/blackbox.js saveLast60s('voice_save') - seals the
//                  black box's last 60 seconds on the phone (PR #178)
//   share_record   not wired yet: read back WHO it would go to, send nothing
//   read_health,
//   read_faults    answered by the OBD reader later (card DRV-06); until then
//                  "Connect the car reader first"
//   hazard_ahead   the ride guard's shared hazard map (src/lib/hazard-alerts.js,
//                  /api/ride/hazards-near)
//   stay_awake     the stay-awake companion runs inside the ride guard
//                  (src/lib/ride-care.js); voice fatigue check is card DRV-04
//
// Levels (src/lib/action-levels.js): saving the record stays on the phone and
// is done straight away (read_back - the hand-off's "auto"); sharing reaches
// another person (spoken_yes); the rest only answer (read_back).
//
// The server half (planDriveTurn) runs in /api/voice/capture and never acts
// on the phone; the phone half (runDriveAction) runs in the Aaria dock after
// the server said "do".

import { metresBetween, spotIsWorthWarning, bearingDeg, angleBetween } from './hazard-alerts.js';

export const DRIVE_INTENTS = new Set([
  'save_last_60s', 'share_record', 'read_health', 'read_faults', 'hazard_ahead', 'stay_awake',
]);

// Brain intent -> the type action-levels.js knows.
export const DRIVE_TYPE = Object.freeze({
  save_last_60s: 'drive_save_record',
  share_record:  'drive_share_record',
  read_health:   'drive_read_health',
  read_faults:   'drive_read_faults',
  hazard_ahead:  'drive_hazard_ahead',
  stay_awake:    'drive_stay_awake',
});

// What the phone does for each intent (null = answer only, nothing on the phone).
export const DEVICE_ACTION = Object.freeze({
  save_last_60s: 'save_last_60s',
  share_record:  null,             // later Drive card
  read_health:   null,             // later Drive card (DRV-06)
  read_faults:   null,
  hazard_ahead:  'hazard_ahead',
  stay_awake:    'stay_awake',
});

function langOf(language) {
  const base = String(language || 'en').toLowerCase().split('-')[0];
  return base === 'te' || base === 'hi' ? base : 'en';
}

const LINES = {
  en: {
    saving:         'Saving the last 60 seconds.',
    saved:          'Saved the last 60 seconds of the drive.',
    save_no_box:    'The black box only works in the QuietKeep app with Drive Mode on.',
    save_failed:    'I could not save the record just now. Try once more.',
    share_who:      (who) => `Share the record with ${who}? Sharing is not ready yet, so nothing has been sent.`,
    share_nobody:   'Sharing records is not ready yet, so nothing has been sent.',
    reader_first:   'Connect the car reader first, then ask me again.',
    hazard_looking: 'Checking the road ahead.',
    hazard_none:    'Nothing reported on the road ahead.',
    hazard_found:   (phrase, m) => `${phrase.replace(/\s*just ahead\.?$/i, '')} in about ${m} metres.`,
    hazard_no_fix:  'I do not know where you are yet. Turn on location and Drive Mode.',
    awake_on:       'I am watching your ride time and will tell you when to stop. If your eyes feel heavy, stop at the next safe place now.',
    awake_off:      'Turn on Drive Mode and I will keep watch on your ride time. If you are sleepy, stop at the next safe place.',
  },
  hi: {
    saving:         'पिछले 60 सेकंड सेव कर रही हूँ।',
    saved:          'ड्राइव के पिछले 60 सेकंड सेव हो गए।',
    save_no_box:    'ब्लैक बॉक्स सिर्फ़ QuietKeep ऐप में ड्राइव मोड चालू होने पर काम करता है।',
    save_failed:    'अभी रिकॉर्ड सेव नहीं हो पाया। एक बार फिर कोशिश कीजिए।',
    share_who:      (who) => `रिकॉर्ड ${who} को भेजूँ? शेयर करना अभी तैयार नहीं है, कुछ नहीं भेजा गया।`,
    share_nobody:   'रिकॉर्ड शेयर करना अभी तैयार नहीं है, कुछ नहीं भेजा गया।',
    reader_first:   'पहले कार रीडर जोड़िए, फिर मुझसे पूछिए।',
    hazard_looking: 'आगे का रास्ता देख रही हूँ।',
    hazard_none:    'आगे के रास्ते पर कुछ रिपोर्ट नहीं हुआ है।',
    hazard_found:   (_phrase, m) => `लगभग ${m} मीटर आगे राइडर अक्सर अचानक ब्रेक लगाते हैं। संभलकर चलिए।`,
    hazard_no_fix:  'मुझे अभी आपकी जगह नहीं पता। लोकेशन और ड्राइव मोड चालू कीजिए।',
    awake_on:       'मैं आपकी राइड का समय देख रही हूँ और रुकने का समय बताऊँगी। आँखें भारी लगें तो अगली सुरक्षित जगह पर अभी रुकिए।',
    awake_off:      'ड्राइव मोड चालू कीजिए, मैं राइड का समय देखती रहूँगी। नींद आ रही हो तो अगली सुरक्षित जगह पर रुकिए।',
  },
  te: {
    saving:         'చివరి 60 సెకన్లు సేవ్ చేస్తున్నాను.',
    saved:          'డ్రైవ్ లో చివరి 60 సెకన్లు సేవ్ అయ్యాయి.',
    save_no_box:    'బ్లాక్ బాక్స్ QuietKeep యాప్ లో డ్రైవ్ మోడ్ ఆన్ లో ఉన్నప్పుడు మాత్రమే పని చేస్తుంది.',
    save_failed:    'ఇప్పుడు రికార్డ్ సేవ్ కాలేదు. ఇంకోసారి ప్రయత్నించండి.',
    share_who:      (who) => `రికార్డ్ ${who} కి పంపాలా? షేర్ చేయడం ఇంకా సిద్ధంగా లేదు, ఏమీ పంపలేదు.`,
    share_nobody:   'రికార్డ్ షేర్ చేయడం ఇంకా సిద్ధంగా లేదు, ఏమీ పంపలేదు.',
    reader_first:   'ముందు కార్ రీడర్ కనెక్ట్ చేసి, మళ్ళీ అడగండి.',
    hazard_looking: 'ముందున్న రోడ్డు చూస్తున్నాను.',
    hazard_none:    'ముందున్న రోడ్డులో ఏమీ రిపోర్ట్ కాలేదు.',
    hazard_found:   (_phrase, m) => `సుమారు ${m} మీటర్ల ముందు రైడర్లు సడన్ గా బ్రేక్ వేస్తుంటారు. జాగ్రత్తగా వెళ్ళండి.`,
    hazard_no_fix:  'మీరు ఎక్కడ ఉన్నారో ఇంకా తెలియదు. లొకేషన్, డ్రైవ్ మోడ్ ఆన్ చేయండి.',
    awake_on:       'మీ రైడ్ సమయం చూస్తున్నాను, ఆగాల్సిన సమయం చెప్తాను. కళ్ళు బరువెక్కితే ఇప్పుడే దగ్గర్లో సురక్షితమైన చోట ఆగండి.',
    awake_off:      'డ్రైవ్ మోడ్ ఆన్ చేయండి, మీ రైడ్ సమయం చూస్తుంటాను. నిద్ర వస్తుంటే దగ్గర్లో సురక్షితమైన చోట ఆగండి.',
  },
};

export function driveLine(key, language, ...args) {
  const set = LINES[langOf(language)];
  const v = set[key] ?? LINES.en[key];
  return typeof v === 'function' ? v(...args) : v;
}

/**
 * The server's plan for one Drive turn. Pure. No keep is ever saved.
 * @returns {{ type, deviceAction: string|null, tts: string }}
 *   deviceAction is what the phone should do if the safety check says "do".
 *   tts is what is said when the phone does nothing (the phone replaces it
 *   with the result of its action when it acts).
 */
export function planDriveTurn({ intent, entities = {}, language }) {
  const type = DRIVE_TYPE[intent];
  if (!type) return null;
  const deviceAction = DEVICE_ACTION[intent];
  let tts;
  switch (intent) {
    case 'save_last_60s':  tts = driveLine('saving', language); break;
    case 'share_record': {
      const who = typeof entities.person === 'string' && entities.person.trim() ? entities.person.trim() : null;
      tts = who ? driveLine('share_who', language, who) : driveLine('share_nobody', language);
      break;
    }
    case 'read_health':
    case 'read_faults':    tts = driveLine('reader_first', language); break;
    case 'hazard_ahead':   tts = driveLine('hazard_looking', language); break;
    case 'stay_awake':     tts = driveLine('awake_off', language); break;
    default:               tts = null;
  }
  return { type, deviceAction, tts };
}

/**
 * The nearest reported hazard ahead, within maxMetres. Pure.
 * position: { lat, lng, headingDeg? }; spots as from /api/ride/hazards-near.
 * Without a heading, "ahead" is simply "nearby".
 */
export function nearestHazard(position, spots = [], maxMetres = 1000) {
  if (!position || typeof position.lat !== 'number' || typeof position.lng !== 'number') return null;
  let best = null;
  for (const spot of spots || []) {
    if (!spotIsWorthWarning(spot)) continue;
    const d = metresBetween(position, spot);
    if (d > maxMetres || d < 15) continue;
    if (typeof position.headingDeg === 'number') {
      const off = angleBetween(position.headingDeg, bearingDeg(position, spot));
      if (off > 45) continue;
    }
    if (!best || d < best.distance) best = { spot, distance: d };
  }
  return best;
}

/** Round to a distance that is easy to say: 50 m steps under 500, 100 m above. */
export function sayableMetres(m) {
  const step = m < 500 ? 50 : 100;
  return Math.max(step, Math.round(m / step) * step);
}

/**
 * The phone half: carry out the action and return the sentence to say.
 * Only called after the server's safety check said "do".
 * deps are injected so this can run in tests without a phone.
 */
export async function runDriveAction(action, { language, deps }) {
  const d = deps || {};
  if (action === 'save_last_60s') {
    if (!d.isBlackboxAvailable?.()) return driveLine('save_no_box', language);
    const r = await d.saveLast60s?.('voice_save');
    return r ? driveLine('saved', language) : driveLine('save_failed', language);
  }
  if (action === 'hazard_ahead') {
    const pos = d.position?.();
    if (!pos) return driveLine('hazard_no_fix', language);
    let spots = [];
    try { spots = (await d.fetchSpots?.(pos)) || []; } catch { spots = []; }
    const best = nearestHazard(pos, spots);
    if (!best) return driveLine('hazard_none', language);
    return driveLine('hazard_found', language, d.phraseFor ? d.phraseFor(best.spot) : 'Riders often slow down suddenly just ahead.', sayableMetres(best.distance));
  }
  if (action === 'stay_awake') {
    return d.isRideGuardActive?.() ? driveLine('awake_on', language) : driveLine('awake_off', language);
  }
  return null;
}
