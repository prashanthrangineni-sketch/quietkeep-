// src/lib/action-levels.js
//
// THE SAFETY CHECK BEFORE EVERY ACTION - the level table, as code.
// (AARIA_ONE_PLAN item 2; levels set by the founder on 10 October 2026.)
//
// One table, one decision function, no imports. Every place that is about to
// DO something on the person's behalf asks this file first, on the phone and
// on the server alike, in every language - language is never an input here.
//
// THE LEVELS
//   read_back   do it, and say what was done. Reminders, notes, tasks,
//               navigation, calendar. Nothing leaves the phone, nothing is
//               spent, nothing is sent to another person.
//   spoken_yes  the person must SAY YES to the exact action, and the phone
//               must be unlocked. Calls and messages to SAVED contacts;
//               anything that writes a money line in the ledger; a purchase
//               page being opened.
//   pin         fingerprint or PIN. Unknown numbers, money leaving an account,
//               sharing location, a cloned voice. No voice-only path may ever
//               satisfy this level, so by voice alone it always stops.
//   never       not an action Aaria takes at all (account changes, deleting
//               everything, anything unrecognised).
//   no_action   nothing to do: thanks / small talk ('none') and a bare yes or
//               no that answers no question ('confirm'). Nothing is saved,
//               nothing is done; Aaria only replies.
//
// THE DECISION
//   do          every proof the level needs is present
//   ask_yes     needs the person's spoken yes
//   ask_unlock  the person said yes but the phone is not known to be unlocked
//   ask_pin     needs fingerprint / PIN
//   refuse      must not happen - and the reason says WHY, never "denied"
//   nothing     there is no action to take (level no_action)
//
// THE FOUR RULES THE PLAN NAMES, AND WHERE EACH ONE STANDS
//   1. the level table               - THIS FILE; enforced where decide() is called
//   2. only the owner's spoken words  - proof.ownerVoice. true/false when a
//                                       speaker check exists; null today
//                                       (none exists). null is RECORDED as
//                                       unknown and never treated as true
//   3. action limits                  - ACTION_LIMITS + withinLimits()
//   4. remote off-switch              - settings.actions_paused -> refuse
//   5. the speed gate (DRV-02)         - context.speedKmh: while moving, nothing
//                                       that needs the screen; long reads wait
//
// "Unknown is null": a missing proof is never assumed present.

export const LEVEL = Object.freeze({
  READ_BACK:  'read_back',
  SPOKEN_YES: 'spoken_yes',
  PIN:        'pin',
  NEVER:      'never',
  NO_ACTION:  'no_action',
});

export const DECISION = Object.freeze({
  DO:         'do',
  ASK_YES:    'ask_yes',
  ASK_UNLOCK: 'ask_unlock',
  ASK_PIN:    'ask_pin',
  REFUSE:     'refuse',
  NOTHING:    'nothing',
});

// Intent types as this app names them (src/lib/intent-parser, the brain's
// INTENT_MAP) -> level. Anything not listed is NEVER: an action we have not
// classified is an action we do not take.
const TABLE = Object.freeze({
  // read back
  reminder:       LEVEL.READ_BACK,
  task:           LEVEL.READ_BACK,
  note:           LEVEL.READ_BACK,
  navigation:     LEVEL.READ_BACK,
  trip:           LEVEL.READ_BACK,   // saved as a trip keep; the brain's trips never auto-open Maps
  compliance:     LEVEL.READ_BACK,   // a licence / renewal tracked, with a reminder date when one is said
  meeting:        LEVEL.READ_BACK,
  document:       LEVEL.READ_BACK,
  list_reminders: LEVEL.READ_BACK,
  proactive_nudge: LEVEL.READ_BACK,  // an in-app notice to the person themself
  payroll:        LEVEL.READ_BACK,   // a DRAFT pay summary from recorded attendance, shown and
                                     // spoken; it writes nothing and pays nothing (business only)
  stock_check:    LEVEL.READ_BACK,   // "how much sugar is left" - answered, nothing written
  // Drive (hand-off DRV-03, 17 Oct 2026; src/lib/drive-voice.js). Saving the
  // black box record seals the last 60 seconds ON THE PHONE - nothing leaves
  // it, so it is done at once and said back. The rest only answer.
  drive_save_record:  LEVEL.READ_BACK,
  drive_read_health:  LEVEL.READ_BACK,
  drive_read_faults:  LEVEL.READ_BACK,
  drive_hazard_ahead: LEVEL.READ_BACK,
  drive_stay_awake:   LEVEL.READ_BACK,
  // spoken yes + unlocked
  contact:        LEVEL.SPOKEN_YES,   // a call or message to a SAVED contact
  whatsapp:       LEVEL.SPOKEN_YES,
  purchase:       LEVEL.SPOKEN_YES,
  expense:        LEVEL.SPOKEN_YES,   // a ledger line, not money moving
  invoice:        LEVEL.SPOKEN_YES,
  ledger_credit:  LEVEL.SPOKEN_YES,
  ledger_debit:   LEVEL.SPOKEN_YES,
  sale:           LEVEL.SPOKEN_YES,
  delete_note:    LEVEL.SPOKEN_YES,   // one note; it is archived, not destroyed (brain intent 'delete')
  attendance:     LEVEL.SPOKEN_YES,   // a staff attendance mark, read back first (business only)
  stock:          LEVEL.SPOKEN_YES,   // an inventory change, read back first (business only);
                                      // asking how much is left writes nothing and is no action
  drive_share_record: LEVEL.SPOKEN_YES, // a sealed drive record sent to another person: read back
                                        // WHO, then a spoken yes (sending is a later Drive card)
  // fingerprint / PIN
  call_unknown:   LEVEL.PIN,          // a number that is not a saved contact
  money_transfer: LEVEL.PIN,          // money leaving an account (UPI, payment; brain intent 'pay')
  salary_payment: LEVEL.PIN,          // paying staff salary is money leaving an account: never by voice
  share_location: LEVEL.PIN,
  voice_clone:    LEVEL.PIN,
  // never by voice
  delete_all:     LEVEL.NEVER,
  account_change: LEVEL.NEVER,
  unknown:        LEVEL.NEVER,
  // nothing to do - the reply is the whole turn
  none:           LEVEL.NO_ACTION,
  confirm:        LEVEL.NO_ACTION,    // a yes with no question pending creates nothing
});

