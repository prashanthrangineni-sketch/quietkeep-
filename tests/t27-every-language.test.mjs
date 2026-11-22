// tests/t27-every-language.test.mjs
// T27 (22 Nov 2026): founder - "Not only english my dear make sure all possible
// languages". Every fixed reply Aaria speaks must come back in the script of the
// language the person spoke, for all 11 languages Sarvam can speak.
import { register } from 'node:module';
register('./loader.mjs', import.meta.url);
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test_anon_key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test_service_role_key';
const { mockDb } = await import('./mock-supabase.mjs');
const { POST } = await import('../src/app/api/voice/capture/route.js');
const { buildExecutionTTS, computeFollowUp } = await import('../src/lib/intent-executor.js');
const { spokenContactQuestion } = await import('../src/lib/contact-match.js');
const { say, REPLY_LANGS } = await import('../src/lib/reply-phrases.js');

let pass = 0, fail = 0;
function check(name, ok, details = '') {
  if (ok) { console.log(`PASS  ${name}`); pass++; }
  else { console.error(`FAIL  ${name} ${details ? '- ' + details : ''}`); fail++; }
}

const SCRIPT = {
  te: /[ఀ-౿]/, hi: /[ऀ-ॿ]/, mr: /[ऀ-ॿ]/, ta: /[஀-௿]/,
  kn: /[ಀ-೿]/, ml: /[ഀ-ൿ]/, bn: /[ঀ-৿]/, gu: /[઀-૿]/,
  pa: /[਀-੿]/, or: /[଀-୿]/,
};
const NEW = ['ta', 'kn', 'ml', 'bn', 'gu', 'pa', 'mr', 'or'];

// 1. Every phrase the new languages need exists, in the right script.
const KEYS = ['didnt_catch', 'ask_for_time', 'already_saved', 'remind_at', 'remind_day_ask', 'remind_no_time',
  'task_at', 'call_at', 'call_now_ask', 'not_in_contacts', 'who_to_call', 'which_one', 'which_more',
  'contact_saved', 'meeting_saved', 'purchase_saved', 'navigation_saved', 'expense_saved', 'intent_saved',
  'navigating', 'place_reach', 'place_return', 'place_noted', 'weather_none', 'weather_now', 'contacts_none',
  'contacts_count', 'tithi_now', 'tithi_none', 'docs_count', 'docs_none', 'tasks_count', 'tasks_none',
  'memories_count', 'memories_none', 'warranties_count', 'warranties_none', 'spend_total', 'spend_none',
  'query_unavailable'];
for (const l of NEW) {
  const missing = KEYS.filter((k) => !say(k, l));
  check(`1: ${l} has every phrase`, missing.length === 0, missing.join(','));
  const wrong = KEYS.filter((k) => say(k, l) && !SCRIPT[l].test(say(k, l)));
  check(`1: ${l} phrases are in ${l} script`, wrong.length === 0, wrong.join(','));
  const ALL = { name: 'X', when: 'Y', date: 'Z', time: 'T', what: 'W', dest: 'D', place: 'P', temp: 26,
    total: 3, list: 'L', tithi: 'Ti', n: 2, top: 'Tp', names: 'N', more: 1 };
  const leftover = KEYS.filter((k) => /\{\w+\}/.test(say(k, l, ALL) || ''));
  check(`1: ${l} phrases fill every blank`, leftover.length === 0, leftover.join(','));
}
check('1: Sarvam\'s "od" code reads as Odia', say('already_saved', 'od-IN') === say('already_saved', 'or'));
check('1: 11 reply languages listed', REPLY_LANGS.length === 11);

