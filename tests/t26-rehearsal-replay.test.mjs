// tests/t26-rehearsal-replay.test.mjs
// T26 (22 Nov 2026): the founder's rehearsal of 22 Nov 09:29-09:33 IST,
// replayed word for word as the phone sent it (language en-IN, Telugu script,
// keep-listening mode, the measured speech lengths), against the real route.
import { register } from 'node:module';
register('./loader.mjs', import.meta.url);
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test_anon_key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test_service_role_key';
const { mockDb } = await import('./mock-supabase.mjs');
const { POST } = await import('../src/app/api/voice/capture/route.js');

let pass = 0, fail = 0;
function check(name, ok, details = '') {
  if (ok) { console.log(`PASS  ${name}`); pass++; }
  else { console.error(`FAIL  ${name} ${details ? '- ' + details : ''}`); fail++; }
}
async function say(body) {
  const req = new Request('http://localhost/api/voice/capture', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test_jwt_token' },
    body: JSON.stringify({ source: 'voice', language: 'en-IN', ...body }),
  });
  const res = await POST(req);
  return { status: res.status, data: await res.json().catch(() => null) };
}
const listen = (speechMs) => ({ path: 'engine', speechMs, liveSpeechMs: speechMs, heardMs: speechMs + 2000, peak: 0.13, stopReason: 'silence' });

// 1. "Remind me at 5 this evening that I have to call the bank" (Telugu)
{
  mockDb.reset();
  const r = await say({ transcript: 'సాయంత్రం ఐదుకి బ్యాంకుకి కాల్ చేయాలి అని గుర్తు చేయి.', listen: listen(3700) });
  const k = (mockDb.tables.keeps || [])[0];
  console.log('  reply:', r.data?.tts_response);
  check('1: saved as a reminder, not a contact', k?.intent_type === 'reminder', `type=${k?.intent_type}`);
  const at = k?.reminder_at ? new Date(k.reminder_at) : null;
  const hh = at ? Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', hour12: false }).format(at)) : null;
  check('1: for 5 pm', hh === 17, `reminder_at=${k?.reminder_at}`);
  check('1: confirmed in Telugu with the time', /గుర్తు చేస్తాను/.test(r.data?.tts_response || '') && /5|ఐదు/.test(r.data?.tts_response || ''), r.data?.tts_response);
}

// 2. "This month how much did I spend?" — no expenses, one old junk keep
{
  mockDb.reset();
  mockDb.tables.keeps = [{ id: 'j1', user_id: 'u1', intent_type: 'expense', content: 'ee nela expenses anni', status: 'open', created_at: new Date().toISOString() }];
  const r = await say({ transcript: 'ఈ నెల నా ఖర్చు ఎంత?', listen: listen(2000) });
  console.log('  reply:', r.data?.tts_response);
  check('2: no "₹0" with junk items read out', !/₹0/.test(r.data?.tts_response || '') && !/expenses anni/.test(r.data?.tts_response || ''), r.data?.tts_response);
}

// 3. "How is the weather today?" with the English loanword in Telugu script
{
  mockDb.reset();
  mockDb.tables.connector_values = [{ scope: 'weather', value: { temp: 26, description: 'Clear sky' } }];
  const r = await say({ transcript: 'ఈ రోజు వెదర్ ఎలా ఉంది?', listen: listen(1800) });
  console.log('  reply:', r.data?.tts_response);
  check('3: weather answered with the real temperature', /26/.test(r.data?.tts_response || ''), r.data?.tts_response);
}

// 4. "Call Surya Kiran" then "Yes." — the phone did NOT send answering:true
{
  mockDb.reset();
  mockDb.tables.contacts = [{ id: 'c-sk', user_id: 'u1', name: 'Surya Kiran', phone: '+919811111111', created_at: new Date().toISOString() }];
  const t1 = await say({ transcript: 'సూర్య కిరణ్ కి కాల్ చేయి.', listen: listen(1300) });
  console.log('  reply 1:', t1.data?.tts_response);
  check('4: Aaria asks in Telugu before dialling', /[ఀ-౿]/.test(t1.data?.tts_response || ''), t1.data?.tts_response);
  const t2 = await say({ transcript: 'Yes.', listen: listen(500), auto_turn: true });
  console.log('  reply 2:', t2.data?.tts_response);
  check('4: "Yes." dials Surya Kiran', t2.data?.auto_exec?.contact_phone === '+919811111111', JSON.stringify(t2.data?.auto_exec || t2.data?.not_saved));
}

// 5. Aaria's own voice heard on an auto turn: "Sorry, I can't make this call."
{
  mockDb.reset();
  const r = await say({ transcript: 'సారీ, ఈ కాల్ చేయలేను.', listen: listen(1500), auto_turn: true, answering: true });
  const n = (mockDb.tables.keeps || []).length;
  check('5: her own "sorry, I can\'t make this call" is not saved', n === 0, `keeps=${n}; reply=${r.data?.tts_response}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
