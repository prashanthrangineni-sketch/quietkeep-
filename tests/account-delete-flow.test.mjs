// tests/account-delete-flow.test.mjs - Delete account flow and route tests (CARD AG-AARIA-26)
import { register } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
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
const OTHER_MEMBER_ID = 'm'.repeat(16);

function makeFakeFetch({
  accountStatus = 200,
  accountBody = { ok: true },
  accountNonJson = false,
} = {}) {
  const calls = [];
  const f = async (url, init = {}) => {
    calls.push({ url, init });
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

// ── Migration Static AST / Parsing Checks ──────────────────────────────────
{
  const migPath = path.resolve('supabase/migrations/20261025_delete_user_data.sql');
  const sql = fs.readFileSync(migPath, 'utf8');

  // Check 1: no delete from or update targets a view (open_loop_summary or keeps_with_priority)
  const views = ['open_loop_summary', 'keeps_with_priority'];
  for (const v of views) {
    const hasDelete = new RegExp(`delete\\s+from\\s+${v}\\b`, 'i').test(sql);
    const hasUpdate = new RegExp(`update\\s+${v}\\b`, 'i').test(sql);
    check(`migration: no delete from view '${v}'`, !hasDelete);
    check(`migration: no update view '${v}'`, !hasUpdate);
  }

  // Check 2: no fallback delete from storage.objects
  const hasStorageObjectsDelete = /delete\s+from\s+storage\.objects/i.test(sql);
  check('migration: no direct storage.objects delete fallback', !hasStorageObjectsDelete);

  // Check 3: intents delete happens AFTER expenses and voice_sessions
  const intentsIdx = sql.indexOf('delete from intents');
  const expensesIdx = sql.indexOf('delete from expenses');
  const voiceSessionsIdx = sql.indexOf('delete from voice_sessions');

  check('migration: contains delete from intents', intentsIdx !== -1);
  check('migration: contains delete from expenses', expensesIdx !== -1);
  check('migration: contains delete from voice_sessions', voiceSessionsIdx !== -1);
  check('migration: intents deleted after expenses', intentsIdx > expensesIdx);
  check('migration: intents deleted after voice_sessions', intentsIdx > voiceSessionsIdx);

  // Check 4a: business_tasks assigned_to_member_id cleared BEFORE business_members delete
  const assignedUpdateIdx = sql.indexOf('assigned_to_member_id = null');
  const businessMembersIdx = sql.indexOf('delete from business_members');
  check('migration: contains business_tasks assigned_to_member_id update', assignedUpdateIdx !== -1);
  check('migration: contains delete from business_members', businessMembersIdx !== -1);
  check('migration: assigned_to_member_id cleared before business_members delete', assignedUpdateIdx < businessMembersIdx);

  // Check 4b: qk_messages reply_to_id cleared BEFORE qk_messages delete
  const replyToIdx = sql.indexOf('reply_to_id = null');
  const qkMessagesIdx = sql.indexOf('delete from qk_messages');
  check('migration: contains qk_messages reply_to_id update', replyToIdx !== -1);
  check('migration: contains delete from qk_messages', qkMessagesIdx !== -1);
  check('migration: reply_to_id cleared before qk_messages delete', replyToIdx < qkMessagesIdx);

  // Check 4c: whatsapp_ocr_queue deleted BEFORE products delete
  const ocrQueueIdx = sql.indexOf('delete from whatsapp_ocr_queue');
  const productsIdx = sql.indexOf('delete from products');
  check('migration: contains delete from whatsapp_ocr_queue', ocrQueueIdx !== -1);
  check('migration: contains delete from products', productsIdx !== -1);
  check('migration: whatsapp_ocr_queue deleted before products', ocrQueueIdx < productsIdx);

  // Check 5: no delete from suggestions targeting intent_id
  const hasSuggestionsIntent = /delete\s+from\s+suggestions.*intent_id/i.test(sql);
  check('migration: no delete from suggestions by intent_id', !hasSuggestionsIntent);
}

// ── Flow Tests (runDeleteAccount) ──────────────────────────────────────────

// 1. flow: both 200 -> ok:true, calls ONLY POST /api/account/delete
{
  const fetchImpl = makeFakeFetch({ accountStatus: 200, accountBody: { ok: true } });
  const res = await runDeleteAccount({ token: FAKE_TOKEN, fetchImpl });
  check('flow 200: returns ok:true', res.ok === true);
  check('flow 200: exactly one call made', fetchImpl.calls.length === 1);
  check('flow 200: calls ONLY /api/account/delete', fetchImpl.calls[0].url === '/api/account/delete');
  check('flow 200: Bearer token sent on call',
    fetchImpl.calls[0].init.headers.Authorization === `Bearer ${FAKE_TOKEN}`);
}

// 2. flow: account 502 (e.g. voice engine error) -> ok:false, reports error message
{
  const fetchImpl = makeFakeFetch({
    accountStatus: 502,
    accountBody: {
      ok: false,
      error: 'Failed to erase voice engine data',
      message: "We couldn't erase your voice data yet. Nothing was deleted. Please try again in a minute.",
    },
  });
  const res = await runDeleteAccount({ token: FAKE_TOKEN, fetchImpl });
  check('flow 502: returns ok:false', res.ok === false);
  check('flow 502: reports step account', res.step === 'account');
  check('flow 502: reports friendly message', res.message.includes("We couldn't erase your voice data yet"));
  check('flow 502: exactly one call made', fetchImpl.calls.length === 1);
}

// 3. flow: account 500 -> ok:false
{
  const fetchImpl = makeFakeFetch({ accountStatus: 500, accountBody: { ok: false } });
  const res = await runDeleteAccount({ token: FAKE_TOKEN, fetchImpl });
  check('account 500: returns ok:false', res.ok === false);
  check('account 500: reports step account', res.step === 'account');
  check('account 500: reports account failure message', res.message === 'Account deletion failed. Please try again.');
  check('account 500: exactly one call made', fetchImpl.calls.length === 1);
}

// 4. flow: non-JSON 200 -> ok:false
{
  const fetchImpl = makeFakeFetch({
    accountStatus: 200,
    accountNonJson: true,
  });
  const res = await runDeleteAccount({ token: FAKE_TOKEN, fetchImpl });
  check('flow: non-JSON 200 returns ok:false', res.ok === false);
  check('flow: non-JSON 200 reports step account', res.step === 'account');
  check('flow: non-JSON 200 reports failure message', res.message === 'Account deletion failed. Please try again.');
  check('flow: non-JSON 200 exactly one call made', fetchImpl.calls.length === 1);
}

// 5. flow: 409 owns_business -> returns message and reason
{
  const fetchImpl = makeFakeFetch({
    accountStatus: 409,
    accountBody: {
      ok: false,
      reason: 'owns_business',
      message: 'You own a business workspace with team members. Transfer ownership or remove the members first, then delete your account.',
    },
  });
  const res = await runDeleteAccount({ token: FAKE_TOKEN, fetchImpl });
  check('flow: 409 owns_business returns ok:false', res.ok === false);
  check('flow: 409 owns_business reason is owns_business', res.reason === 'owns_business');
  check('flow: 409 owns_business message matches founder copy', res.message.includes('Transfer ownership or remove the members first'));
  check('flow: 409 owns_business exactly one call made', fetchImpl.calls.length === 1);
}

// ── Route Tests (POST /api/account/delete) ─────────────────────────────────

function createMockSupabase({
  ownedWorkspaces = [],
  workspaceMembers = [],
  chatMessages = [],
  storageListError = null,
  storageRemoveError = null,
  rpcCounts = { auth_users: 1 },
  rpcError = null,
} = {}) {
  const removedFiles = [];
  let rpcCalled = false;
  let rpcArgs = null;

  return {
    from(table) {
      return {
        select() {
          return {
            eq(col, val) {
              if (table === 'business_workspaces' && col === 'owner_user_id') {
                return Promise.resolve({ data: ownedWorkspaces, error: null });
              }
              if (table === 'business_chat_messages' && col === 'sender_id') {
                return Promise.resolve({ data: chatMessages, error: null });
              }
              return Promise.resolve({ data: [], error: null });
            },
            in(col, vals) {
              return {
                eq(c2, v2) {
                  if (table === 'business_members' && col === 'workspace_id' && c2 === 'status' && v2 === 'active') {
                    return Promise.resolve({ data: workspaceMembers, error: null });
                  }
                  return Promise.resolve({ data: [], error: null });
                },
              };
            },
          };
        },
      };
    },
    storage: {
      from(bucket) {
        return {
          list: async (folder) => {
            if (storageListError && bucket === storageListError.bucket) {
              return { data: null, error: storageListError.error };
            }
            return { data: [], error: null };
          },
          remove: async (paths) => {
            if (storageRemoveError && bucket === storageRemoveError.bucket) {
              return { data: null, error: storageRemoveError.error };
            }
            removedFiles.push({ bucket, paths });
            return { data: paths, error: null };
          },
        };
      },
    },
    rpc(fn, args) {
      rpcCalled = true;
      rpcArgs = args;
      if (rpcError) {
        return Promise.resolve({ data: null, error: rpcError });
      }
      return Promise.resolve({ data: rpcCounts, error: null });
    },
    getRpcCalled: () => rpcCalled,
    getRpcArgs: () => rpcArgs,
    getRemovedFiles: () => removedFiles,
  };
}

// 6. Product Rule: user owns business workspace with other active members -> 409 BEFORE forget-me is called
{
  let forgetCalled = false;
  let voiceCalled = false;
  const fakeSupabase = createMockSupabase({
    ownedWorkspaces: [{ id: 'ws-1' }],
    workspaceMembers: [
      { id: 'mem-owner', user_id: FAKE_USER_ID, status: 'active', workspace_id: 'ws-1' },
      { id: 'mem-other', user_id: OTHER_MEMBER_ID, status: 'active', workspace_id: 'ws-1' },
    ],
  });

  const req = new Request('http://localhost:3000/api/account/delete', {
    method: 'POST',
    headers: { Authorization: `Bearer ${FAKE_TOKEN}` },
  });

  const res = await POST(req, {
    user: { id: FAKE_USER_ID },
    supabase: fakeSupabase,
    askEngineToForget: async () => { forgetCalled = true; return { ok: true }; },
    executeVoicePreferencesDelete: async () => { voiceCalled = true; return { ok: true }; },
  });

  check('product rule: active members returns 409', res.status === 409);
  check('product rule: forget-me never called', forgetCalled === false);
  check('product rule: voice delete never called', voiceCalled === false);
  check('product rule: rpc never called', fakeSupabase.getRpcCalled() === false);
  const data = await res.json();
  check('product rule: reason is owns_business', data.reason === 'owns_business');
  check('product rule: message guides user to transfer or remove members', data.message.includes('Transfer ownership or remove the members first'));
}

// 7. Route: forget-me on voice engine fails -> 502, no cloned voice delete, no storage/rpc
{
  let voiceCalled = false;
  const fakeSupabase = createMockSupabase();
  const fakeForgetFails = async () => ({
    ok: false,
    status: 502,
    reason: 'engine_error',
  });

  const req = new Request('http://localhost:3000/api/account/delete', {
    method: 'POST',
    headers: { Authorization: `Bearer ${FAKE_TOKEN}` },
  });

  const res = await POST(req, {
    user: { id: FAKE_USER_ID },
    supabase: fakeSupabase,
    askEngineToForget: fakeForgetFails,
    executeVoicePreferencesDelete: async () => { voiceCalled = true; return { ok: true }; },
  });

  check('route forget-me failure: returns 502', res.status === 502);
  check('route forget-me failure: cloned voice never called', voiceCalled === false);
  check('route forget-me failure: no storage files removed', fakeSupabase.getRemovedFiles().length === 0);
  check('route forget-me failure: rpc not called', fakeSupabase.getRpcCalled() === false);
  const data = await res.json();
  check('route forget-me failure: friendly message returned', data.message.includes("We couldn't erase your voice data yet"));
}

// 8. Product Rule: user owns workspace with NO other members -> proceeds and succeeds
{
  const fakeSupabase = createMockSupabase({
    ownedWorkspaces: [{ id: 'ws-solo' }],
    workspaceMembers: [
      { id: 'mem-owner', user_id: FAKE_USER_ID, status: 'active', workspace_id: 'ws-solo' },
    ],
  });

  const req = new Request('http://localhost:3000/api/account/delete', {
    method: 'POST',
    headers: { Authorization: `Bearer ${FAKE_TOKEN}` },
  });

  const res = await POST(req, {
    user: { id: FAKE_USER_ID },
    supabase: fakeSupabase,
    askEngineToForget: async () => ({ ok: true, status: 200 }),
    executeVoicePreferencesDelete: async () => ({ ok: true, status: 200 }),
  });

  check('product rule: solo owner returns 200', res.status === 200);
  check('product rule: solo owner rpc was called', fakeSupabase.getRpcCalled() === true);
}

// 9. Route: cloned-voice delete fails -> 502 and rpc not called
{
  const fakeSupabase = createMockSupabase();
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
    askEngineToForget: async () => ({ ok: true, status: 200 }),
    executeVoicePreferencesDelete: fakeVoiceDeleteFails,
  });

  check('route cloned-voice delete fails: returns 502', res.status === 502);
  check('route cloned-voice delete fails: rpc not called', fakeSupabase.getRpcCalled() === false);
}

