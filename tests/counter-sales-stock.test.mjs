// tests/counter-sales-stock.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
// Tests for Quick Counter sales, recipe ingredients decrement, 10s undo,
// and offline sync idempotency (preventing double counting).
// ─────────────────────────────────────────────────────────────────────────────

import assert from 'node:assert';
import { mockDb, createClient } from './mock-supabase.mjs';
import {
  recordCounterSale,
  undoCounterSale,
} from '../src/lib/inventory-stock.js';

let passed = 0;
let failed = 0;

function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      console.log(`PASS  ${name}`);
      passed++;
    })
    .catch((err) => {
      console.error(`FAIL  ${name}`);
      console.error(err);
      failed++;
    });
}

const WS_ID = 'ws_tea_stall_101';

async function run() {
  console.log('\n--- Testing Counter Sales & Stock Decrements (TASK B2) ---');

  await test('1.1 Single tap sale lowers stock of standard packaged item', async () => {
    mockDb.reset();
    const db = createClient();
    mockDb.tables.inventory_items.push({
      id: 'item_samosa',
      workspace_id: WS_ID,
      name: 'Samosa',
      sku: 'SAM01',
      current_stock: 50,
      selling_price: 20,
      is_made_on_spot: false,
    });

    const res = await recordCounterSale(db, WS_ID, {
      clientSaleId: 'sale_tap_1',
      items: [{ item_id: 'item_samosa', name: 'Samosa', quantity: 1, unit_price: 20 }],
      paymentMode: 'cash',
      totalAmount: 20,
      source: 'counter',
    });

    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.already_processed, false);

    // Verify inventory stock was reduced by 1
    const samosa = mockDb.tables.inventory_items.find((i) => i.id === 'item_samosa');
    assert.strictEqual(samosa.current_stock, 49, 'Stock reduced to 49');
    assert(samosa.last_sale_at, 'last_sale_at timestamp is set');

    // Verify stock_movement audit log
    assert.strictEqual(mockDb.tables.stock_movements.length, 1);
    const mvt = mockDb.tables.stock_movements[0];
    assert.strictEqual(mvt.item_id, 'item_samosa');
    assert.strictEqual(mvt.change, -1);
    assert.strictEqual(mvt.balance_after, 49);
    assert.strictEqual(mvt.reason, 'counter_sale');

    // Verify business_sales audit row
    assert.strictEqual(mockDb.tables.business_sales.length, 1);
    const sale = mockDb.tables.business_sales[0];
    assert.strictEqual(sale.payment_mode, 'cash');
    assert.strictEqual(sale.status, 'completed');
    assert.strictEqual(sale.total_amount, 20);
  });

  await test('1.2 UPI Counter sale records payment mode and lowers stock', async () => {
    mockDb.reset();
    const db = createClient();
    mockDb.tables.inventory_items.push({
      id: 'item_biscuit',
      workspace_id: WS_ID,
      name: 'Parle-G Biscuit',
      current_stock: 100,
      selling_price: 10,
      is_made_on_spot: false,
    });

    const res = await recordCounterSale(db, WS_ID, {
      clientSaleId: 'sale_tap_upi',
      items: [{ item_id: 'item_biscuit', name: 'Parle-G Biscuit', quantity: 2, unit_price: 10 }],
      paymentMode: 'upi',
      totalAmount: 20,
      source: 'counter',
    });

    assert.strictEqual(res.ok, true);
    const biscuit = mockDb.tables.inventory_items.find((i) => i.id === 'item_biscuit');
    assert.strictEqual(biscuit.current_stock, 98);

    const sale = mockDb.tables.business_sales[0];
    assert.strictEqual(sale.payment_mode, 'upi');
  });

  await test('2.1 Recipe items: made-on-the-spot Chai (0.1 L milk + 5 g tea powder)', async () => {
    mockDb.reset();
    const db = createClient();
    // Raw ingredients
    mockDb.tables.inventory_items.push(
      {
        id: 'ing_milk',
        workspace_id: WS_ID,
        name: 'Milk',
        current_stock: 10.0, // 10 Litres
        unit: 'L',
        is_made_on_spot: false,
      },
      {
        id: 'ing_tea_powder',
        workspace_id: WS_ID,
        name: 'Tea Powder',
        current_stock: 500, // 500 grams
        unit: 'g',
        is_made_on_spot: false,
      },
      {
        id: 'item_chai',
        workspace_id: WS_ID,
        name: 'Chai',
        selling_price: 15,
        is_made_on_spot: true,
        recipe: [
          { ingredient_id: 'ing_milk', name: 'Milk', quantity: 0.1, unit: 'L' },
          { ingredient_id: 'ing_tea_powder', name: 'Tea Powder', quantity: 5, unit: 'g' },
        ],
      }
    );

    // Record sale of 3 cups of Chai
    const res = await recordCounterSale(db, WS_ID, {
      clientSaleId: 'sale_chai_3',
      items: [{ item_id: 'item_chai', name: 'Chai', quantity: 3, unit_price: 15 }],
      paymentMode: 'cash',
      totalAmount: 45,
    });

    assert.strictEqual(res.ok, true);

    // Check ingredients:
    // Milk: 10.0 - (3 * 0.1) = 9.7 L
    const milk = mockDb.tables.inventory_items.find((i) => i.id === 'ing_milk');
    assert.strictEqual(milk.current_stock, 9.7, 'Milk stock should be 9.7 L');

    // Tea powder: 500 - (3 * 5) = 485 g
    const teaPowder = mockDb.tables.inventory_items.find((i) => i.id === 'ing_tea_powder');
    assert.strictEqual(teaPowder.current_stock, 485, 'Tea powder stock should be 485 g');

    // Check stock movements for ingredients
    assert.strictEqual(mockDb.tables.stock_movements.length, 2);
    const milkMvt = mockDb.tables.stock_movements.find((m) => m.item_id === 'ing_milk');
    assert.strictEqual(milkMvt.change, -0.3);
    assert.strictEqual(milkMvt.reason, 'recipe_sale');

    const powderMvt = mockDb.tables.stock_movements.find((m) => m.item_id === 'ing_tea_powder');
    assert.strictEqual(powderMvt.change, -15);
    assert.strictEqual(powderMvt.reason, 'recipe_sale');

    // Chai itself has updated last_sale_at
    const chai = mockDb.tables.inventory_items.find((i) => i.id === 'item_chai');
    assert(chai.last_sale_at, 'Chai last_sale_at was updated');
  });

  await test('3.1 10-second Undo reverts stock and cancels sale', async () => {
    mockDb.reset();
    const db = createClient();
    mockDb.tables.inventory_items.push({
      id: 'item_samosa',
      workspace_id: WS_ID,
      name: 'Samosa',
      current_stock: 20,
      is_made_on_spot: false,
    });

    // Tap sale
    const saleRes = await recordCounterSale(db, WS_ID, {
      clientSaleId: 'tap_undo_test',
      items: [{ item_id: 'item_samosa', name: 'Samosa', quantity: 1, unit_price: 20 }],
    });

    const samosaMid = mockDb.tables.inventory_items.find((i) => i.id === 'item_samosa');
    assert.strictEqual(samosaMid.current_stock, 19, 'Stock dropped to 19');

    // Tap undo
    const undoRes = await undoCounterSale(db, WS_ID, saleRes.sale.id);
    assert.strictEqual(undoRes.ok, true);

    // Stock should be restored back to 20
    const samosaAfter = mockDb.tables.inventory_items.find((i) => i.id === 'item_samosa');
    assert.strictEqual(samosaAfter.current_stock, 20, 'Stock restored to 20');

    // Check undo movement logged
    const undoMvt = mockDb.tables.stock_movements.find((m) => m.reason === 'counter_undo');
    assert(undoMvt, 'counter_undo movement recorded');
    assert.strictEqual(undoMvt.change, 1);
    assert.strictEqual(undoMvt.balance_after, 20);

    // Sale status cancelled
    const sale = mockDb.tables.business_sales.find((s) => s.id === saleRes.sale.id);
    assert.strictEqual(sale.status, 'cancelled');
  });

  await test('3.2 Undo on recipe item restores ingredients', async () => {
    mockDb.reset();
    const db = createClient();
    mockDb.tables.inventory_items.push(
      { id: 'ing_milk', workspace_id: WS_ID, name: 'Milk', current_stock: 5.0 },
      { id: 'ing_tea', workspace_id: WS_ID, name: 'Tea', current_stock: 200 },
      {
        id: 'item_chai',
        workspace_id: WS_ID,
        name: 'Chai',
        recipe: [
          { ingredient_id: 'ing_milk', quantity: 0.1 },
          { ingredient_id: 'ing_tea', quantity: 5 },
        ],
      }
    );

    const saleRes = await recordCounterSale(db, WS_ID, {
      items: [{ item_id: 'item_chai', name: 'Chai', quantity: 2 }],
    });

    assert.strictEqual(mockDb.tables.inventory_items.find((i) => i.id === 'ing_milk').current_stock, 4.8);
    assert.strictEqual(mockDb.tables.inventory_items.find((i) => i.id === 'ing_tea').current_stock, 190);

    // Undo
    await undoCounterSale(db, WS_ID, saleRes.sale.id);

    // Ingredients restored
    assert.strictEqual(mockDb.tables.inventory_items.find((i) => i.id === 'ing_milk').current_stock, 5.0);
    assert.strictEqual(mockDb.tables.inventory_items.find((i) => i.id === 'ing_tea').current_stock, 200);
  });

  await test('4.1 Offline sync idempotency: resending same client_sale_id does NOT double count', async () => {
    mockDb.reset();
    const db = createClient();
    mockDb.tables.inventory_items.push({
      id: 'item_cookie',
      workspace_id: WS_ID,
      name: 'Cookie',
      current_stock: 10,
    });

    const offlineBatch = [
      {
        clientSaleId: 'offline_sale_uuid_1001',
        items: [{ item_id: 'item_cookie', name: 'Cookie', quantity: 2 }],
        totalAmount: 40,
        paymentMode: 'cash',
      },
    ];

    // First Sync
    const res1 = await recordCounterSale(db, WS_ID, offlineBatch[0]);
    assert.strictEqual(res1.ok, true);
    assert.strictEqual(res1.already_processed, false);
    assert.strictEqual(mockDb.tables.inventory_items.find((i) => i.id === 'item_cookie').current_stock, 8);
    assert.strictEqual(mockDb.tables.business_sales.length, 1);
    assert.strictEqual(mockDb.tables.stock_movements.length, 1);

    // Duplicate Sync (e.g. network retry or re-flushing local queue)
    const res2 = await recordCounterSale(db, WS_ID, offlineBatch[0]);
    assert.strictEqual(res2.ok, true);
    assert.strictEqual(res2.already_processed, true, 'Marked already_processed');

    // Stock must STILL be 8 (NOT 6!)
    const cookie = mockDb.tables.inventory_items.find((i) => i.id === 'item_cookie');
    assert.strictEqual(cookie.current_stock, 8, 'Stock must NOT be double-decremented');

    // Business sales and stock movements must NOT duplicate
    assert.strictEqual(mockDb.tables.business_sales.length, 1, 'No duplicate sale row');
    assert.strictEqual(mockDb.tables.stock_movements.length, 1, 'No duplicate stock movement');
  });

  console.log(`\nSTOCK TESTS COMPLETED: ${passed} passed, ${failed} failed.\n`);
  if (failed > 0) process.exit(1);
}

run();