// Per-hour ceilings for actions that reach other people or money. Chosen as
// defaults on 13 Oct 2026, not measured from use: generous enough for a busy
// shop, small enough that a runaway loop or a stranger's voice cannot do much
// before it is noticed. Read-back actions are not capped (they stay on the phone).
export const ACTION_LIMITS = Object.freeze({
  [LEVEL.SPOKEN_YES]: { per_hour: 20 },
  [LEVEL.PIN]:        { per_hour: 5 },
});

/**
 * The level for an action.
 * @param {{ type: string, contactSaved?: boolean|null, movesMoney?: boolean }} action
 *   type          the intent type
 *   contactSaved  for 'contact': is the number a saved contact? null = unknown
 *   movesMoney    a money type that actually moves money (not a ledger line)
 */
export function levelFor(action) {
  const type = String(action?.type || '').trim();
  if (!type) return LEVEL.NEVER;
  if (type === 'contact' && action.contactSaved !== true) return LEVEL.PIN; // unknown -> PIN
  if (action.movesMoney === true) return LEVEL.PIN;
  return Object.prototype.hasOwnProperty.call(TABLE, type) ? TABLE[type] : LEVEL.NEVER;
}

/**
 * Has this level room for one more action in the current hour?
 * @param {string} level
 * @param {number|null} doneThisHour  count already done; null = unknown -> no
 */
export function withinLimits(level, doneThisHour) {
  const cap = ACTION_LIMITS[level];
  if (!cap) return true;                              // uncapped level
  if (typeof doneThisHour !== 'number' || !Number.isFinite(doneThisHour)) return false;
  return doneThisHour < cap.per_hour;
}

/**
 * The safety check. Pure: nothing here looks anything up.
 *
 * @param {object} action   { type, contactSaved?, movesMoney? }
 * @param {object} proof    what has actually been established, true/false/null:
 *   spokenYes   the person said yes to THIS action after hearing it read back
 *   unlocked    the phone is unlocked (app in the foreground counts)
 *   pin         fingerprint / PIN was given for THIS action
 *   ownerVoice  a speaker check said this is the owner (null = no check exists)
 * @param {object} context  { doneThisHour?: number|null, settings?: { actions_paused?: boolean } }
 * @returns {{ level, decision, reason, needs: string[] }}
 */
export function decide(action, proof = {}, context = {}) {
  const level = levelFor(action);
  const p = proof || {};
  const out = (decision, reason, needs = []) => ({ level, decision, reason, needs });

  // 4. the remote off-switch, before anything else
  if (context?.settings?.actions_paused === true) {
    return out(DECISION.REFUSE, 'actions_paused');
  }
  // nothing to do is never "do", whatever proof came with it
  if (level === LEVEL.NO_ACTION) {
    return out(DECISION.NOTHING, 'nothing_to_do');
  }
  // 2. a speaker check that says "not the owner" stops everything above read-back
  if (p.ownerVoice === false && level !== LEVEL.READ_BACK) {
    return out(DECISION.REFUSE, 'not_owner_voice');
  }
  if (level === LEVEL.NEVER) {
    return out(DECISION.REFUSE, 'not_a_voice_action');
  }
  if (level === LEVEL.READ_BACK) {
    return out(DECISION.DO, 'read_back');
  }
  // 3. limits, for anything that reaches people or money
  if (!withinLimits(level, context?.doneThisHour ?? null)) {
    return out(DECISION.REFUSE,
      typeof context?.doneThisHour === 'number' ? 'hourly_limit_reached' : 'hourly_count_unknown');
  }
  if (level === LEVEL.PIN) {
    return p.pin === true ? out(DECISION.DO, 'pin_given') : out(DECISION.ASK_PIN, 'needs_pin', ['pin']);
  }
  // spoken_yes
  if (p.spokenYes !== true) return out(DECISION.ASK_YES, 'needs_spoken_yes', ['spoken_yes']);
  if (p.unlocked !== true)  return out(DECISION.ASK_UNLOCK, 'needs_unlocked_phone', ['unlocked']);
  return out(DECISION.DO, 'spoken_yes_and_unlocked');
}

