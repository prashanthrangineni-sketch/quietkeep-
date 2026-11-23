// tests/t31-habit-offers.test.mjs
// T31 (23 Nov 2026): Aaria offers help from what she learned, at the right
// moment, asks once (hybrid), and a "yes" turns the habit into a repeating reminder.
import { register } from 'node:module';
register('./loader.mjs', import.meta.url);
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test_anon_key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test_service_role_key';
const { mockDb } = await import('./mock-supabase.mjs');
const O = await import('../src/lib/habit-offers.js');
const { refreshTauProfile } = await import('../src/lib/tau-profile.js');

let pass = 0, fail = 0;
function check(name, ok, details = '') {
  if (ok) { console.log(`PASS  ${name}`); pass++; }
  else { console.error(`FAIL  ${name} ${details ? '- ' + details : ''}`); fail++; }
}

const amma = { id: 'call:amma:evening', kind: 'call', name: 'Amma', bucket: 'evening', hour: 20, dow: null, confidence: 0.8, status: 'learned' };
const fuel = { id: 'action:expense:morning:d6', kind: 'action', intent: 'expense', bucket: 'morning', hour: 9, dow: 6, confidence: 0.7, status: 'learned' };
const ist = (iso) => new Date(`${iso}+05:30`);

// 1. What a yes creates.
{
  const p = O.planForHabit(amma);
  check('1: call habit -> daily 8 pm "Call Amma" with the contact', p.recurrence === 'daily' && p.hour === 20 && p.text === 'Call Amma' && p.contact_name === 'Amma');
  const w = O.planForHabit(fuel);
  check('1: Saturday expense habit -> weekly on Saturday at 9', w.recurrence === 'weekly' && w.dow === 6 && w.hour === 9);
  check('1: places and facts are not offered as reminders', O.planForHabit({ kind: 'place', name: 'Office' }) === null && O.planForHabit({ kind: 'fact', text: 'x' }) === null);
}

// 2. The next time, in India time.
check('2: next 8 pm after 6 pm IST is today 8 pm', O.nextAt(20, 0, null, ist('2026-11-23T18:00:00')).toISOString() === '2026-11-23T14:30:00.000Z');
check('2: next 8 pm after 9 pm IST is tomorrow', O.nextAt(20, 0, null, ist('2026-11-23T21:00:00')).toISOString() === '2026-11-24T14:30:00.000Z');
check('2: next Saturday 9 am from Monday', O.nextAt(9, 0, 6, ist('2026-11-23T10:00:00')).toISOString() === '2026-11-28T03:30:00.000Z');

// 3. The right moment: up to 3 hours before the usual time, only when sure.
check('3: 6 pm -> offers the 8 pm Amma habit', O.pickOffer([amma], 'hybrid', ist('2026-11-23T18:00:00'))?.id === amma.id);
check('3: 10 am -> too early, no offer', O.pickOffer([amma], 'hybrid', ist('2026-11-23T10:00:00')) === null);
check('3: 9 pm -> too late today, no offer', O.pickOffer([amma], 'hybrid', ist('2026-11-23T21:00:00')) === null);
check('3: not sure (0.4) -> no offer', O.pickOffer([{ ...amma, confidence: 0.4 }], 'hybrid', ist('2026-11-23T18:00:00')) === null);
check('3: asked 2 days ago -> not asked again this week', O.pickOffer([{ ...amma, asked_at: ist('2026-11-21T18:00:00').toISOString() }], 'hybrid', ist('2026-11-23T18:00:00')) === null);
check('3: "Ask me first" -> never offered by voice', O.pickOffer([amma], 'ask_first', ist('2026-11-23T18:00:00')) === null);
check('3: declined -> never offered again', O.pickOffer([{ ...amma, status: 'declined' }], 'hybrid', ist('2026-11-23T18:00:00')) === null);
check('3: weekly habit only offered on its day', O.pickOffer([fuel], 'hybrid', ist('2026-11-28T07:00:00'))?.id === fuel.id && O.pickOffer([fuel], 'hybrid', ist('2026-11-27T07:00:00')) === null);

