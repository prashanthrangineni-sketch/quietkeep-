// tests/closing-check.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
// Tests for Closing Check (/b/closing):
// - Top 10 packaged items physical count vs system stock
// - Cash in drawer gap calculation
// - Stock correction with 'adjustment' movement
// - Shop accuracy score (0-100) stored on business_workspaces
// - Compatibility with PR #268 accuracy score rules
// ─────────────────────────────────────────────────────────────────────────────

import assert from 'node:assert';
import { mockDb, createClient } from './mock-supabase.mjs';
import {
  adjustStockForClosing,
  calculateAccuracyScore,
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

// PR #268 helper rule to verify interop
function isAccuracyScoreLowFromPR268(score) {
  if (score === null || score === undefined) return false;
  const num = Number(score);
  if (isNaN(num)) return false;
  return num > 1 ? num < 70 : num < 0.7;
}

const WS_ID = 'ws_closing_test_101';

async function run() {
  console.log('\n--- Testing Daily Closing Check & Accuracy Score (TASK B2) ---');

  await test('1.1 Accuracy score formula: exact matches yield 100', () => {
    const itemCounts = [
      { item_id: 'i1', system_stock: 10, physical_count: 10 },
      { item_id: 'i2', system_stock: 25, physical_count: 25 },
      { item_id: 'i3', system_stock: 50, physical_count: 50 },
    ];
    const score = calculateAccuracyScore(itemCounts);
    assert.strictEqual(score, 100);
    assert.strictEqual(isAccuracyScoreLowFromPR268(score), false, 'PR268 considers 100 high accuracy');
  });

  await test('1.2 Accuracy score formula: partial discrepancy scales accurately', () => {
    const itemCounts = [
      { item_id: 'i1', system_stock: 10, physical_count: 8 },  // diff 2
      { item_id: 'i2', system_stock: 10, physical_count: 9 },  // diff 1
      { item_id: 'i3', system_stock: 10, physical_count: 10 }, // exact match
      { item_id: 'i4', system_stock: 10, physical_count: 10 }, // exact match
    ];
    const score = calculateAccuracyScore(itemCounts);
    assert(score >= 70 && score <= 90, `Score ${score} in expected range 70-90`);
    assert.strictEqual(isAccuracyScoreLowFromPR268(score), false);
  });

  await test('1.3 Accuracy score formula: severe discrepancy drops below 70', () => {
    const itemCounts = [
      { item_id: 'i1', system_stock: 10, physical_count: 2 },  // missing 8
      { item_id: 'i2', system_stock: 20, physical_count: 5 },  // missing 15
      { item_id: 'i3', system_stock: 30, physical_count: 10 }, // missing 20
    ];
    const score = calculateAccuracyScore(itemCounts);
    assert(score < 70, `Score ${score} drops below 70`);
    assert.strictEqual(isAccuracyScoreLowFromPR268(score), true, 'PR268 considers <70 low accuracy');
  });

  await test('2.1 Closing check adjusts stock with reason="adjustment" and updates workspace accuracy_score', async () => {
    mockDb.reset();
    const db = createClient();

    // Setup workspace
    mockDb.tables.business_workspaces.push({
      id: WS_ID,
      name: 'Chai & Snacks Corner',
      accuracy_score: 100,
    });

    // Setup 10 packaged items
    const top10 = [
      { id: 'p1', workspace_id: WS_ID, name: 'Lays Chips', current_stock: 20, is_made_on_spot: false },
      { id: 'p2', workspace_id: WS_ID, name: 'Kurkure', current_stock: 15, is_made_on_spot: false },
      { id: 'p3', workspace_id: WS_ID, name: 'Parle-G', current_stock: 30, is_made_on_spot: false },
      { id: 'p4', workspace_id: WS_ID, name: 'Good Day', current_stock: 25, is_made_on_spot: false },
      { id: 'p5', workspace_id: WS_ID, name: 'Frooti', current_stock: 12, is_made_on_spot: false },
      { id: 'p6', workspace_id: WS_ID, name: 'Thums Up', current_stock: 18, is_made_on_spot: false },
      { id: 'p7', workspace_id: WS_ID, name: 'KitKat', current_stock: 10, is_made_on_spot: false },
      { id: 'p8', workspace_id: WS_ID, name: 'Dairy Milk', current_stock: 14, is_made_on_spot: false },
      { id: 'p9', workspace_id: WS_ID, name: '5 Star', current_stock: 16, is_made_on_spot: false },
      { id: 'p10', workspace_id: WS_ID, name: 'Water Bottle', current_stock: 40, is_made_on_spot: false },
    ];
    mockDb.tables.inventory_items.push(...top10);

    // Closing counts: 8 items exact, 1 item shortage (-2), 1 item surplus (+1)
    const counts = [
      { item_id: 'p1', system_stock: 20, physical_count: 18 }, // gap -2
      { item_id: 'p2', system_stock: 15, physical_count: 16 }, // gap +1
      { item_id: 'p3', system_stock: 30, physical_count: 30 },
      { item_id: 'p4', system_stock: 25, physical_count: 25 },
      { item_id: 'p5', system_stock: 12, physical_count: 12 },
      { item_id: 'p6', system_stock: 18, physical_count: 18 },
      { item_id: 'p7', system_stock: 10, physical_count: 10 },
      { item_id: 'p8', system_stock: 14, physical_count: 14 },
      { item_id: 'p9', system_stock: 16, physical_count: 16 },
      { item_id: 'p10', system_stock: 40, physical_count: 40 },
    ];

    const result = await adjustStockForClosing(db, WS_ID, {
      cashInDrawer: 3450,
      expectedCash: 3500, // cash gap -50
      itemCounts: counts,
      notes: 'Evening closing count complete',
      checkedBy: 'user_owner_1',
    });

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.cash_gap, -50, 'Cash gap calculated as -50');
    assert.strictEqual(result.adjustments_count, 2, 'Exactly 2 items had gaps requiring adjustment');
    assert(result.accuracy_score >= 80 && result.accuracy_score <= 100);

    // Verify inventory stock corrected
    const p1 = mockDb.tables.inventory_items.find((i) => i.id === 'p1');
    assert.strictEqual(p1.current_stock, 18, 'p1 stock corrected to physical count 18');

    const p2 = mockDb.tables.inventory_items.find((i) => i.id === 'p2');
    assert.strictEqual(p2.current_stock, 16, 'p2 stock corrected to physical count 16');

    // Verify stock movements logged with reason="adjustment"
    assert.strictEqual(mockDb.tables.stock_movements.length, 2);
    const mvt1 = mockDb.tables.stock_movements.find((m) => m.item_id === 'p1');
    assert.strictEqual(mvt1.change, -2);
    assert.strictEqual(mvt1.balance_after, 18);
    assert.strictEqual(mvt1.reason, 'adjustment', 'reason must be "adjustment"');

    const mvt2 = mockDb.tables.stock_movements.find((m) => m.item_id === 'p2');
    assert.strictEqual(mvt2.change, 1);
    assert.strictEqual(mvt2.balance_after, 16);
    assert.strictEqual(mvt2.reason, 'adjustment', 'reason must be "adjustment"');

    // Verify business_workspaces updated with accuracy_score
    const ws = mockDb.tables.business_workspaces.find((w) => w.id === WS_ID);
    assert.strictEqual(ws.accuracy_score, result.accuracy_score);
    assert.strictEqual(ws.closing_cash_in_drawer, 3450);
    assert(ws.last_closing_at, 'last_closing_at set');

    // Verify audit log row in business_closing_checks
    assert.strictEqual(mockDb.tables.business_closing_checks.length, 1);
    const log = mockDb.tables.business_closing_checks[0];
    assert.strictEqual(log.cash_in_drawer, 3450);
    assert.strictEqual(log.expected_cash, 3500);
    assert.strictEqual(log.cash_gap, -50);
  });

  console.log(`\nCLOSING TESTS COMPLETED: ${passed} passed, ${failed} failed.\n`);
  if (failed > 0) process.exit(1);
}

run();
