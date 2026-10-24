// tests/business-routes.test.mjs
// Route-level integration tests for QuietKeep Business limits, opt-outs, approvals & webhooks.
// Mocks Supabase, Twilio & Meta APIs. Plain node, no external test runner required.

import { register } from 'node:module';
import crypto from 'node:crypto';

// Register loader for path aliases (@/) and module mocking
register('./loader.mjs', import.meta.url);

// Pinned deterministic daytime (14:00 IST / 08:30 UTC) for promo hours window testing
const RealDate = globalThis.Date;
const FIXED_NOW = new RealDate('2026-10-24T08:30:00.000Z').getTime();
class MockDate extends RealDate {
  constructor(...args) {
    if (args.length === 0) {
      super(FIXED_NOW);
    } else {
      super(...args);
    }
  }
  static now() {
    return FIXED_NOW;
  }
}
globalThis.Date = MockDate;

// Configure test environment variables
process.env.TWILIO_ACCOUNT_SID = 'AC_TEST_ACCOUNT_12345';
process.env.TWILIO_AUTH_TOKEN = 'test_twilio_secret_token_abc';
process.env.TWILIO_WHATSAPP_FROM = '+14155238886';
process.env.WHATSAPP_WEBHOOK_URL = 'https://quietkeep.com/api/whatsapp/webhook';
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service_role_test_secret';
process.env.META_WHATSAPP_APP_SECRET = 'test_meta_app_secret_xyz123';

function makeMetaSignature(body, secret = process.env.META_WHATSAPP_APP_SECRET) {
  const hex = crypto.createHmac('sha256', secret).update(body).digest('hex');
  return `sha256=${hex}`;
}

const { mockDb } = await import('./mock-supabase.mjs');

// Dynamically import routes after loader is registered
const { POST: sendRoute } = await import('../src/app/api/whatsapp/send/route.js');
const { POST: twilioWebhookRoute } = await import('../src/app/api/whatsapp/webhook/route.js');
const { POST: metaWebhookRoute } = await import('../src/app/api/whatsapp/meta-webhook/route.js');
const { GET: approvalsGet, POST: approvalsPost } = await import('../src/app/api/business/approvals/route.js');
const { POST: dunningRoute } = await import('../src/app/api/business/dunning/route.js');

let pass = 0, fail = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  ${detail}`}`);
  ok ? pass++ : fail++;
}

// Track mocked outbound HTTP calls (Twilio / Meta)
const mockFetchCalls = [];
let mockTwilioFail = false;
globalThis.fetch = async (url, options = {}) => {
  mockFetchCalls.push({ url, options });
  if (url.includes('api.twilio.com')) {
    if (mockTwilioFail) {
      return {
        ok: false,
        status: 500,
        json: async () => ({ error: 'twilio_error' }),
        text: async () => JSON.stringify({ error: 'twilio_error' })
      };
    }
    return {
      ok: true,
      status: 201,
      json: async () => ({ sid: 'SM_TEST_MOCK_SID_999', status: 'queued' }),
      text: async () => JSON.stringify({ sid: 'SM_TEST_MOCK_SID_999' })
    };
  }
  if (url.includes('graph.facebook.com')) {
    return {
      ok: true,
      status: 200,
      json: async () => ({ messages: [{ id: 'wamid.HBgTEST_ID' }] }),
      text: async () => JSON.stringify({ messages: [{ id: 'wamid.HBgTEST_ID' }] })
    };
  }
  return { ok: false, status: 404, json: async () => ({ error: 'not_found' }), text: async () => 'not_found' };
};

function makeTwilioSignature(url, params, token) {
  const data = Object.keys(params).sort().reduce((acc, k) => acc + k + params[k], url);
  return crypto.createHmac('sha1', token).update(Buffer.from(data, 'utf-8')).digest('base64');
}

