// src/lib/document-classify.js
// ─────────────────────────────────────────────────────────────────────────────
// Reading a document well enough to file it, and to know when it expires.
//
// WHY THIS EXISTS
// Google Drive and every phone gallery do the same thing with a photo of a
// document: they store it. Finding it later is the user's problem, and knowing
// that your passport lapses in six weeks is definitely the user's problem.
// QuietKeep's `documents` table already has `category`, `expiry_date` and
// `reminder_days_before` — the filing cabinet exists. Nothing fills it in.
//
// So the model reads the document once, on upload, and proposes: what is this,
// what should it be called, when does it expire. The user confirms with one tap.
//
// THE PART THAT ACTUALLY MATTERS
// Not the classification — that is easy and a wrong guess costs one tap. It is
// the EXPIRY DATE, because a wrong date is worse than no date: it produces a
// confident reminder on the wrong day, and the user stops trusting every other
// reminder in the app.
//
// Hence the date rules below, and why every helper here is a pure function with
// tests. The network call is the trivial part; this is where correctness lives.
// ─────────────────────────────────────────────────────────────────────────────

/** The exact categories src/app/documents/page.jsx renders. Do not add here alone. */
export const CATEGORIES = [
  'Passport', 'Vaccination', 'Insurance', 'License', 'Property',
  'Financial', 'Medical', 'Aadhar', 'PAN', 'Vehicle', 'Other',
];

/**
 * Words a model is likely to return, mapped to the category the app actually has.
 * Deliberately explicit: a fuzzy match would put a "vehicle insurance policy"
 * under Vehicle or Insurance depending on word order, which is a coin toss the
 * user then has to correct every time.
 */
const CATEGORY_HINTS = {
  passport: 'Passport',
  visa: 'Passport',
  vaccination: 'Vaccination', vaccine: 'Vaccination', immunisation: 'Vaccination', immunization: 'Vaccination',
  insurance: 'Insurance', policy: 'Insurance', mediclaim: 'Insurance',
  license: 'License', licence: 'License', 'driving licence': 'License', 'driving license': 'License',
  dl: 'License',
  property: 'Property', deed: 'Property', 'sale deed': 'Property', 'rent agreement': 'Property',
  lease: 'Property', 'khata certificate': 'Property',
  financial: 'Financial', bank: 'Financial', statement: 'Financial', 'salary slip': 'Financial',
  payslip: 'Financial', itr: 'Financial', 'form 16': 'Financial', 'demat': 'Financial',
  medical: 'Medical', prescription: 'Medical', 'lab report': 'Medical', discharge: 'Medical',
  'health report': 'Medical',
  aadhar: 'Aadhar', aadhaar: 'Aadhar', uid: 'Aadhar',
  pan: 'PAN', 'pan card': 'PAN',
  vehicle: 'Vehicle', rc: 'Vehicle', 'registration certificate': 'Vehicle', puc: 'Vehicle',
  'pollution certificate': 'Vehicle', fitness: 'Vehicle',
};

/**
 * Force whatever the model said into a category the app can actually render.
 * Unknown → 'Other'. Never invent a category; the UI has no colour for it.
 */
export function normaliseCategory(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (!s) return 'Other';

  const exact = CATEGORIES.find((c) => c.toLowerCase() === s);
  if (exact) return exact;

  // Longest hint first, so "driving licence" beats "licence" and
  // "registration certificate" is not shadowed by a shorter key.
  const keys = Object.keys(CATEGORY_HINTS).sort((a, b) => b.length - a.length);
  for (const k of keys) {
    if (s.includes(k)) return CATEGORY_HINTS[k];
  }
  return 'Other';
}

/**
 * Parse a date off an Indian document into ISO, or return null.
 *
 * THE TRAP: 03/04/2027 is 3 April in India and 4 March in the United States.
 * Every model on the market is trained mostly on US text and will happily read
 * it the American way. On an Indian passport, RC or insurance policy that is
 * simply wrong, and it silently moves a renewal reminder by up to eleven months.
 *
 * So: slash- and dot-separated dates are read DAY FIRST, always. The only
 * unambiguous alternative is ISO (YYYY-MM-DD), which is detected by shape. When
 * a value cannot be read confidently, this returns null — no date at all beats
 * a confident wrong one.
 */