// 4. The question, in the language spoken.
check('4: Telugu question', /మీరు సాధారణంగా రాత్రి 8 గంటలకు Ammaకి కాల్ చేస్తారు. ప్రతి రోజు గుర్తు చేయనా\?/.test(O.offerQuestion(amma, 'te-IN')), O.offerQuestion(amma, 'te-IN'));
check('4: Hindi question', /रोज़ याद दिलाऊँ\?/.test(O.offerQuestion(amma, 'hi')));
check('4: English question', O.offerQuestion(amma, 'en') === 'You usually call Amma around 8 pm. Shall I remind you every day?');
check('4: answer lines', /గుర్తు చేస్తాను/.test(O.answerLine('yes', 'te')) && /won't ask again/.test(O.answerLine('no', 'en')));

// 5. Hearing yes / no.
for (const [t, want] of [['avunu', 'yes'], ['అవును', 'yes'], ['సరే చేయి', 'yes'], ['haan', 'yes'], ['हाँ', 'yes'], ['yes please', 'yes'], ['ok', 'yes'],
  ['vaddu', 'no'], ['వద్దు', 'no'], ['నహీ', null], ['नहीं', 'no'], ['no', 'no'], ['call Ravi at 5 pm tomorrow please now', null], ['remind me', null]]) {
  check(`5: "${t}" -> ${want}`, O.offerAnswer(t) === want, String(O.offerAnswer(t)));
}

// 6. The routes: ask once, yes creates the reminder, no switches it off.
async function call(mod, method, body, query = '') {
  const req = new Request(`http://localhost/api/aaria/x${query}`, {
    method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test_jwt_token' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const res = await mod[method](req);
  return { status: res.status, data: await res.json().catch(() => null) };
}
{
  const offerRoute = await import('../src/app/api/aaria/offer/route.js');
  mockDb.reset();
  mockDb.tables.tau_behaviour_profile = [{ id: 'p1', user_id: 'u1', learning_mode: 'hybrid', habits: [{ ...amma, hour: (new Date(Date.now() + 330 * 60000).getUTCHours() + 2) % 24 }] }];
  mockDb.tables.reminders = [];
  const g = await call(offerRoute, 'GET', null, '?lang=te-IN');
  check('6: offer returned in Telugu', !!g.data?.offer?.question && /గుర్తు చేయనా/.test(g.data.offer.question), JSON.stringify(g.data));
  const row = mockDb.tables.tau_behaviour_profile.find((r) => r.user_id === 'u1');
  check('6: marked as asked (asked once)', !!row.habits[0].asked_at);
  const again = await call(offerRoute, 'GET', null, '?lang=te-IN');
  check('6: not asked again right away', again.data?.offer === null, JSON.stringify(again.data));
  const y = await call(offerRoute, 'POST', { id: amma.id, answer: 'yes', lang: 'te' });
  const rem = mockDb.tables.reminders[0];
  check('6: yes -> a daily repeating reminder "Call Amma"', y.status === 200 && rem?.recurrence === 'daily' && rem?.reminder_text === 'Call Amma' && rem?.contact_name === 'Amma', JSON.stringify(rem));
  const after = mockDb.tables.tau_behaviour_profile.find((r) => r.user_id === 'u1').habits[0];
  check('6: habit confirmed and linked to its reminder', after.status === 'confirmed' && !!after.reminder_id);
  check('6: Aaria answers in Telugu', /గుర్తు చేస్తాను/.test(y.data?.line || ''));
  const learned = await import('../src/app/api/aaria/learned/route.js');
  await call(learned, 'POST', { action: 'forget', id: amma.id });
  check('6: "Forget" switches the reminder off', mockDb.tables.reminders[0].is_active === false);
}

// 7. The nightly rebuild: "Let her act" sets it up by itself; hybrid does not.
{
  const { createClient } = await import('@supabase/supabase-js');
  const db = createClient('http://localhost:54321', 'test_service_role_key');
  const now = new Date('2026-11-22T12:00:00Z');
  const ist7 = (daysAgo, hh) => {
    const d = new Date(now.getTime() - daysAgo * 864e5).toISOString().slice(0, 10);
    return new Date(`${d}T${String(hh).padStart(2, '0')}:05:00+05:30`).toISOString();
  };
  const keeps = [1, 2, 3, 4, 5, 6, 7, 8].map((d, i) => ({ id: `k${i}`, user_id: 'u1', intent_type: 'contact', contact_name: 'Amma', created_at: ist7(d, 20), status: 'open' }));
  for (const [mode, expectReminder] of [['hybrid', false], ['let_act', true]]) {
    mockDb.reset();
    mockDb.tables.keeps = keeps;
    mockDb.tables.behavior_patterns = [];
    mockDb.tables.reminders = [];
    mockDb.tables.tau_behaviour_profile = [{ id: 'p1', user_id: 'u1', learning_mode: mode, habits: [] }];
    const r = await refreshTauProfile(db, 'u1', { now, force: true });
    const made = mockDb.tables.reminders.length > 0;
    check(`7: ${mode}: ${expectReminder ? 'sets up the reminder by itself' : 'only learns, sets nothing up'}`, made === expectReminder, JSON.stringify(r));
  }
}

// 8. The nightly rebuild never forgets what was asked or set up (no re-asking, no duplicate reminders).
{
  const { buildTauProfile } = await import('../src/lib/tau-profile.js');
  const now = new Date('2026-11-22T12:00:00Z');
  const ist8 = (daysAgo, hh) => {
    const d = new Date(now.getTime() - daysAgo * 864e5).toISOString().slice(0, 10);
    return new Date(`${d}T${String(hh).padStart(2, '0')}:05:00+05:30`).toISOString();
  };
  const keeps = [1, 2, 3, 4].map((d) => ({ intent_type: 'contact', contact_name: 'Amma', created_at: ist8(d, 20), status: 'open' }));
  const previous = [{ id: 'call:amma:evening', status: 'confirmed', asked_at: '2026-11-21T12:00:00Z', reminder_id: 'r-1', auto: false }];
  const h = buildTauProfile({ userId: 'u1', keeps, previous, now }).habits.find((x) => x.id === 'call:amma:evening');
  check('8: asked_at kept across rebuilds', h?.asked_at === '2026-11-21T12:00:00Z');
  check('8: reminder link kept (no duplicate reminder each night)', h?.reminder_id === 'r-1');
  const { habitsToActOn } = await import('../src/lib/habit-offers.js');
  check('8: a confirmed habit with its reminder is not set up again', habitsToActOn([h], 'hybrid').length === 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
