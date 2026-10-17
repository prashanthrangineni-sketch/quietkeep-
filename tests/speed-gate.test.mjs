// tests/speed-gate.test.mjs - DRV-02, the speed gate in src/lib/action-levels.js.
// While moving (GPS >= 8 km/h): nothing that needs the screen; spoken-yes
// actions stay voice-only; long reads wait. Plus the 200-message attack set
// run again as if the person were driving.
import {
  decide, isMoving, needsScreen, readWhileMoving, levelFor,
  LEVEL, DECISION, MOVING_SPEED_KMH, MOVING_MAX_ITEMS, MOVING_MAX_WORDS, SAY,
} from '../src/lib/action-levels.js';
import { parseIntent } from '../src/lib/intent-parser.js';
import { ATTACKS } from '../promptfoo/attack-messages.mjs';

let pass = 0, fail = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  ${detail}`}`);
  ok ? pass++ : fail++;
}

const DRIVING = { doneThisHour: 0, speedKmh: 40 };
const PARKED = { doneThisHour: 0, speedKmh: 0 };
const ALL_PROOF = { spokenYes: true, unlocked: true, pin: true, ownerVoice: null };

// ── what "moving" means ─────────────────────────────────────────────────────
check('threshold is 8 km/h', MOVING_SPEED_KMH === 8);
check('7.9 km/h (walking fast) is not moving', isMoving(7.9) === false);
check('8 km/h is moving', isMoving(8) === true);
check('unknown speed is not treated as moving', isMoving(null) === false && isMoving(undefined) === false && isMoving(NaN) === false && isMoving('40') === false);

// ── callers that pass no speed behave exactly as before ────────────────────
for (const t of ['reminder', 'contact', 'purchase', 'money_transfer', 'navigation']) {
  const before = decide({ type: t, contactSaved: true }, ALL_PROOF, { doneThisHour: 0 });
  const parked = decide({ type: t, contactSaved: true }, ALL_PROOF, PARKED);
  check(`no speed / parked: ${t} unchanged (${before.decision})`, before.decision === parked.decision && before.reason === parked.reason);
}

// ── while moving ────────────────────────────────────────────────────────────
check('moving: a reminder is still done and said back', decide({ type: 'reminder' }, {}, DRIVING).decision === DECISION.DO);
check('moving: navigation still opens (hands-free)', decide({ type: 'navigation' }, {}, DRIVING).decision === DECISION.DO);
check('moving: black-box save still works by voice', decide({ type: 'drive_save_record' }, {}, DRIVING).decision === DECISION.DO);
check('moving: a call to a saved contact asks yes/no out loud (voice-only)', decide({ type: 'contact', contactSaved: true }, {}, DRIVING).decision === DECISION.ASK_YES);
check('moving: spoken yes + app in front -> call is placed', decide({ type: 'contact', contactSaved: true }, { spokenYes: true, unlocked: true }, DRIVING).decision === DECISION.DO);
{
  const d = decide({ type: 'contact', contactSaved: true }, { spokenYes: true, unlocked: false }, DRIVING);
  check('moving: spoken yes but phone locked -> no "unlock" request; waits until stopped', d.decision === DECISION.REFUSE && d.reason === 'wait_until_stopped', JSON.stringify(d));
  const p = decide({ type: 'contact', contactSaved: true }, { spokenYes: true, unlocked: false }, PARKED);
  check('parked: same case still asks to unlock', p.decision === DECISION.ASK_UNLOCK);
}
for (const t of ['money_transfer', 'share_location', 'call_unknown', 'voice_clone', 'salary_payment']) {
  const d = decide({ type: t }, {}, DRIVING);
  check(`moving: ${t} (PIN) refused, wait until stopped`, d.decision === DECISION.REFUSE && d.reason === 'wait_until_stopped');
  const withPin = decide({ type: t }, ALL_PROOF, DRIVING);
  check(`moving: ${t} refused even with a PIN given`, withPin.decision === DECISION.REFUSE);
}
check('moving: an unknown number is PIN, so refused', decide({ type: 'contact', contactSaved: false }, ALL_PROOF, DRIVING).reason === 'wait_until_stopped');
for (const t of ['purchase', 'invoice']) {
  check(`moving: ${t} needs the screen -> refused`, decide({ type: t }, ALL_PROOF, DRIVING).reason === 'wait_until_stopped');
  check(`parked: ${t} works as before with all proofs`, decide({ type: t }, ALL_PROOF, PARKED).decision === DECISION.DO);
}
check('moving: never-actions are still refused as not-by-voice', decide({ type: 'delete_all' }, ALL_PROOF, DRIVING).reason === 'not_a_voice_action');
check('moving: actions paused still wins', decide({ type: 'reminder' }, {}, { ...DRIVING, settings: { actions_paused: true } }).reason === 'actions_paused');
check('moving: hourly limit still applies to voice-only actions', decide({ type: 'contact', contactSaved: true }, { spokenYes: true, unlocked: true }, { speedKmh: 40, doneThisHour: 999 }).reason === 'hourly_limit_reached');
check('needsScreen: PIN level always', needsScreen('anything', LEVEL.PIN) === true && needsScreen('reminder', LEVEL.READ_BACK) === false);
check('the new reasons have spoken lines', SAY.wait_until_stopped === 'wait_until_stopped' && typeof SAY.long_read_while_moving === 'string');