// ── 1. ROUTE /api/whatsapp/send (Items A, B, D, F, H, J) ──────────────────────
console.log('\n--- 1. Testing POST /api/whatsapp/send ---');
{
  // 1.1 Unauthenticated request returns 401
  mockDb.reset();
  mockDb.mockUser = null;
  const req1 = new Request('http://localhost/api/whatsapp/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ to: '+919876543210', message: 'Hi' })
  });
  const res1 = await sendRoute(req1);
  check('1.1 Unauthenticated returns 401', res1.status === 401);

  // 1.2 Invalid phone or missing message returns 400
  mockDb.reset();
  const req2 = new Request('http://localhost/api/whatsapp/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ to: 'invalid_num', message: 'Hi' })
  });
  const res2 = await sendRoute(req2);
  check('1.2 Invalid phone number returns 400', res2.status === 400);

  // 1.3 Caller is NOT owner or member of requested workspace returns 403 forbidden_workspace
  mockDb.reset();
  mockDb.tables.business_workspaces.push({
    id: 'ws_other',
    owner_user_id: 'user_stranger',
    name: 'Stranger Shop',
    created_at: '2026-01-01T00:00:00Z',
    daily_promo_limit: 50
  });
  const req3 = new Request('http://localhost/api/whatsapp/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspace_id: 'ws_other', to: '9876543210', message: 'Hello promo' })
  });
  const res3 = await sendRoute(req3);
  const data3 = await res3.json();
  check('1.3 Non-member caller returns 403 forbidden_workspace', res3.status === 403 && data3.code === 'forbidden_workspace');

  // 1.4 Caller IS active member of workspace returns OK
  mockDb.reset();
  mockDb.tables.business_workspaces.push({
    id: 'ws_corp',
    owner_user_id: 'user_boss',
    name: 'Corp Shop',
    created_at: '2026-01-01T00:00:00Z',
    daily_promo_limit: 100
  });
  mockDb.tables.business_members.push({
    id: 'mem_1',
    workspace_id: 'ws_corp',
    user_id: 'u1',
    status: 'active',
    role: 'member'
  });
  // Add inbound query so it is transactional reply
  mockDb.tables.business_approvals.push({
    id: 'app_inbound_1',
    workspace_id: 'ws_corp',
    action_type: 'customer_reply',
    status: 'pending',
    payload: { customer_phone: '+919876543210', text: 'Where is shop?' },
    created_at: new Date().toISOString()
  });

  const req4 = new Request('http://localhost/api/whatsapp/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspace_id: 'ws_corp', to: '9876543210', message: 'We are next to bus stand.' })
  });
  const res4 = await sendRoute(req4);
  check('1.4 Active member of workspace allowed to send', res4.status === 200);

  // 1.5 Server decides message is PROMOTIONAL if unproven (even if client claimed is_promotional: false)
  mockDb.reset();
  mockDb.tables.business_workspaces.push({
    id: 'ws_1',
    owner_user_id: 'u1',
    name: 'My Shop',
    created_at: '2026-01-01T00:00:00Z',
    daily_promo_limit: 50
  });
  // Customer is opted out
  mockDb.tables.business_customer_opt_outs.push({
    workspace_id: 'ws_1',
    phone: '+919876543210',
    opted_out_at: '2026-10-01T00:00:00Z'
  });
  // Client claims is_promotional: false, but there is NO inbound query and NO order_id!
  const req5 = new Request('http://localhost/api/whatsapp/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workspace_id: 'ws_1',
      to: '9876543210',
      message: 'Claim your unrequested discount!',
      is_promotional: false
    })
  });
  const res5 = await sendRoute(req5);
  const data5 = await res5.json();
  check('1.5 Unproven claim treated as promotional and blocked for opted-out customer', res5.status === 403 && data5.code === 'customer_opted_out');

  // 1.6 Proven transactional: reply to inbound customer message in last 24h allowed for opted-out customer
  mockDb.reset();
  mockDb.tables.business_workspaces.push({
    id: 'ws_1',
    owner_user_id: 'u1',
    name: 'My Shop',
    created_at: '2026-01-01T00:00:00Z',
    daily_promo_limit: 50
  });
  mockDb.tables.business_customer_opt_outs.push({
    workspace_id: 'ws_1',
    phone: '+919876543210',
    opted_out_at: '2026-10-01T00:00:00Z'
  });
  // Recent inbound inquiry in last 24h
  mockDb.tables.business_approvals.push({
    id: 'app_inbound_2',
    workspace_id: 'ws_1',
    action_type: 'customer_reply',
    status: 'pending',
    payload: { customer_phone: '+919876543210', text: 'Do you have rice?' },
    created_at: new Date(Date.now() - 2 * 3600 * 1000).toISOString()
  });

  const req6 = new Request('http://localhost/api/whatsapp/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workspace_id: 'ws_1',
      to: '9876543210',
      message: 'Yes, 25kg Sona Masoori is available at 1200.'
    })
  });
  const res6 = await sendRoute(req6);
  check('1.6 Inbound reply within 24h allowed even if customer opted out', res6.status === 200);

  // 1.7 Proven transactional: order status update tied to real order id allowed for opted-out customer
  mockDb.reset();
  mockDb.tables.business_workspaces.push({
    id: 'ws_1',
    owner_user_id: 'u1',
    name: 'My Shop',
    created_at: '2026-01-01T00:00:00Z',
    daily_promo_limit: 50
  });
  mockDb.tables.business_customer_opt_outs.push({
    workspace_id: 'ws_1',
    phone: '+919876543210',
    opted_out_at: '2026-10-01T00:00:00Z'
  });
  // Real invoice in workspace
  mockDb.tables.business_invoices.push({
    id: 'ord_99',
    workspace_id: 'ws_1',
    customer_phone: '+919876543210',
    status: 'pending'
  });

  const req7 = new Request('http://localhost/api/whatsapp/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workspace_id: 'ws_1',
      to: '9876543210',
      order_id: 'ord_99',
      message: 'Your order #ord_99 is out for delivery with driver Ramesh.'
    })
  });
  const res7 = await sendRoute(req7);
  check('1.7 Order status update allowed for opted-out customer', res7.status === 200);

  // 1.8 Fail-closed promo log: if business_promo_log insert errors, does NOT send promotion
  mockDb.reset();
  mockDb.tables.business_workspaces.push({
    id: 'ws_1',
    owner_user_id: 'u1',
    name: 'My Shop',
    created_at: '2026-01-01T00:00:00Z',
    daily_promo_limit: 50
  });
  mockDb.failInserts.add('business_promo_log');
  mockFetchCalls.length = 0;

  const req8 = new Request('http://localhost/api/whatsapp/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workspace_id: 'ws_1',
      to: '+919876543210',
      message: 'Flash Sale: 20% off all spices today only!'
    })
  });
  const res8 = await sendRoute(req8);
  const data8 = await res8.json();
  const twilioCalledInReq8 = mockFetchCalls.some(c => c.url.includes('api.twilio.com'));
  check('1.8 Fail-closed: insert error returns 500 promo_log_failed', res8.status === 500 && data8.code === 'promo_log_failed');
  check('1.8 Fail-closed: Twilio was NOT called when log insert failed', !twilioCalledInReq8);

  // 1.9 Audit log masks customer phone (last 4 digits only)
  mockDb.reset();
  mockDb.tables.business_workspaces.push({
    id: 'ws_1',
    owner_user_id: 'u1',
    name: 'My Shop',
    created_at: '2026-01-01T00:00:00Z',
    daily_promo_limit: 50
  });
  // Allow promotional send
  const req9 = new Request('http://localhost/api/whatsapp/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workspace_id: 'ws_1',
      to: '+91 98765 43210',
      message: 'Happy Festival! Sweets available now.'
    })
  });
  const res9 = await sendRoute(req9);
  check('1.9 Promotional send returns 200', res9.status === 200);
  const promoLog = mockDb.tables.business_promo_log.find(r => r.workspace_id === 'ws_1');
  check('1.9 Promo log stores normalized phone', promoLog && promoLog.phone === '+919876543210');
  const actLog = mockDb.tables.business_activity_log.find(r => r.workspace_id === 'ws_1');
  check('1.9 Activity log masks phone to last 4 digits', actLog && actLog.metadata && actLog.metadata.who.endsWith('3210') && !actLog.metadata.who.includes('98765'));

  // 1.10 Unnormalised stored phone still blocked after backfill logic (Item 1)
  mockDb.reset();
  mockDb.tables.business_workspaces.push({
    id: 'ws_1',
    owner_user_id: 'u1',
    name: 'My Shop',
    created_at: '2026-01-01T00:00:00Z',
    daily_promo_limit: 50
  });
  mockDb.tables.business_customer_opt_outs.push({
    workspace_id: 'ws_1',
    phone: '9876543210',
    opted_out_at: '2026-10-01T00:00:00Z'
  });
  const req10 = new Request('http://localhost/api/whatsapp/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workspace_id: 'ws_1',
      to: '+919876543210',
      message: 'Unsolicited promotional offer'
    })
  });
  const res10 = await sendRoute(req10);
  const data10 = await res10.json();
  check('1.10 Unnormalised stored phone still blocked after backfill logic', res10.status === 403 && data10.code === 'customer_opted_out');

  // 1.11 No workspace_id: checks all workspaces caller belongs to, blocks if opted out in ANY (Item 2)
  mockDb.reset();
  mockDb.tables.business_workspaces.push(
    { id: 'ws_owned', owner_user_id: 'u1', name: 'Owned Shop', created_at: '2026-01-01T00:00:00Z', daily_promo_limit: 50 },
    { id: 'ws_member', owner_user_id: 'u_boss', name: 'Branch Shop', created_at: '2026-01-01T00:00:00Z', daily_promo_limit: 50 }
  );
  mockDb.tables.business_members.push({
    id: 'mem_u1',
    workspace_id: 'ws_member',
    user_id: 'u1',
    status: 'active',
    role: 'member'
  });
  mockDb.tables.business_customer_opt_outs.push({
    workspace_id: 'ws_member',
    phone: '+919876543210',
    opted_out_at: '2026-10-01T00:00:00Z'
  });
  const req11 = new Request('http://localhost/api/whatsapp/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      to: '9876543210',
      message: 'Multi-workspace promo broadcast'
    })
  });
  const res11 = await sendRoute(req11);
  const data11 = await res11.json();
  check('1.11 No workspace_id + opted-out number -> blocked across all member workspaces', res11.status === 403 && data11.code === 'customer_opted_out');

  // 1.12 Unrelated order id -> not transactional, blocked for opted-out recipient (Item 3)
  mockDb.reset();
  mockDb.tables.business_workspaces.push({
    id: 'ws_1',
    owner_user_id: 'u1',
    name: 'My Shop',
    created_at: '2026-01-01T00:00:00Z',
    daily_promo_limit: 50
  });
  mockDb.tables.business_customer_opt_outs.push({
    workspace_id: 'ws_1',
    phone: '+919876543210'
  });
  mockDb.tables.business_invoices.push({
    id: 'inv_other_customer',
    workspace_id: 'ws_1',
    customer_phone: '+918888888888'
  });
  const req12 = new Request('http://localhost/api/whatsapp/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workspace_id: 'ws_1',
      to: '+919876543210',
      order_id: 'inv_other_customer',
      message: 'Sneaky promo using another customer invoice id'
    })
  });
  const res12 = await sendRoute(req12);
  const data12 = await res12.json();
  check('1.12 Unrelated order id -> not transactional, blocked for opted-out recipient', res12.status === 403 && data12.code === 'customer_opted_out');

  // 1.13 Fail-closed: DB error during customer opt-out check returns 500 (Round 4 Item 1)
  mockDb.reset();
  mockDb.tables.business_workspaces.push({
    id: 'ws_1',
    owner_user_id: 'u1',
    name: 'My Shop',
    created_at: '2026-01-01T00:00:00Z',
    daily_promo_limit: 50
  });
  mockDb.failQueries.add('business_customer_opt_outs');
  const req13 = new Request('http://localhost/api/whatsapp/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workspace_id: 'ws_1',
      to: '+919876543210',
      message: 'Hello customer'
    })
  });
  const res13 = await sendRoute(req13);
  const data13 = await res13.json();
  mockDb.failQueries.clear();
  check('1.13 Opt-out DB query error fails closed with 500 opt_out_check_failed', res13.status === 500 && data13.code === 'opt_out_check_failed');

  // 1.14 Two matching rows in business_customer_opt_outs -> still detected without error (Round 4 Item 1)
  mockDb.reset();
  mockDb.tables.business_workspaces.push({
    id: 'ws_1',
    owner_user_id: 'u1',
    name: 'My Shop',
    created_at: '2026-01-01T00:00:00Z',
    daily_promo_limit: 50
  });
  // Insert 2 rows for same phone (e.g. from different legacy keywords)
  mockDb.tables.business_customer_opt_outs.push(
    { workspace_id: 'ws_1', phone: '+919876543210', keyword: 'STOP' },
    { workspace_id: 'ws_1', phone: '+919876543210', keyword: 'OPTOUT' }
  );
  const req14 = new Request('http://localhost/api/whatsapp/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workspace_id: 'ws_1',
      to: '+919876543210',
      message: 'Promo to user with duplicate opt-out rows'
    })
  });
  const res14 = await sendRoute(req14);
  const data14 = await res14.json();
  check('1.14 2 matching opt-out rows -> still detected and blocked with 403', res14.status === 403 && data14.code === 'customer_opted_out');

  // 1.15 Fail-closed: Workspace query error returns 500 (Round 4 Item 1)
  mockDb.reset();
  mockDb.failQueries.add('business_workspaces');
  const req15 = new Request('http://localhost/api/whatsapp/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      to: '+919876543210',
      message: 'Promo message'
    })
  });
  const res15 = await sendRoute(req15);
  const data15 = await res15.json();
  mockDb.failQueries.clear();
  check('1.15 Workspace query error fails closed with 500 workspace_lookup_failed', res15.status === 500 && data15.code === 'workspace_lookup_failed');

  // 1.16 Order-type approval in business_approvals counts as order update and allows send (Round 4 Item 2)
  mockDb.reset();
  mockDb.tables.business_workspaces.push({
    id: 'ws_1',
    owner_user_id: 'u1',
    name: 'My Shop',
    created_at: '2026-01-01T00:00:00Z',
    daily_promo_limit: 50
  });
  mockDb.tables.business_customer_opt_outs.push({
    workspace_id: 'ws_1',
    phone: '+919876543210'
  });
  // Note: NO customer_phone column in table row! Phone is in payload.
  mockDb.tables.business_approvals.push({
    id: 'app_order_update_1',
    workspace_id: 'ws_1',
    action_type: 'business_order_confirm',
    status: 'pending',
    payload: {
      customerPhone: '+919876543210',
      what: 'order_request',
      suggested_reply: 'Your order is ready for pickup!'
    }
  });
  mockFetchCalls.length = 0;
  const req16 = new Request('http://localhost/api/whatsapp/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workspace_id: 'ws_1',
      to: '+919876543210',
      order_id: 'app_order_update_1',
      message: 'Your order is ready for pickup!'
    })
  });
  const res16 = await sendRoute(req16);
  check('1.16 Order-type approval (no customer_phone column) counts as transactional and sends 200', res16.status === 200);

  // 1.17 Approval with status="out_for_delivery" but action_type NOT order is NOT an order update (Round 4 Item 2)
  mockDb.reset();
  mockDb.tables.business_workspaces.push({
    id: 'ws_1',
    owner_user_id: 'u1',
    name: 'My Shop',
    created_at: '2026-01-01T00:00:00Z',
    daily_promo_limit: 50
  });
  mockDb.tables.business_customer_opt_outs.push({
    workspace_id: 'ws_1',
    phone: '+919876543210'
  });
  mockDb.tables.business_approvals.push({
    id: 'app_not_order',
    workspace_id: 'ws_1',
    action_type: 'customer_reply',
    status: 'out_for_delivery',
    payload: {
      customerPhone: '+919876543210',
      what: 'general_query'
    }
  });
  const req17 = new Request('http://localhost/api/whatsapp/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workspace_id: 'ws_1',
      to: '+919876543210',
      order_id: 'app_not_order',
      message: 'General query reply to opted-out customer'
    })
  });
  const res17 = await sendRoute(req17);
  const data17 = await res17.json();
  check('1.17 status "out_for_delivery" does not count as order update without order action_type', res17.status === 403 && data17.code === 'customer_opted_out');
}

