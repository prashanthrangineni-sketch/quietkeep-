// tests/document-classify.test.mjs
// A wrong category costs one tap. A wrong expiry date produces a confident
// reminder on the wrong day and costs the user's trust in every other reminder
// in the app. The date cases below are the ones that matter.

import {
  normaliseCategory, normaliseDate, isPlausibleExpiry,
  normaliseName, defaultLeadDays, toDocumentFields, CATEGORIES,
} from '../src/lib/document-classify.js';

let pass = 0, fail = 0;
function eq(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) { console.log(`      expected: ${JSON.stringify(want)}`); console.log(`      got     : ${JSON.stringify(got)}`); fail++; }
  else pass++;
}

// ── THE TRAP: Indian dates are day-first ─────────────────────────────────────
// 03/04/2027 is 3 April in India and 4 March in the US. Reading it the American
// way moves a renewal reminder by up to eleven months.
eq('03/04/2027 is 3 April, not 4 March', normaliseDate('03/04/2027'), '2027-04-03');
eq('31/12/2030 (impossible as MM/DD)',   normaliseDate('31/12/2030'), '2030-12-31');
eq('dash separator, day first',          normaliseDate('03-04-2027'), '2027-04-03');
eq('dot separator, day first',           normaliseDate('03.04.2027'), '2027-04-03');
eq('single-digit day and month',         normaliseDate('3/4/2027'),   '2027-04-03');

// ── ISO is unambiguous and must not be reordered ─────────────────────────────
eq('ISO passes through',                 normaliseDate('2027-04-03'), '2027-04-03');

// ── month names remove all ambiguity ─────────────────────────────────────────
eq('DD Mon YYYY',                        normaliseDate('03 Apr 2027'),   '2027-04-03');
eq('DD Month YYYY',                      normaliseDate('3 April 2027'),  '2027-04-03');
eq('Mon DD, YYYY',                       normaliseDate('Apr 3, 2027'),   '2027-04-03');
eq('Month DD YYYY',                      normaliseDate('April 3 2027'),  '2027-04-03');

// ── unreadable must return null, never a guess ───────────────────────────────
eq('empty',            normaliseDate(''),              null);
eq('null',             normaliseDate(null),            null);
eq('N/A',              normaliseDate('N/A'),           null);
eq('"lifetime"',       normaliseDate('Lifetime'),      null);
eq('"permanent"',      normaliseDate('Permanent'),     null);
eq('free text',        normaliseDate('see reverse'),   null);
eq('2-digit year',     normaliseDate('03/04/27'),      null);   // ambiguous century
eq('month 13',         normaliseDate('03/13/2027'),    null);   // day-first: month 13
eq('31 February',      normaliseDate('31/02/2027'),    null);
eq('31 April',         normaliseDate('31/04/2027'),    null);

// ── plausibility: OCR turns 2027 into 2077 or 2007 invisibly ─────────────────
const NOW = new Date('2026-08-14T00:00:00Z');
eq('next year is plausible',        isPlausibleExpiry('2027-04-03', NOW), true);
eq('recently expired is plausible', isPlausibleExpiry('2025-01-01', NOW), true);
eq('10 years out is plausible',     isPlausibleExpiry('2036-01-01', NOW), true);
eq('50 years out is not',           isPlausibleExpiry('2077-04-03', NOW), false);
eq('20 years expired is not',       isPlausibleExpiry('2006-04-03', NOW), false);
eq('null is not',                   isPlausibleExpiry(null, NOW),         false);

// ── categories: longest hint wins ────────────────────────────────────────────
eq('exact name',              normaliseCategory('Passport'), 'Passport');
eq('case insensitive',        normaliseCategory('passport'), 'Passport');
eq('driving licence',         normaliseCategory('driving licence'), 'License');
eq('American spelling',       normaliseCategory('driving license'), 'License');
eq('registration certificate',normaliseCategory('registration certificate'), 'Vehicle');
eq('PUC',                     normaliseCategory('puc certificate'), 'Vehicle');
eq('aadhaar spelling',        normaliseCategory('aadhaar card'), 'Aadhar');
eq('aadhar spelling',         normaliseCategory('aadhar'), 'Aadhar');
eq('mediclaim',               normaliseCategory('mediclaim policy'), 'Insurance');
eq('salary slip',             normaliseCategory('salary slip'), 'Financial');
eq('sale deed',               normaliseCategory('sale deed'), 'Property');
eq('unknown falls back',      normaliseCategory('grocery receipt'), 'Other');
eq('empty falls back',        normaliseCategory(''), 'Other');
eq('never invents a category',
   CATEGORIES.includes(normaliseCategory('something entirely unexpected')), true);

// ── names ────────────────────────────────────────────────────────────────────
eq('collapses whitespace', normaliseName('  Passport   Prashanth ', 'Passport'), 'Passport Prashanth');
eq('empty falls back to category', normaliseName('', 'Insurance'), 'Insurance');
eq('empty + Other falls back', normaliseName('', 'Other'), 'Document');
eq('long name is trimmed', normaliseName('x'.repeat(200), 'Other').length, 60);

// ── lead days scale with how slow renewal is ─────────────────────────────────
eq('passport gets 6 months', defaultLeadDays('Passport'), 180);
eq('vehicle gets 30 days',   defaultLeadDays('Vehicle'), 30);
eq('unknown gets 30 days',   defaultLeadDays('Other'), 30);

// ── end to end ───────────────────────────────────────────────────────────────
{
  const out = toDocumentFields({
    category: 'driving licence', name: 'DL Prashanth',
    expiry_date: '03/04/2027', doc_number: 'TS0920200001234', confidence: 0.91,
  }, NOW);
  eq('e2e category',    out.category, 'License');
  eq('e2e expiry',      out.expiry_date, '2027-04-03');
  eq('e2e lead days',   out.reminder_days_before, 60);
  eq('e2e confident',   out.low_confidence, false);
  eq('e2e not flagged', out.expiry_unreadable, false);
}

{
  // Model returned an expiry we cannot trust — must be dropped AND flagged,
  // so the UI can say so rather than leaving a silently empty field.
  const out = toDocumentFields({ category: 'Passport', expiry_date: '03/04/2077', confidence: 0.9 }, NOW);
  eq('implausible expiry dropped', out.expiry_date, null);
  eq('and flagged as unreadable',  out.expiry_unreadable, true);
}

{
  const out = toDocumentFields({ category: 'Other', confidence: 0.2 }, NOW);
  eq('low confidence flagged', out.low_confidence, true);
  eq('no expiry, not flagged', out.expiry_unreadable, false);
}

{
  // Never throw on junk — this runs on every upload.
  const out = toDocumentFields(null, NOW);
  eq('null input survives', out.category, 'Other');
  eq('null input names it', out.name, 'Document');
  eq('confidence clamped',  out.confidence, 0);
}

eq('confidence above 1 is clamped', toDocumentFields({ confidence: 5 }, NOW).confidence, 1);
eq('negative confidence clamped',   toDocumentFields({ confidence: -3 }, NOW).confidence, 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
