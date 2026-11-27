// tests/cart2save-feed.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
// Tests for QuietKeep Business: shop pin, "Show on Cart2Save", send changes (AG-1 + AG-3)
// ─────────────────────────────────────────────────────────────────────────────
import assert from 'node:assert/strict';
import test from 'node:test';
import crypto from 'node:crypto';

import {
  calculateAvailabilityLabel,
  isAccuracyScoreLow,
  isShopOpen,
  CART2SAVE_AVAILABILITY_LABELS,
} from '../src/lib/cart2save/availability.js';
import { readFileSync } from 'node:fs';

import {
  buildShopPayload,
  buildItemPayload,
  buildUnpublishItemPayload,
  assertNoPrivateFields,
  sanitizePayload,
  FORBIDDEN_FIELD_PATTERNS,
} from '../src/lib/cart2save/payload.js';

import {
  writeOutboxRow,
  handleWorkspaceChange,
  handleItemChange,
  enqueueAllPublicItems,
  enqueueNightlyFullResend,
} from '../src/lib/cart2save/outbox.js';

import {
  computeHmacSignature,
  calculateBackoffMs,
  processFeedOutboxBatch,
  groupRowsByShop,
  isFeedEnabled,
  MAX_RETRY_ATTEMPTS,
  BASE_BACKOFF_MS,
} from '../src/lib/cart2save/feed-sender.js';

// ─────────────────────────────────────────────────────────────────────────────
// 1. Tests: Private fields never in the payload (AG-1 / AG-3 Requirement 3)
// ─────────────────────────────────────────────────────────────────────────────
test('1.1 Item payload contains only public fields and never private/cost/supplier/batch data', () => {
  const dirtyItem = {
    id: 'item_123',
    workspace_id: 'ws_abc',
    name: 'Sona Masoori Rice 25kg',
    barcode: '8901234567890',
    unit: 'bag',
    selling_price: 1450,
    current_stock: 10,
    // SENSITIVE FIELDS: Must NEVER be leaked
    purchase_price: 1200,
    cost_price: 1180,
    supplier_name: 'Sri Lakshmi Wholesalers',
    supplier_phone: '+91 98765 43210',
    batch_number: 'BTH-2026-X1',
    profit: 250,
    margin: 0.17,
    customer_phone: '+91 91111 22222',
    customer_name: 'John Doe',
    min_stock_alert: 3,
    gstin: '36AAAAA0000A1Z5',
    created_by: 'user_xyz',
    updated_at: '2026-11-24T10:00:00.000Z',
  };

  const payload = buildItemPayload(dirtyItem, { hours: { open: '00:00', close: '23:59' } }, new Date('2026-11-24T10:30:00.000Z'));

  // Assert allowed fields are present and correct
  assert.equal(payload.item_name, 'Sona Masoori Rice 25kg');
  assert.equal(payload.barcode, '8901234567890');
  assert.equal(payload.unit, 'bag');
  assert.equal(payload.selling_price, 1450);
  assert.equal(payload.availability_label, 'in_stock');
  // 27 Nov 2026: the freshness time is when the availability word was worked out (now),
  // not when the owner last edited the item.
  assert.equal(payload.updated_time, '2026-11-24T10:30:00.000Z');

  // Assert sensitive fields are completely absent
  assert.equal(payload.purchase_price, undefined);
  assert.equal(payload.cost_price, undefined);
  assert.equal(payload.supplier_name, undefined);
  assert.equal(payload.supplier_phone, undefined);
  assert.equal(payload.batch_number, undefined);
  assert.equal(payload.profit, undefined);
  assert.equal(payload.margin, undefined);
  assert.equal(payload.customer_phone, undefined);
  assert.equal(payload.customer_name, undefined);
  assert.equal(payload.min_stock_alert, undefined);
  assert.equal(payload.current_stock, undefined);
  assert.equal(payload.gstin, undefined);
  assert.equal(payload.workspace_id, undefined);

  // Exact keys check: payload has exactly 6 public keys
  const keys = Object.keys(payload).sort();
  assert.deepEqual(keys, [
    'availability_label',
    'barcode',
    'item_name',
    'selling_price',
    'unit',
    'updated_time',
  ]);
});

test('1.2 Shop payload contains only allowed shop metadata and never user/financial/billing data', () => {
  const dirtyShop = {
    id: 'ws_789',
    owner_user_id: 'user_secret_owner',
    name: 'Balaji Supermarket',
    category: 'grocery',
    business_type: 'retail',
    lat: 17.4435,
    lng: 78.3842,
    address: 'Plot 12, Kondapur Main Rd, Hyderabad',
    phone: '+91 98765 00000',
    hours: { open: '08:00', close: '22:00' },
    upi_id: 'balaji@okhdfcbank',
    // SENSITIVE/INTERNAL FIELDS: Must NEVER be leaked
    plan: 'enterprise',
    tier: 'pro_monthly',
    gstin: '36ABCDE1234F1Z5',
    razorpay_account_id: 'acc_rzp_1234',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-11-24T00:00:00Z',
  };

  const payload = buildShopPayload(dirtyShop);

  assert.equal(payload.shop_name, 'Balaji Supermarket');
  assert.equal(payload.category, 'grocery');
  assert.equal(payload.lat, 17.4435);
  assert.equal(payload.lng, 78.3842);
  assert.equal(payload.address, 'Plot 12, Kondapur Main Rd, Hyderabad');
  assert.equal(payload.phone, '+91 98765 00000');
  assert.deepEqual(payload.hours, { open: '08:00', close: '22:00' });
  assert.equal(payload.upi_id, 'balaji@okhdfcbank');

  // Assert sensitive fields are absent
  assert.equal(payload.owner_user_id, undefined);
  assert.equal(payload.plan, undefined);
  assert.equal(payload.tier, undefined);
  assert.equal(payload.gstin, undefined);
  assert.equal(payload.razorpay_account_id, undefined);
});

