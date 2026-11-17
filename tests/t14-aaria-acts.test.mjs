// tests/t14-aaria-acts.test.mjs
// Verification suite for CARD T14:
// "Aaria acts": answer questions, do actions, never file them as notes
// Replays all 14 evidence sentences through POST() with mockDb and verifies:
//   - navigation/location intent: open Maps to place (read back first), never a reminder
//   - call/contact intent: confirm call, dial on spoken yes via auto_exec, never a reminder unless time said
//   - queries (weather, tithi, documents, tasks, memories, warranties, expenses): answered aloud, not_saved: true, no keeps
//   - fragments: ask again in spoken language ("could you say that again?"), not_saved: true

import { register } from 'node:module';
import assert from 'node:assert/strict';

register('./loader.mjs', import.meta.url);

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test_anon_key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test_service_role_key';

const { mockDb } = await import('./mock-supabase.mjs');
const { POST } = await import('../src/app/api/voice/capture/route.js');

let pass = 0;
let fail = 0;

function check(name, ok, details = '') {
  if (ok) {
    console.log(`PASS  ${name}`);
    pass++;
  } else {
    console.error(`FAIL  ${name} ${details ? '- ' + details : ''}`);
    fail++;
  }
}

async function callVoiceCapture(body) {
  const req = new Request('http://localhost/api/voice/capture', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer test_jwt_token',
    },
    body: JSON.stringify(body),
  });
  const res = await POST(req);
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

console.log('--- REPLAYING 14 CARD-T14 EVIDENCE SENTENCES ---\n');

// ── 1. "Kukatpalli ki location set cheyava?" ──────────────────────────────
{
  mockDb.reset();
  const { status, data } = await callVoiceCapture({
    transcript: 'Kukatpalli ki location set cheyava?',
    source: 'voice',
    language: 'te-IN',
  });

  const remindersInDb = (mockDb.tables.reminders || []).length;
  check(
    'Sentence 1: Navigation status is 200 or 201',
    [200, 201].includes(status),
    `status=${status}`
  );
  check(
    'Sentence 1: auto_exec intent is navigation with destination Kukatpalli and delay 2500ms',
    data?.auto_exec?.intent_type === 'navigation' &&
    data?.auto_exec?.navigation_query === 'Kukatpalli' &&
    data?.auto_exec?.delay_ms === 2500,
    JSON.stringify(data?.auto_exec)
  );
  check(
    'Sentence 1: Never created a reminder in DB',
    remindersInDb === 0,
    `reminders count=${remindersInDb}`
  );
  check(
    'Sentence 1: Spoken read-back contains Kukatpalli / navigation',
    typeof data?.tts_response === 'string' && data.tts_response.includes('Kukatpalli'),
    `tts=${data?.tts_response}`
  );
}

// ── 2. "నీరజకి కాల్ చేయవా?" ──────────────────────────────────────────────
{
  mockDb.reset();
  // Populate contact Neeraja
  mockDb.tables.contacts = [
    {
      id: 'c-neeraja',
      user_id: 'u1',
      name: 'Neeraja',
      phone: '+919876543210',
      created_at: new Date().toISOString(),
    },
  ];

  // Turn 1: Request call to Neeraja
  const turn1 = await callVoiceCapture({
    transcript: 'నీరజకి కాల్ చేయవా?',
    source: 'voice',
    language: 'te-IN',
  });

  const remsT1 = (mockDb.tables.reminders || []).length;
  check(
    'Sentence 2 Turn 1: Call request status 200 or 201',
    [200, 201].includes(turn1.status),
    `status=${turn1.status}`
  );
  check(
    'Sentence 2 Turn 1: Never created a reminder row in DB',
    remsT1 === 0,
    `reminders count=${remsT1}`
  );
  check(
    'Sentence 2 Turn 1: Read back confirms call with follow_up (action_hint call_or_remind or confirm_call)',
    ['call_or_remind', 'confirm_call'].includes(turn1.data?.follow_up?.action_hint) &&
    turn1.data?.follow_up?.contact?.phone === '+919876543210',
    JSON.stringify(turn1.data?.follow_up)
  );

  // Turn 2: Spoken yes
  const turn2 = await callVoiceCapture({
    transcript: 'అవును',
    source: 'voice',
    language: 'te-IN',
    answering: true,
  });

  const remsT2 = (mockDb.tables.reminders || []).length;
  check(
    'Sentence 2 Turn 2: Spoken yes confirmed call with auto_exec dial and call_now',
    turn2.data?.call_now === true &&
    turn2.data?.auto_exec?.intent_type === 'contact' &&
    turn2.data?.auto_exec?.contact_phone === '+919876543210',
    JSON.stringify(turn2.data?.auto_exec)
  );
  check(
    'Sentence 2 Turn 2: Never created a reminder row in DB',
    remsT2 === 0,
    `reminders count=${remsT2}`
  );
}