// ── long reads wait ─────────────────────────────────────────────────────────
const tenReminders = { items: Array.from({ length: 10 }, (_, i) => `reminder ${i}`) };
check('parked: ten reminders read in full', readWhileMoving(tenReminders, 0).deferred === false);
{
  const r = readWhileMoving(tenReminders, 40);
  check(`moving: ten reminders -> first ${MOVING_MAX_ITEMS} now, rest when stopped`, r.deferred && r.sayItems === MOVING_MAX_ITEMS && r.reason === 'long_read_while_moving');
}
check('moving: two reminders read in full', readWhileMoving({ items: ['a', 'b'] }, 40).deferred === false);
const longText = { text: Array.from({ length: 80 }, () => 'word').join(' ') };
check(`moving: an 80-word reply -> ${MOVING_MAX_WORDS} words now`, readWhileMoving(longText, 40).sayWords === MOVING_MAX_WORDS);
check('moving: a short reply is said in full', readWhileMoving({ text: 'Your next reminder is at 5.' }, 40).deferred === false);
check('unknown speed: nothing deferred', readWhileMoving(tenReminders, null).deferred === false);

// ── the 200-message attack set, while driving ───────────────────────────────
// Same first-turn proofs as tests/attack-set.test.mjs gate 1 (no spoken yes,
// app in front, worst case: the contact is saved), now at 40 km/h. PASS = only
// read-back actions run, and nothing that needs the screen runs at all.
{
  check('attack set loads (200 messages)', ATTACKS.length === 200);
  let beyondReadBack = 0, screenRan = 0, unlockAsked = 0;
  for (const [, , text] of ATTACKS) {
    const parsed = parseIntent(text);
    for (const proof of [
      { spokenYes: false, unlocked: true, pin: false, ownerVoice: null },
      // the attacker's best case: it even got a "yes" and a PIN through
      { spokenYes: true, unlocked: false, pin: true, ownerVoice: null },
    ]) {
      const d = decide({ type: parsed.type, contactSaved: true }, proof, DRIVING);
      const lvl = levelFor({ type: parsed.type, contactSaved: true });
      if (d.decision === DECISION.DO && lvl !== LEVEL.READ_BACK && proof.spokenYes !== true) beyondReadBack++;
      if (d.decision === DECISION.DO && needsScreen(parsed.type, lvl)) screenRan++;
      if (d.decision === DECISION.ASK_UNLOCK) unlockAsked++;
    }
  }
  check('driving: no attack message runs anything beyond read-back on a first turn', beyondReadBack === 0, `${beyondReadBack}`);
  check('driving: no screen-needing action runs, even with a PIN', screenRan === 0, `${screenRan}`);
  check('driving: Aaria never asks the driver to unlock the phone', unlockAsked === 0, `${unlockAsked}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
