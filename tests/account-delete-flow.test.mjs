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
const ATTACKER_USER_ID = 'x'.repeat(16);

function makeFakeFetch({
  forgetStatus = 200,
  forgetBody = { ok: true },
  accountStatus = 200,
  accountBody = { ok: true },
  accountNonJson = false,
} = {}) {
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
      if (accountNonJson) {
        return {
          status: accountStatus,
          ok: accountStatus >= 200 && accountStatus < 300,
          json: async () => { throw new Error('Unexpected token < in JSON'); },
          text: async () => 'OK',
        };
      }
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

// 5. flow: non-JSON 200 -> ok:false
{
  const fetchImpl = makeFakeFetch({
    forgetStatus: 200,
    forgetBody: { ok: true },
    accountStatus: 200,
    accountNonJson: true,
  });
  const res = await runDeleteAccount({ token: FAKE_TOKEN, fetchImpl });
  check('flow: non-JSON 200 returns ok:false', res.ok === false);
  check('flow: non-JSON 200 reports step account', res.step === 'account');
  check('flow: non-JSON 200 reports failure message', res.message === 'Account deletion failed. Please try again.');
}

// 6. Route-level test: cloned-voice delete fails -> 502 and rpc not called
{
  let rpcCalled = false;
  const fakeSupabase = {
    storage: {
      from() {
        return {
          list: async () => ({ data: [], error: null }),
          remove: async () => ({ data: [], error: null }),
        };
      },
    },
    rpc() {
      rpcCalled = true;
      return Promise.resolve({ data: {}, error: null });
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
  check('route cloned-voice delete fails: rpc not called', rpcCalled === false);
  const data = await res.json();
  check('route cloned-voice delete fails: body ok:false', data.ok === false);
}

// 7. Route-level test: storage failure -> 502 and rpc not called
{
  let rpcCalled = false;
  const fakeSupabase = {
    storage: {
      from(bucket) {
        return {
          list: async () => {
            if (bucket === 'memories') {
              return { data: null, error: { message: 'Storage service timeout' } };
            }
            return { data: [], error: null };
          },
          remove: async () => ({ data: [], error: null }),
        };
      },
    },
    rpc() {
      rpcCalled = true;
      return Promise.resolve({ data: {}, error: null });
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

  check('route storage failure: returns 502', res.status === 502);
  check('route storage failure: rpc not called', rpcCalled === false);
  const data = await res.json();
  check('route storage failure: body ok:false', data.ok === false);
  check('route storage failure: mentions bucket or storage error', data.error.includes('memories') || data.error.includes('Storage'));
}

// 8. Route-level test: rpc error -> 500
{
  const fakeSupabase = {
    storage: {
      from() {
        return {
          list: async () => ({ data: [], error: null }),
          remove: async () => ({ data: [], error: null }),
        };
      },
    },
    rpc(fn, args) {
      if (fn === 'delete_user_data') {
        return Promise.resolve({ data: null, error: { message: 'Foreign key violation in live DB' } });
      }
      return Promise.resolve({ data: {}, error: null });
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

  check('route rpc error: returns 500', res.status === 500);
  const data = await res.json();
  check('route rpc error: body ok:false', data.ok === false);
  check('route rpc error: returns error message', data.error.includes('Foreign key violation'));
}

// 9. Route-level test: a userId in the body is ignored (uses ONLY verified user from bearer)
{
  let rpcArgsReceived = null;
  const fakeSupabase = {
    storage: {
      from() {
        return {
          list: async () => ({ data: [], error: null }),
          remove: async () => ({ data: [], error: null }),
        };
      },
    },
    rpc(fn, args) {
      rpcArgsReceived = args;
      return Promise.resolve({ data: { auth_users: 1 }, error: null });
    },
  };

  const fakeVoiceDeleteSuccess = async ({ userId }) => {
    check('route userId in body ignored: voice delete receives verified userId', userId === FAKE_USER_ID);
    return { ok: true, status: 200, deleted: true };
  };

  // Malicious request attempting to delete another user by specifying userId in body
  const req = new Request('http://localhost:3000/api/account/delete', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${FAKE_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      userId: ATTACKER_USER_ID,
      id: ATTACKER_USER_ID,
      user_id: ATTACKER_USER_ID,
    }),
  });

  const res = await POST(req, {
    user: { id: FAKE_USER_ID },
    supabase: fakeSupabase,
    executeVoicePreferencesDelete: fakeVoiceDeleteSuccess,
  });

  check('route userId in body ignored: returns 200', res.status === 200);
  check('route userId in body ignored: rpc called with verified user id', rpcArgsReceived?.p_user === FAKE_USER_ID);
  check('route userId in body ignored: rpc never receives attacker user id', rpcArgsReceived?.p_user !== ATTACKER_USER_ID);
}

// 10. Route-level test: success -> 200 and returns counts
{
  const fakeSupabase = {
    storage: {
      from() {
        return {
          list: async () => ({ data: [{ name: 'file1.txt', id: '1' }], error: null }),
          remove: async () => ({ data: [], error: null }),
        };
      },
    },
    rpc(fn, args) {
      return Promise.resolve({ data: { auth_users: 1, calendar_events: 2 }, error: null });
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

  check('route full success: returns 200', res.status === 200);
  const data = await res.json();
  check('route full success: body ok:true', data.ok === true);
  check('route full success: returns counts', data.counts?.auth_users === 1 && data.counts?.calendar_events === 2);
}

// 11. Route-level test: unauthenticated -> 401
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