// ── 3. "Ganesh ki call jewa" ──────────────────────────────────────────────
{
  mockDb.reset();
  // Populate contact Ganesh
  mockDb.tables.contacts = [
    {
      id: 'c-ganesh',
      user_id: 'u1',
      name: 'Ganesh',
      phone: '+919123456789',
      created_at: new Date().toISOString(),
    },
  ];

  // Turn 1: Request call to Ganesh
  const turn1 = await callVoiceCapture({
    transcript: 'Ganesh ki call jewa',
    source: 'voice',
    language: 'te-IN',
  });

  const remsT1 = (mockDb.tables.reminders || []).length;
  check(
    'Sentence 3 Turn 1: Call request status 200 or 201',
    [200, 201].includes(turn1.status),
    `status=${turn1.status}`
  );
  check(
    'Sentence 3 Turn 1: Never created a reminder row in DB',
    remsT1 === 0,
    `reminders count=${remsT1}`
  );
  check(
    'Sentence 3 Turn 1: Read back confirms call with follow_up (action_hint call_or_remind or confirm_call)',
    ['call_or_remind', 'confirm_call'].includes(turn1.data?.follow_up?.action_hint) &&
    turn1.data?.follow_up?.contact?.phone === '+919123456789',
    JSON.stringify(turn1.data?.follow_up)
  );

  // Turn 2: Spoken yes
  const turn2 = await callVoiceCapture({
    transcript: 'yes',
    source: 'voice',
    language: 'en-IN',
    answering: true,
  });

  const remsT2 = (mockDb.tables.reminders || []).length;
  check(
    'Sentence 3 Turn 2: Spoken yes confirmed call with auto_exec dial and call_now',
    turn2.data?.call_now === true &&
    turn2.data?.auto_exec?.intent_type === 'contact' &&
    turn2.data?.auto_exec?.contact_phone === '+919123456789',
    JSON.stringify(turn2.data?.auto_exec)
  );
  check(
    'Sentence 3 Turn 2: Never created a reminder row in DB',
    remsT2 === 0,
    `reminders count=${remsT2}`
  );
}

// ── 4. "Ee roju weather ela undi?" ────────────────────────────────────────
{
  mockDb.reset();
  mockDb.tables.connector_values = [
    {
      scope: 'weather',
      value: { temp: 31, description: 'clear sky' },
    },
  ];

  const { status, data } = await callVoiceCapture({
    transcript: 'Ee roju weather ela undi?',
    source: 'voice',
    language: 'te-IN',
  });

  const keepsCount = (mockDb.tables.keeps || []).length;
  check(
    'Sentence 4: Weather query returns not_saved=true and status 200',
    status === 200 && data?.not_saved === true && data?.query_type === 'weather',
    `status=${status}, not_saved=${data?.not_saved}, query_type=${data?.query_type}`
  );
  check(
    'Sentence 4: No keeps saved in DB',
    keepsCount === 0,
    `keeps count=${keepsCount}`
  );
  check(
    'Sentence 4: Weather answered aloud in Telugu',
    typeof data?.tts_response === 'string' &&
    (data.tts_response.includes('వాతావరణం') || data.tts_response.includes('డిగ్రీలు')),
    `tts=${data?.tts_response}`
  );
}

// ── 5. "Ee roju thithi enti Telugu calendar prakaram?" ────────────────────
{
  mockDb.reset();
  const { status, data } = await callVoiceCapture({
    transcript: 'Ee roju thithi enti Telugu calendar prakaram?',
    source: 'voice',
    language: 'te-IN',
  });

  const keepsCount = (mockDb.tables.keeps || []).length;
  check(
    'Sentence 5: Tithi query returns not_saved=true and status 200',
    status === 200 && data?.not_saved === true && data?.query_type === 'tithi',
    `status=${status}, not_saved=${data?.not_saved}, query_type=${data?.query_type}`
  );
  check(
    'Sentence 5: No keeps saved in DB',
    keepsCount === 0,
    `keeps count=${keepsCount}`
  );
  check(
    'Sentence 5: Tithi answered in Telugu (plain unavailable message when not in DB)',
    typeof data?.tts_response === 'string' && data.tts_response.includes('తెలుగు'),
    `tts=${data?.tts_response}`
  );
}