/**
 * Words that mean "yes, do it" - a reply to a read-back question, in the
 * scripts and romanisations the recogniser actually returns. Deliberately
 * short: a long sentence is a new instruction, not a yes.
 */
const YES_WORD = 'yes|yeah|yep|ya|yah|ok|okay|sure|do it|go ahead|confirm|haan|ha|han|haa|avunu|aunu|sare|sari|cheyyi|cheyi|karo|kar do|theek hai|thik hai|ఔను|అవును|సరే|చెయ్యి|हाँ|हां|ठीक है|करो|कर दो';
// The WHOLE reply must be yes-words (plus "please"/"ji"), not merely start with
// one: "haan paise bhejo" ("yes, send the money") begins with a yes and is a
// new instruction - the attack set caught the earlier starts-with version.
// A plain character class is used instead of \b: \b only knows Latin letters,
// so it never matched at the end of a Telugu or Devanagari word.
const YES = new RegExp(`^(?:${YES_WORD})(?:[\\s,]+(?:${YES_WORD}|please|ji|pls))*[.!?]*$`, 'iu');

export function isSpokenYes(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  if (t.split(/\s+/).length > 4) return false;
  return YES.test(t);
}

/**
 * Words that mean "no, don't" - the other answer to a read-back question.
 * Same shape as isSpokenYes: the WHOLE reply must be no-words. Anything that
 * is not a clear yes is already treated as not-yes; this only lets Aaria say
 * "okay, I'll keep it" instead of treating "no" as a new instruction.
 */
const NO_WORD = 'no|nope|nah|cancel|stop|leave it|dont|don\'t|wait|nahi|nahin|na|mat karo|rehne do|rahne do|vaddu|oddu|vadhu|ledu|kaadu|aagu|aapu|వద్దు|లేదు|కాదు|ఆగు|ఆపు|नहीं|नही|मत करो|रहने दो|रुको';
const NO = new RegExp(`^(?:${NO_WORD})(?:[\\s,]+(?:${NO_WORD}|please|ji|pls|thanks|thank you|le|that|it|this))*[.!?]*$`, 'iu');

export function isSpokenNo(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  if (t.split(/\s+/).length > 4) return false;
  return NO.test(t);
}

/**
 * What the person is told when the decision is not "do", as a reason code
 * the UI speaks in the person's own language. Never "denied", never "access".
 */
export const SAY = Object.freeze({
  needs_spoken_yes:      'ask_confirm',        // "Call Surya Kiran - yes or no?"
  needs_unlocked_phone:  'unlock_first',       // "Unlock the phone and say yes."
  needs_pin:             'needs_pin',          // "That needs your fingerprint or PIN in the app."
  actions_paused:        'actions_paused',     // "Actions are paused from your settings."
  not_owner_voice:       'not_owner',          // "I only take this from the owner's voice."
  not_a_voice_action:    'not_by_voice',       // "That is not something I do by voice."
  hourly_limit_reached:  'limit_reached',      // "That is the limit for this hour."
  hourly_count_unknown:  'limit_unknown',      // "I cannot check the hourly limit just now."
  nothing_to_do:         'nothing_to_do',      // "Okay." / "What would you like me to do?"
});

/**
 * ONE TABLE. (Drift fix, 14 Oct 2026.)
 *
 * The older suggestions governor (src/lib/governor-engine.js) kept its own
 * safe / moderate / sensitive map, with different levels from this file.
 * Two tables can disagree; the plan says one. The governor now asks these
 * two functions instead, so this file is the only place a level is decided.
 *
 * governorRiskFor - the governor's word for a type, read from TABLE:
 *   read_back -> 'safe', spoken_yes -> 'moderate', pin / never -> 'sensitive'.
 *   A contact with an unknown number is PIN here, so 'sensitive' there.
 *
 * mayActUnasked - may this type happen with NOBODY asking: no spoken yes,
 *   no PIN, phone lock unknown. That is exactly an automatic action or a
 *   proactive trigger. Only read-back types may; anything that reaches
 *   another person or money may not, however confident the prediction.
 */
export function governorRiskFor(intentType) {
  const level = levelFor({ type: intentType });
  if (level === LEVEL.READ_BACK) return 'safe';
  if (level === LEVEL.SPOKEN_YES) return 'moderate';
  return 'sensitive';
}

export function mayActUnasked(intentType) {
  return decide(
    { type: intentType },
    { spokenYes: false, unlocked: false, pin: false, ownerVoice: null },
    { doneThisHour: 0 },
  ).decision === DECISION.DO;
}

export const TABLE_FOR_DOCS = TABLE;
