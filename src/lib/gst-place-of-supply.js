// src/lib/gst-place-of-supply.js
// ─────────────────────────────────────────────────────────────────────────────
// Deciding IGST vs CGST+SGST correctly, including for customers with no GSTIN.
//
// WHAT WAS WRONG
// b/invoices decided inter-state by comparing the first two digits of the two
// GSTINs. That is right for B2B and it works. But it returns FALSE whenever the
// customer has no GSTIN — the code comment said so outright, "Same/unknown →
// CGST+SGST".
//
// Under GST law the place of supply for a B2C sale is the RECIPIENT'S LOCATION,
// not a GSTIN they do not have. So an unregistered customer in another state was
// being charged CGST+SGST when the invoice legally requires IGST. QuietKeep is
// releasing across India, so "customer in another state without a GSTIN" is not
// an edge case — for most small shops it is the common case.
//
// WHY THE FIX IS A DROPDOWN AND NOT ADDRESS PARSING
// `customer_address` is free text. Deriving a state from "12-3-45, near the old
// bus stand, Vjy" is a guess, and a guess that silently changes the tax on an
// invoice is worse than asking. One dropdown, defaulting to the supplier's own
// state, costs the shopkeeper nothing on the common intra-state sale and is
// correct on the uncommon one.
// ─────────────────────────────────────────────────────────────────────────────

/** GST state codes — the first two digits of every GSTIN. */
export const GST_STATES = [
  ['01', 'Jammu & Kashmir'], ['02', 'Himachal Pradesh'], ['03', 'Punjab'],
  ['04', 'Chandigarh'], ['05', 'Uttarakhand'], ['06', 'Haryana'],
  ['07', 'Delhi'], ['08', 'Rajasthan'], ['09', 'Uttar Pradesh'],
  ['10', 'Bihar'], ['11', 'Sikkim'], ['12', 'Arunachal Pradesh'],
  ['13', 'Nagaland'], ['14', 'Manipur'], ['15', 'Mizoram'],
  ['16', 'Tripura'], ['17', 'Meghalaya'], ['18', 'Assam'],
  ['19', 'West Bengal'], ['20', 'Jharkhand'], ['21', 'Odisha'],
  ['22', 'Chhattisgarh'], ['23', 'Madhya Pradesh'], ['24', 'Gujarat'],
  ['26', 'Dadra & Nagar Haveli and Daman & Diu'], ['27', 'Maharashtra'],
  ['29', 'Karnataka'], ['30', 'Goa'], ['31', 'Lakshadweep'],
  ['32', 'Kerala'], ['33', 'Tamil Nadu'], ['34', 'Puducherry'],
  ['35', 'Andaman & Nicobar Islands'], ['36', 'Telangana'],
  ['37', 'Andhra Pradesh'], ['38', 'Ladakh'],
  ['97', 'Other Territory'],
];

const VALID_CODES = new Set(GST_STATES.map(([c]) => c));

/** The state code embedded in a GSTIN, or null if it is not a plausible one. */
export function stateCodeFromGstin(gstin) {
  const s = String(gstin || '').trim().toUpperCase();
  if (s.length < 2) return null;
  const code = s.slice(0, 2);
  return VALID_CODES.has(code) ? code : null;
}

export function stateName(code) {
  const hit = GST_STATES.find(([c]) => c === String(code));
  return hit ? hit[1] : null;
}

/**
 * Decide the place of supply.
 *
 * Precedence is deliberate:
 *   1. The customer's GSTIN, when they have one. It is the strongest evidence
 *      and it is what the B2B rule has always used.
 *   2. An explicitly chosen state. This is the B2C case the old code got wrong.
 *   3. Neither → treat as intra-state.
 *
 * Rule 3 is a judgement call worth stating. With no GSTIN and no chosen state we
 * have no evidence at all, and the overwhelming majority of small-shop sales are
 * local. Defaulting to IGST on no evidence would over-tax the common case;
 * defaulting to CGST+SGST under-taxes a rare one. Neither is free, but the UI
 * pre-selects the supplier's own state, so "no evidence" should be rare.
 *
 * @param {string}  supplierGstin
 * @param {string} [customerGstin]
 * @param {string} [customerStateCode] two-digit code chosen in the UI
 * @returns {{interState: boolean, basis: string, supplierState: string|null, customerState: string|null}}
 */
export function resolvePlaceOfSupply(supplierGstin, customerGstin, customerStateCode) {
  const supplier = stateCodeFromGstin(supplierGstin);

  const fromGstin = stateCodeFromGstin(customerGstin);
  if (supplier && fromGstin) {
    return {
      interState: supplier !== fromGstin,
      basis: 'customer_gstin',
      supplierState: supplier,
      customerState: fromGstin,
    };
  }

  const chosen = String(customerStateCode || '').trim();
  if (supplier && VALID_CODES.has(chosen)) {
    return {
      interState: supplier !== chosen,
      basis: 'customer_state',
      supplierState: supplier,
      customerState: chosen,
    };
  }

  return {
    interState: false,
    basis: 'insufficient_evidence',
    supplierState: supplier,
    customerState: null,
  };
}

/**
 * Split a GST amount into the three heads.
 * Halves are rounded to paise, and any rounding remainder is given to SGST so
 * cgst + sgst always equals the total exactly — an invoice whose parts do not
 * sum to its whole is rejected at filing.
 */
export function splitGst(totalGst, interState) {
  const total = Math.round((Number(totalGst) || 0) * 100) / 100;
  if (interState) return { cgst: 0, sgst: 0, igst: total };
  const cgst = Math.round((total / 2) * 100) / 100;
  const sgst = Math.round((total - cgst) * 100) / 100;
  return { cgst, sgst, igst: 0 };
}

export default resolvePlaceOfSupply;
