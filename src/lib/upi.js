// src/lib/upi.js
// ─────────────────────────────────────────────────────────────────────────────
// UPI (Unified Payments Interface) format check, URI parser, and pay link generator.
//
// Rules according to NPCI specifications:
// - A VPA has the format <username>@<bankhandle> (e.g. shopname@okhdfcbank, 9876543210@paytm)
// - Username: 2 to 256 alphanumeric characters plus allowable punctuation (., -, _)
// - Bank handle: 2 to 64 alphanumeric characters plus allowable punctuation
// - Exactly one '@' symbol, no spaces or control characters
// - UPI URI scheme: upi://pay?pa=...&pn=...&am=...&tn=...&cu=INR
// ─────────────────────────────────────────────────────────────────────────────

// Standard NPCI VPA format regex
const UPI_ID_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9.\-_]{1,255}@[a-zA-Z0-9.\-_]{2,64}$/;

/**
 * Validates a UPI ID / VPA string.
 * @param {string} id - The UPI ID to validate
 * @returns {{ valid: boolean, upiId?: string, error?: string }}
 */
export function validateUpiId(id) {
  if (id == null) {
    return { valid: false, error: 'UPI ID is required' };
  }

  const raw = String(id).trim();
  if (!raw) {
    return { valid: false, error: 'UPI ID cannot be empty' };
  }

  if (/\s/.test(raw)) {
    return { valid: false, error: 'UPI ID cannot contain spaces' };
  }

  const atParts = raw.split('@');
  if (atParts.length < 2) {
    return { valid: false, error: 'UPI ID must contain an @ symbol (e.g. yourname@bank)' };
  }
  if (atParts.length > 2) {
    return { valid: false, error: 'UPI ID cannot contain more than one @ symbol' };
  }

  const [username, handle] = atParts;
  if (!username) {
    return { valid: false, error: 'UPI ID is missing username before @' };
  }
  if (!handle) {
    return { valid: false, error: 'UPI ID is missing bank handle after @' };
  }

  if (!UPI_ID_REGEX.test(raw)) {
    return {
      valid: false,
      error: 'Invalid UPI ID format. Expected format: username@bank (e.g. myshop@okaxis or 9876543210@paytm)',
    };
  }

  return { valid: true, upiId: raw.toLowerCase() };
}

/**
 * Returns true if the UPI ID is valid.
 * @param {string} id
 * @returns {boolean}
 */
export function isValidUpiId(id) {
  return validateUpiId(id).valid;
}

/**
 * Normalizes a UPI ID to trimmed lowercase, or null if invalid.
 * @param {string} id
 * @returns {string|null}
 */
export function normalizeUpiId(id) {
  const result = validateUpiId(id);
  return result.valid ? result.upiId : null;
}

/**
 * Parses a UPI URI string (e.g. upi://pay?pa=... or scanned QR content) or raw VPA.
 * @param {string} uriString
 * @returns {{ valid: boolean, pa: string|null, pn: string|null, am: number|null, tn: string|null, cu: string, raw: string, error?: string }}
 */
