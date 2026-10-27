// tests/vision-score.test.mjs
// Unit tests for vision extraction scoring functions.

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  parseRupee,
  matchTotal,
  normalizeDate,
  matchDate,
  matchMrp,
  normalizeExpiry,
  matchExpiry,
  matchMerchant,
  scoreItemsF1,
  scoreVisionRecord,
} from '../scripts/vision/vision-score.mjs'

test('parseRupee handles numbers, currency symbols, and commas', () => {
  assert.equal(parseRupee(450), 450)
  assert.equal(parseRupee(450.4), 450)
  assert.equal(parseRupee(450.6), 451)
  assert.equal(parseRupee('₹ 1,420.00'), 1420)
  assert.equal(parseRupee('Rs. 250'), 250)
  assert.equal(parseRupee('240/-'), 240)
  assert.equal(parseRupee(null), null)
  assert.equal(parseRupee(''), null)
})

test('matchTotal tests exact match to the integer rupee', () => {
  assert.equal(matchTotal(450, 450), true)
  assert.equal(matchTotal(450, '450'), true)
  assert.equal(matchTotal(450, '₹ 450.25'), true)
  assert.equal(matchTotal(450, 451), false)
  assert.equal(matchTotal(450, null), false)
  assert.equal(matchTotal(null, null), true)
})

test('normalizeDate and matchDate handle ISO and DD/MM/YYYY', () => {
  assert.equal(normalizeDate('2026-10-18'), '2026-10-18')
  assert.equal(normalizeDate('18/10/2026'), '2026-10-18')
  assert.equal(normalizeDate('18-10-2026'), '2026-10-18')
  assert.equal(matchDate('2026-10-18', '2026-10-18'), true)
  assert.equal(matchDate('2026-10-18', '18/10/2026'), true)
  assert.equal(matchDate('2026-10-18', '2026-10-19'), false)
  assert.equal(matchDate('2026-10-18', null), false)
  assert.equal(matchDate(null, null), true)
})

test('matchMrp checks exact rupee match', () => {
  assert.equal(matchMrp(250, 250), true)
  assert.equal(matchMrp(250, '₹ 250.00'), true)
  assert.equal(matchMrp(250, 260), false)
  assert.equal(matchMrp(null, null), true)
  assert.equal(matchMrp(250, null), false)
})

test('normalizeExpiry and matchExpiry handle multiple date formats', () => {
  assert.equal(normalizeExpiry('2027-12'), '2027-12')
  assert.equal(normalizeExpiry('12/2027'), '2027-12')
  assert.equal(normalizeExpiry('12/27'), '2027-12')
  assert.equal(normalizeExpiry('2027-12-31'), '2027-12-31')
  assert.equal(matchExpiry('2027-12', '12/2027'), true)
  assert.equal(matchExpiry('2027-12', '2027-12-31'), true)
  assert.equal(matchExpiry('2027-12', '2028-01'), false)
  assert.equal(matchExpiry(null, null), true)
  assert.equal(matchExpiry('2027-12', null), false)
})

test('matchMerchant performs fuzzy matching ignoring common business suffixes', () => {
  assert.equal(matchMerchant('Apollo SafeCare Pharmacy', 'Apollo SafeCare Pharmacy'), true)
  assert.equal(matchMerchant('Apollo SafeCare Pharmacy', 'Apollo Safecare'), true)
  assert.equal(matchMerchant('Swagath Grand Tiffins', 'Swagath Grand Hotel'), true)
  assert.equal(matchMerchant('Sri Lakshmi Kirana Stores', 'Sri Lakshmi Kirana & General Store'), true)
  assert.equal(matchMerchant('TGSPDCL Southern Power', 'TGSPDCL'), true)
  assert.equal(matchMerchant('Apollo Pharmacy', 'MedPlus Medicals'), false)
})

