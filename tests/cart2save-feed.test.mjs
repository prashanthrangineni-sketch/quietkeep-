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
} from '../src/lib/cart2save/availability.js';

import {
  buildShopPayload,
  buildItemPayload,
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
  assert.equal(payload.updated_time, '2026-11-24T10:00:00.000Z');

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

  const prevItem = { id: 'item_1', workspace_id: 'ws_1', is_public: true, name: 'Apples' };
  const currentItem = { id: 'item_1', workspace_id: 'ws_1', is_public: false, name: 'Apples' };

  await handleItemChange(mockDb, currentItem, prevItem);

  assert.equal(outboxWrites.length, 1);
  const outbox = outboxWrites[0];
  assert.equal(outbox.workspace_id, 'ws_1');
  assert.equal(outbox.entity_type, 'item');
  assert.equal(outbox.entity_id, 'item_1');
  assert.equal(outbox.action, 'unpublish');
  assert.equal(outbox.payload.unpublish, true);
  assert.equal(outbox.payload.item_id, 'item_1');
});

test('2.3 Deleting an item marked public enqueues item unpublish', async () => {
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

  const prevItem = { id: 'item_del', workspace_id: 'ws_1', is_public: true, name: 'Sugar' };
  const deletedItem = { id: 'item_del', workspace_id: 'ws_1', deleted: true, is_public: false, name: 'Sugar' };

  await handleItemChange(mockDb, deletedItem, prevItem);

  assert.equal(outboxWrites.length, 1);
  assert.equal(outboxWrites[0].action, 'unpublish');
  assert.equal(outboxWrites[0].entity_id, 'item_del');
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Tests: Availability label rules (AG-1 / AG-3 Requirement 4)
// ─────────────────────────────────────────────────────────────────────────────
test('3.1 Packaged items: in_stock if count > 3', () => {
  const shop = { hours: { open: '00:00', close: '23:59' }, accuracy_score: 1.0 };
  const now = new Date('2026-11-24T12:00:00Z');

  // count 4
  const item4 = { current_stock: 4, updated_at: '2026-11-24T11:30:00Z' };
  assert.equal(calculateAvailabilityLabel({ item: item4, shop, now }), 'in_stock');

  // count 10
  const item10 = { current_stock: 10, updated_at: '2026-11-24T11:50:00Z' };
  assert.equal(calculateAvailabilityLabel({ item: item10, shop, now }), 'in_stock');
});

test('3.2 Packaged items: few_left if count 1-3', () => {
  const shop = { hours: { open: '00:00', close: '23:59' }, accuracy_score: 1.0 };
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
  const shop = { hours: { open: '00:00', close: '23:59' }, accuracy_score: 1.0 };
  const now = new Date('2026-11-24T12:00:00Z');

  const item0 = { current_stock: 0, updated_at: '2026-11-24T11:45:00Z' };
  assert.equal(calculateAvailabilityLabel({ item: item0, shop, now }), 'hidden');

  const itemNegative = { current_stock: -1, updated_at: '2026-11-24T11:45:00Z' };
  assert.equal(calculateAvailabilityLabel({ item: itemNegative, shop, now }), 'hidden');
});

test('3.4 Items marked "made on the spot": available_while_open during opening hours', () => {
  const shop = { hours: { open: '08:00', close: '22:00' }, accuracy_score: 1.0 };
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
  assert.equal(
    calculateAvailabilityLabel({ item: samosa, shop, now: outsideOpen }),
    'closed'
  );
});

test('3.5 Any item with no recorded sale or update for 3 hours during opening hours: call_to_confirm', () => {
  const shop = { hours: { open: '00:00', close: '23:59' }, accuracy_score: 1.0 };
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

test('3.6 Shop accuracy score low: call_to_confirm', () => {
  const now = new Date('2026-11-24T12:00:00Z');
  const freshItem = { current_stock: 20, updated_at: '2026-11-24T11:50:00Z' };

  // Decimal scale low (< 0.7)
  const lowAccShopDecimal = {
    hours: { open: '00:00', close: '23:59' },
    accuracy_score: 0.65,
  };
  assert.equal(
    calculateAvailabilityLabel({ item: freshItem, shop: lowAccShopDecimal, now }),
    'call_to_confirm'
  );

  // Percentage scale low (< 70)
  const lowAccShopPercent = {
    hours: { open: '00:00', close: '23:59' },
    accuracy_score: 55,
  };
  assert.equal(
    calculateAvailabilityLabel({ item: freshItem, shop: lowAccShopPercent, now }),
    'call_to_confirm'
  );

  // Good accuracy score (>= 0.7 or >= 70)
  const goodAccShop = {
    hours: { open: '00:00', close: '23:59' },
    accuracy_score: 0.95,
  };
  assert.equal(
    calculateAvailabilityLabel({ item: freshItem, shop: goodAccShop, now }),
    'in_stock'
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Tests: Server job retry with backoff & HMAC (AG-1 / AG-3 Requirement 5)
// ─────────────────────────────────────────────────────────────────────────────
test('4.1 Off by default behind CART2SAVE_FEED_ENABLED', async () => {
  delete process.env.CART2SAVE_FEED_ENABLED;
  const result = await processFeedOutboxBatch({ db: {} });
  assert.equal(result.enabled, false);
  assert.equal(result.skipped, true);
  assert.match(result.reason, /CART2SAVE_FEED_ENABLED is not enabled/);
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
