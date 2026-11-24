// tests/sale-command-parser.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
// Tests for text command sale parser (English, Hindi, Telugu - Roman & Script)
// ─────────────────────────────────────────────────────────────────────────────

import assert from 'node:assert';
import { parseSaleCommand } from '../src/lib/sale-command-parser.js';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`PASS  ${name}`);
    passed++;
  } catch (err) {
    console.error(`FAIL  ${name}`);
    console.error(err);
    failed++;
  }
}

const mockShopItems = [
  { id: 'item_chai', name: 'Chai', selling_price: 15, is_made_on_spot: true },
  { id: 'item_samosa', name: 'Samosa', selling_price: 20, is_made_on_spot: false },
  { id: 'item_coffee', name: 'Coffee', selling_price: 25, is_made_on_spot: true },
  { id: 'item_biscuit', name: 'Biscuit', selling_price: 10, is_made_on_spot: false },
  { id: 'item_bun_maska', name: 'Bun Maska', selling_price: 35, is_made_on_spot: true },
  { id: 'item_dosa', name: 'Masala Dosa', selling_price: 60, is_made_on_spot: true },
];

console.log('\n--- Testing Natural Language Text Command Sale Parser ---');

// 1. English commands
test('1.1 Standard English: "3 chai 2 samosa cash"', () => {
  const res = parseSaleCommand('3 chai 2 samosa cash', mockShopItems);
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.payment_mode, 'cash');
  assert.strictEqual(res.items.length, 2);

  const chai = res.items.find(i => i.name.toLowerCase() === 'chai');
  assert(chai, 'Chai found');
  assert.strictEqual(chai.quantity, 3);
  assert.strictEqual(chai.item_id, 'item_chai');
  assert.strictEqual(chai.total_price, 45);

  const samosa = res.items.find(i => i.name.toLowerCase() === 'samosa');
  assert(samosa, 'Samosa found');
  assert.strictEqual(samosa.quantity, 2);
  assert.strictEqual(samosa.item_id, 'item_samosa');
  assert.strictEqual(samosa.total_price, 40);

  assert.strictEqual(res.total_amount, 85);
  assert.strictEqual(res.unknown_items.length, 0);
});

test('1.2 English number words & UPI: "two tea 1 coffee upi"', () => {
  const res = parseSaleCommand('two tea 1 coffee upi', mockShopItems);
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.payment_mode, 'upi');
  assert.strictEqual(res.items.length, 2);

  const tea = res.items.find(i => i.name.toLowerCase() === 'chai');
  assert(tea, 'Tea mapped to Chai');
  assert.strictEqual(tea.quantity, 2);

  const coffee = res.items.find(i => i.name.toLowerCase() === 'coffee');
  assert(coffee, 'Coffee found');
  assert.strictEqual(coffee.quantity, 1);
});

test('1.3 English single item with default cash: "bun maska"', () => {
  const res = parseSaleCommand('bun maska', mockShopItems);
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.payment_mode, 'cash');
  assert.strictEqual(res.items.length, 1);
  assert.strictEqual(res.items[0].name, 'Bun Maska');
  assert.strictEqual(res.items[0].quantity, 1);
});

// 2. Hindi commands (Romanised and Devanagari)
test('2.1 Hindi Romanised: "teen chai do samosa cash"', () => {
  const res = parseSaleCommand('teen chai do samosa cash', mockShopItems);
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.payment_mode, 'cash');
  assert.strictEqual(res.items.length, 2);

  const chai = res.items.find(i => i.name.toLowerCase() === 'chai');
  assert.strictEqual(chai.quantity, 3);

  const samosa = res.items.find(i => i.name.toLowerCase() === 'samosa');
  assert.strictEqual(samosa.quantity, 2);
});

test('2.2 Hindi Romanised with nakad: "ek chai do biscuit nakad"', () => {
  const res = parseSaleCommand('ek chai do biscuit nakad', mockShopItems);
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.payment_mode, 'cash');

  const chai = res.items.find(i => i.name.toLowerCase() === 'chai');
  assert.strictEqual(chai.quantity, 1);

  const biscuit = res.items.find(i => i.name.toLowerCase() === 'biscuit');
  assert.strictEqual(biscuit.quantity, 2);
});

test('2.3 Hindi Devanagari with numerals: "३ चाय २ समोसा नकद"', () => {
  const res = parseSaleCommand('३ चाय २ समोसा नकद', mockShopItems);
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.payment_mode, 'cash');
  assert.strictEqual(res.items.length, 2);

  const chai = res.items.find(i => i.name.toLowerCase() === 'chai');
  assert.strictEqual(chai.quantity, 3);

  const samosa = res.items.find(i => i.name.toLowerCase() === 'samosa');
  assert.strictEqual(samosa.quantity, 2);
});

