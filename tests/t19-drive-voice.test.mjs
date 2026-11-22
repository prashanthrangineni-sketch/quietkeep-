// tests/t19-drive-voice.test.mjs
// Card T19: Drive Mode voice audit
// Verifies EVERY drive intent across te, hi, en:
// 1. Reply is in the spoken language (script verification).
// 2. The action named is what really runs (or honest "not wired yet / connect reader first").
// 3. Nothing claims done when nothing happened.

import assert from 'node:assert/strict';
import {
  DRIVE_INTENTS,
  DRIVE_TYPE,
  DEVICE_ACTION,
  planDriveTurn,
  runDriveAction,
  driveLine,
} from '../src/lib/drive-voice.js';

let pass = 0;
let fail = 0;

function check(name, ok, detail = '') {
  if (ok) {
    console.log(`PASS  ${name}`);
    pass++;
  } else {
    console.error(`FAIL  ${name}${detail ? ` (${detail})` : ''}`);
    fail++;
  }
}

console.log('── Card T19: Drive Mode Voice Audit (te, hi, en) ──\n');

const TELUGU_REGEX = /[\u0C00-\u0C7F]/;
const HINDI_REGEX = /[\u0900-\u097F]/;

const INTENTS = Array.from(DRIVE_INTENTS);
const LANGUAGES = ['te', 'hi', 'en'];

// 1. Verify every intent is planned in every language
for (const intent of INTENTS) {
  for (const lang of LANGUAGES) {
    const plan = planDriveTurn({
      intent,
      language: lang,
      entities: intent === 'share_record' ? { person: 'Suresh' } : {},
    });

    check(`[${intent}] [${lang}] produces a valid plan`, !!plan);
    check(`[${intent}] [${lang}] type is mapped`, plan.type === DRIVE_TYPE[intent]);
    check(`[${intent}] [${lang}] deviceAction matches specification`, plan.deviceAction === DEVICE_ACTION[intent]);
    check(`[${intent}] [${lang}] has non-empty tts`, typeof plan.tts === 'string' && plan.tts.length > 0);

    // Spoken language verification
    if (lang === 'te') {
      check(`[${intent}] [te] tts contains Telugu script`, TELUGU_REGEX.test(plan.tts), plan.tts);
    } else if (lang === 'hi') {
      check(`[${intent}] [hi] tts contains Devanagari script`, HINDI_REGEX.test(plan.tts), plan.tts);
    } else if (lang === 'en') {
      check(
        `[${intent}] [en] tts is in English (no Indic script)`,
        !TELUGU_REGEX.test(plan.tts) && !HINDI_REGEX.test(plan.tts),
        plan.tts
      );
    }

    // Honesty / Nothing claims done when nothing happened
    if (intent === 'save_last_60s') {
      // Server plan must only say "Saving..." (in progress), never "Saved"
      check(
        `[${intent}] [${lang}] plan does NOT claim already saved`,
        !/\bSaved\b/i.test(plan.tts) && !/సేవ్ అయ్యాయి/.test(plan.tts) && !/सेव हो गए/.test(plan.tts),
        plan.tts
      );
    }

    if (intent === 'share_record') {
      // Must be null action and honestly state not ready / nothing sent
      check(`[${intent}] [${lang}] action is null (not wired yet)`, plan.deviceAction === null);
      if (lang === 'en') {
        check(`[${intent}] [en] tts states sharing not ready / nothing sent`, /not ready.*nothing.*sent/i.test(plan.tts));
      } else if (lang === 'te') {
        check(`[${intent}] [te] tts states sharing not ready / nothing sent`, /సిద్ధంగా లేదు.*ఏమీ పంపలేదు/.test(plan.tts));
      } else if (lang === 'hi') {
        check(`[${intent}] [hi] tts states sharing not ready / nothing sent`, /तैयार नहीं.*कुछ नहीं भेजा/.test(plan.tts));
      }
    }

    if (intent === 'read_health' || intent === 'read_faults') {
      // Fallback server plan must honestly say connect car reader first
      if (lang === 'en') {
        check(`[${intent}] [en] honest line: connect reader first`, /Connect the car reader first/i.test(plan.tts));
      } else if (lang === 'te') {
        check(`[${intent}] [te] honest line: connect reader first`, /ముందు కార్ రీడర్ కనెక్ట్ చేసి/.test(plan.tts));
      } else if (lang === 'hi') {
        check(`[${intent}] [hi] honest line: connect reader first`, /पहले कार रीडर जोड़िए/.test(plan.tts));
      }
    }
  }
}