// ── 2. ROUTE /api/whatsapp/webhook (Twilio) (Items C, D, E) ───────────────────
console.log('\n--- 2. Testing POST /api/whatsapp/webhook (Twilio) ---');
{
  // 2.1 Missing / invalid signature returns 403
  const badReq = new Request('http://localhost/api/whatsapp/webhook', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'x-twilio-signature': 'bad_sig'
    },
    body: new URLSearchParams({ From: 'whatsapp:+919876543210', To: 'whatsapp:+911122334455', Body: 'Hello' }).toString()
  });
  const badRes = await twilioWebhookRoute(badReq);
  check('2.1 Invalid Twilio signature returns 403', badRes.status === 403);

  // 2.2 Inbound STOP from external customer (not a QuietKeep user) stores opt-out
  mockDb.reset();
  mockDb.tables.business_workspaces.push({
    id: 'ws_kirana',
    owner_user_id: 'owner_user_99',
    name: 'Kirana Store',
    phone: '+911122334455',
    timings: '9:00 AM - 9:00 PM',
    address: 'Main Road'
  });

  const stopParams = {
    From: 'whatsapp:+91 99887 76655', // raw spaces
    To: 'whatsapp:+911122334455',
    Body: 'STOP',
    MessageSid: 'SM_STOP_1'
  };
  const stopSig = makeTwilioSignature('https://quietkeep.com/api/whatsapp/webhook', stopParams, process.env.TWILIO_AUTH_TOKEN);

  const stopReq = new Request('http://localhost/api/whatsapp/webhook', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'x-twilio-signature': stopSig
    },
    body: new URLSearchParams(stopParams).toString()
  });
  const stopRes = await twilioWebhookRoute(stopReq);
  const stopXml = await stopRes.text();
  check('2.2 Opt-out returns XML response', stopRes.status === 200 && stopXml.includes('unsubscribed'));
  const storedOptOut = mockDb.tables.business_customer_opt_outs.find(r => r.workspace_id === 'ws_kirana');
  check('2.2 Opt-out recorded with normalized phone for external customer', storedOptOut && storedOptOut.phone === '+919988776655');

  // 2.3 Telugu opt-out: "వద్దు"
  mockDb.reset();
  mockDb.tables.business_workspaces.push({
    id: 'ws_kirana',
    owner_user_id: 'owner_user_99',
    name: 'Kirana Store',
    phone: '+911122334455'
  });
  const teParams = {
    From: 'whatsapp:+919876543210',
    To: 'whatsapp:+911122334455',
    Body: 'వద్దు',
    MessageSid: 'SM_TE_1'
  };
  const teSig = makeTwilioSignature('https://quietkeep.com/api/whatsapp/webhook', teParams, process.env.TWILIO_AUTH_TOKEN);
  const teReq = new Request('http://localhost/api/whatsapp/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'x-twilio-signature': teSig },
    body: new URLSearchParams(teParams).toString()
  });
  await twilioWebhookRoute(teReq);
  const teOptOut = mockDb.tables.business_customer_opt_outs.find(r => r.phone === '+919876543210');
  check('2.3 Telugu "వద్దు" stores opt-out', !!teOptOut);

  // 2.4 Hindi opt-out: "मैसेज बंद करो"
  mockDb.reset();
  mockDb.tables.business_workspaces.push({
    id: 'ws_kirana',
    owner_user_id: 'owner_user_99',
    name: 'Kirana Store',
    phone: '+911122334455'
  });
  const hiParams = {
    From: 'whatsapp:+919876543210',
    To: 'whatsapp:+911122334455',
    Body: 'मैसेज बंद करो',
    MessageSid: 'SM_HI_1'
  };
  const hiSig = makeTwilioSignature('https://quietkeep.com/api/whatsapp/webhook', hiParams, process.env.TWILIO_AUTH_TOKEN);
  const hiReq = new Request('http://localhost/api/whatsapp/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'x-twilio-signature': hiSig },
    body: new URLSearchParams(hiParams).toString()
  });
  await twilioWebhookRoute(hiReq);
  const hiOptOut = mockDb.tables.business_customer_opt_outs.find(r => r.phone === '+919876543210');
  check('2.4 Hindi "मैसेज बंद करो" stores opt-out', !!hiOptOut);

  // 2.5 Negative opt-out (Item E): "ఉల్లిపాయ వద్దు" -> NOT opt-out!
  mockDb.reset();
  mockDb.tables.business_workspaces.push({
    id: 'ws_kirana',
    owner_user_id: 'owner_user_99',
    name: 'Kirana Store',
    phone: '+911122334455'
  });
  const neg1Params = {
    From: 'whatsapp:+919876543210',
    To: 'whatsapp:+911122334455',
    Body: 'ఉల్లిపాయ వద్దు',
    MessageSid: 'SM_NEG_1'
  };
  const neg1Sig = makeTwilioSignature('https://quietkeep.com/api/whatsapp/webhook', neg1Params, process.env.TWILIO_AUTH_TOKEN);
  const neg1Req = new Request('http://localhost/api/whatsapp/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'x-twilio-signature': neg1Sig },
    body: new URLSearchParams(neg1Params).toString()
  });
  await twilioWebhookRoute(neg1Req);
  check('2.5 "ఉల్లిపాయ వద్దు" does NOT record opt-out', mockDb.tables.business_customer_opt_outs.length === 0);

  // 2.6 Negative opt-out (Item E): "bus stop where?" -> NOT opt-out!
  mockDb.reset();
  mockDb.tables.business_workspaces.push({
    id: 'ws_kirana',
    owner_user_id: 'owner_user_99',
    name: 'Kirana Store',
    phone: '+911122334455'
  });
  const neg2Params = {
    From: 'whatsapp:+919876543210',
    To: 'whatsapp:+911122334455',
    Body: 'bus stop where?',
    MessageSid: 'SM_NEG_2'
  };
  const neg2Sig = makeTwilioSignature('https://quietkeep.com/api/whatsapp/webhook', neg2Params, process.env.TWILIO_AUTH_TOKEN);
  const neg2Req = new Request('http://localhost/api/whatsapp/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'x-twilio-signature': neg2Sig },
    body: new URLSearchParams(neg2Params).toString()
  });
  await twilioWebhookRoute(neg2Req);
  check('2.6 "bus stop where?" does NOT record opt-out', mockDb.tables.business_customer_opt_outs.length === 0);

  // 2.7 Negative opt-out (Item E): "cancel my order" -> NOT opt-out!
  mockDb.reset();
  mockDb.tables.business_workspaces.push({
    id: 'ws_kirana',
    owner_user_id: 'owner_user_99',
    name: 'Kirana Store',
    phone: '+911122334455'
  });
  const neg3Params = {
    From: 'whatsapp:+919876543210',
    To: 'whatsapp:+911122334455',
    Body: 'cancel my order',
    MessageSid: 'SM_NEG_3'
  };
  const neg3Sig = makeTwilioSignature('https://quietkeep.com/api/whatsapp/webhook', neg3Params, process.env.TWILIO_AUTH_TOKEN);
  const neg3Req = new Request('http://localhost/api/whatsapp/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'x-twilio-signature': neg3Sig },
    body: new URLSearchParams(neg3Params).toString()
  });
  await twilioWebhookRoute(neg3Req);
  check('2.7 "cancel my order" does NOT record opt-out', mockDb.tables.business_customer_opt_outs.length === 0);

  // 2.8 Customer inquiry queues for owner review in business_approvals
  mockDb.reset();
  mockDb.tables.business_workspaces.push({
    id: 'ws_kirana',
    owner_user_id: 'owner_user_99',
    name: 'Kirana Store',
    phone: '+911122334455'
  });
  const inqParams = {
    From: 'whatsapp:+919876543210',
    To: 'whatsapp:+911122334455',
    Body: 'Can you deliver 10kg sugar to Gandhi Nagar?',
    MessageSid: 'SM_INQ_1'
  };
  const inqSig = makeTwilioSignature('https://quietkeep.com/api/whatsapp/webhook', inqParams, process.env.TWILIO_AUTH_TOKEN);
  const inqReq = new Request('http://localhost/api/whatsapp/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'x-twilio-signature': inqSig },
    body: new URLSearchParams(inqParams).toString()
  });
  await twilioWebhookRoute(inqReq);
  const queuedApp = mockDb.tables.business_approvals.find(r => r.workspace_id === 'ws_kirana');
  check('2.8 Inbound inquiry queued in business_approvals for owner review', queuedApp && queuedApp.action_type === 'customer_reply');
}