test('2.4 Hindi Devanagari word numbers & UPI: "दो समोसा तीन चाय यूपीआई"', () => {
  const res = parseSaleCommand('दो समोसा तीन चाय यूपीआई', mockShopItems);
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.payment_mode, 'upi');

  const samosa = res.items.find(i => i.name.toLowerCase() === 'samosa');
  assert.strictEqual(samosa.quantity, 2);

  const chai = res.items.find(i => i.name.toLowerCase() === 'chai');
  assert.strictEqual(chai.quantity, 3);
});

// 3. Telugu commands (Romanised and Telugu script)
test('3.1 Telugu Romanised: "moodu chai rendu samosa cash"', () => {
  const res = parseSaleCommand('moodu chai rendu samosa cash', mockShopItems);
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.payment_mode, 'cash');
  assert.strictEqual(res.items.length, 2);

  const chai = res.items.find(i => i.name.toLowerCase() === 'chai');
  assert.strictEqual(chai.quantity, 3);

  const samosa = res.items.find(i => i.name.toLowerCase() === 'samosa');
  assert.strictEqual(samosa.quantity, 2);
});

test('3.2 Telugu Romanised with nagadu & upi: "oka coffee rendu biscuit upi"', () => {
  const res = parseSaleCommand('oka coffee rendu biscuit upi', mockShopItems);
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.payment_mode, 'upi');

  const coffee = res.items.find(i => i.name.toLowerCase() === 'coffee');
  assert.strictEqual(coffee.quantity, 1);

  const biscuit = res.items.find(i => i.name.toLowerCase() === 'biscuit');
  assert.strictEqual(biscuit.quantity, 2);
});

test('3.3 Telugu Native Script: "మూడు చాయ్ రెండు సమోసా నగదు"', () => {
  const res = parseSaleCommand('మూడు చాయ్ రెండు సమోసా నగదు', mockShopItems);
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.payment_mode, 'cash');

  const chai = res.items.find(i => i.name.toLowerCase() === 'chai');
  assert.strictEqual(chai.quantity, 3);

  const samosa = res.items.find(i => i.name.toLowerCase() === 'samosa');
  assert.strictEqual(samosa.quantity, 2);
});

test('3.4 Telugu Native Script with UPI: "రెండు టీ ఒక కాఫీ యుపిఐ"', () => {
  const res = parseSaleCommand('రెండు టీ ఒక కాఫీ యుపిఐ', mockShopItems);
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.payment_mode, 'upi');

  const chai = res.items.find(i => i.name.toLowerCase() === 'chai');
  assert.strictEqual(chai.quantity, 2);

  const coffee = res.items.find(i => i.name.toLowerCase() === 'coffee');
  assert.strictEqual(coffee.quantity, 1);
});

test('3.5 Telugu Numerals: "౩ టీ ౨ సమోసా క్యాష్"', () => {
  const res = parseSaleCommand('౩ టీ ౨ సమోసా క్యాష్', mockShopItems);
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.payment_mode, 'cash');

  const chai = res.items.find(i => i.name.toLowerCase() === 'chai');
  assert.strictEqual(chai.quantity, 3);

  const samosa = res.items.find(i => i.name.toLowerCase() === 'samosa');
  assert.strictEqual(samosa.quantity, 2);
});

// 4. Unknown words asking to pick from shop's items
test('4.1 Unknown word: "3 muffins 2 chai cash"', () => {
  const res = parseSaleCommand('3 muffins 2 chai cash', mockShopItems);
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.has_unknown, true);
  assert.strictEqual(res.unknown_items.length, 1);

  const unknown = res.unknown_items[0];
  assert.strictEqual(unknown.raw_name, 'muffins');
  assert.strictEqual(unknown.quantity, 3);
  assert.strictEqual(unknown.matched, false);
  assert.strictEqual(unknown.needs_disambiguation, true);

  // Known item still parsed correctly
  const chai = res.items.find(i => i.name.toLowerCase() === 'chai');
  assert(chai, 'Chai still parsed');
  assert.strictEqual(chai.quantity, 2);

  // Shop items offered for disambiguation
  assert(res.available_shop_items.length >= 6);
  assert(res.available_shop_items.some(si => si.id === 'item_chai'));
});

test('4.2 Empty command returns error', () => {
  const res = parseSaleCommand('');
  assert.strictEqual(res.ok, false);
});

console.log(`\nPARSER TESTS COMPLETED: ${passed} passed, ${failed} failed.\n`);
if (failed > 0) process.exit(1);