// ── 6. "నా ఫోన్లో ఏ పత్రాలు సేవ్ చేయబడి ఉన్నాయి?" ────────────────────────
{
  mockDb.reset();
  mockDb.tables.documents = [
    { id: 'd1', user_id: 'u1', title: 'Aadhaar Card' },
    { id: 'd2', user_id: 'u1', title: 'Vehicle RC' },
  ];

  const { status, data } = await callVoiceCapture({
    transcript: 'నా ఫోన్లో ఏ పత్రాలు సేవ్ చేయబడి ఉన్నాయి?',
    source: 'voice',
    language: 'te-IN',
  });

  const keepsCount = (mockDb.tables.keeps || []).length;
  check(
    'Sentence 6: Documents query returns not_saved=true and status 200',
    status === 200 && data?.not_saved === true && data?.query_type === 'documents',
    `status=${status}, not_saved=${data?.not_saved}`
  );
  check(
    'Sentence 6: No new keeps saved in DB',
    keepsCount === 0,
    `keeps count=${keepsCount}`
  );
  check(
    'Sentence 6: Documents listed aloud in Telugu',
    typeof data?.tts_response === 'string' && data.tts_response.includes('పత్రాలు') && data.tts_response.includes('Aadhaar Card'),
    `tts=${data?.tts_response}`
  );
}

// ── 7. "ఈరోజు ఏమేం పనులున్నాయి?" ──────────────────────────────────────────
{
  mockDb.reset();
  const today = new Date().toISOString();
  mockDb.tables.reminders = [
    { id: 'r1', user_id: 'u1', reminder_text: 'Doctor appointment', scheduled_for: today, is_active: true },
  ];

  const { status, data } = await callVoiceCapture({
    transcript: 'ఈరోజు ఏమేం పనులున్నాయి?',
    source: 'voice',
    language: 'te-IN',
  });

  const keepsCount = (mockDb.tables.keeps || []).length;
  check(
    'Sentence 7: Tasks query returns not_saved=true and status 200',
    status === 200 && data?.not_saved === true && data?.query_type === 'tasks',
    `status=${status}, not_saved=${data?.not_saved}`
  );
  check(
    'Sentence 7: No new keeps saved in DB',
    keepsCount === 0,
    `keeps count=${keepsCount}`
  );
  check(
    'Sentence 7: Tasks answered aloud in Telugu',
    typeof data?.tts_response === 'string' && data.tts_response.includes('పనులు') && data.tts_response.includes('Doctor appointment'),
    `tts=${data?.tts_response}`
  );
}

// ── 8. "నా ఫోన్లో ఏమేం జ్ఞాపకాలు ఉన్నాయి?" ────────────────────────────────
{
  mockDb.reset();
  mockDb.tables.keeps = [
    { id: 'k1', user_id: 'u1', content: 'Trip to Araku Valley', status: 'open', created_at: new Date().toISOString() },
  ];

  const { status, data } = await callVoiceCapture({
    transcript: 'నా ఫోన్లో ఏమేం జ్ఞాపకాలు ఉన్నాయి?',
    source: 'voice',
    language: 'te-IN',
  });

  // DB should still have only the 1 existing keep
  const keepsCount = (mockDb.tables.keeps || []).length;
  check(
    'Sentence 8: Memories query returns not_saved=true and status 200',
    status === 200 && data?.not_saved === true && data?.query_type === 'memories',
    `status=${status}, not_saved=${data?.not_saved}`
  );
  check(
    'Sentence 8: No new keeps saved in DB (keeps count unchanged at 1)',
    keepsCount === 1,
    `keeps count=${keepsCount}`
  );
  check(
    'Sentence 8: Memories answered aloud in Telugu',
    typeof data?.tts_response === 'string' && data.tts_response.includes('జ్ఞాపకాలు') && data.tts_response.includes('Trip to Araku Valley'),
    `tts=${data?.tts_response}`
  );
}