// ── 3. ROUTE /api/whatsapp/meta-webhook (Meta) (Items C, K) ───────────────────
console.log('\n--- 3. Testing POST /api/whatsapp/meta-webhook (Meta) ---');
{
  // 3.1 Resolves receiving workspace by display_phone_number and stores opt-out
  mockDb.reset();
  mockDb.tables.business_workspaces.push({
    id: 'ws_meta',
    owner_user_id: 'owner_meta',
    name: 'Meta Shop',
    phone: '+919911223344'
  });

  const metaPayload = {
    entry: [{
      changes: [{
        value: {
          metadata: { display_phone_number: '919911223344', phone_number_id: 'meta_num_1' },
          messages: [{
            id: 'wamid.HBg1',
            from: '919876543210',
            type: 'text',
            text: { body: 'UNSUBSCRIBE' }
          }]
        }
      }]
    }]
  };

  const metaRaw1 = JSON.stringify(metaPayload);
  const metaReq = new Request('http://localhost/api/whatsapp/meta-webhook', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-hub-signature-256': makeMetaSignature(metaRaw1)
    },
    body: metaRaw1
  });
  const metaRes = await metaWebhookRoute(metaReq);
  check('3.1 Meta webhook returns 200 OK', metaRes.status === 200);
  const metaOptOut = mockDb.tables.business_customer_opt_outs.find(r => r.workspace_id === 'ws_meta');
  check('3.1 Meta opt-out stored with receiving workspace and normalized phone', metaOptOut && metaOptOut.phone === '+919876543210');

  // 3.2 Interactive button click approve_<id> sends message to customer and approves (Round 4 Item 5: distinct owner and business phone)
  mockDb.reset();
  mockDb.tables.business_workspaces.push({
    id: 'ws_meta',
    owner_user_id: 'owner_meta',
    name: 'Meta Shop',
    phone: '+919911223344' // Business receiving number
  });
  mockDb.tables.whatsapp_sessions.push({
    user_id: 'owner_meta',
    phone_number: '+919870001111' // Distinct owner mobile number
  });
  mockDb.tables.business_approvals.push({
    id: 'app_meta_1',
    workspace_id: 'ws_meta',
    action_type: 'customer_reply',
    status: 'pending',
    payload: {
      customer_phone: '+919876543210',
      suggested_reply: 'Yes, your order is confirmed!'
    }
  });

  mockFetchCalls.length = 0;
  const btnPayload = {
    entry: [{
      changes: [{
        value: {
          metadata: { display_phone_number: '919911223344' }, // Business receiving number
          messages: [{
            id: 'wamid.HBg2',
            from: '919870001111', // Owner tapping from their personal phone
            type: 'interactive',
            interactive: {
              type: 'button_reply',
              button_reply: { id: 'approve_app_meta_1', title: 'Send Reply' }
            }
          }]
        }
      }]
    }]
  };

  const btnRaw2 = JSON.stringify(btnPayload);
  const btnReq = new Request('http://localhost/api/whatsapp/meta-webhook', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-hub-signature-256': makeMetaSignature(btnRaw2)
    },
    body: btnRaw2
  });
  const btnRes = await metaWebhookRoute(btnReq);
  check('3.2 Interactive approve button returns 200', btnRes.status === 200);
  const updatedMetaApp = mockDb.tables.business_approvals.find(r => r.id === 'app_meta_1');
  check('3.2 Interactive approve sets status to approved', updatedMetaApp && updatedMetaApp.status === 'approved');
  check('3.2 Outbound customer message was sent via API', mockFetchCalls.length > 0);

  // 3.3 Rejects request when META_WHATSAPP_APP_SECRET is unset (Item 8)
  const savedSecret = process.env.META_WHATSAPP_APP_SECRET;
  delete process.env.META_WHATSAPP_APP_SECRET;
  const unsetReq = new Request('http://localhost/api/whatsapp/meta-webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: metaRaw1
  });
  const unsetRes = await metaWebhookRoute(unsetReq);
  check('3.3 Unset META_WHATSAPP_APP_SECRET returns 403', unsetRes.status === 403);
  process.env.META_WHATSAPP_APP_SECRET = savedSecret;

  // 3.4 Interactive button click from non-owner phone is rejected (Item 8 & Round 4 Item 5)
  mockDb.reset();
  mockDb.tables.business_workspaces.push({
    id: 'ws_meta',
    owner_user_id: 'owner_meta',
    name: 'Meta Shop',
    phone: '+919911223344'
  });
  mockDb.tables.whatsapp_sessions.push({
    user_id: 'owner_meta',
    phone_number: '+919870001111'
  });
  mockDb.tables.business_approvals.push({
    id: 'app_meta_imposter',
    workspace_id: 'ws_meta',
    action_type: 'customer_reply',
    status: 'pending',
    payload: { customer_phone: '+919876543210', suggested_reply: 'Secret promo' }
  });
  const imposterBtnPayload = {
    entry: [{
      changes: [{
        value: {
          metadata: { display_phone_number: '919911223344' },
          messages: [{
            id: 'wamid.HBgImposter',
            from: '918888888888', // Not the owner phone
            type: 'interactive',
            interactive: {
              type: 'button_reply',
              button_reply: { id: 'approve_app_meta_imposter', title: 'Send Reply' }
            }
          }]
        }
      }]
    }]
  };
  const imposterRaw = JSON.stringify(imposterBtnPayload);
  const imposterReq = new Request('http://localhost/api/whatsapp/meta-webhook', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-hub-signature-256': makeMetaSignature(imposterRaw)
    },
    body: imposterRaw
  });
  await metaWebhookRoute(imposterReq);
  const imposterApp = mockDb.tables.business_approvals.find(r => r.id === 'app_meta_imposter');
  check('3.4 Non-owner interactive button click stays pending (not approved)', imposterApp && imposterApp.status === 'pending');

  // 3.5 Double send / Meta retry prevention on interactive approve (Round 4 Item 3)
  mockDb.reset();
  mockDb.tables.business_workspaces.push({
    id: 'ws_meta',
    owner_user_id: 'owner_meta',
    name: 'Meta Shop',
    phone: '+919911223344'
  });
  mockDb.tables.whatsapp_sessions.push({
    user_id: 'owner_meta',
    phone_number: '+919870001111'
  });
  mockDb.tables.business_approvals.push({
    id: 'app_meta_dup',
    workspace_id: 'ws_meta',
    action_type: 'customer_reply',
    status: 'pending',
    payload: {
      customer_phone: '+919876543210',
      suggested_reply: 'Confirmed order once!'
    }
  });
  mockFetchCalls.length = 0;
  const dupPayload = {
    entry: [{
      changes: [{
        value: {
          metadata: { display_phone_number: '919911223344' },
          messages: [{
            id: 'wamid.HBgDup1',
            from: '919870001111',
            type: 'interactive',
            interactive: {
              type: 'button_reply',
              button_reply: { id: 'approve_app_meta_dup', title: 'Send Reply' }
            }
          }]
        }
      }]
    }]
  };
  const dupRaw = JSON.stringify(dupPayload);
  const dupReq1 = new Request('http://localhost/api/whatsapp/meta-webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-hub-signature-256': makeMetaSignature(dupRaw) },
    body: dupRaw
  });
  await metaWebhookRoute(dupReq1);
  const fetchCountAfterFirst = mockFetchCalls.length;
  check('3.5 First Meta approve sends 1 message to customer', fetchCountAfterFirst === 1);

  // Send the EXACT SAME request a second time (simulating Meta retry or duplicate owner tap)
  const dupReq2 = new Request('http://localhost/api/whatsapp/meta-webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-hub-signature-256': makeMetaSignature(dupRaw) },
    body: dupRaw
  });
  await metaWebhookRoute(dupReq2);
  check('3.5 Second duplicate Meta webhook does NOT send a second message', mockFetchCalls.length === 1);

  // 3.6 Refuse approve when there is no reply text -> sends notice to owner, stays pending (Round 4 Item 4)
  mockDb.reset();
  mockDb.tables.business_workspaces.push({
    id: 'ws_meta',
    owner_user_id: 'owner_meta',
    name: 'Meta Shop',
    phone: '+919911223344'
  });
  mockDb.tables.whatsapp_sessions.push({
    user_id: 'owner_meta',
    phone_number: '+919870001111'
  });
  mockDb.tables.business_approvals.push({
    id: 'app_meta_no_reply',
    workspace_id: 'ws_meta',
    action_type: 'customer_reply',
    status: 'pending',
    payload: {
      customer_phone: '+919876543210',
      suggested_reply: null // No reply text!
    }
  });
  mockFetchCalls.length = 0;
  const noReplyPayload = {
    entry: [{
      changes: [{
        value: {
          metadata: { display_phone_number: '919911223344' },
          messages: [{
            id: 'wamid.HBgNoReply',
            from: '919870001111',
            type: 'interactive',
            interactive: {
              type: 'button_reply',
              button_reply: { id: 'approve_app_meta_no_reply', title: 'Send Reply' }
            }
          }]
        }
      }]
    }]
  };
  const noReplyRaw = JSON.stringify(noReplyPayload);
  const noReplyReq = new Request('http://localhost/api/whatsapp/meta-webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-hub-signature-256': makeMetaSignature(noReplyRaw) },
    body: noReplyRaw
  });
  await metaWebhookRoute(noReplyReq);
  const noReplyApp = mockDb.tables.business_approvals.find(r => r.id === 'app_meta_no_reply');
  check('3.6 Approve with no reply text leaves status pending', noReplyApp && noReplyApp.status === 'pending');
  // Verify owner was sent the notification that reply text is needed
  const ownerNoticeSent = mockFetchCalls.some(c => c.options?.body?.includes('no+reply+text') || c.options?.body?.includes('no reply text'));
  check('3.6 Refusal sends notice to owner that reply text is needed', ownerNoticeSent);

  // 3.7 Owner verification succeeds via user_settings when whatsapp_sessions is missing (Round 4 Item 5)
  mockDb.reset();
  mockDb.tables.business_workspaces.push({
    id: 'ws_meta',
    owner_user_id: 'owner_user_settings_only',
    name: 'Meta Shop',
    phone: '+919911223344'
  });
  mockDb.tables.user_settings.push({
    user_id: 'owner_user_settings_only',
    phone: '+919870003333'
  });
  mockDb.tables.business_approvals.push({
    id: 'app_meta_settings',
    workspace_id: 'ws_meta',
    action_type: 'customer_reply',
    status: 'pending',
    payload: {
      customer_phone: '+919876543210',
      suggested_reply: 'Hello from user_settings owner!'
    }
  });
  mockFetchCalls.length = 0;
  const settPayload = {
    entry: [{
      changes: [{
        value: {
          metadata: { display_phone_number: '919911223344' },
          messages: [{
            id: 'wamid.HBgSett',
            from: '919870003333',
            type: 'interactive',
            interactive: {
              type: 'button_reply',
              button_reply: { id: 'approve_app_meta_settings', title: 'Send Reply' }
            }
          }]
        }
      }]
    }]
  };
  const settRaw = JSON.stringify(settPayload);
  const settReq = new Request('http://localhost/api/whatsapp/meta-webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-hub-signature-256': makeMetaSignature(settRaw) },
    body: settRaw
  });
  await metaWebhookRoute(settReq);
  const settApp = mockDb.tables.business_approvals.find(r => r.id === 'app_meta_settings');
  check('3.7 Owner verified via user_settings.phone succeeds and approves', settApp && settApp.status === 'approved');
}