// 10. Route: storage failure -> 502 and rpc not called
{
  const fakeSupabase = createMockSupabase({
    storageListError: { bucket: 'memories', error: { message: 'Storage timeout' } },
  });

  const req = new Request('http://localhost:3000/api/account/delete', {
    method: 'POST',
    headers: { Authorization: `Bearer ${FAKE_TOKEN}` },
  });

  const res = await POST(req, {
    user: { id: FAKE_USER_ID },
    supabase: fakeSupabase,
    askEngineToForget: async () => ({ ok: true, status: 200 }),
    executeVoicePreferencesDelete: async () => ({ ok: true, status: 200 }),
  });

  check('route storage failure: returns 502', res.status === 502);
  check('route storage failure: rpc not called', fakeSupabase.getRpcCalled() === false);
}

// 11. Route: cleans up business_chat_messages voice attachments in voice-messages bucket
{
  const fakeSupabase = createMockSupabase({
    chatMessages: [
      { id: '1', metadata: { path: 'chat/ws-1/room-1/audio1.webm' } },
      { id: '2', content: 'https://example.supabase.co/storage/v1/object/sign/voice-messages/chat%2Fws-1%2Froom-2%2Faudio2.webm?token=xyz' },
    ],
  });

  const req = new Request('http://localhost:3000/api/account/delete', {
    method: 'POST',
    headers: { Authorization: `Bearer ${FAKE_TOKEN}` },
  });

  const res = await POST(req, {
    user: { id: FAKE_USER_ID },
    supabase: fakeSupabase,
    askEngineToForget: async () => ({ ok: true, status: 200 }),
    executeVoicePreferencesDelete: async () => ({ ok: true, status: 200 }),
  });

  check('business chat files: returns 200', res.status === 200);
  const removals = fakeSupabase.getRemovedFiles().filter(r => r.bucket === 'voice-messages');
  const removedPaths = removals.flatMap(r => r.paths);
  check('business chat files: removed metadata.path', removedPaths.includes('chat/ws-1/room-1/audio1.webm'));
  check('business chat files: removed decoded URL path', removedPaths.includes('chat/ws-1/room-2/audio2.webm'));
}