// 2. Test language tag variants (e.g. te-IN, te_IN, hi-IN, hi_IN)
for (const tag of ['te-IN', 'te_IN', 'hi-IN', 'hi_IN', 'en-IN', 'en_US']) {
  const plan = planDriveTurn({ intent: 'save_last_60s', language: tag });
  const base = tag.toLowerCase().slice(0, 2);
  if (base === 'te') {
    check(`Language tag ${tag} resolves to Telugu`, TELUGU_REGEX.test(plan.tts));
  } else if (base === 'hi') {
    check(`Language tag ${tag} resolves to Hindi`, HINDI_REGEX.test(plan.tts));
  } else {
    check(`Language tag ${tag} resolves to English`, !TELUGU_REGEX.test(plan.tts) && !HINDI_REGEX.test(plan.tts));
  }
}

// 3. Execution audit on phone half (runDriveAction): verify truthfulness
console.log('\n── Execution Audit: Honest replies on real outcomes ──\n');

// A. save_last_60s
const noBlackboxEn = await runDriveAction('save_last_60s', {
  language: 'en',
  deps: { isBlackboxAvailable: () => false },
});
check('save_last_60s without blackbox: honest refusal', /only works.*Drive Mode/i.test(noBlackboxEn));

const saveFailedTe = await runDriveAction('save_last_60s', {
  language: 'te',
  deps: { isBlackboxAvailable: () => true, saveLast60s: async () => ({ saved: false, reason: 'no_result' }) },
});
check('save_last_60s failed save in Telugu: honest failure', /సేవ్ కాలేదు/i.test(saveFailedTe));

const saveSuccessHi = await runDriveAction('save_last_60s', {
  language: 'hi',
  deps: { isBlackboxAvailable: () => true, saveLast60s: async () => ({ saved: true, sealed: true }) },
});
check('save_last_60s successful save in Hindi: confirmed', /सेव हो गए/i.test(saveSuccessHi));

// B. read_health & read_faults
const noReaderTe = await runDriveAction('read_health', {
  language: 'te',
  deps: { describeCar: async () => null },
});
check('read_health without reader in Telugu: asks to connect reader first', /ముందు కార్ రీడర్ కనెక్ట్ చేసి/.test(noReaderTe));

const readerBrokeHi = await runDriveAction('read_faults', {
  language: 'hi',
  deps: { describeFaults: async () => { throw new Error('OBD timeout'); } },
});
check('read_faults on error in Hindi: reports read failure honestly', /नहीं पढ़ पाई/i.test(readerBrokeHi));

// C. hazard_ahead
const noPosEn = await runDriveAction('hazard_ahead', {
  language: 'en',
  deps: { position: () => null },
});
check('hazard_ahead without GPS fix: honestly states location unknown', /do not know where you are/i.test(noPosEn));

const noHazardTe = await runDriveAction('hazard_ahead', {
  language: 'te',
  deps: { position: () => ({ lat: 17.4, lng: 78.4 }), fetchSpots: async () => [] },
});
check('hazard_ahead with clear road in Telugu: honestly states nothing reported', /ఏమీ రిపోర్ట్ కాలేదు/.test(noHazardTe));

// D. stay_awake
const awakeInactiveHi = await runDriveAction('stay_awake', {
  language: 'hi',
  deps: { isRideGuardActive: () => false },
});
check('stay_awake with inactive ride guard in Hindi: prompts to turn on Drive Mode', /ड्राइव मोड चालू कीजिए/.test(awakeInactiveHi));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
