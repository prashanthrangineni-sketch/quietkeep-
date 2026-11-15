// tests/voice-capture-plain-reminder.test.mjs
// Regression test for Bug 1: Plain reminder capture must return 200/201 and never throw
// ReferenceError: nowSafety is not defined.

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

function check(name, ok) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (ok) pass++;
  else fail++;
}

// 1. Founder Telugu reminder capture must return 2xx (not throw 500 nowSafety ReferenceError)
mockDb.reset();
const teluguReq = new Request('http://localhost/api/voice/capture', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer test_jwt_token',
  },
  body: JSON.stringify({
    transcript: 'రేపు ఉదయం తొమ్మిది గంటలకు నాకు గుర్తు చేయి',
    source: 'voice',
    language: 'te-IN',
  }),
});

const teluguRes = await POST(teluguReq);
const teluguData = await teluguRes.json();

check('Telugu reminder capture returns success (status 200 or 201)', [200, 201].includes(teluguRes.status));
check('Telugu reminder capture does not throw 500', teluguRes.status !== 500);
check('Telugu reminder response has valid keep or reminder', !teluguData.error && (teluguData.keep || teluguData.intent || teluguData.reminder));
check('Telugu reminder response has safety property (or null)', 'safety' in teluguData);

// 2. Plain English reminder capture
mockDb.reset();
const englishReq = new Request('http://localhost/api/voice/capture', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer test_jwt_token',
  },
  body: JSON.stringify({
    transcript: 'Remind me to call Mom tomorrow at 9 am',
    source: 'voice',
    language: 'en-IN',
  }),
});

const englishRes = await POST(englishReq);
const englishData = await englishRes.json();

check('English reminder capture returns success (status 200 or 201)', [200, 201].includes(englishRes.status));
check('English reminder capture does not throw 500', englishRes.status !== 500);
check('English reminder response has valid keep or reminder', !englishData.error && (englishData.keep || englishData.intent || englishData.reminder));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
