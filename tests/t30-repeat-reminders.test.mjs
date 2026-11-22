// tests/t30-repeat-reminders.test.mjs
// T30 (22 Nov 2026): "remind me every day / ప్రతి రోజు / हर सोमवार" becomes a
// repeating reminder, Aaria says so in the spoken language, and "ఈ రోజు" (today)
// is never mistaken for every day.
import { register } from 'node:module';
register('./loader.mjs', import.meta.url);
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test_anon_key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test_service_role_key';
const { mockDb } = await import('./mock-supabase.mjs');
const { detectRepeat, nextRepeat, repeatLine } = await import('../src/lib/repeat-rule.js');
const { POST } = await import('../src/app/api/voice/capture/route.js');

let pass = 0, fail = 0;
function check(name, ok, details = '') {
  if (ok) { console.log(`PASS  ${name}`); pass++; }
  else { console.error(`FAIL  ${name} ${details ? '- ' + details : ''}`); fail++; }
}

// 1. What counts as repeating.
const cases = [
  ['remind me every day at 8 pm to call Amma', 'daily'],
  ['every morning at 6 remind me to walk', 'daily'],
  ['ప్రతి రోజు రాత్రి 8 కి అమ్మకి కాల్ చేయమని గుర్తు చేయి', 'daily'],
  ['రోజూ ఉదయం 7 కి మందులు గుర్తు చేయి', 'daily'],
  ['prathi roju 9 ki gurthu cheyi', 'daily'],
  ['रोज़ रात 10 बजे दवा याद दिलाना', 'daily'],
  ['har din subah 6 baje uthana', 'daily'],
  ['தினமும் காலை 7 மணிக்கு நினைவூட்டு', 'daily'],
  ['every Monday at 9 remind me about the meeting', 'weekly'],
  ['हर सोमवार सुबह 9 बजे याद दिलाना', 'weekly'],
  ['ప్రతి శనివారం పెట్రోల్ గుర్తు చేయి', 'weekly'],
  ['remind me every month to pay rent', 'monthly'],
  ['ప్రతి నెల 1 న అద్దె గుర్తు చేయి', 'monthly'],
  ['ఈ రోజు సాయంత్రం 5 కి గుర్తు చేయి', null],
  ['ee roju 5 ki gurthu cheyi', null],
  ['remind me at 5 pm to call the bank', null],
  ['call Roz at 5', null],
];
for (const [t, want] of cases) check(`1: "${t}" -> ${want}`, detectRepeat(t) === want, String(detectRepeat(t)));

// 2. Next time keeps the time of day.
check('2: daily moves to the next day at the same time', nextRepeat('2026-11-21T14:30:00Z', 'daily', Date.parse('2026-11-22T15:00:00Z')) === '2026-11-23T14:30:00.000Z');
check('2: daily before today\'s time stays today', nextRepeat('2026-11-21T14:30:00Z', 'daily', Date.parse('2026-11-22T10:00:00Z')) === '2026-11-22T14:30:00.000Z');
check('2: weekly adds 7 days', nextRepeat('2026-11-16T03:30:00Z', 'weekly', Date.parse('2026-11-17T00:00:00Z')) === '2026-11-23T03:30:00.000Z');
check('2: unknown recurrence = no next time', nextRepeat('2026-11-16T03:30:00Z', 'none') === null);

// 3. The spoken line.
check('3: Telugu line', repeatLine('daily', 'te-IN') === 'ఇది ప్రతి రోజు గుర్తు చేస్తాను.');
check('3: Hindi weekly line', /हर हफ़्ते/.test(repeatLine('weekly', 'hi')));
check('3: nothing for a one-time reminder', repeatLine('none', 'en') === '');

// 4. End to end through the real voice route.
async function say(body) {
  const req = new Request('http://localhost/api/voice/capture', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test_jwt_token' },
    body: JSON.stringify({ source: 'voice', ...body }),
  });
  const res = await POST(req);
  return { status: res.status, data: await res.json().catch(() => null) };
}
{
  mockDb.reset();
  const r = await say({ transcript: 'Remind me every day at 8 pm to call the bank', language: 'en-IN' });
  const rem = (mockDb.tables.reminders || [])[0];
  check('4: English "every day" saved as a daily reminder', rem?.recurrence === 'daily', JSON.stringify(rem || r.data).slice(0, 200));
  check('4: Aaria says it repeats', /every day/.test(r.data?.tts_response || ''), r.data?.tts_response);
}
{
  mockDb.reset();
  const r = await say({ transcript: 'ప్రతి రోజు రాత్రి 8 కి బ్యాంకుకి కాల్ చేయాలి అని గుర్తు చేయి', language: 'te-IN' });
  const rem = (mockDb.tables.reminders || [])[0];
  check('4: Telugu "ప్రతి రోజు" saved as daily', rem?.recurrence === 'daily', JSON.stringify(rem || r.data).slice(0, 200));
  check('4: Telugu reply says ప్రతి రోజు', /ప్రతి రోజు గుర్తు చేస్తాను/.test(r.data?.tts_response || ''), r.data?.tts_response);
}
{
  mockDb.reset();
  await say({ transcript: 'సాయంత్రం ఐదుకి బ్యాంకుకి కాల్ చేయాలి అని గుర్తు చేయి.', language: 'en-IN' });
  const rem = (mockDb.tables.reminders || [])[0];
  check('4: one-time Telugu reminder stays one-time', rem && rem.recurrence === 'none', JSON.stringify(rem).slice(0, 200));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