test('scoreItemsF1 handles exact match, partial match, and price verification', () => {
  const expected = [
    { name: 'Sona Masoori Rice', qty: '5 kg', price: 320 },
    { name: 'Toor Dal', qty: '1 kg', price: 165 },
  ]

  // Perfect match
  const gotExact = [
    { name: 'Sona Masoori Rice', qty: '5kg', price: 320 },
    { name: 'Toor Dal', qty: '1kg', price: 165 },
  ]
  const resExact = scoreItemsF1(expected, gotExact)
  assert.equal(resExact.f1, 1.0)
  assert.equal(resExact.matched, 2)

  // 1 out of 2 matched
  const gotPartial = [
    { name: 'Sona Masoori Rice', qty: '5kg', price: 320 },
    { name: 'Moong Dal', qty: '1kg', price: 110 },
  ]
  const resPartial = scoreItemsF1(expected, gotPartial)
  assert.equal(resPartial.matched, 1)
  assert.equal(resPartial.precision, 0.5)
  assert.equal(resPartial.recall, 0.5)
  assert.equal(resPartial.f1, 0.5)

  // Wrong price does not match
  const gotWrongPrice = [
    { name: 'Sona Masoori Rice', qty: '5kg', price: 500 },
    { name: 'Toor Dal', qty: '1kg', price: 165 },
  ]
  const resWrongPrice = scoreItemsF1(expected, gotWrongPrice)
  assert.equal(resWrongPrice.matched, 1)

  // Empty lists
  assert.equal(scoreItemsF1([], []).f1, 1.0)
  assert.equal(scoreItemsF1(expected, []).f1, 0.0)
  assert.equal(scoreItemsF1([], gotExact).f1, 0.0)
})

test('scoreVisionRecord evaluates full record and reports checks and fails', () => {
  const expected = {
    doc_type: 'kirana',
    merchant: 'Sri Lakshmi Kirana Stores',
    date: '2026-10-18',
    total: 485,
    currency: 'INR',
    items: [
      { name: 'Sona Masoori Rice', qty: '5 kg', price: 320 },
      { name: 'Toor Dal', qty: '1 kg', price: 165 },
    ],
    mrp: null,
    expiry: null,
  }

  const gotGood = {
    doc_type: 'kirana',
    merchant: 'Sri Lakshmi Kirana',
    date: '18/10/2026',
    total: 485,
    currency: 'INR',
    items: [
      { name: 'Sona Masoori Rice 5kg', qty: '5 kg', price: 320 },
      { name: 'Toor Dal', qty: '1 kg', price: 165 },
    ],
    mrp: null,
    expiry: null,
  }

  const res = scoreVisionRecord(expected, gotGood)
  assert.equal(res.pass, true)
  assert.equal(res.json_valid, true)
  assert.equal(res.checks.total, true)
  assert.equal(res.checks.date, true)
  assert.equal(res.checks.merchant, true)
  assert.equal(res.fails.length, 0)
})

test('scoreVisionRecord handles bad JSON and markdown fences', () => {
  const expected = {
    doc_type: 'kirana',
    merchant: 'Test Shop',
    date: '2026-10-18',
    total: 100,
    items: [],
  }

  // Wrapped in markdown codeblock
  const jsonBlock = '```json\n{"doc_type":"kirana","merchant":"Test Shop","date":"2026-10-18","total":100}\n```'
  const resBlock = scoreVisionRecord(expected, jsonBlock)
  assert.equal(resBlock.json_valid, true)
  assert.equal(resBlock.pass, true)

  // Invalid JSON string
  const resBad = scoreVisionRecord(expected, 'Sorry I cannot read this image.')
  assert.equal(resBad.json_valid, false)
  assert.equal(resBad.pass, false)
  assert.ok(resBad.fails.includes('invalid_json'))
})

test('scoreVisionRecord handles missing fields properly', () => {
  const expected = {
    doc_type: 'pharmacy',
    merchant: 'Apollo Pharmacy',
    date: '2026-10-20',
    total: 300,
    mrp: 350,
    expiry: '2027-12',
    items: [{ name: 'Medicine A', price: 300 }],
  }

  // Model omitted mrp and date
  const gotMissing = {
    doc_type: 'pharmacy',
    merchant: 'Apollo Pharmacy',
    total: 300,
    items: [{ name: 'Medicine A', price: 300 }],
  }

  const res = scoreVisionRecord(expected, gotMissing)
  assert.equal(res.pass, false)
  assert.equal(res.checks.total, true)
  assert.equal(res.checks.date, false)
  assert.equal(res.checks.mrp, false)
  assert.ok(res.fails.some((f) => f.startsWith('date:')))
  assert.ok(res.fails.some((f) => f.startsWith('mrp:')))
})