test('1.3 assertNoPrivateFields throws if any forbidden field is injected', () => {
  assert.doesNotThrow(() => {
    assertNoPrivateFields({ item_name: 'Soap', selling_price: 45 });
  });

  for (const forbidden of ['purchase_price', 'cost_price', 'supplier_name', 'batch_number', 'profit', 'customer_phone']) {
    assert.throws(
      () => assertNoPrivateFields({ item_name: 'Test', [forbidden]: 'leaked' }),
      /SECURITY VIOLATION/,
      `Expected error when payload contains ${forbidden}`
    );
  }
});

test('1.4 sanitizePayload strips all forbidden keys as defense-in-depth', () => {
  const dirty = {
    item_name: 'Milk',
    cost_price: 28,
    selling_price: 32,
    batch_number: 'B12',
    supplier_phone: '1234',
  };
  const clean = sanitizePayload(dirty);
  assert.equal(clean.item_name, 'Milk');
  assert.equal(clean.selling_price, 32);
  assert.equal(clean.cost_price, undefined);
  assert.equal(clean.batch_number, undefined);
  assert.equal(clean.supplier_phone, undefined);
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Tests: Switch off sends unpublish (AG-1 / AG-3 Requirement 2 & 5)
// ─────────────────────────────────────────────────────────────────────────────
test('2.1 Switching shop show_on_cart2save from ON to OFF enqueues shop unpublish', async () => {
  const outboxWrites = [];
  const mockDb = {
    from: (table) => {
      assert.equal(table, 'cart2save_outbox');
      return {
        insert: (row) => {
          outboxWrites.push(row);
          return { select: () => ({ single: () => ({ data: { id: 'out_1', ...row }, error: null }) }) };
        },
      };
    },
  };

  const prevWs = { id: 'ws_1', show_on_cart2save: true, name: 'Kirana' };
  const currentWs = { id: 'ws_1', show_on_cart2save: false, name: 'Kirana' };

  await handleWorkspaceChange(mockDb, 'ws_1', prevWs, currentWs);

  assert.equal(outboxWrites.length, 1);
  const outbox = outboxWrites[0];
  assert.equal(outbox.workspace_id, 'ws_1');
  assert.equal(outbox.entity_type, 'shop');
  assert.equal(outbox.entity_id, 'ws_1');
  assert.equal(outbox.action, 'unpublish');
  assert.equal(outbox.payload.unpublish, true);
  assert.equal(outbox.payload.shop_id, 'ws_1');
  assert.equal(outbox.status, 'pending');
});

test('2.2 Switching an item from public to private enqueues item unpublish', async () => {
  const outboxWrites = [];
  const mockDb = {
    from: (table) => {
      assert.equal(table, 'cart2save_outbox');
      return {
        insert: (row) => {
          outboxWrites.push(row);
          return { select: () => ({ single: () => ({ data: { id: 'out_2', ...row }, error: null }) }) };
        },
      };
    },
  };

  const prevItem = { id: 'item_1', workspace_id: 'ws_1', is_public: true, name: 'Apples', barcode: '8901234567890', unit: 'kg', selling_price: 120 };
  const currentItem = { id: 'item_1', workspace_id: 'ws_1', is_public: false, name: 'Apples', barcode: '8901234567890', unit: 'kg', selling_price: 120 };

  await handleItemChange(mockDb, currentItem, prevItem);

  assert.equal(outboxWrites.length, 1);
  const outbox = outboxWrites[0];
  assert.equal(outbox.workspace_id, 'ws_1');
  assert.equal(outbox.entity_type, 'item');
  assert.equal(outbox.entity_id, 'item_1');
  assert.equal(outbox.action, 'unpublish');
  assert.equal(outbox.payload.unpublish, true);
  assert.equal(outbox.payload.item_id, 'item_1');
  assert.equal(outbox.payload.item_name, 'Apples');
  assert.equal(outbox.payload.barcode, '8901234567890');
  assert.equal(outbox.payload.unit, 'kg');
  assert.equal(outbox.payload.selling_price, 120);
});

test('2.3 Deleting an item marked public enqueues item unpublish with item name and identifying fields', async () => {
  const outboxWrites = [];
  const mockDb = {
    from: (table) => {
      return {
        insert: (row) => {
          outboxWrites.push(row);
          return { select: () => ({ single: () => ({ data: { id: 'out_3', ...row }, error: null }) }) };
        },
      };
    },
  };

  const prevItem = { id: 'item_del', workspace_id: 'ws_1', is_public: true, name: 'Sugar', barcode: '8901111111111', unit: 'kg', selling_price: 45 };
  const deletedItem = { id: 'item_del', workspace_id: 'ws_1', deleted: true, is_public: false };

  await handleItemChange(mockDb, deletedItem, prevItem);

  assert.equal(outboxWrites.length, 1);
  const outbox = outboxWrites[0];
  assert.equal(outbox.action, 'unpublish');
  assert.equal(outbox.entity_id, 'item_del');
  assert.equal(outbox.payload.unpublish, true);
  assert.equal(outbox.payload.item_id, 'item_del');
  assert.equal(outbox.payload.item_name, 'Sugar');
  assert.equal(outbox.payload.barcode, '8901111111111');
  assert.equal(outbox.payload.unit, 'kg');
  assert.equal(outbox.payload.selling_price, 45);
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Tests: Availability label rules (AG-1 / AG-3 Requirement 4)
// ─────────────────────────────────────────────────────────────────────────────
test('3.1 Packaged items: in_stock if count > 3', () => {
  const shop = { hours: { open: '00:00', close: '23:59' }, accuracy_score: 100 };
  const now = new Date('2026-11-24T12:00:00Z');

  // count 4
  const item4 = { current_stock: 4, updated_at: '2026-11-24T11:30:00Z' };
  assert.equal(calculateAvailabilityLabel({ item: item4, shop, now }), 'in_stock');

  // count 10
  const item10 = { current_stock: 10, updated_at: '2026-11-24T11:50:00Z' };
  assert.equal(calculateAvailabilityLabel({ item: item10, shop, now }), 'in_stock');
});

test('3.2 Packaged items: few_left if count 1-3', () => {
  const shop = { hours: { open: '00:00', close: '23:59' }, accuracy_score: 100 };
  const now = new Date('2026-11-24T12:00:00Z');

  for (const count of [1, 2, 3]) {
    const item = { current_stock: count, updated_at: '2026-11-24T11:45:00Z' };
    assert.equal(
      calculateAvailabilityLabel({ item, shop, now }),
      'few_left',
      `Expected few_left for stock ${count}`
    );
  }
});

test('3.3 Packaged items: hidden if count 0', () => {
  const shop = { hours: { open: '00:00', close: '23:59' }, accuracy_score: 100 };
  const now = new Date('2026-11-24T12:00:00Z');

  const item0 = { current_stock: 0, updated_at: '2026-11-24T11:45:00Z' };
  assert.equal(calculateAvailabilityLabel({ item: item0, shop, now }), 'hidden');

  const itemNegative = { current_stock: -1, updated_at: '2026-11-24T11:45:00Z' };
  assert.equal(calculateAvailabilityLabel({ item: itemNegative, shop, now }), 'hidden');
});

test('3.4 Items marked "made on the spot": available_while_open during opening hours', () => {
  const shop = { hours: { open: '08:00', close: '22:00' }, accuracy_score: 100 };
  // 10:00 UTC = 15:30 IST (within 08:00 - 22:00 IST)
  const duringOpen = new Date('2026-11-24T10:00:00Z');

  const samosa = {
    name: 'Hot Samosa',
    is_made_on_spot: true,
    updated_at: '2026-11-24T09:30:00Z',
  };

  assert.equal(
    calculateAvailabilityLabel({ item: samosa, shop, now: duringOpen }),
    'available_while_open'
  );

  // Outside opening hours: 23:00 UTC = 04:30 IST (shop closed)
  const outsideOpen = new Date('2026-11-24T23:00:00Z');
  // 27 Nov 2026: never 'closed'. Cart2Save's product table refuses that word, and it works
  // out "open now" from the shop's hours itself.
  assert.equal(
    calculateAvailabilityLabel({ item: samosa, shop, now: outsideOpen }),
    'available_while_open'
  );
});

test('3.5 Any item with no recorded sale or update for 3 hours during opening hours: call_to_confirm', () => {
  const shop = { hours: { open: '00:00', close: '23:59' }, accuracy_score: 100 };
  const now = new Date('2026-11-24T15:00:00Z');

  // Last update was 3.5 hours ago (11:30)
  const stalePackaged = {
    current_stock: 10,
    updated_at: '2026-11-24T11:30:00Z',
  };
  assert.equal(
    calculateAvailabilityLabel({ item: stalePackaged, shop, now }),
    'call_to_confirm'
  );

  // Stale made on the spot item
  const staleSpot = {
    is_made_on_spot: true,
    updated_at: '2026-11-24T11:00:00Z',
  };
  assert.equal(
    calculateAvailabilityLabel({ item: staleSpot, shop, now }),
    'call_to_confirm'
  );

  // Fresh update 1 hour ago -> in_stock
  const freshPackaged = {
    current_stock: 10,
    updated_at: '2026-11-24T14:00:00Z',
  };
  assert.equal(
    calculateAvailabilityLabel({ item: freshPackaged, shop, now }),
    'in_stock'
  );
});

test('3.6 Shop accuracy score scale (0-100, default 100 matching PR #269): low score (< 70) triggers call_to_confirm', () => {
  const now = new Date('2026-11-24T12:00:00Z');
  const freshItem = { current_stock: 20, updated_at: '2026-11-24T11:50:00Z' };

  // Default accuracy score (100) -> good (in_stock)
  const defaultAccShop = {
    hours: { open: '00:00', close: '23:59' },
    accuracy_score: 100,
  };
  assert.equal(isAccuracyScoreLow(defaultAccShop.accuracy_score), false);
  assert.equal(
    calculateAvailabilityLabel({ item: freshItem, shop: defaultAccShop, now }),
    'in_stock'
  );

  // High accuracy score (85) -> good (in_stock)
  const goodAccShop = {
    hours: { open: '00:00', close: '23:59' },
    accuracy_score: 85,
  };
  assert.equal(isAccuracyScoreLow(goodAccShop.accuracy_score), false);
  assert.equal(
    calculateAvailabilityLabel({ item: freshItem, shop: goodAccShop, now }),
    'in_stock'
  );

  // Low accuracy score on 0-100 scale: score 55 (< 70) -> call_to_confirm
  const lowAccShop55 = {
    hours: { open: '00:00', close: '23:59' },
    accuracy_score: 55,
  };
  assert.equal(isAccuracyScoreLow(lowAccShop55.accuracy_score), true);
  assert.equal(
    calculateAvailabilityLabel({ item: freshItem, shop: lowAccShop55, now }),
    'call_to_confirm'
  );

  // Low accuracy score on 0-100 scale: score 0 (< 70) -> call_to_confirm
  const lowAccShop0 = {
    hours: { open: '00:00', close: '23:59' },
    accuracy_score: 0,
  };
  assert.equal(isAccuracyScoreLow(lowAccShop0.accuracy_score), true);
  assert.equal(
    calculateAvailabilityLabel({ item: freshItem, shop: lowAccShop0, now }),
    'call_to_confirm'
  );

  // Legacy decimal scale compatibility (e.g. 0.65 < 0.7 low, 0.95 >= 0.7 good)
  assert.equal(isAccuracyScoreLow(0.65), true);
  assert.equal(isAccuracyScoreLow(0.95), false);
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Tests: Server job retry with backoff & HMAC (AG-1 / AG-3 Requirement 5)
// ─────────────────────────────────────────────────────────────────────────────
test('4.1 On by default; CART2SAVE_FEED_ENABLED=false switches the feed off', async () => {
  process.env.CART2SAVE_FEED_ENABLED = 'false';
  const off = await processFeedOutboxBatch({ db: {} });
  assert.equal(off.enabled, false);
  assert.equal(off.skipped, true);
  assert.match(off.reason, /switched off/);

  // Not set at all: the feed runs (and here stops at the missing secret, proving it got past the switch).
  delete process.env.CART2SAVE_FEED_ENABLED;
  delete process.env.QK_BUSINESS_FEED_SECRET;
  const on = await processFeedOutboxBatch({ db: {} });
  assert.equal(on.enabled, true);
  assert.match(on.error, /QK_BUSINESS_FEED_SECRET is not configured/);
});

test('4.2 Missing QK_BUSINESS_FEED_SECRET fails closed without sending', async () => {
  process.env.CART2SAVE_FEED_ENABLED = 'true';
  delete process.env.QK_BUSINESS_FEED_SECRET;

  const result = await processFeedOutboxBatch({ db: {} });
  assert.equal(result.enabled, true);
  assert.equal(result.success, false);
  assert.match(result.error, /QK_BUSINESS_FEED_SECRET is not configured/);
});

test('4.3 Sends batch with HMAC header and marks sent on 200 OK', async () => {
  process.env.CART2SAVE_FEED_ENABLED = 'true';
  process.env.QK_BUSINESS_FEED_SECRET = 'mock_secret_key_12345';

  const rowsInDb = [
    {
      id: 'out_1',
      workspace_id: 'ws_test',
      entity_type: 'shop',
      entity_id: 'ws_test',
      action: 'upsert',
      payload: { shop_name: 'Test Shop', lat: 17.44, lng: 78.38 },
      status: 'pending',
      attempts: 0,
    },
    {
      id: 'out_2',
      workspace_id: 'ws_test',
      entity_type: 'item',
      entity_id: 'item_100',
      action: 'upsert',
      payload: { item_name: 'Biscuits', selling_price: 20, availability_label: 'in_stock' },
      status: 'pending',
      attempts: 0,
    },
  ];

  const dbUpdates = [];
  const mockDb = {
    from: (table) => ({
      select: () => ({
        in: () => ({
          lte: () => ({
            lt: () => ({
              order: () => ({
                limit: () => ({ data: rowsInDb, error: null }),
              }),
            }),
          }),
        }),
      }),
      update: (fields) => ({
        in: (col, ids) => {
          dbUpdates.push({ col, ids, fields });
          return Promise.resolve({ error: null });
        },
      }),
    }),
  };

  let capturedUrl = '';
  let capturedHeaders = {};
  let capturedBody = '';

  const mockFetch = async (url, options) => {
    capturedUrl = String(url);
    capturedHeaders = options.headers;
    capturedBody = options.body;
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ received: 2 }),
    };
  };

  const now = new Date('2026-11-24T12:00:00Z');
  const result = await processFeedOutboxBatch({
    db: mockDb,
    fetchImpl: mockFetch,
    now,
  });

  assert.equal(result.success, true);
  assert.equal(result.sent, 2);

  // Verify HMAC header
  assert.ok(capturedHeaders['X-QK-Signature']);
  const expectedHmac = crypto.createHmac('sha256', 'mock_secret_key_12345').update(capturedBody).digest('hex');
  assert.equal(capturedHeaders['X-QK-Signature'], expectedHmac);

  // Verify DB updated to sent
  assert.equal(dbUpdates.length, 1);
  assert.equal(dbUpdates[0].fields.status, 'sent');
  assert.deepEqual(dbUpdates[0].ids, ['out_1', 'out_2']);
});

test('4.4 Retries with backoff on failed HTTP request', async () => {
  process.env.CART2SAVE_FEED_ENABLED = 'true';
  process.env.QK_BUSINESS_FEED_SECRET = 'mock_secret_key_12345';

  const rowsInDb = [
    {
      id: 'out_fail_1',
      workspace_id: 'ws_test',
      entity_type: 'shop',
      entity_id: 'ws_test',
      action: 'upsert',
      payload: { shop_name: 'Test Shop' },
      status: 'pending',
      attempts: 1, // Already failed once
    },
  ];

  const individualUpdates = [];
  const mockDb = {
    from: (table) => ({
      select: () => ({
        in: () => ({
          lte: () => ({
            lt: () => ({
              order: () => ({
                limit: () => ({ data: rowsInDb, error: null }),
              }),
            }),
          }),
        }),
      }),
      update: (fields) => ({
        eq: (col, val) => {
          individualUpdates.push({ col, val, fields });
          return Promise.resolve({ error: null });
        },
      }),
    }),
  };

  const failingFetch = async () => {
    return {
      ok: false,
      status: 503,
      text: async () => 'Service Temporarily Unavailable',
    };
  };

  const now = new Date('2026-11-24T12:00:00Z');
  const result = await processFeedOutboxBatch({
    db: mockDb,
    fetchImpl: failingFetch,
    now,
  });

  assert.equal(result.success, false);
  assert.equal(result.sent, 0);

  // Check retry update
  assert.equal(individualUpdates.length, 1);
  const update = individualUpdates[0].fields;
  assert.equal(update.attempts, 2);
  assert.equal(update.status, 'pending'); // Still pending for retry

  // Check exponential backoff delay: attempt 2 should be at least 2 minutes (120,000ms)
  const expectedDelayMs = calculateBackoffMs(2);
  assert.equal(expectedDelayMs, 2 * 60 * 1000); // 2 minutes
  const nextAttemptMs = new Date(update.next_attempt_at).getTime();
  assert.equal(nextAttemptMs, now.getTime() + expectedDelayMs);
});

test('4.5 Outbox row marks status failed when MAX_RETRY_ATTEMPTS is reached', async () => {
  process.env.CART2SAVE_FEED_ENABLED = 'true';
  process.env.QK_BUSINESS_FEED_SECRET = 'mock_secret_key_12345';

  const rowAtLimit = [
    {
      id: 'out_max_attempt',
      workspace_id: 'ws_test',
      entity_type: 'item',
      entity_id: 'item_1',
      action: 'upsert',
      payload: { item_name: 'Rice' },
      status: 'pending',
      attempts: 4, // 4th attempt -> next is 5th (MAX_RETRY_ATTEMPTS)
    },
  ];

  const individualUpdates = [];
  const mockDb = {
    from: () => ({
      select: () => ({
        in: () => ({
          lte: () => ({
            lt: () => ({
              order: () => ({
                limit: () => ({ data: rowAtLimit, error: null }),
              }),
            }),
          }),
        }),
      }),
      update: (fields) => ({
        eq: (col, val) => {
          individualUpdates.push({ col, val, fields });
          return Promise.resolve({ error: null });
        },
      }),
    }),
  };

  const failingFetch = async () => {
    return { ok: false, status: 500, text: async () => 'Internal Server Error' };
  };

  const now = new Date('2026-11-24T12:00:00Z');
  await processFeedOutboxBatch({
    db: mockDb,
    fetchImpl: failingFetch,
    now,
  });

  assert.equal(individualUpdates.length, 1);
  assert.equal(individualUpdates[0].fields.attempts, 5);
  assert.equal(individualUpdates[0].fields.status, 'failed');
});

test('4.6 Nightly full re-send enqueues all active shops and their public items', async () => {
  const workspaces = [
    { id: 'ws_1', name: 'Shop 1', show_on_cart2save: true, lat: 17.4, lng: 78.4 },
    { id: 'ws_2', name: 'Shop 2', show_on_cart2save: true, lat: 17.5, lng: 78.5 },
  ];

  const itemsMap = {
    ws_1: [
      { id: 'item_1', workspace_id: 'ws_1', name: 'Item 1', is_public: true, selling_price: 10 },
      { id: 'item_2', workspace_id: 'ws_1', name: 'Item 2', is_public: true, selling_price: 20 },
    ],
    ws_2: [
      { id: 'item_3', workspace_id: 'ws_2', name: 'Item 3', is_public: true, selling_price: 30 },
    ],
  };

  const outboxInserts = [];
  const mockDb = {
    from: (table) => {
      if (table === 'business_workspaces') {
        return {
          select: () => ({
            eq: () => ({ data: workspaces, error: null }),
          }),
        };
      }
      if (table === 'inventory_items') {
        return {
          select: () => ({
            eq: (_c, wsId) => ({
              eq: () => ({ data: itemsMap[wsId] || [], error: null }),
            }),
          }),
        };
      }
      if (table === 'cart2save_outbox') {
        return {
          insert: (row) => {
            outboxInserts.push(row);
            return { select: () => ({ single: () => ({ data: { id: 'out_' + outboxInserts.length, ...row }, error: null }) }) };
          },
        };
      }
    },
  };

  const res = await enqueueNightlyFullResend(mockDb);
  assert.equal(res.workspacesCount, 2);
  assert.equal(res.itemsCount, 3);
  // Total 2 shop rows + 3 item rows = 5 outbox records
  assert.equal(outboxInserts.length, 5);
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Tests: Unpublish Payload & PR #189 Receiver Validation Rules
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Receiver validation function directly reflecting PR #189
 * (pranix-witness-ui lib/integrations/quietkeep/feedHandler.ts lines 130-147)
 */
function simulatePR189Receiver(feedPayload) {
  // 1. assertNoForbiddenFields from PR #189 security.ts
  const FORBIDDEN = [
    'purchase_price', 'cost_price', 'cost', 'buy_price', 'supplier',
    'supplier_name', 'supplier_phone', 'supplier_id', 'profit', 'margin',
    'batch', 'batch_number', 'batch_no', 'batch_id', 'lot_number',
    'customer', 'customer_name', 'customer_phone', 'customer_id',
    'customer_email', 'gstin', 'gst_rate', 'min_stock_alert',
    'current_stock', 'owner_user_id', 'user_id', 'member_id', 'created_by',
  ];

  function checkSecurity(obj) {
    if (!obj || typeof obj !== 'object') return;
    if (Array.isArray(obj)) {
      obj.forEach(checkSecurity);
      return;
    }
    for (const [key, val] of Object.entries(obj)) {
      const lower = key.toLowerCase();
      if (lower !== 'batch_size' && lower !== 'batch_count') {
        for (const f of FORBIDDEN) {
          if (lower === f || lower.includes(f)) {
            throw new Error(`PR #189 Rejected: forbidden field "${key}"`);
          }
        }
      }
      if (val && typeof val === 'object') checkSecurity(val);
    }
  }

  checkSecurity(feedPayload);

  // 2. Format 2 parsing from PR #189 feedHandler.ts
  const parsedItems = [];
  if (Array.isArray(feedPayload.items)) {
    for (const entry of feedPayload.items) {
      if (!entry || typeof entry !== 'object') continue;
      const entityType = entry.entity_type;
      const action = entry.action;
      const data = entry.data || {};

      if (entityType === 'item') {
        const isUnpublish = action === 'unpublish' || data.unpublish === true;
        const itemId = String(entry.entity_id || data.item_id || '').trim();
        const itemName = String(data.item_name || data.name || '').trim();

        // CRITICAL CHECK in PR #189: both id and name MUST be present
        if (itemId && itemName) {
          parsedItems.push({
            external_id: itemId,
            name: itemName,
            barcode: data.barcode || null,
            unit: data.unit || 'pcs',
            selling_price: Number(data.selling_price) || 0,
            availability: isUnpublish ? 'hidden' : (data.availability_label || data.availability || 'in_stock'),
            updated_at: data.updated_time || data.updated_at || new Date().toISOString(),
            published: !isUnpublish,
          });
        }
      }
    }
  }

  return parsedItems;
}

test('5.1 buildUnpublishItemPayload includes required identifying fields and excludes private fields', () => {
  const fullItem = {
    id: 'item_unpub_1',
    workspace_id: 'ws_1',
    name: 'Basmati Rice 5kg',
    barcode: '8901112223334',
    unit: 'bag',
    selling_price: 650,
    current_stock: 5,
    cost_price: 520,
    supplier_name: 'Wholesaler A',
    batch_number: 'BATCH-99',
    profit: 130,
    updated_at: '2026-11-24T12:00:00.000Z',
  };

  const payload = buildUnpublishItemPayload(fullItem);

  // Must include item id, item name, barcode, unit, selling price, unpublish, updated_time
  assert.equal(payload.item_id, 'item_unpub_1');
  assert.equal(payload.item_name, 'Basmati Rice 5kg');
  assert.equal(payload.barcode, '8901112223334');
  assert.equal(payload.unit, 'bag');
  assert.equal(payload.selling_price, 650);
  assert.equal(payload.unpublish, true);
  assert.equal(payload.updated_time, '2026-11-24T12:00:00.000Z');

  // Must NEVER leak private fields
  assert.equal(payload.cost_price, undefined);
  assert.equal(payload.supplier_name, undefined);
  assert.equal(payload.batch_number, undefined);
  assert.equal(payload.profit, undefined);
  assert.equal(payload.current_stock, undefined);
});

test('5.2 Unpublish payload passes PR #189 validation rules and correctly unpublishes item', async () => {
  const outboxWrites = [];
  const mockDb = {
    from: (table) => ({
      insert: (row) => {
        outboxWrites.push(row);
        return { select: () => ({ single: () => ({ data: { id: 'out_unpub', ...row }, error: null }) }) };
      },
    }),
  };

  const prevItem = {
    id: 'item_456',
    workspace_id: 'ws_test',
    name: 'Organic Honey 500g',
    barcode: '8909876543210',
    unit: 'bottle',
    selling_price: 350,
    is_public: true,
  };

  const currentItem = {
    ...prevItem,
    is_public: false,
  };

  await handleItemChange(mockDb, currentItem, prevItem);

  assert.equal(outboxWrites.length, 1);
  const outboxRow = outboxWrites[0];

  // Wrap in outbox batch format matching feed-sender.js
  const batchFeed = {
    source: 'quietkeep_business',
    sent_at: new Date().toISOString(),
    batch_size: 1,
    items: [
      {
        outbox_id: 'out_unpub',
        workspace_id: outboxRow.workspace_id,
        entity_type: outboxRow.entity_type,
        entity_id: outboxRow.entity_id,
        action: outboxRow.action,
        data: outboxRow.payload,
      },
    ],
  };

  // Run through PR #189 validation rules
  const ingestedItems = simulatePR189Receiver(batchFeed);

  // Must not be dropped: exactly 1 item parsed
  assert.equal(ingestedItems.length, 1);
  const ingested = ingestedItems[0];
  assert.equal(ingested.external_id, 'item_456');
  assert.equal(ingested.name, 'Organic Honey 500g');
  assert.equal(ingested.barcode, '8909876543210');
  assert.equal(ingested.unit, 'bottle');
  assert.equal(ingested.selling_price, 350);
  assert.equal(ingested.published, false);
  assert.equal(ingested.availability, 'hidden');
});

test('5.3 PR #189 drops unpublish when item name is missing, confirming the bug and fix', () => {
  // Payload WITHOUT item name (the bug that existed before Fix 2)
  const buggyFeed = {
    source: 'quietkeep_business',
    items: [
      {
        entity_type: 'item',
        entity_id: 'item_missing_name',
        action: 'unpublish',
        data: {
          item_id: 'item_missing_name',
          unpublish: true,
          updated_time: new Date().toISOString(),
          // item_name missing!
        },
      },
    ],
  };

  const droppedResult = simulatePR189Receiver(buggyFeed);
  // PR #189 lines 131-133 drops it when itemName is empty
  assert.equal(droppedResult.length, 0, 'Receiver must drop item if item_name is missing');

  // Payload WITH item name (our fix)
  const fixedFeed = {
    source: 'quietkeep_business',
    items: [
      {
        entity_type: 'item',
        entity_id: 'item_fixed',
        action: 'unpublish',
        data: {
          item_id: 'item_fixed',
          item_name: 'Tata Salt 1kg',
          barcode: '8901030000000',
          unit: 'pkt',
          selling_price: 28,
          unpublish: true,
          updated_time: new Date().toISOString(),
        },
      },
    ],
  };

  const fixedResult = simulatePR189Receiver(fixedFeed);
  assert.equal(fixedResult.length, 1, 'Receiver must successfully parse unpublish when item_name is present');
  assert.equal(fixedResult[0].name, 'Tata Salt 1kg');
  assert.equal(fixedResult[0].published, false);
  assert.equal(fixedResult[0].availability, 'hidden');
});


// ─────────────────────────────────────────────────────────────────────────────
// 6. The publish path, end to end (27 Nov 2026)
// Traced on the live systems: nothing ever called the sender, the feed was switched off,
// one call could mix shops (Cart2Save reads one shop per call), outside opening hours the
// label was a word Cart2Save refuses, and an item nobody edited for a day dropped out of
// Cart2Save's 24-hour freshness rule.
// ─────────────────────────────────────────────────────────────────────────────

test('6.1 Every availability word QuietKeep can send is one Cart2Save accepts', () => {
  const shop = { hours: { open: '09:00', close: '21:00' }, accuracy_score: 100 };
  const lowShop = { hours: { open: '09:00', close: '21:00' }, accuracy_score: 40 };
  const times = ['2026-11-24T06:00:00Z', '2026-11-24T18:00:00Z', '2026-11-24T23:00:00Z']; // open, shut, shut
  const items = [
    { current_stock: 10, updated_at: '2026-11-24T05:30:00Z' },
    { current_stock: 2, updated_at: '2026-11-24T05:30:00Z' },
    { current_stock: 0, updated_at: '2026-11-24T05:30:00Z' },
    { current_stock: 10, updated_at: '2026-11-20T05:30:00Z' },
    { is_made_on_spot: true, updated_at: '2026-11-24T05:30:00Z' },
    { updated_at: '2026-11-24T05:30:00Z' },
  ];
  for (const t of times) for (const item of items) for (const s of [shop, lowShop, {}]) {
    const label = calculateAvailabilityLabel({ item, shop: s, now: new Date(t) });
    assert.ok(CART2SAVE_AVAILABILITY_LABELS.includes(label), `"${label}" is not a word Cart2Save accepts`);
  }
});

test('6.2 Outside opening hours the stock still speaks; the 3-hour rule waits for opening time', () => {
  const shop = { hours: { open: '09:00', close: '21:00' }, accuracy_score: 100 };
  const shut = new Date('2026-11-24T20:00:00Z'); // 01:30 IST
  assert.equal(calculateAvailabilityLabel({ item: { current_stock: 10, updated_at: '2026-11-20T00:00:00Z' }, shop, now: shut }), 'in_stock');
  assert.equal(calculateAvailabilityLabel({ item: { current_stock: 2 }, shop, now: shut }), 'few_left');
  assert.equal(calculateAvailabilityLabel({ item: { current_stock: 0 }, shop, now: shut }), 'hidden');
});

test('6.3 An item with no selling price is never shown to shoppers', () => {
  const open = { hours: { open: '00:00', close: '23:59' } };
  const now = new Date('2026-11-24T10:30:00.000Z');
  for (const price of [null, undefined, '', 0, -5, 'abc']) {
    const p = buildItemPayload({ name: 'No price', current_stock: 9, selling_price: price, updated_at: now.toISOString() }, open, now);
    assert.equal(p.availability_label, 'hidden');
    assert.equal(p.selling_price, null);
  }
  assert.equal(buildItemPayload({ name: 'Priced', current_stock: 9, selling_price: 20, updated_at: now.toISOString() }, open, now).availability_label, 'in_stock');
});

test('6.4 One call per shop, newest row per item, shop first', () => {
  const rows = [
    { id: 'a1', workspace_id: 'A', entity_type: 'item', entity_id: 'i1', payload: { item_name: 'old' } },
    { id: 'b1', workspace_id: 'B', entity_type: 'item', entity_id: 'i9', payload: { item_name: 'b' } },
    { id: 'a2', workspace_id: 'A', entity_type: 'shop', entity_id: 'A', payload: { shop_name: 'A' } },
    { id: 'a3', workspace_id: 'A', entity_type: 'item', entity_id: 'i1', payload: { item_name: 'new' } },
  ];
  const groups = groupRowsByShop(rows);
  assert.equal(groups.length, 2);
  const a = groups.find((g) => g.workspaceId === 'A');
  assert.deepEqual(a.send.map((r) => r.id), ['a2', 'a3']);       // shop first, newest item row only
  assert.deepEqual(a.superseded.map((r) => r.id), ['a1']);       // the older duplicate is closed with it
  assert.deepEqual(a.all.map((r) => r.id).sort(), ['a1', 'a2', 'a3']);
});

test('6.5 Two shops waiting: two calls, each carrying only its own shop; one failing does not block the other', async () => {
  process.env.QK_BUSINESS_FEED_SECRET = 'mock_secret_key_12345';
  delete process.env.CART2SAVE_FEED_ENABLED;
  const rowsInDb = [
    { id: 'o1', workspace_id: 'A', entity_type: 'shop', entity_id: 'A', action: 'upsert', payload: { shop_name: 'Shop A' }, attempts: 0 },
    { id: 'o2', workspace_id: 'B', entity_type: 'shop', entity_id: 'B', action: 'upsert', payload: { shop_name: 'Shop B' }, attempts: 0 },
    { id: 'o3', workspace_id: 'A', entity_type: 'item', entity_id: 'i1', action: 'upsert', payload: { item_name: 'Rice' }, attempts: 0 },
    { id: 'o4', workspace_id: 'B', entity_type: 'item', entity_id: 'i2', action: 'upsert', payload: { item_name: 'Dal' }, attempts: 0 },
  ];
  const updates = [];
  const db = {
    from: () => ({
      select: () => ({ in: () => ({ lte: () => ({ lt: () => ({ order: () => ({ limit: () => ({ data: rowsInDb, error: null }) }) }) }) }) }),
      update: (fields) => ({
        in: (col, ids) => { updates.push({ ids, status: fields.status }); return Promise.resolve({ error: null }); },
        eq: (col, id) => { updates.push({ ids: [id], status: fields.status, attempts: fields.attempts }); return Promise.resolve({ error: null }); },
      }),
    }),
  };
  const calls = [];
  const fetchImpl = async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push(body);
    const isB = body.items.some((i) => i.workspace_id === 'B');
    return { ok: !isB, status: isB ? 500 : 200, text: async () => (isB ? 'boom' : '{"ok":true}') };
  };
  const result = await processFeedOutboxBatch({ db, fetchImpl, now: new Date('2026-11-24T12:00:00Z') });

  assert.equal(calls.length, 2);
  for (const body of calls) {
    assert.equal(new Set(body.items.map((i) => i.workspace_id)).size, 1, 'a call mixed two shops');
    assert.equal(body.items[0].entity_type, 'shop');
  }
  assert.equal(result.sent, 2);
  assert.equal(result.failed, 2);
  assert.equal(result.success, false);
  assert.deepEqual(updates.find((u) => u.status === 'sent').ids, ['o1', 'o3']);
  assert.equal(updates.filter((u) => u.status === 'pending' && u.attempts === 1).length, 2);
});

test('6.6 The sender is on a schedule, and the secret is never written in the file', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20261127_cart2save_feed_schedule.sql', import.meta.url), 'utf8');
  assert.match(sql, /cron\.schedule\('quietkeep-cart2save-feed', '\*\/5 \* \* \* \*'/);
  assert.match(sql, /cron\.schedule\('quietkeep-cart2save-full-resend', '10 \* \* \* \*'/);
  assert.match(sql, /https:\/\/quietkeep\.com\/api\/cron\/cart2save-feed\?mode=nightly_full/);
  assert.match(sql, /vault\.decrypted_secrets where name = 'quietkeep_nudge_cron_bearer'/);
  assert.doesNotMatch(sql, /Bearer [A-Za-z0-9._-]{16,}/);
});

test('6.7 The sending page refuses to run without the scheduler secret', () => {
  const route = readFileSync(new URL('../src/app/api/cron/cart2save-feed/route.js', import.meta.url), 'utf8');
  assert.match(route, /if \(!cronSecret\) \{[\s\S]{0,220}status: 503/);
  assert.match(route, /!== `Bearer \$\{cronSecret\}`/);
  assert.equal(isFeedEnabled({}), true);
  assert.equal(isFeedEnabled({ CART2SAVE_FEED_ENABLED: 'false' }), false);
  assert.equal(isFeedEnabled({ CART2SAVE_FEED_ENABLED: 'true' }), true);
});
