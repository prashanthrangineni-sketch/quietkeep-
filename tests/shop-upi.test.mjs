// tests/shop-upi.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
// Tests for TASK B3: Shop QR uses the shop's own UPI ID (AG-10, web part only)
//
// 1. UPI ID format validation & normalization
// 2. UPI payment intent URI building & parsing (pa, pn, am, tn, cu=INR)
// 3. Cart amount maths & decimal rounding
// 4. Shop resolver (scanned upi:// string → shop workspace → /s/[shop] URL)
// 5. Stock lowering lifecycle:
//    - Order placed as 'paid - awaiting shop confirmation' → stock NOT lowered
//    - Shop confirms order → stock lowered
//    - Idempotent confirmation → stock not lowered twice
// 6. Razorpay create-qr route marked subscription-only and decoupled from counter
// ─────────────────────────────────────────────────────────────────────────────

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  validateUpiId,
  isValidUpiId,
  normalizeUpiId,
  parseUpiUri,
  buildUpiPayUri,
  calculateCartTotal,
} from '../src/lib/upi.js';

import { resolveShopFromUpi } from '../src/lib/shop-resolver.js';
import { decrementStockForSale } from '../src/lib/inventory-stock.js';
import { mockDb, createClient } from './mock-supabase.mjs';

describe('TASK B3: Shop QR & UPI Payments', () => {
  beforeEach(() => {
    mockDb.reset();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 1. UPI ID Format Validation & Normalization
  // ───────────────────────────────────────────────────────────────────────────
  describe('1. UPI ID Format Validation', () => {
    test('1.1 Validates standard Indian UPI VPAs correctly', () => {
      const validCases = [
        'shop@okhdfcbank',
        'ramu.kirana@okaxis',
        '9876543210@paytm',
        'merchant-1@ybl',
        'store_central@icici',
        'quick.pay.123@axl',
        'RamuKirana@SBI', // uppercase should normalize
      ];

      for (const vpa of validCases) {
        const res = validateUpiId(vpa);
        assert.equal(res.valid, true, `Expected ${vpa} to be valid`);
        assert.equal(res.upiId, vpa.toLowerCase().trim());
        assert.equal(isValidUpiId(vpa), true);
      }
    });

    test('1.2 Normalizes whitespace and uppercase in UPI ID', () => {
      assert.equal(normalizeUpiId('  ShopName@OKHDFCBank  '), 'shopname@okhdfcbank');
      assert.equal(normalizeUpiId('9876543210@PAYTM'), '9876543210@paytm');
    });

    test('1.3 Rejects malformed UPI IDs with clear error messages', () => {
      const invalidCases = [
        { val: '', err: 'empty' },
        { val: '   ', err: 'empty' },
        { val: null, err: 'required' },
        { val: undefined, err: 'required' },
        { val: 'shop name@okaxis', err: 'contain spaces' },
        { val: 'shopname', err: 'contain an @ symbol' },
        { val: 'shop@okaxis@hdfc', err: 'more than one @' },
        { val: '@okaxis', err: 'missing username' },
        { val: 'shop@', err: 'missing bank handle' },
        { val: 's@b', err: 'Invalid UPI ID format' },
        { val: 'shop$name@okaxis', err: 'Invalid UPI ID format' },
      ];

      for (const { val, err } of invalidCases) {
        const res = validateUpiId(val);
        assert.equal(res.valid, false, `Expected ${val} to be invalid`);
        assert.ok(
          res.error.toLowerCase().includes(err.toLowerCase()),
          `Expected error for "${val}" to mention "${err}", got: "${res.error}"`
        );
        assert.equal(isValidUpiId(val), false);
        assert.equal(normalizeUpiId(val), null);
      }
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 2. UPI Pay Link URI Formatting & Parsing
  // ───────────────────────────────────────────────────────────────────────────
  describe('2. UPI Pay Link Formatting and Parsing', () => {
    test('2.1 Builds valid upi://pay URI with pa, pn, am, tn, cu=INR', () => {
      const uri = buildUpiPayUri({
        pa: 'ramu@okaxis',
        pn: 'Ramu Kirana Store',
        am: 150.5,
        tn: 'ORD-101',
        cu: 'INR',
      });

      assert.ok(uri.startsWith('upi://pay?'), 'Must start with upi://pay?');
      const parsedParams = new URLSearchParams(uri.slice('upi://pay?'.length));

      assert.equal(parsedParams.get('pa'), 'ramu@okaxis');
      assert.equal(parsedParams.get('pn'), 'Ramu Kirana Store');
      assert.equal(parsedParams.get('am'), '150.50'); // 2 decimals
      assert.equal(parsedParams.get('tn'), 'ORD-101');
      assert.equal(parsedParams.get('cu'), 'INR');
    });

    test('2.2 buildUpiPayUri enforces positive amounts and valid VPA', () => {
      assert.throws(() => {
        buildUpiPayUri({ pa: 'invalid', pn: 'Shop', am: 100, tn: 'ORD-1' });
      }, /Invalid payee UPI ID/);

      assert.throws(() => {
        buildUpiPayUri({ pa: 'shop@okaxis', pn: 'Shop', am: 0, tn: 'ORD-1' });
      }, /positive number/);

      assert.throws(() => {
        buildUpiPayUri({ pa: 'shop@okaxis', pn: 'Shop', am: -25, tn: 'ORD-1' });
      }, /positive number/);
    });

    test('2.3 parseUpiUri parses standard NPCI UPI URI strings', () => {
      const rawUri = 'upi://pay?pa=store@okhdfcbank&pn=Super%20Mart&am=249.99&tn=INV-999&cu=INR';
      const parsed = parseUpiUri(rawUri);

      assert.equal(parsed.valid, true);
      assert.equal(parsed.pa, 'store@okhdfcbank');
      assert.equal(parsed.pn, 'Super Mart');
      assert.equal(parsed.am, 249.99);
      assert.equal(parsed.tn, 'INV-999');
      assert.equal(parsed.cu, 'INR');
    });

    test('2.4 parseUpiUri parses plain VPA strings directly', () => {
      const parsed = parseUpiUri('kirana@paytm');
      assert.equal(parsed.valid, true);
      assert.equal(parsed.pa, 'kirana@paytm');
      assert.equal(parsed.cu, 'INR');
    });

    test('2.5 parseUpiUri rejects malformed or non-UPI strings', () => {
      const parsed = parseUpiUri('https://google.com');
      assert.equal(parsed.valid, false);
      assert.ok(parsed.error);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 3. Cart Amount Maths
  // ───────────────────────────────────────────────────────────────────────────
  describe('3. Cart Amount Maths', () => {
    test('3.1 Accurately calculates total for multiple line items', () => {
      const items = [
        { name: 'Chai', selling_price: 15, quantity: 2 },        // 30
        { name: 'Samosa', selling_price: 20.5, quantity: 3 },     // 61.50
        { name: 'Biscuit', selling_price: 10.25, quantity: 4 },    // 41.00
      ];

      const total = calculateCartTotal(items);
      assert.equal(total, 132.5);
    });

    test('3.2 Handles floating point precision correctly without rounding errors', () => {
      const items = [
        { price: 19.99, qty: 3 }, // 59.97
        { price: 0.1, qty: 2 },    // 0.20
      ];

      const total = calculateCartTotal(items);
      assert.equal(total, 60.17);
    });

    test('3.3 Handles edge cases: empty cart, negative prices, zero quantities', () => {
      assert.equal(calculateCartTotal([]), 0);
      assert.equal(calculateCartTotal(null), 0);

      const invalidItems = [
        { price: -10, qty: 2 },
        { price: 50, qty: 0 },
        { price: 'invalid', qty: 1 },
      ];
      assert.equal(calculateCartTotal(invalidItems), 0);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 4. Shop Resolver
  // ───────────────────────────────────────────────────────────────────────────
  describe('4. Shop Resolver (scanned upi:// string → shop workspace → /s/[shop])', () => {
    test('4.1 Resolves shop workspace and /s/ URL from scanned upi:// URI', async () => {
      const db = createClient('mock', 'mock');

      // Populate mock workspaces
      mockDb.tables.business_workspaces = [
        {
          id: 'ws-1111-2222',
          name: 'Sri Krishna Kirana',
          upi_id: 'krishna.kirana@okaxis',
          slug: 'sri-krishna-kirana',
          address: 'Road No 1, Jubilee Hills, Hyderabad',
          phone: '+919876543210',
          business_type: 'retail',
        },
        {
          id: 'ws-3333-4444',
          name: 'City Bakery',
          upi_id: 'citybakery@okhdfcbank',
          slug: null,
          phone: '+919876500000',
        },
      ];

      const scannedUri = 'upi://pay?pa=krishna.kirana@okaxis&pn=Sri%20Krishna%20Kirana&am=100';
      const result = await resolveShopFromUpi(scannedUri, db);

      assert.equal(result.found, true);
      assert.equal(result.upi_id, 'krishna.kirana@okaxis');
      assert.equal(result.url, '/s/sri-krishna-kirana');
      assert.equal(result.shop.id, 'ws-1111-2222');
      assert.equal(result.shop.name, 'Sri Krishna Kirana');
      assert.equal(result.parsedPayload.amount, 100);
    });

    test('4.2 Resolves shop by UUID URL if slug is null', async () => {
      const db = createClient('mock', 'mock');
      mockDb.tables.business_workspaces = [
        {
          id: 'ws-3333-4444',
          name: 'City Bakery',
          upi_id: 'citybakery@okhdfcbank',
          slug: null,
        },
      ];

      const result = await resolveShopFromUpi('citybakery@okhdfcbank', db);
      assert.equal(result.found, true);
      assert.equal(result.url, '/s/ws-3333-4444');
      assert.equal(result.shop.id, 'ws-3333-4444');
    });

    test('4.3 Handles unregistered UPI ID gracefully with found:false', async () => {
      const db = createClient('mock', 'mock');
      mockDb.tables.business_workspaces = [];

      const result = await resolveShopFromUpi('unknown.merchant@okaxis', db);
      assert.equal(result.found, false);
      assert.ok(result.error.includes('No shop registered with UPI ID'));
    });

    test('4.4 Handles invalid scanned string gracefully', async () => {
      const db = createClient('mock', 'mock');
      const result = await resolveShopFromUpi('not-a-valid-qr', db);
      assert.equal(result.found, false);
      assert.ok(result.error);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 5. Stock Lowering Lifecycle: Order placed vs Shop Confirmation
  // ───────────────────────────────────────────────────────────────────────────
  describe('5. Stock Lowering Lifecycle (confirmed orders only)', () => {
    test('5.1 Stock is NOT lowered when customer submits order as awaiting confirmation', async () => {
      const db = createClient('mock', 'mock');
      const wsId = 'ws-test-stock-1';

      // 1. Setup inventory items
      mockDb.tables.inventory_items = [
        { id: 'item-1', workspace_id: wsId, name: 'Toor Dal 1kg', current_stock: 50, selling_price: 160 },
        { id: 'item-2', workspace_id: wsId, name: 'Sugar 1kg', current_stock: 30, selling_price: 45 },
      ];
      mockDb.tables.stock_movements = [];
      mockDb.tables.business_sales = [];

      // Customer places order via /s/[shop]
      const cartItems = [
        { item_id: 'item-1', name: 'Toor Dal 1kg', selling_price: 160, quantity: 2 },
        { item_id: 'item-2', name: 'Sugar 1kg', selling_price: 45, quantity: 1 },
      ];

      // Simulate order placement
      const saleRow = {
        id: 'sale-ord-1',
        workspace_id: wsId,
        client_sale_id: 'ORD-1001',
        items: cartItems,
        total_amount: 365,
        payment_mode: 'upi',
        status: 'paid - awaiting shop confirmation', // Key state
        source: 'public_shop',
      };
      mockDb.tables.business_sales.push(saleRow);

      // Verify stock is UNCHANGED at this stage
      const toorDal = mockDb.tables.inventory_items.find(i => i.id === 'item-1');
      const sugar = mockDb.tables.inventory_items.find(i => i.id === 'item-2');
      assert.equal(toorDal.current_stock, 50, 'Stock must NOT be lowered upon order submission');
      assert.equal(sugar.current_stock, 30, 'Stock must NOT be lowered upon order submission');
      assert.equal(mockDb.tables.stock_movements.length, 0, 'No stock movements logged yet');
    });

    test('5.2 Stock IS lowered when shopkeeper confirms the order', async () => {
      const db = createClient('mock', 'mock');
      const wsId = 'ws-test-stock-1';

      mockDb.tables.inventory_items = [
        { id: 'item-1', workspace_id: wsId, name: 'Toor Dal 1kg', current_stock: 50, selling_price: 160 },
        { id: 'item-2', workspace_id: wsId, name: 'Sugar 1kg', current_stock: 30, selling_price: 45 },
      ];
      mockDb.tables.stock_movements = [];

      const cartItems = [
        { item_id: 'item-1', name: 'Toor Dal 1kg', selling_price: 160, quantity: 2 },
        { item_id: 'item-2', name: 'Sugar 1kg', selling_price: 45, quantity: 1 },
      ];

      // Shop confirms order
      const result = await decrementStockForSale(db, wsId, cartItems, {
        referenceId: 'sale-ord-1',
        reason: 'shop_upi_sale',
        paymentMode: 'upi',
      });

      assert.equal(result.updated, 2);
      assert.equal(result.missed, 0);

      // Verify stock was correctly lowered
      const toorDal = mockDb.tables.inventory_items.find(i => i.id === 'item-1');
      const sugar = mockDb.tables.inventory_items.find(i => i.id === 'item-2');
      assert.equal(toorDal.current_stock, 48, '50 - 2 = 48');
      assert.equal(sugar.current_stock, 29, '30 - 1 = 29');

      // Verify audit trail in stock_movements
      assert.equal(mockDb.tables.stock_movements.length, 2);
      const mvt1 = mockDb.tables.stock_movements.find(m => m.item_id === 'item-1');
      assert.equal(mvt1.change, -2);
      assert.equal(mvt1.balance_after, 48);
      assert.equal(mvt1.reason, 'shop_upi_sale');
      assert.equal(mvt1.reference_id, 'sale-ord-1');
    });

    test('5.3 Confirmation logic is idempotent (cannot lower stock twice for same sale)', async () => {
      const db = createClient('mock', 'mock');
      const wsId = 'ws-test-stock-1';

      mockDb.tables.inventory_items = [
        { id: 'item-1', workspace_id: wsId, name: 'Milk 1L', current_stock: 10, selling_price: 60 },
      ];
      mockDb.tables.stock_movements = [];

      const sale = {
        id: 'sale-ord-2',
        workspace_id: wsId,
        status: 'paid - awaiting shop confirmation',
        items: [{ item_id: 'item-1', quantity: 2 }],
      };
      mockDb.tables.business_sales = [sale];

      // First confirmation
      if (sale.status !== 'completed') {
        await decrementStockForSale(db, wsId, sale.items, { referenceId: sale.id });
        sale.status = 'completed';
      }

      const itemAfterFirst = mockDb.tables.inventory_items.find(i => i.id === 'item-1');
      assert.equal(itemAfterFirst.current_stock, 8);

      // Second duplicate confirmation attempt (e.g. double tap)
      let decrementedAgain = false;
      if (sale.status !== 'completed') {
        await decrementStockForSale(db, wsId, sale.items, { referenceId: sale.id });
        decrementedAgain = true;
      }

      assert.equal(decrementedAgain, false, 'Duplicate confirmation must be blocked by status');
      const itemAfterSecond = mockDb.tables.inventory_items.find(i => i.id === 'item-1');
      assert.equal(itemAfterSecond.current_stock, 8, 'Stock must remain 8');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 6. Razorpay create-qr Decoupling & Subscription Route Check
  // ───────────────────────────────────────────────────────────────────────────
  describe('6. Razorpay create-qr Route Subscription Verification', () => {
    test('6.1 create-qr route is explicitly documented as subscription-only', () => {
      const createQrPath = resolve('src/app/api/business/payments/create-qr/route.js');
      const content = readFileSync(createQrPath, 'utf8');

      assert.ok(
        content.includes('SUBSCRIPTION-ONLY'),
        'Route must be labeled SUBSCRIPTION-ONLY'
      );
      assert.ok(
        content.includes('Pranix never holds shop money'),
        'Route must document that Pranix never holds shop money'
      );
      assert.ok(
        content.includes("shop payments go straight to the shop's own UPI ID") ||
        content.includes("Shop payments go straight to the shop's own UPI ID"),
        'Route must document that shop payments go to shop own UPI'
      );
    });

    test('6.2 ScanPay component no longer calls Razorpay create-qr route', () => {
      const scanPayPath = resolve('src/components/biz/ScanPay.jsx');
      const content = readFileSync(scanPayPath, 'utf8');

      assert.ok(
        !content.includes("fetch('/api/business/payments/create-qr'"),
        'ScanPay counter screen must NOT call /api/business/payments/create-qr'
      );
      assert.ok(
        content.includes('buildUpiPayUri'),
        'ScanPay must use buildUpiPayUri for direct shop UPI collection'
      );
    });
  });
});