export function parseUpiUri(uriString) {
  const raw = (uriString || '').trim();
  if (!raw) {
    return { valid: false, pa: null, pn: null, am: null, tn: null, cu: 'INR', raw, error: 'Empty UPI string' };
  }

  // Handle case where raw string is already just a VPA (e.g. merchant@okhdfcbank)
  if (!/^upi:\/\//i.test(raw)) {
    const vpaCheck = validateUpiId(raw);
    if (vpaCheck.valid) {
      return {
        valid: true,
        pa: vpaCheck.upiId,
        pn: null,
        am: null,
        tn: null,
        cu: 'INR',
        raw,
      };
    }
    // If not a VPA and not a upi:// URI
    return {
      valid: false,
      pa: null,
      pn: null,
      am: null,
      tn: null,
      cu: 'INR',
      raw,
      error: 'Not a valid UPI URI or UPI ID',
    };
  }

  try {
    const qIndex = raw.indexOf('?');
    const queryString = qIndex !== -1 ? raw.slice(qIndex + 1) : '';
    const params = new URLSearchParams(queryString);

    const paRaw = params.get('pa') || '';
    const vpaCheck = validateUpiId(paRaw);
    if (!vpaCheck.valid) {
      return {
        valid: false,
        pa: paRaw || null,
        pn: params.get('pn') || null,
        am: null,
        tn: params.get('tn') || null,
        cu: params.get('cu') || 'INR',
        raw,
        error: `Invalid payee UPI ID (pa): ${vpaCheck.error}`,
      };
    }

    const amRaw = params.get('am');
    let am = null;
    if (amRaw != null && amRaw !== '') {
      const parsedAm = parseFloat(amRaw);
      if (Number.isFinite(parsedAm) && parsedAm >= 0) {
        am = Math.round((parsedAm + Number.EPSILON) * 100) / 100;
      }
    }

    return {
      valid: true,
      pa: vpaCheck.upiId,
      pn: params.get('pn') ? decodeURIComponent(params.get('pn')) : null,
      am,
      tn: params.get('tn') ? decodeURIComponent(params.get('tn')) : null,
      cu: params.get('cu') || 'INR',
      raw,
    };
  } catch (err) {
    return {
      valid: false,
      pa: null,
      pn: null,
      am: null,
      tn: null,
      cu: 'INR',
      raw,
      error: `Failed to parse UPI URI: ${err.message}`,
    };
  }
}

/**
 * Builds a valid NPCI UPI payment intent URI.
 * Opens any UPI app (Google Pay, PhonePe, Paytm, BHIM, etc.) on mobile.
 *
 * @param {object} params
 * @param {string} params.pa - Shop UPI ID (payee address)
 * @param {string} params.pn - Shop name (payee name)
 * @param {number|string} params.am - Amount in INR (total)
 * @param {string} params.tn - Transaction note / short order ref
 * @param {string} [params.cu='INR'] - Currency code
 * @returns {string} The formatted upi://pay URI
 */
export function buildUpiPayUri({ pa, pn, am, tn, cu = 'INR' }) {
  const vpaCheck = validateUpiId(pa);
  if (!vpaCheck.valid) {
    throw new Error(`Invalid payee UPI ID: ${vpaCheck.error}`);
  }

  const cleanPa = vpaCheck.upiId;
  const cleanPn = (pn || 'Shop').trim();

  const numAm = Number(am);
  if (!Number.isFinite(numAm) || numAm <= 0) {
    throw new Error(`Payment amount must be a positive number, received: ${am}`);
  }
  const cleanAm = (Math.round((numAm + Number.EPSILON) * 100) / 100).toFixed(2);

  const cleanTn = (tn || 'Order').trim();
  const cleanCu = (cu || 'INR').trim().toUpperCase();

  const params = new URLSearchParams();
  params.set('pa', cleanPa);
  params.set('pn', cleanPn);
  params.set('am', cleanAm);
  params.set('tn', cleanTn);
  params.set('cu', cleanCu);

  return `upi://pay?${params.toString()}`;
}

/**
 * Helper to compute cart line items total safely with decimal rounding.
 * @param {Array<{ price?: number, selling_price?: number, quantity?: number, qty?: number }>} items
 * @returns {number}
 */
export function calculateCartTotal(items) {
  if (!Array.isArray(items) || items.length === 0) return 0;

  const total = items.reduce((sum, item) => {
    const price = Number(item.selling_price ?? item.price ?? 0);
    const qty = Number(item.quantity ?? item.qty ?? item.units ?? 1);
    if (!Number.isFinite(price) || price < 0 || !Number.isFinite(qty) || qty <= 0) {
      return sum;
    }
    return sum + (price * qty);
  }, 0);

  return Math.round((total + Number.EPSILON) * 100) / 100;
}