export function normaliseDate(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s || /^(n\/?a|none|null|unknown|not applicable|lifetime|permanent)$/i.test(s)) return null;

  let y, m, d;

  // ISO first — unambiguous by construction.
  let mt = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (mt) { [, y, m, d] = mt.map(Number); }

  // DD/MM/YYYY or DD-MM-YYYY or DD.MM.YYYY — day first, deliberately.
  if (!y) {
    mt = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
    if (mt) { d = +mt[1]; m = +mt[2]; y = +mt[3]; }
  }

  // DD Mon YYYY / Mon DD YYYY — month name removes the ambiguity entirely.
  if (!y) {
    const MONTHS = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
    mt = s.match(/^(\d{1,2})\s+([a-z]{3,})\.?,?\s+(\d{4})$/i);
    if (mt) {
      const mi = MONTHS.indexOf(mt[2].slice(0, 3).toLowerCase());
      if (mi >= 0) { d = +mt[1]; m = mi + 1; y = +mt[3]; }
    }
    if (!y) {
      mt = s.match(/^([a-z]{3,})\.?\s+(\d{1,2}),?\s+(\d{4})$/i);
      if (mt) {
        const mi = MONTHS.indexOf(mt[1].slice(0, 3).toLowerCase());
        if (mi >= 0) { m = mi + 1; d = +mt[2]; y = +mt[3]; }
      }
    }
  }

  if (!y || !m || !d) return null;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;

  // Reject dates that are real strings but impossible days (31 Feb, 31 Apr).
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;

  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * Is this expiry date plausible enough to act on?
 *
 * An OCR misread turns 2027 into 2077 or 2007 without changing anything a human
 * would notice. A reminder fifty years out is harmless noise; one in the past is
 * a red "EXPIRED" badge on a perfectly valid passport, which makes the user
 * distrust the feature immediately.
 *
 * @param {string} iso    'YYYY-MM-DD'
 * @param {Date}   [now]  injectable for tests
 */
export function isPlausibleExpiry(iso, now = new Date()) {
  if (!iso) return false;
  const t = Date.parse(`${iso}T00:00:00Z`);
  if (!Number.isFinite(t)) return false;
  const years = (t - now.getTime()) / (365.25 * 24 * 3600 * 1000);
  // A document already 5 years expired is far more likely a misread than a real
  // thing worth filing; 30 years out is beyond any Indian document's validity.
  return years > -5 && years < 30;
}

/** Trim a proposed name to something that fits a list row. */
export function normaliseName(raw, category) {
  const s = String(raw || '').trim().replace(/\s+/g, ' ');
  if (!s) return category && category !== 'Other' ? category : 'Document';
  // 60 characters INCLUDING the ellipsis, so the contract and the output agree.
  return s.length > 60 ? `${s.slice(0, 59)}…` : s;
}

/**
 * How many days before expiry to nudge. Longer lead where renewal is slow.
 * A passport renewal takes weeks; a PUC certificate takes an afternoon.
 */
export function defaultLeadDays(category) {
  switch (category) {
    case 'Passport':  return 180;   // appointments and police verification
    case 'Insurance': return 45;
    case 'License':   return 60;
    case 'Vehicle':   return 30;    // PUC, fitness — quick to renew
    case 'Property':  return 90;
    default:          return 30;
  }
}

/**
 * Turn a raw model response into something safe to write to `documents`.
 * Returns only fields the caller should prefill; never throws.
 */
export function toDocumentFields(modelJson, now = new Date()) {
  const raw = modelJson && typeof modelJson === 'object' ? modelJson : {};

  const category = normaliseCategory(raw.category);
  const expiry   = normaliseDate(raw.expiry_date);
  const usable   = expiry && isPlausibleExpiry(expiry, now) ? expiry : null;

  const conf = typeof raw.confidence === 'number' ? raw.confidence : 0;

  return {
    category,
    name: normaliseName(raw.name || raw.title, category),
    expiry_date: usable,
    // Surfaced so the UI can say "I could not read the expiry date" rather than
    // silently leaving the field blank as if it had not tried.
    expiry_unreadable: !!(raw.expiry_date && !usable),
    doc_number: raw.doc_number ? String(raw.doc_number).trim().slice(0, 40) : null,
    reminder_days_before: defaultLeadDays(category),
    confidence: Math.max(0, Math.min(1, conf)),
    // Below this the UI should present the guess as a question, not a fact.
    low_confidence: conf < 0.6,
  };
}

/** The instruction sent to the vision model. */
export const CLASSIFY_PROMPT = `You are filing a document for an Indian user of QuietKeep.

Reply with ONLY a JSON object. No markdown fence, no explanation.

{
  "category": one of ${JSON.stringify(CATEGORIES)},
  "name": a short human label, e.g. "Passport — Prashanth" or "Bajaj car insurance",
  "expiry_date": the expiry / valid-until date EXACTLY as printed on the document,
  "doc_number": the document's own number if clearly visible,
  "confidence": 0-1, how sure you are of the category
}

RULES:
- Copy "expiry_date" VERBATIM as printed. Do NOT reformat it, do not convert it,
  do not guess the order of day and month. If the document prints 03/04/2027,
  return "03/04/2027". Reformatting is handled after you.
- If there is no expiry date, omit the key entirely. Do not invent one.
- Omit any key you cannot read. An absent key is fine; a wrong value is not.
- Do not transcribe full Aadhaar or PAN numbers. For those, return only the last
  4 characters in "doc_number".
- If the image is not a document at all, use category "Other" and confidence 0.`;

export default toDocumentFields;
