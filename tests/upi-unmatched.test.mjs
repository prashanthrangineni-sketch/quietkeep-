// tests/upi-unmatched.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
// Tests for UPI payment received with no items (TASK B2):
// - Creates pending 'what was this for?' approval card
// - Owner can pick items (lowers stock via stock-movement path)
// - Owner can skip (no stock change, marks card resolved)
// ─────────────────────────────────────────────────────────────────────────────

import assert from 'node:assert';
import { mockDb, createClient } from './mock-supabase.mjs';
import { decrementStockForSale } from '../src/lib/inventory-stock.js';

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

const WS_ID = 'ws_upi_test_202';

async function run() {
  console.log('\n--- Testing Unmatched UPI Payment Cards (TASK B2) ---');

  await test('1.1 Webhook receipt with no items inserts pending "what was this for?" card', async () => {
    mockDb.reset();
    const db = createClient();

    // Simulate webhook payment without item details
    const paymentId = 'pay_upi_no_items_123';
    const amount = 50;
    const who = 'Suresh Kumar';

    await db.from('business_approvals').insert({
      workspace_id: WS_ID,
      action_type: 'upi_unmatched_payment',
      status: 'pending',
      payload: {
        payment_id: paymentId,
        amount,
        party: who,
        question: 'What was this for?',
        snippet: `₹${amount} received via UPI from ${who}. What was this for?`,
        what: 'upi_unmatched_payment',
      },
      created_at: new Date().toISOString(),
    });

    assert.strictEqual(mockDb.tables.business_approvals.length, 1);
    const card = mockDb.tables.business_approvals[0];
    assert.strictEqual(card.action_type, 'upi_unmatched_payment');
    assert.strictEqual(card.status, 'pending');
    assert.strictEqual(card.payload.amount, 50);
    assert.strictEqual(card.payload.question, 'What was this for?');
  });

  await test('1.2 Owner resolves card by picking items: lowers stock', async () => {
    mockDb.reset();
    const db = createClient();

    // Inventory items
    mockDb.tables.inventory_items.push({
      id: 'item_coffee',
      workspace_id: WS_ID,
      name: 'Coffee',
      current_stock: 30,
      is_made_on_spot: false,
    });

    // Pending card
    const cardId = 'card_unmatched_1';
    mockDb.tables.business_approvals.push({
      id: cardId,
      workspace_id: WS_ID,
      action_type: 'upi_unmatched_payment',
      status: 'pending',
      payload: { amount: 50, party: 'Ramesh' },
    });

    // Owner picks 2 coffees for this ₹50 payment
    const pickedItems = [{ item_id: 'item_coffee', name: 'Coffee', quantity: 2, unit_price: 25 }];
    const stockResult = await decrementStockForSale(db, WS_ID, pickedItems, {
      referenceId: cardId,
      reason: 'upi_unmatched_sale',
      paymentMode: 'upi',
    });

    assert.strictEqual(stockResult.updated, 1);

    // Stock lowered by 2 (30 -> 28)
    const coffee = mockDb.tables.inventory_items.find((i) => i.id === 'item_coffee');
    assert.strictEqual(coffee.current_stock, 28);

    // Stock movement logged
    assert.strictEqual(mockDb.tables.stock_movements.length, 1);
    const mvt = mockDb.tables.stock_movements[0];
    assert.strictEqual(mvt.change, -2);
    assert.strictEqual(mvt.reason, 'upi_unmatched_sale');

    // Update approval status to approved / resolved
    await db.from('business_approvals')
      .update({
        status: 'approved',
        approved_at: new Date().toISOString(),
        payload: { selected_items: pickedItems, resolved: true },
      })
      .eq('id', cardId);

    const updatedCard = mockDb.tables.business_approvals.find((a) => a.id === cardId);
    assert.strictEqual(updatedCard.status, 'approved');
  });

  await test('1.3 Owner skips card: marks resolved without changing stock', async () => {
    mockDb.reset();
    const db = createClient();

    mockDb.tables.inventory_items.push({
      id: 'item_chai',
      workspace_id: WS_ID,
      name: 'Chai',
      current_stock: 40,
    });

    const cardId = 'card_unmatched_skip';
    mockDb.tables.business_approvals.push({
      id: cardId,
      workspace_id: WS_ID,
      action_type: 'upi_unmatched_payment',
      status: 'pending',
      payload: { amount: 20 },
    });

    // Owner skips
    await db.from('business_approvals')
      .update({ status: 'rejected', approved_at: new Date().toISOString() })
      .eq('id', cardId);

    const updatedCard = mockDb.tables.business_approvals.find((a) => a.id === cardId);
    assert.strictEqual(updatedCard.status, 'rejected');

    // Stock untouched
    const chai = mockDb.tables.inventory_items.find((i) => i.id === 'item_chai');
    assert.strictEqual(chai.current_stock, 40);
    assert.strictEqual(mockDb.tables.stock_movements.length, 0);
  });

  console.log(`\nUPI UNMATCHED TESTS COMPLETED: ${passed} passed, ${failed} failed.\n`);
  if (failed > 0) process.exit(1);
}

run();
