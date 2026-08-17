// tests/gst-place-of-supply.test.mjs
// Getting this wrong makes an invoice legally incorrect, so the B2C cases —
// the ones the old GSTIN-only comparison could never handle — matter most.

import {
  stateCodeFromGstin, resolvePlaceOfSupply, splitGst, stateName, GST_STATES,
} from '../src/lib/gst-place-of-supply.js';

let pass = 0, fail = 0;
function eq(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) { console.log(`      expected: ${JSON.stringify(want)}`); console.log(`      got     : ${JSON.stringify(got)}`); fail++; }
  else pass++;
}

const TG = '36AABCU9603R1ZM';   // Telangana
const AP = '37AABCU9603R1ZM';   // Andhra Pradesh
const KA = '29AABCU9603R1ZM';   // Karnataka

// ── state code extraction ────────────────────────────────────────────────────
eq('Telangana from GSTIN',  stateCodeFromGstin(TG), '36');
eq('lowercase is fine',     stateCodeFromGstin(TG.toLowerCase()), '36');
eq('whitespace trimmed',    stateCodeFromGstin('  ' + KA + ' '), '29');
eq('code 25 does not exist', stateCodeFromGstin('25AABCU9603R1ZM'), null);
eq('code 00 rejected',      stateCodeFromGstin('00AABCU9603R1ZM'), null);
eq('too short',             stateCodeFromGstin('3'), null);
eq('empty',                 stateCodeFromGstin(''), null);
eq('null',                  stateCodeFromGstin(null), null);

// ── B2B: unchanged behaviour, the GSTIN wins ─────────────────────────────────
{
  const r = resolvePlaceOfSupply(TG, AP);
  eq('B2B different states → inter-state', r.interState, true);
  eq('B2B basis is the GSTIN', r.basis, 'customer_gstin');
}
eq('B2B same state → intra-state', resolvePlaceOfSupply(TG, TG).interState, false);

// A customer GSTIN must outrank a wrongly-chosen dropdown value.
eq('GSTIN beats a contradicting state choice',
   resolvePlaceOfSupply(TG, AP, '36').interState, true);

// ── B2C: THE BUG THIS FIXES ──────────────────────────────────────────────────
// No customer GSTIN. The old code returned false here every time, charging
// CGST+SGST on a sale that legally requires IGST.
{
  const r = resolvePlaceOfSupply(TG, null, '37');
  eq('B2C customer in another state → INTER-state', r.interState, true);
  eq('B2C basis is the chosen state', r.basis, 'customer_state');
  eq('B2C records the customer state', r.customerState, '37');
}
eq('B2C customer in the same state → intra-state',
   resolvePlaceOfSupply(TG, null, '36').interState, false);
eq('B2C with empty-string GSTIN still uses the state',
   resolvePlaceOfSupply(TG, '', '37').interState, true);

// ── no evidence at all ───────────────────────────────────────────────────────
{
  const r = resolvePlaceOfSupply(TG, null, null);
  eq('no evidence → intra-state', r.interState, false);
  eq('and it says so', r.basis, 'insufficient_evidence');
}
eq('invalid chosen state is not trusted',
   resolvePlaceOfSupply(TG, null, '99').basis, 'insufficient_evidence');
eq('supplier with no GSTIN → intra-state',
   resolvePlaceOfSupply(null, null, '37').interState, false);

// ── the split must always reconstruct the whole ──────────────────────────────
eq('inter-state puts everything in IGST', splitGst(180, true),  { cgst: 0, sgst: 0, igst: 180 });
eq('intra-state halves it',               splitGst(180, false), { cgst: 90, sgst: 90, igst: 0 });
eq('zero',                                splitGst(0, false),   { cgst: 0, sgst: 0, igst: 0 });

// An odd number of paise must not vanish. 0.01 split in half is the classic
// case where cgst + sgst silently stops equalling total_gst and the return
// is rejected at filing.
{
  const s = splitGst(0.01, false);
  eq('one paisa does not vanish', Math.round((s.cgst + s.sgst) * 100) / 100, 0.01);
}
{
  const s = splitGst(90.05, false);
  eq('odd paise still reconstructs', Math.round((s.cgst + s.sgst) * 100) / 100, 90.05);
}
{
  // 18% of 1234.56 — a realistic ugly number.
  const gst = Math.round(1234.56 * 0.18 * 100) / 100;
  const s = splitGst(gst, false);
  eq('realistic amount reconstructs', Math.round((s.cgst + s.sgst) * 100) / 100, gst);
}

// ── the table itself ─────────────────────────────────────────────────────────
eq('no duplicate state codes', GST_STATES.length, new Set(GST_STATES.map(([c]) => c)).size);
eq('Telangana is 36', stateName('36'), 'Telangana');
eq('Andhra Pradesh is 37', stateName('37'), 'Andhra Pradesh');
eq('unknown code has no name', stateName('25'), null);
eq('every code is two digits', GST_STATES.every(([c]) => /^\d{2}$/.test(c)), true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
