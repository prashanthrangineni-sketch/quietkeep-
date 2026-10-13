// tests/action-levels.test.mjs - the safety check before every action, with
// every level and every proof combination spelled out. Plain node.
import {
  LEVEL, DECISION, levelFor, decide, withinLimits, isSpokenYes, ACTION_LIMITS, SAY, TABLE_FOR_DOCS,
} from '../src/lib/action-levels.js';

let pass = 0, fail = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  ${detail}`}`);
  ok ? pass++ : fail++;
}
const d = (action, proof, ctx) => decide(action, proof, ctx);

// ── the table ────────────────────────────────────────────────────────────────
check('reminder is read-back', levelFor({ type: 'reminder' }) === LEVEL.READ_BACK);
check('navigation is read-back', levelFor({ type: 'navigation' }) === LEVEL.READ_BACK);
check('note is read-back', levelFor({ type: 'note' }) === LEVEL.READ_BACK);
check('call to a saved contact needs spoken yes', levelFor({ type: 'contact', contactSaved: true }) === LEVEL.SPOKEN_YES);
check('call to an unknown number needs PIN', levelFor({ type: 'contact', contactSaved: false }) === LEVEL.PIN);
check('call with contact status UNKNOWN needs PIN (unknown is not saved)', levelFor({ type: 'contact' }) === LEVEL.PIN);
check('a ledger line needs spoken yes, not PIN', levelFor({ type: 'ledger_debit' }) === LEVEL.SPOKEN_YES);
check('money actually moving needs PIN', levelFor({ type: 'money_transfer' }) === LEVEL.PIN);
check('any type flagged movesMoney needs PIN', levelFor({ type: 'expense', movesMoney: true }) === LEVEL.PIN);
check('sharing location needs PIN', levelFor({ type: 'share_location' }) === LEVEL.PIN);
check('cloned voice needs PIN', levelFor({ type: 'voice_clone' }) === LEVEL.PIN);
check('delete everything is never by voice', levelFor({ type: 'delete_all' }) === LEVEL.NEVER);
check('unknown intent is never', levelFor({ type: 'unknown' }) === LEVEL.NEVER);
check('an unlisted type is never (unclassified = not taken)', levelFor({ type: 'launch_rocket' }) === LEVEL.NEVER);
check('empty / missing type is never', levelFor({}) === LEVEL.NEVER && levelFor(null) === LEVEL.NEVER);
check('every table entry maps to a real level', Object.values(TABLE_FOR_DOCS).every((v) => Object.values(LEVEL).includes(v)));

// ── read-back: do it ─────────────────────────────────────────────────────────
{
  const r = d({ type: 'reminder' }, {});
  check('read-back needs no proof at all', r.decision === DECISION.DO && r.needs.length === 0, JSON.stringify(r));
}

// ── spoken yes: every combination ────────────────────────────────────────────
{
  const call = { type: 'contact', contactSaved: true };
  const ctx = { doneThisHour: 0 };
  check('call, no proof -> ask yes', d(call, {}, ctx).decision === DECISION.ASK_YES);
  check('call, yes but lock unknown -> ask unlock', d(call, { spokenYes: true }, ctx).decision === DECISION.ASK_UNLOCK);
  check('call, yes but locked -> ask unlock', d(call, { spokenYes: true, unlocked: false }, ctx).decision === DECISION.ASK_UNLOCK);
  check('call, unlocked but no yes -> ask yes (yes comes first)', d(call, { unlocked: true }, ctx).decision === DECISION.ASK_YES);
  check('call, yes + unlocked -> do', d(call, { spokenYes: true, unlocked: true }, ctx).decision === DECISION.DO);
  check('a yes given as a string is not a yes', d(call, { spokenYes: 'yes', unlocked: true }, ctx).decision === DECISION.ASK_YES);
  check('the needs list names what is missing', JSON.stringify(d(call, {}, ctx).needs) === '["spoken_yes"]');
}

// ── PIN: voice alone can never satisfy it ────────────────────────────────────
{
  const ctx = { doneThisHour: 0 };
  const unknownNum = { type: 'contact', contactSaved: false };
  check('unknown number, spoken yes + unlocked is NOT enough', d(unknownNum, { spokenYes: true, unlocked: true }, ctx).decision === DECISION.ASK_PIN);
  check('unknown number with PIN -> do', d(unknownNum, { pin: true }, ctx).decision === DECISION.DO);
  check('money transfer by voice -> ask pin, reason says why', (() => { const r = d({ type: 'money_transfer' }, { spokenYes: true, unlocked: true }, ctx); return r.decision === DECISION.ASK_PIN && r.reason === 'needs_pin'; })());
}

