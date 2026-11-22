// tests/t29-learning-modes.test.mjs
// T29 (22 Nov 2026): founder decision — hybrid learning that hurts no one.
// Hybrid (default): learns alone, asks once before using something new.
// Ask me first: uses nothing learned until approved. Let her act: uses sure habits.
import { register } from 'node:module';
register('./loader.mjs', import.meta.url);
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test_anon_key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test_service_role_key';
const { mockDb } = await import('./mock-supabase.mjs');
const T = await import('../src/lib/tau-profile.js');

let pass = 0, fail = 0;
function check(name, ok, details = '') {
  if (ok) { console.log(`PASS  ${name}`); pass++; }
  else { console.error(`FAIL  ${name} ${details ? '- ' + details : ''}`); fail++; }
}

const sure = { id: 'call:amma:evening', kind: 'call', name: 'Amma', bucket: 'evening', hour: 20, dow: null, confidence: 0.8, status: 'learned' };
const unsure = { ...sure, id: 'call:ravi:morning', name: 'Ravi', confidence: 0.4 };
const medium = { ...sure, id: 'call:sita:night', name: 'Sita', confidence: 0.65 };

// 1. Default is hybrid; unknown modes fall back to it.
check('1: default mode is hybrid', T.DEFAULT_LEARNING_MODE === 'hybrid' && T.normaliseMode(undefined) === 'hybrid' && T.normaliseMode('nonsense') === 'hybrid');

// 2. What she may do in each mode.
check('2: hybrid offers a sure new habit (asks once)', T.decideHabitUse(sure, 'hybrid') === 'offer');
check('2: hybrid stays quiet when unsure', T.decideHabitUse(unsure, 'hybrid') === 'none');
check('2: hybrid acts once the person said yes', T.decideHabitUse({ ...sure, status: 'confirmed' }, 'hybrid') === 'act');
check('2: ask_first never uses what she learned on her own', T.decideHabitUse(sure, 'ask_first') === 'none');
check('2: ask_first acts on what the person approved', T.decideHabitUse({ ...sure, status: 'confirmed' }, 'ask_first') === 'act');
check('2: let_act acts on a sure habit', T.decideHabitUse(sure, 'let_act') === 'act');
check('2: let_act still asks when only fairly sure', T.decideHabitUse(medium, 'let_act') === 'offer');
check('2: a "no" is final in every mode', ['hybrid', 'ask_first', 'let_act'].every((m) => T.decideHabitUse({ ...sure, status: 'declined' }, m) === 'none'));
check('2: "forget" is final in every mode', ['hybrid', 'ask_first', 'let_act'].every((m) => T.decideHabitUse({ ...sure, status: 'forgotten' }, m) === 'none'));

// 3. Answers and teaching.
{
  const after = T.answerHabit([sure, unsure], sure.id, 'confirm');
  check('3: yes marks it confirmed', after[0].status === 'confirmed' && after[1].status === 'learned');
  check('3: unknown answer changes nothing', T.answerHabit([sure], sure.id, 'maybe')[0].status === 'learned');
  const taught = T.teachFact([], '  My office is in Hitech City  ');
  check('3: teaching stores a confirmed fact', taught.length === 1 && taught[0].kind === 'fact' && taught[0].status === 'confirmed' && taught[0].text === 'My office is in Hitech City');
  check('3: the same fact is not stored twice', T.teachFact(taught, 'My office is in Hitech City').length === 1);
  check('3: empty teaching is ignored', T.teachFact([], '   ').length === 0);
}

// 4. Answers survive the nightly rebuild even when the data no longer shows the habit.
{
  const now = new Date('2026-11-22T12:00:00Z');
  const previous = [
    { ...sure, status: 'confirmed', days: 4, last_seen: '2026-11-20T14:30:00Z' },
    { ...unsure, status: 'forgotten' },
    { id: 'fact:my office is in hitech city', kind: 'fact', text: 'My office is in Hitech City', status: 'confirmed', confidence: 1 },
  ];
  const { habits } = T.buildTauProfile({ userId: 'u1', keeps: [], previous, now });
  check('4: confirmed habit kept', habits.some((h) => h.id === sure.id && h.status === 'confirmed'));
  check('4: forgotten habit stays forgotten (never re-learned silently)', habits.some((h) => h.id === unsure.id && h.status === 'forgotten'));
  check('4: taught fact kept', habits.some((h) => h.kind === 'fact'));
}

// 5. Plain sentences for the page.
check('5: call sentence', T.habitSentence(sure) === 'You usually call Amma in the evening (around 8 pm).', T.habitSentence(sure));
check('5: weekday sentence', /on Saturdays in the morning/.test(T.habitSentence({ kind: 'action', intent: 'expense', bucket: 'morning', dow: 6, hour: 9 })));
check('5: fact sentence is what they said', T.habitSentence({ kind: 'fact', text: 'I buy milk every evening' }) === 'I buy milk every evening');

// 6. The page's data route: own session only, every action works.
{
  const { GET, POST } = await import('../src/app/api/aaria/learned/route.js');
  const req = (method, body, auth = 'Bearer test_jwt_token') => new Request('http://localhost/api/aaria/learned', {
    method, headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: auth } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  mockDb.reset();
  mockDb.tables.tau_behaviour_profile = [{ id: 'p1', user_id: 'u1', habits: [sure, unsure], last_updated: '2026-11-22T00:00:00Z' }];

  const noAuth = await GET(req('GET', null, null));
  check('6: no sign-in = 401', noAuth.status === 401);

  const g = await (await GET(req('GET'))).json();
  check('6: shows hybrid by default and both habits with sentences', g.mode === 'hybrid' && g.habits.length === 2 && /Amma/.test(g.habits[0].sentence), JSON.stringify(g).slice(0, 200));
  check('6: tells the page what she would do', g.habits.find((h) => h.id === sure.id)?.use === 'offer');

  const m = await POST(req('POST', { mode: 'ask_first' }));
  const mj = await m.json();
  check('6: mode changes to ask_first', m.status === 200 && mj.mode === 'ask_first');
  check('6: unknown mode refused', (await POST(req('POST', { mode: 'spy' }))).status === 400);

  const y = await (await POST(req('POST', { action: 'confirm', id: sure.id }))).json();
  check('6: yes saved', y.habits.find((h) => h.id === sure.id)?.status === 'confirmed');
  const f = await (await POST(req('POST', { action: 'forget', id: unsure.id }))).json();
  check('6: forgotten habit disappears from the page', !f.habits.some((h) => h.id === unsure.id));
  check('6: unknown habit = 404', (await POST(req('POST', { action: 'confirm', id: 'nope' }))).status === 404);
  const t = await (await POST(req('POST', { action: 'teach', text: 'I buy milk every evening' }))).json();
  check('6: taught fact shown', t.habits.some((h) => h.kind === 'fact' && h.sentence === 'I buy milk every evening'));
  const saved = mockDb.tables.tau_behaviour_profile.find((r) => r.user_id === 'u1');
  check('6: everything saved in the person\'s row', saved?.learning_mode === 'ask_first' && saved.habits.some((h) => h.kind === 'fact'));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