// ── 4. ROUTE /api/business/approvals (Item K) ─────────────────────────────────
console.log('\n--- 4. Testing /api/business/approvals (Send/Edit/Ignore) ---');
{
  // 4.1 GET returns pending approvals for workspace member
  mockDb.reset();
  mockDb.tables.business_workspaces.push({
    id: 'ws_app',
    owner_user_id: 'u1',
    name: 'Approval Shop'
  });
  mockDb.tables.business_approvals.push({
    id: 'app_1',
    workspace_id: 'ws_app',
    action_type: 'customer_reply',
    status: 'pending',
    payload: { customer_phone: '+919876543210', suggested_reply: 'Ready for pickup.' },
    created_at: new Date().toISOString()
  });

  const getReq = new Request('http://localhost/api/business/approvals', {
    headers: {
      'Authorization': 'Bearer test_jwt_token',
      'X-Workspace-Id': 'ws_app'
    }
  });
  const getRes = await approvalsGet(getReq);
  const getData = await getRes.json();
  check('4.1 GET approvals returns pending list', getRes.status === 200 && getData.approvals.length === 1);

  // 4.2 POST action: 'send' executes approval and sends via Twilio
  mockFetchCalls.length = 0;
  const sendReq = new Request('http://localhost/api/business/approvals', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer test_jwt_token',
      'X-Workspace-Id': 'ws_app'
    },
    body: JSON.stringify({ approval_id: 'app_1', action: 'send' })
  });
  const sendRes = await approvalsPost(sendReq);
  const sendData = await sendRes.json();
  check('4.2 POST Send returns success', sendRes.status === 200 && sendData.ok === true);
  const appAfterSend = mockDb.tables.business_approvals.find(r => r.id === 'app_1');
  check('4.2 Approval marked approved after Send', appAfterSend && appAfterSend.status === 'approved');
  check('4.2 Outbound WhatsApp message sent to customer', mockFetchCalls.length === 1);

  // 4.3 POST action: 'ignore' rejects approval and does NOT send message
  mockDb.reset();
  mockDb.tables.business_workspaces.push({
    id: 'ws_app',
    owner_user_id: 'u1',
    name: 'Approval Shop'
  });
  mockDb.tables.business_approvals.push({
    id: 'app_2',
    workspace_id: 'ws_app',
    action_type: 'customer_reply',
    status: 'pending',
    payload: { customer_phone: '+919876543210', suggested_reply: 'Spam answer' },
    created_at: new Date().toISOString()
  });

  mockFetchCalls.length = 0;
  const ignoreReq = new Request('http://localhost/api/business/approvals', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer test_jwt_token',
      'X-Workspace-Id': 'ws_app'
    },
    body: JSON.stringify({ approval_id: 'app_2', action: 'ignore' })
  });
  const ignoreRes = await approvalsPost(ignoreReq);
  check('4.3 POST Ignore returns success', ignoreRes.status === 200);
  const appAfterIgnore = mockDb.tables.business_approvals.find(r => r.id === 'app_2');
  check('4.3 Approval marked rejected after Ignore', appAfterIgnore && appAfterIgnore.status === 'rejected');
  check('4.3 Twilio was NOT called on Ignore', mockFetchCalls.length === 0);

  // 4.4 POST action: 'edit' sends edited message to customer
  mockDb.reset();
  mockDb.tables.business_workspaces.push({
    id: 'ws_app',
    owner_user_id: 'u1',
    name: 'Approval Shop'
  });
  mockDb.tables.business_approvals.push({
    id: 'app_3',
    workspace_id: 'ws_app',
    action_type: 'customer_reply',
    status: 'pending',
    payload: { customer_phone: '+919876543210', suggested_reply: 'Original draft' },
    created_at: new Date().toISOString()
  });

  mockFetchCalls.length = 0;
  const editReq = new Request('http://localhost/api/business/approvals', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer test_jwt_token',
      'X-Workspace-Id': 'ws_app'
    },
    body: JSON.stringify({
      approval_id: 'app_3',
      action: 'edit',
      edited_message: 'Customized message for customer.'
    })
  });
  const editRes = await approvalsPost(editReq);
  check('4.4 POST Edit returns success', editRes.status === 200);
  const appAfterEdit = mockDb.tables.business_approvals.find(r => r.id === 'app_3');
  check('4.4 Approval marked approved with edit', appAfterEdit && appAfterEdit.status === 'approved');
  check('4.4 Outbound WhatsApp sent with edited text', mockFetchCalls.length === 1);

  // 4.5 Send with null reply -> refused with 400 (Item 4)
  mockDb.reset();
  mockDb.tables.business_workspaces.push({
    id: 'ws_app',
    owner_user_id: 'u1',
    name: 'Approval Shop'
  });
  mockDb.tables.business_approvals.push({
    id: 'app_null_reply',
    workspace_id: 'ws_app',
    action_type: 'customer_reply',
    status: 'pending',
    payload: { customer_phone: '+919876543210', suggested_reply: null },
    created_at: new Date().toISOString()
  });
  const nullReplyReq = new Request('http://localhost/api/business/approvals', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer test_jwt_token',
      'X-Workspace-Id': 'ws_app'
    },
    body: JSON.stringify({ approval_id: 'app_null_reply', action: 'send' })
  });
  const nullReplyRes = await approvalsPost(nullReplyReq);
  const nullReplyData = await nullReplyRes.json();
  check('4.5 Send with null reply refused with 400 missing_reply_text', nullReplyRes.status === 400 && nullReplyData.code === 'missing_reply_text');
  const nullApp = mockDb.tables.business_approvals.find(r => r.id === 'app_null_reply');
  check('4.5 Approval stays pending when send refused', nullApp && nullApp.status === 'pending');

  // 4.6 Failed Twilio send keeps status pending and returns error (Item 4)
  mockDb.reset();
  mockDb.tables.business_workspaces.push({
    id: 'ws_app',
    owner_user_id: 'u1',
    name: 'Approval Shop'
  });
  mockDb.tables.business_approvals.push({
    id: 'app_fail_send',
    workspace_id: 'ws_app',
    action_type: 'customer_reply',
    status: 'pending',
    payload: { customer_phone: '+919876543210', suggested_reply: 'Will fail to deliver' },
    created_at: new Date().toISOString()
  });
  mockTwilioFail = true;
  const failSendReq = new Request('http://localhost/api/business/approvals', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer test_jwt_token',
      'X-Workspace-Id': 'ws_app'
    },
    body: JSON.stringify({ approval_id: 'app_fail_send', action: 'send' })
  });
  const failSendRes = await approvalsPost(failSendReq);
  const failSendData = await failSendRes.json();
  mockTwilioFail = false;
  check('4.6 Failed Twilio send returns 502 send_failed', failSendRes.status === 502 && failSendData.code === 'send_failed');
  const failedApp = mockDb.tables.business_approvals.find(r => r.id === 'app_fail_send');
  check('4.6 Approval remains pending when send fails', failedApp && failedApp.status === 'pending');

  // 4.7 Double send prevention: second call returns 409 and does not call Twilio again (Round 4 Item 3)
  mockDb.reset();
  mockDb.tables.business_workspaces.push({
    id: 'ws_app',
    owner_user_id: 'u1',
    name: 'Approval Shop'
  });
  mockDb.tables.business_approvals.push({
    id: 'app_double_1',
    workspace_id: 'ws_app',
    action_type: 'customer_reply',
    status: 'pending',
    payload: { customer_phone: '+919876543210', suggested_reply: 'Send once only!' },
    created_at: new Date().toISOString()
  });

  mockFetchCalls.length = 0;
  const firstReq = new Request('http://localhost/api/business/approvals', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer test_jwt_token',
      'X-Workspace-Id': 'ws_app'
    },
    body: JSON.stringify({ approval_id: 'app_double_1', action: 'send' })
  });
  const firstRes = await approvalsPost(firstReq);
  check('4.7 First approve returns 200', firstRes.status === 200);
  check('4.7 Twilio called exactly once on first send', mockFetchCalls.length === 1);

  // Second duplicate request for same approval_id
  const secondReq = new Request('http://localhost/api/business/approvals', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer test_jwt_token',
      'X-Workspace-Id': 'ws_app'
    },
    body: JSON.stringify({ approval_id: 'app_double_1', action: 'send' })
  });
  const secondRes = await approvalsPost(secondReq);
  const secondData = await secondRes.json();
  check('4.7 Second duplicate approve returns 409 already_processed', secondRes.status === 409 && secondData.code === 'already_processed');
  check('4.7 Twilio NOT called again on duplicate approve', mockFetchCalls.length === 1);
}

