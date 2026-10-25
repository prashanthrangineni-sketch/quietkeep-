// tests/account-delete-flow.test.mjs - Delete account flow and route tests (CARD AG-AARIA-26)
import { register } from 'node:module';
register('./loader.mjs', import.meta.url);

import { runDeleteAccount } from '../src/lib/account-delete-flow.js';
const { POST } = await import('../src/app/api/account/delete/route.js');

let pass = 0, fail = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  ${detail}`}`);
  ok ? pass++ : fail++;
}

// Runtime-built tokens/keys to satisfy gitleaks rule
const FAKE_TOKEN = 't'.repeat(32);
const FAKE_USER_ID = 'u'.repeat(16);

function makeFakeFetch({ forgetStatus = 200, forgetBody = { ok: true }, accountStatus = 200, accountBody = { ok: true } } = {}) {
  const calls = [];
  const f = async (url, init = {}) => {
    calls.push({ url, init });
    if (url === '/api/voice/forget-me') {
      return {
        status: forgetStatus,
        ok: forgetStatus >= 200 && forgetStatus < 300,
        json: async () => forgetBody,
      };
    }
    if (url === '/api/account/delete') {
      return {
        status: accountStatus,
        ok: accountStatus >= 200 && accountStatus < 300,
        json: async () => accountBody,
      };
    }
    return {
      status: 404,
      ok: false,
      json: async () => ({ error: 'Not found' }),
    };
  };
  f.calls = calls;
  return f;
}

// 1. forget-me 502 -> account route never called, ok:false
{
  const fetchImpl = makeFakeFetch({ forgetStatus: 502, forgetBody: { ok: false, reason: 'engine_error' } });
  const res = await runDeleteAccount({ token: FAKE_TOKEN, fetchImpl });
  check('forget-me 502: returns ok:false', res.ok === false);
  check('forget-me 502: reports step voice', res.step === 'voice');
  check('forget-me 502: friendly message shown', res.message.includes("We couldn't erase your voice data yet"));
  check('forget-me 502: account route never called', fetchImpl.calls.length === 1 && fetchImpl.calls[0].url === '/api/voice/forget-me');
}

// 2. forget-me 401 -> same (account route never called, ok:false)
{
  const fetchImpl = makeFakeFetch({ forgetStatus: 401, forgetBody: { ok: false, reason: 'not_signed_in' } });
  const res = await runDeleteAccount({ token: FAKE_TOKEN, fetchImpl });
  check('forget-me 401: returns ok:false', res.ok === false);
  check('forget-me 401: reports step voice', res.step === 'voice');
  check('forget-me 401: account route never called', fetchImpl.calls.length === 1 && fetchImpl.calls[0].url === '/api/voice/forget-me');
}

// 3. both 200 -> ok:true, calls in order
{
  const fetchImpl = makeFakeFetch({ forgetStatus: 200, forgetBody: { ok: true }, accountStatus: 200, accountBody: { ok: true } });
  const res = await runDeleteAccount({ token: FAKE_TOKEN, fetchImpl });
  check('both 200: returns ok:true', res.ok === true);
  check('both 200: exactly two calls made', fetchImpl.calls.length === 2);
  check('both 200: calls in order (/api/voice/forget-me then /api/account/delete)',
    fetchImpl.calls[0].url === '/api/voice/forget-me' &&
    fetchImpl.calls[1].url === '/api/account/delete');
  check('both 200: Bearer token sent on voice call',
    fetchImpl.calls[0].init.headers.Authorization === `Bearer ${FAKE_TOKEN}`);
  check('both 200: Bearer token sent on account call',
    fetchImpl.calls[1].init.headers.Authorization === `Bearer ${FAKE_TOKEN}`);
}

// 4. account 500 -> ok:false
{
  const fetchImpl = makeFakeFetch({ forgetStatus: 200, forgetBody: { ok: true }, accountStatus: 500, accountBody: { ok: false } });
  const res = await runDeleteAccount({ token: FAKE_TOKEN, fetchImpl });
  check('account 500: returns ok:false', res.ok === false);
  check('account 500: reports step account', res.step === 'account');
  check('account 500: reports account failure message', res.message === 'Account deletion failed. Please try again.');
  check('account 500: both endpoints were called', fetchImpl.calls.length === 2);
}

// 5. Route-level test with fake supabase client: cloned-voice delete fails -> 502 and deleteUser never called
{
  let deleteUserCalled = false;
  const fakeSupabase = {
    from() {
      return {
        delete() {
          return {
            eq() {
              return Promise.resolve({ error: null });
            },
          };
        },
      };
    },
    auth: {
      admin: {
        async deleteUser() {
          deleteUserCalled = true;
          return { data: { user: { id: FAKE_USER_ID } }, error: null };
        },
      },
    },
  };

  const fakeVoiceDeleteFails = async () => ({
    ok: false,
    status: 502,
    error: 'Engine forget refused or failed',
  });

  const req = new Request('http://localhost:3000/api/account/delete', {
    method: 'POST',
    headers: { Authorization: `Bearer ${FAKE_TOKEN}` },
  });

  const res = await POST(req, {
    user: { id: FAKE_USER_ID },
    supabase: fakeSupabase,
    executeVoicePreferencesDelete: fakeVoiceDeleteFails,
  });

  check('route cloned-voice delete fails: returns 502', res.status === 502);
  check('route cloned-voice delete fails: deleteUser never called', deleteUserCalled === false);
  const data = await res.json();
  check('route cloned-voice delete fails: body ok:false', data.ok === false);
}

// 6. Route-level test: cloned-voice delete succeeds -> deletes non-cascade tables and calls deleteUser with verified id
{
  let deleteUserCalledWith = null;
  const deletedFromTables = [];
  const fakeSupabase = {
    from(table) {
      return {
        delete() {
          return {
            eq(col, val) {
              deletedFromTables.push({ table, col, val });
              return Promise.resolve({ error: null });
            },
          };
        },
      };
    },
    auth: {
      admin: {
        async deleteUser(id) {
          deleteUserCalledWith = id;
          return { data: { user: { id } }, error: null };
        },
      },
    },
  };

  const fakeVoiceDeleteSuccess = async () => ({
    ok: true,
    status: 200,
    deleted: true,
  });

  const req = new Request('http://localhost:3000/api/account/delete', {
    method: 'POST',
    headers: { Authorization: `Bearer ${FAKE_TOKEN}` },
  });

  const res = await POST(req, {
    user: { id: FAKE_USER_ID },
    supabase: fakeSupabase,
    executeVoicePreferencesDelete: fakeVoiceDeleteSuccess,
  });

  check('route success: returns 200', res.status === 200);
  check('route success: deleteUser called with verified user id', deleteUserCalledWith === FAKE_USER_ID);
  check('route success: deletes from non-cascade user tables',
    deletedFromTables.some(d => d.table === 'contacts' && d.val === FAKE_USER_ID) &&
    deletedFromTables.some(d => d.table === 'business_members' && d.val === FAKE_USER_ID) &&
    deletedFromTables.some(d => d.table === 'user_settings' && d.val === FAKE_USER_ID));
  const data = await res.json();
  check('route success: body ok:true', data.ok === true);
}

// 7. Route-level test: unauthenticated -> 401
{
  const req = new Request('http://localhost:3000/api/account/delete', {
    method: 'POST',
    headers: {},
  });
  const res = await POST(req, {
    createBearerClient: async () => ({ user: null }),
  });
  check('route unauthorized: returns 401', res.status === 401);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