// ── never ────────────────────────────────────────────────────────────────────
{
  const r = d({ type: 'delete_all' }, { spokenYes: true, unlocked: true, pin: true }, { doneThisHour: 0 });
  check('never: even every proof does not make it happen', r.decision === DECISION.REFUSE && r.reason === 'not_a_voice_action');
  check('unknown intent refuses with a non-security reason', d({ type: 'unknown' }).reason === 'not_a_voice_action');
}

// ── the owner's voice ────────────────────────────────────────────────────────
{
  const call = { type: 'contact', contactSaved: true };
  const full = { spokenYes: true, unlocked: true };
  check('speaker check says NOT owner -> refuse', d(call, { ...full, ownerVoice: false }, { doneThisHour: 0 }).reason === 'not_owner_voice');
  check('speaker check says owner -> do', d(call, { ...full, ownerVoice: true }, { doneThisHour: 0 }).decision === DECISION.DO);
  check('no speaker check (null) is not treated as true, and does not block either', d(call, { ...full, ownerVoice: null }, { doneThisHour: 0 }).decision === DECISION.DO);
  check('not-owner still allows a read-back (a reminder is harmless)', d({ type: 'reminder' }, { ownerVoice: false }).decision === DECISION.DO);
}

// ── limits ───────────────────────────────────────────────────────────────────
{
  const call = { type: 'contact', contactSaved: true };
  const full = { spokenYes: true, unlocked: true };
  check('read-back is uncapped', withinLimits(LEVEL.READ_BACK, 99999));
  check('spoken-yes cap exists', ACTION_LIMITS[LEVEL.SPOKEN_YES].per_hour > 0);
  check('19 done, cap 20 -> within', withinLimits(LEVEL.SPOKEN_YES, 19));
  check('20 done, cap 20 -> not within', !withinLimits(LEVEL.SPOKEN_YES, 20));
  check('unknown count is NOT within (unknown is not zero)', !withinLimits(LEVEL.SPOKEN_YES, null) && !withinLimits(LEVEL.SPOKEN_YES, undefined));
  check('at the cap, a perfect call is refused with limit reason', d(call, full, { doneThisHour: 20 }).reason === 'hourly_limit_reached');
  check('count unknown, a perfect call is refused and says the count is unknown', d(call, full, {}).reason === 'hourly_count_unknown');
  check('PIN cap is tighter than spoken-yes cap', ACTION_LIMITS[LEVEL.PIN].per_hour < ACTION_LIMITS[LEVEL.SPOKEN_YES].per_hour);
}

// ── the off-switch ───────────────────────────────────────────────────────────
{
  const paused = { settings: { actions_paused: true }, doneThisHour: 0 };
  check('paused: a call is refused', d({ type: 'contact', contactSaved: true }, { spokenYes: true, unlocked: true }, paused).reason === 'actions_paused');
  check('paused: even a reminder is refused (off means off)', d({ type: 'reminder' }, {}, paused).decision === DECISION.REFUSE);
  check('not paused: reminder goes', d({ type: 'reminder' }, {}, { settings: { actions_paused: false } }).decision === DECISION.DO);
}

// ── the yes words ────────────────────────────────────────────────────────────
check('yes', isSpokenYes('yes'));
check('haan (Hindi, romanised)', isSpokenYes('haan'));
check('avunu (Telugu, romanised)', isSpokenYes('avunu'));
check('అవును', isSpokenYes('అవును'));
check('हाँ', isSpokenYes('हाँ'));
check('sare cheyyi', isSpokenYes('sare cheyyi'));
check('"no" is not a yes', !isSpokenYes('no'));
check('"yesterday" is not a yes', !isSpokenYes('yesterday'));
check('a long sentence starting with yes is not a yes', !isSpokenYes('yes but first remind me to buy milk tomorrow'));
check('empty is not a yes', !isSpokenYes('') && !isSpokenYes(null));
check('"yes please" / "haan ji" are a yes', isSpokenYes('yes please') && isSpokenYes('haan ji'));
check('a short sentence that only STARTS with yes is not a yes ("haan paise bhejo")', !isSpokenYes('haan paise bhejo'));
check('"ok call 9876543210" is not a yes', !isSpokenYes('ok call 9876543210'));

// ── every non-do reason has something to say, and none of it says denied ─────
{
  const reasons = ['needs_spoken_yes', 'needs_unlocked_phone', 'needs_pin', 'actions_paused', 'not_owner_voice', 'not_a_voice_action', 'hourly_limit_reached', 'hourly_count_unknown'];
  check('every reason code has a SAY entry', reasons.every((r) => typeof SAY[r] === 'string' && SAY[r]));
  check('no SAY entry mentions denial or access', Object.values(SAY).every((s) => !/den|access|permission/i.test(s)));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