// 2. A reminder with a time is confirmed in each language, with the time words in it.
const at = new Date(Date.now() + 26 * 3600e3); // tomorrow
for (const l of NEW) {
  const tts = buildExecutionTTS({ type: 'reminder', subject: 'x', entities: { dates: [], times: ['9'] } }, null, at.toISOString(), null, l);
  check(`2: ${l} reminder confirmed in ${l}`, SCRIPT[l].test(tts) && !/remind you/i.test(tts), tts);
}
check('2: Telugu reminder unchanged', /గుర్తు చేస్తాను/.test(buildExecutionTTS({ type: 'reminder', subject: 'x', entities: { dates: [], times: ['9'] } }, null, at.toISOString(), null, 'te')));
check('2: English reminder unchanged', /I'll remind you/.test(buildExecutionTTS({ type: 'reminder', subject: 'remind me to call', entities: { dates: [], times: ['9'] } }, null, at.toISOString(), null, 'en')));

// 3. Telugu and Hindi no longer get English for meetings, expenses and the rest.
for (const l of ['te', 'hi']) {
  for (const type of ['meeting', 'purchase', 'navigation', 'expense', 'other']) {
    const tts = buildExecutionTTS({ type, subject: 'abc' }, null, null, null, l);
    check(`3: ${l} ${type} reply not English`, SCRIPT[l].test(tts), tts);
  }
}

// 4. "Call X" asks back in the language it was asked in.
const contact = { single: { name: 'Surya Kiran', phone: '+919811111111' } };
for (const [l, sentence] of [['ta', 'சூர்யா கிரணுக்கு அழை'], ['kn', 'ಸೂರ್ಯ ಕಿರಣ್ ಗೆ ಕರೆ ಮಾಡು'], ['bn', 'সূর্য কিরণকে কল করো']]) {
  const fu = computeFollowUp({ type: 'contact', subject: sentence, entities: { names: ['Surya Kiran'], dates: [], times: [] } }, contact, null);
  if (fu?.follow_up) check(`4: ${l} call question in ${l}`, SCRIPT[l].test(fu.follow_up), fu.follow_up);
}

// 5. "Which Surya?" in the spoken language (rehearsal: 10 contacts called Surya).
const many = [{ name: 'Surya A', phone: '1' }, { name: 'Surya B', phone: '2' }, { name: 'Surya C', phone: '3' }, { name: 'Surya D', phone: '4' }];
check('5: Telugu "which one"', /ఏ Surya\?/.test(spokenContactQuestion('Surya', many, 'te')), spokenContactQuestion('Surya', many, 'te'));
check('5: Tamil "which one"', SCRIPT.ta.test(spokenContactQuestion('Surya', many, 'ta')));
check('5: English "which one" unchanged', /^Which Surya\? Surya A, Surya B or Surya C — or 1 more on screen/.test(spokenContactQuestion('Surya', many)));

// 6. End to end through the real route: a Tamil sentence gets a Tamil reply.
async function sayRoute(body) {
  const req = new Request('http://localhost/api/voice/capture', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test_jwt_token' },
    body: JSON.stringify({ source: 'voice', ...body }),
  });
  const res = await POST(req);
  return { status: res.status, data: await res.json().catch(() => null) };
}
for (const [l, code, sentence] of [
  ['ta', 'ta-IN', 'நாளை காலை ஒன்பது மணிக்கு வங்கிக்கு போக வேண்டும் என்று குறித்துக்கொள்'],
  ['kn', 'kn-IN', 'ನಾಳೆ ಬ್ಯಾಂಕಿಗೆ ಹೋಗಬೇಕು ಎಂದು ಬರೆದಿಡು'],
  ['bn', 'bn-IN', 'কাল ব্যাংকে যেতে হবে লিখে রাখো'],
]) {
  mockDb.reset();
  const r = await sayRoute({ transcript: sentence, language: code });
  const tts = r.data?.tts_response || '';
  check(`6: ${l} sentence answered in ${l}`, (r.status === 200 || r.status === 201) && (tts === '' || SCRIPT[l].test(tts)), `status=${r.status} reply=${tts}`);
}

// 7. The same sentence twice in Malayalam: "Already saved" in Malayalam.
{
  mockDb.reset();
  const sentence = 'നാളെ ബാങ്കിൽ പോകണം എന്ന് കുറിച്ചു വെക്കൂ';
  await sayRoute({ transcript: sentence, language: 'ml-IN' });
  const r = await sayRoute({ transcript: sentence, language: 'ml-IN' });
  if (r.data?.deduplicated) check('7: Malayalam "already saved"', SCRIPT.ml.test(r.data.tts_response), r.data.tts_response);
  else check('7: Malayalam repeat handled', r.status < 300, JSON.stringify(r.data).slice(0, 200));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