// 12. Route: rpc error -> 500
{
  const fakeSupabase = createMockSupabase({
    rpcError: { message: 'Foreign key violation in live DB' },
  });

  const req = new Request('http://localhost:3000/api/account/delete', {
    method: 'POST',
    headers: { Authorization: `Bearer ${FAKE_TOKEN}` },
  });

  const res = await POST(req, {
    user: { id: FAKE_USER_ID },
    supabase: fakeSupabase,
    askEngineToForget: async () => ({ ok: true, status: 200 }),
    executeVoicePreferencesDelete: async () => ({ ok: true, status: 200 }),
  });

  check('route rpc error: returns 500', res.status === 500);
}

// 13. Route: counts.auth_users !== 1 -> 500 (never ok:true when auth record not deleted)
{
  const fakeSupabase = createMockSupabase({
    rpcCounts: { auth_users: 0, calendar_events: 1 },
  });

  const req = new Request('http://localhost:3000/api/account/delete', {
    method: 'POST',
    headers: { Authorization: `Bearer ${FAKE_TOKEN}` },
  });

  const res = await POST(req, {
    user: { id: FAKE_USER_ID },
    supabase: fakeSupabase,
    askEngineToForget: async () => ({ ok: true, status: 200 }),
    executeVoicePreferencesDelete: async () => ({ ok: true, status: 200 }),
  });

  check('counts.auth_users !== 1: returns 500', res.status === 500);
  const data = await res.json();
  check('counts.auth_users !== 1: reports sign-in record not deleted', data.error.includes('sign-in record was not deleted'));
}