// ── 5. ROUTE /api/business/dunning (Item G) ───────────────────────────────────
console.log('\n--- 5. Testing POST /api/business/dunning (Shared caps & window) ---');
{
  // 5.1 Unauthorized caller rejected with 401 when missing auth header
  mockDb.reset();
  mockDb.tables.business_workspaces.push({
    id: 'ws_dun',
    owner_user_id: 'stranger_user',
    name: 'Dunning Shop'
  });
  const unauthReq = new Request('http://localhost/api/business/dunning', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspace_id: 'ws_dun' })
  });
  const unauthRes = await dunningRoute(unauthReq);
  check('5.1 Unauthenticated caller rejected with 401', unauthRes.status === 401);

  // 5.2 Opted-out customer is skipped by dunning
  mockDb.reset();
  mockDb.tables.business_workspaces.push({
    id: 'ws_dun',
    owner_user_id: 'u1',
    name: 'Dunning Shop'
  });
  mockDb.tables.business_customers.push({
    id: 'c_opted_out',
    workspace_id: 'ws_dun',
    phone: '+919876543210',
    name: 'Sharma Ji',
    outstanding_balance: 5000,
    whatsapp_opted_in: false
  });
  mockDb.tables.business_customer_opt_outs.push({
    workspace_id: 'ws_dun',
    phone: '+919876543210'
  });
  mockDb.tables.business_ledger.push({
    id: 'led_opted',
    workspace_id: 'ws_dun',
    party_name: 'Sharma Ji',
    amount: 5000,
    amount_pending: 5000,
    due_date: '2026-10-01',
    payment_status: 'pending'
  });

  const optOutReq = new Request('http://localhost/api/business/dunning', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer test_jwt_token',
      'X-Workspace-Id': 'ws_dun'
    },
    body: JSON.stringify({ workspace_id: 'ws_dun' })
  });
  const optOutRes = await dunningRoute(optOutReq);
  const optOutData = await optOutRes.json();
  check('5.2 Opted out customer is skipped (sent: 0, skipped: 1)', optOutRes.status === 200 && optOutData.sent === 0 && optOutData.skipped === 1);

  // 5.3 Enforces daily cap (1 reminder / 24h per customer)
  mockDb.reset();
  mockDb.tables.business_workspaces.push({
    id: 'ws_dun',
    owner_user_id: 'u1',
    name: 'Dunning Shop'
  });
  mockDb.tables.business_customers.push({
    id: 'c_capped',
    workspace_id: 'ws_dun',
    phone: '+919876543210',
    name: 'Ramesh',
    outstanding_balance: 3000,
    whatsapp_opted_in: true
  });
  mockDb.tables.business_ledger.push({
    id: 'led_capped',
    workspace_id: 'ws_dun',
    party_name: 'Ramesh',
    amount: 3000,
    amount_pending: 3000,
    due_date: '2026-10-01',
    payment_status: 'pending'
  });
  // Recent promo sent today
  const todayStr = new Date().toISOString();
  mockDb.tables.business_promo_log.push({
    id: 'p_recent_1',
    workspace_id: 'ws_dun',
    phone: '+919876543210',
    message_type: 'promotional',
    status: 'sent',
    sent_at: todayStr
  });

  const capReq = new Request('http://localhost/api/business/dunning', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer test_jwt_token',
      'X-Workspace-Id': 'ws_dun'
    },
    body: JSON.stringify({ workspace_id: 'ws_dun' })
  });
  const capRes = await dunningRoute(capReq);
  const capData = await capRes.json();
  check('5.3 Daily reminder cap skips sending (sent: 0)', capRes.status === 200 && capData.sent === 0);
  check('5.3 Results report daily cap skipped status', capData.results[0] && capData.results[0].status === 'skipped');

  // 5.4 Valid dunning request sends message and inserts in both business_promo_log and business_dunning_log
  mockDb.reset();
  mockDb.tables.business_workspaces.push({
    id: 'ws_dun',
    owner_user_id: 'u1',
    name: 'Dunning Shop'
  });
  mockDb.tables.business_customers.push({
    id: 'c_ok',
    workspace_id: 'ws_dun',
    phone: '9876543210', // raw 10 digits
    name: 'Suresh',
    outstanding_balance: 2500,
    whatsapp_opted_in: true
  });
  mockDb.tables.business_ledger.push({
    id: 'led_ok_1',
    workspace_id: 'ws_dun',
    party_name: 'Suresh',
    amount: 2500,
    amount_pending: 2500,
    due_date: '2026-10-01',
    payment_status: 'pending'
  });

  mockFetchCalls.length = 0;
  const okReq = new Request('http://localhost/api/business/dunning', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer test_jwt_token',
      'X-Workspace-Id': 'ws_dun'
    },
    body: JSON.stringify({ workspace_id: 'ws_dun' })
  });
  const okRes = await dunningRoute(okReq);
  const okData = await okRes.json();
  check('5.4 Successful dunning request returns 200', okRes.status === 200 && okData.sent === 1);
  const dunPromoLog = mockDb.tables.business_promo_log.find(r => r.workspace_id === 'ws_dun');
  check('5.4 Promo log recorded with normalized phone', dunPromoLog && dunPromoLog.phone === '+919876543210');
  const dunLog = mockDb.tables.business_dunning_log.find(r => r.workspace_id === 'ws_dun');
  check('5.4 Dunning log recorded with amount and status sent', dunLog && dunLog.status === 'sent' && dunLog.amount === 2500);
  const twilioSent = mockFetchCalls.some(c => c.url.includes('api.twilio.com'));
  check('5.4 Outbound WhatsApp sent to customer', twilioSent);

  // 5.5 Fail closed: DB error during opt-out check in dunning returns 500 (Round 4 Item 1)
  mockDb.reset();
  mockDb.tables.business_workspaces.push({
    id: 'ws_dun',
    owner_user_id: 'u1',
    name: 'Dunning Shop'
  });
  mockDb.tables.business_customers.push({
    id: 'c_err',
    workspace_id: 'ws_dun',
    phone: '9876543210',
    name: 'Ramesh',
    outstanding_balance: 3000,
    whatsapp_opted_in: true
  });
  mockDb.tables.business_ledger.push({
    id: 'led_err_1',
    workspace_id: 'ws_dun',
    party_name: 'Ramesh',
    amount: 3000,
    amount_pending: 3000,
    due_date: '2026-10-01',
    payment_status: 'pending'
  });
  mockDb.failQueries.add('business_customer_opt_outs');
  const dunErrReq = new Request('http://localhost/api/business/dunning', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer test_jwt_token',
      'X-Workspace-Id': 'ws_dun'
    },
    body: JSON.stringify({ workspace_id: 'ws_dun' })
  });
  const dunErrRes = await dunningRoute(dunErrReq);
  mockDb.failQueries.clear();
  check('5.5 Dunning opt-out DB error fails closed with 500', dunErrRes.status === 500);
}

console.log(`\n========================================`);
console.log(`ROUTE TESTS COMPLETED: ${pass} passed, ${fail} failed.`);
console.log(`========================================\n`);

if (fail > 0) process.exit(1);