// ── 9. "వారంటీస్ ఏమున్నాయి?" ──────────────────────────────────────────────
{
  mockDb.reset();
  mockDb.tables.products = [
    { id: 'p1', user_id: 'u1', name: 'Sony Headphones', warranty_expiry: '2027-01-01' },
  ];

  const { status, data } = await callVoiceCapture({
    transcript: 'వారంటీస్ ఏమున్నాయి?',
    source: 'voice',
    language: 'te-IN',
  });

  const keepsCount = (mockDb.tables.keeps || []).length;
  check(
    'Sentence 9: Warranties query returns not_saved=true and status 200',
    status === 200 && data?.not_saved === true && data?.query_type === 'warranties',
    `status=${status}, not_saved=${data?.not_saved}`
  );
  check(
    'Sentence 9: No new keeps saved in DB',
    keepsCount === 0,
    `keeps count=${keepsCount}`
  );
  check(
    'Sentence 9: Warranties answered aloud in Telugu',
    typeof data?.tts_response === 'string' && data.tts_response.includes('వారంటీ') && data.tts_response.includes('Sony Headphones'),
    `tts=${data?.tts_response}`
  );
}

// ── 10. "ee nela expenses anni" ───────────────────────────────────────────
{
  mockDb.reset();
  mockDb.tables.expenses = [
    { id: 'e1', user_id: 'u1', amount: 1500, description: 'Groceries', created_at: new Date().toISOString() },
    { id: 'e2', user_id: 'u1', amount: 800, description: 'Petrol', created_at: new Date().toISOString() },
  ];

  const { status, data } = await callVoiceCapture({
    transcript: 'ee nela expenses anni',
    source: 'voice',
    language: 'te-IN',
  });

  const keepsCount = (mockDb.tables.keeps || []).length;
  const expCount = (mockDb.tables.expenses || []).length;
  check(
    'Sentence 10: Expenses query returns not_saved=true and status 200',
    status === 200 && data?.not_saved === true && data?.query_type === 'expenses',
    `status=${status}, not_saved=${data?.not_saved}`
  );
  check(
    'Sentence 10: Never filed as a new expense (expenses count unchanged at 2)',
    expCount === 2,
    `expenses count=${expCount}`
  );
  check(
    'Sentence 10: No new keeps saved in DB',
    keepsCount === 0,
    `keeps count=${keepsCount}`
  );
  check(
    'Sentence 10: Month expenses total answered in Telugu',
    typeof data?.tts_response === 'string' && data.tts_response.includes('2300'),
    `tts=${data?.tts_response}`
  );
}

// ── 11–14. Four Fragment Turns ─────────────────────────────────────────────
const fragments = [
  { text: 'Surya Exactly', speechMs: 400, desc: 'Sentence 11' },
  { text: 'I mean,', speechMs: 600, desc: 'Sentence 12' },
  { text: 'రెండు నిమిషాల', speechMs: 800, desc: 'Sentence 13' },
  { text: 'ఏదో ఒక', speechMs: 500, desc: 'Sentence 14' },
];

for (const { text, speechMs, desc } of fragments) {
  mockDb.reset();
  const { status, data } = await callVoiceCapture({
    transcript: text,
    source: 'voice',
    language: 'te-IN',
    listen: { path: 'engine', speechMs, heardMs: 1200 },
  });

  const keepsCount = (mockDb.tables.keeps || []).length;
  check(
    `${desc}: Fragment rejected with not_saved=true and reason speech_fragment`,
    data?.not_saved === true && data?.reason === 'speech_fragment',
    `reason=${data?.reason}`
  );
  check(
    `${desc}: Asks again in Telugu instead of silence`,
    typeof data?.tts_response === 'string' &&
    data.tts_response.includes('మళ్ళీ చెప్పగలరా') &&
    data?.assistant?.language === 'te',
    `tts=${data?.tts_response}, assistant=${JSON.stringify(data?.assistant)}`
  );
  check(
    `${desc}: No keeps saved in DB`,
    keepsCount === 0,
    `keeps count=${keepsCount}`
  );
}

console.log(`\n========================================`);
console.log(`Results: ${pass} passed, ${fail} failed`);
console.log(`========================================\n`);

process.exitCode = fail === 0 ? 0 : 1;