// 14. Route: a userId in the body is ignored (uses ONLY verified user from bearer)
{
  const fakeSupabase = createMockSupabase();

  const req = new Request('http://localhost:3000/api/account/delete', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${FAKE_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      userId: ATTACKER_USER_ID,
      id: ATTACKER_USER_ID,
    }),
  });

  let forgetUserId = null;
  const res = await POST(req, {
    user: { id: FAKE_USER_ID },
    supabase: fakeSupabase,
    askEngineToForget: async (uid) => {
      forgetUserId = uid;
      return { ok: true, status: 200 };
    },
    executeVoicePreferencesDelete: async ({ userId }) => {
      check('userId in body ignored: voice delete receives verified userId', userId === FAKE_USER_ID);
      return { ok: true, status: 200 };
    },
  });

  check('userId in body ignored: returns 200', res.status === 200);
  check('userId in body ignored: forget-me received verified userId', forgetUserId === FAKE_USER_ID);
  check('userId in body ignored: rpc called with verified user id', fakeSupabase.getRpcArgs()?.p_user === FAKE_USER_ID);
  check('userId in body ignored: rpc never receives attacker user id', fakeSupabase.getRpcArgs()?.p_user !== ATTACKER_USER_ID);
}

// 15. Route: unauthorized -> 401
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
