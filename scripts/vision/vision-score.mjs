// scripts/vision/vision-score.mjs
// Scoring functions for vision extraction evaluations.

/**
 * Parses numeric rupee value from number or string (handles currency symbols, commas).
 */
export function parseRupee(val) {
  if (val == null) return null
  if (typeof val === 'number') return Math.round(val)
  const clean = String(val).replace(/,/g, '').trim()
  const m = clean.match(/-?\d+(?:\.\d+)?/)
  if (!m) return null
  const num = Number(m[0])
  return Number.isFinite(num) ? Math.round(num) : null
}

/**
 * Checks if total matches exactly to the integer rupee.
 */
export function matchTotal(expected, got) {
  if (expected == null && got == null) return true
  const expNum = parseRupee(expected)
  const gotNum = parseRupee(got)
  if (expNum == null || gotNum == null) return false
  return expNum === gotNum
}

/**
 * Normalizes date string into YYYY-MM-DD when possible.
 */
export function normalizeDate(val) {
  if (!val) return null
  const s = String(val).trim()
  // YYYY-MM-DD or YYYY/MM/DD
  const isoMatch = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/)
  if (isoMatch) {
    const y = isoMatch[1]
    const m = isoMatch[2].padStart(2, '0')
    const d = isoMatch[3].padStart(2, '0')
    return `${y}-${m}-${d}`
  }
  // DD-MM-YYYY or DD/MM/YYYY
  const dmyMatch = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/)
  if (dmyMatch) {
    const d = dmyMatch[1].padStart(2, '0')
    const m = dmyMatch[2].padStart(2, '0')
    const y = dmyMatch[3]
    return `${y}-${m}-${d}`
  }
  const parsed = new Date(s)
  if (!isNaN(parsed.getTime()) && parsed.getFullYear() > 2000) {
    const y = parsed.getFullYear()
    const m = String(parsed.getMonth() + 1).padStart(2, '0')
    const d = String(parsed.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }
  return s.toLowerCase().replace(/\s+/g, '')
}

/**
 * Checks exact date match after normalization.
 */
export function matchDate(expected, got) {
  if (!expected && !got) return true
  if (!expected || !got) return false
  const expNorm = normalizeDate(expected)
  const gotNorm = normalizeDate(got)
  return expNorm === gotNorm
}

/**
 * Checks exact MRP match (rounded to rupee).
 */
export function matchMrp(expected, got) {
  if (expected == null && got == null) return true
  if (expected == null || got == null) return false
  return matchTotal(expected, got)
}

/**
 * Normalizes expiry dates: YYYY-MM-DD, YYYY-MM, MM/YYYY, MM/YY.
 */
export function normalizeExpiry(val) {
  if (!val) return null
  const s = String(val).trim()
  // YYYY-MM-DD
  const isoMatch = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/)
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2].padStart(2, '0')}-${isoMatch[3].padStart(2, '0')}`
  }
  // DD-MM-YYYY
  const dmyMatch = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/)
  if (dmyMatch) {
    return `${dmyMatch[3]}-${dmyMatch[2].padStart(2, '0')}-${dmyMatch[1].padStart(2, '0')}`
  }
  // YYYY-MM
  const ymMatch = s.match(/^(\d{4})[-/.](\d{1,2})$/)
  if (ymMatch) {
    return `${ymMatch[1]}-${ymMatch[2].padStart(2, '0')}`
  }
  // MM/YYYY
  const myMatch = s.match(/^(\d{1,2})[-/.](\d{4})$/)
  if (myMatch) {
    return `${myMatch[2]}-${myMatch[1].padStart(2, '0')}`
  }
  // MM/YY
  const myShort = s.match(/^(\d{1,2})[-/.](\d{2})$/)
  if (myShort) {
    return `20${myShort[2]}-${myShort[1].padStart(2, '0')}`
  }
  const normDate = normalizeDate(s)
  if (normDate) return normDate
  return s.toLowerCase().replace(/\s+/g, '')
}

/**
 * Checks exact expiry match.
 */
export function matchExpiry(expected, got) {
  if (!expected && !got) return true
  if (!expected || !got) return false
  const expNorm = normalizeExpiry(expected)
  const gotNorm = normalizeExpiry(got)
  if (expNorm === gotNorm) return true
  if (expNorm.startsWith(gotNorm) || gotNorm.startsWith(expNorm)) return true
  return false
}

/**
 * Normalizes merchant names by removing common business entity suffixes and punctuation.
 */
export function cleanMerchant(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[.,/#!$%^&*;:{}=\-_`~()'"?]/g, ' ')
    .replace(/\b(pvt|ltd|limited|private|store|stores|kirana|general|medical|pharmacy|tiffin|tiffins|hotel|restaurant|center|centre)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Dice coefficient over character bigrams.
 */
export function diceSimilarity(a, b) {
  if (a === b) return 1.0
  if (!a || !b) return 0.0
  if (a.length < 2 || b.length < 2) return a === b ? 1.0 : (a.includes(b) || b.includes(a) ? 0.7 : 0.0)
  const bigramsA = new Map()
  for (let i = 0; i < a.length - 1; i++) {
    const bg = a.slice(i, i + 2)
    bigramsA.set(bg, (bigramsA.get(bg) || 0) + 1)
  }
  let intersection = 0
  for (let i = 0; i < b.length - 1; i++) {
    const bg = b.slice(i, i + 2)
    const count = bigramsA.get(bg) || 0
    if (count > 0) {
      bigramsA.set(bg, count - 1)
      intersection++
    }
  }
  return (2.0 * intersection) / ((a.length - 1) + (b.length - 1))
}

/**
 * Fuzzy matches merchant names using normalization, inclusion, or bigram similarity.
 */
export function matchMerchant(expected, got) {
  if (!expected && !got) return true
  if (!expected || !got) return false
  const expNorm = cleanMerchant(expected)
  const gotNorm = cleanMerchant(got)
  if (!expNorm || !gotNorm) return false
  if (expNorm === gotNorm) return true
  if (expNorm.includes(gotNorm) || gotNorm.includes(expNorm)) return true
  return diceSimilarity(expNorm, gotNorm) >= 0.55
}

/**
 * Normalizes item names for matching.
 */
export function cleanItemName(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[.,/#!$%^&*;:{}=\-_`~()'"?]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Matches an extracted item against an expected item by price and name.
 */
export function matchItem(exp, got) {
  if (!exp || !got) return false
  const expP = parseRupee(exp.price)
  const gotP = parseRupee(got.price)
  if (expP != null && gotP != null) {
    if (Math.abs(expP - gotP) > 1) return false
  } else if (expP != null || gotP != null) {
    return false
  }
  const expN = cleanItemName(exp.name)
  const gotN = cleanItemName(got.name)
  if (expN === gotN) return true
  if (expN.includes(gotN) || gotN.includes(expN)) return true
  return diceSimilarity(expN, gotN) >= 0.5
}

/**
 * Computes precision, recall and F1 for items based on name + price.
 */
export function scoreItemsF1(expectedItems = [], gotItems = []) {
  const exp = Array.isArray(expectedItems) ? expectedItems : []
  const got = Array.isArray(gotItems) ? gotItems : []
  if (exp.length === 0 && got.length === 0) {
    return { precision: 1.0, recall: 1.0, f1: 1.0, matched: 0, expected: 0, got: 0 }
  }
  if (exp.length === 0 || got.length === 0) {
    return { precision: 0.0, recall: 0.0, f1: 0.0, matched: 0, expected: exp.length, got: got.length }
  }
  const usedGot = new Set()
  let matched = 0
  for (const e of exp) {
    for (let i = 0; i < got.length; i++) {
      if (usedGot.has(i)) continue
      if (matchItem(e, got[i])) {
        usedGot.add(i)
        matched++
        break
      }
    }
  }
  const precision = matched / got.length
  const recall = matched / exp.length
  const f1 = (precision + recall > 0) ? (2 * precision * recall) / (precision + recall) : 0.0
  return {
    precision: Math.round(precision * 1000) / 1000,
    recall: Math.round(recall * 1000) / 1000,
    f1: Math.round(f1 * 1000) / 1000,
    matched,
    expected: exp.length,
    got: got.length,
  }
}

/**
 * Evaluates model extraction against ground truth.
 */
export function scoreVisionRecord(expected, rawGot) {
  let got = rawGot
  let jsonValid = false
  if (typeof rawGot === 'string') {
    try {
      let cleaned = rawGot.trim()
      const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
      if (fenceMatch) cleaned = fenceMatch[1].trim()
      got = JSON.parse(cleaned)
      jsonValid = got !== null && typeof got === 'object'
    } catch {
      got = null
      jsonValid = false
    }
  } else if (rawGot && typeof rawGot === 'object') {
    jsonValid = true
  }

  const checks = {
    json_valid: jsonValid,
    total: false,
    date: false,
    mrp: false,
    expiry: false,
    merchant: false,
  }
  const fails = []

  if (!jsonValid || !got) {
    fails.push('invalid_json')
    const itemsF1 = scoreItemsF1(expected.items, [])
    return {
      pass: false,
      json_valid: false,
      checks,
      fails,
      items_f1: itemsF1,
      got: null,
    }
  }

  // total exact (to the rupee)
  if (expected.total !== undefined && expected.total !== null) {
    checks.total = matchTotal(expected.total, got.total)
    if (!checks.total) fails.push(`total: expected ${expected.total}, got ${got.total}`)
  } else {
    checks.total = true
  }

  // date exact
  if (expected.date) {
    checks.date = matchDate(expected.date, got.date)
    if (!checks.date) fails.push(`date: expected ${expected.date}, got ${got.date}`)
  } else {
    checks.date = true
  }

  // mrp exact
  if (expected.mrp !== undefined && expected.mrp !== null) {
    checks.mrp = matchMrp(expected.mrp, got.mrp)
    if (!checks.mrp) fails.push(`mrp: expected ${expected.mrp}, got ${got.mrp}`)
  } else {
    checks.mrp = true
  }

  // expiry exact
  if (expected.expiry) {
    checks.expiry = matchExpiry(expected.expiry, got.expiry)
    if (!checks.expiry) fails.push(`expiry: expected ${expected.expiry}, got ${got.expiry}`)
  } else {
    checks.expiry = true
  }

  // merchant fuzzy
  if (expected.merchant) {
    checks.merchant = matchMerchant(expected.merchant, got.merchant)
    if (!checks.merchant) fails.push(`merchant: expected "${expected.merchant}", got "${got.merchant}"`)
  } else {
    checks.merchant = true
  }

  // items F1
  const itemsF1 = scoreItemsF1(expected.items, got.items)
  // Line items are scored only on itemised bills. A utility bill's charge
  // lines and a product label's single product are not a shopping list.
  const ITEMISED = new Set(['kirana', 'pharmacy', 'restaurant'])
  if (ITEMISED.has(expected.doc_type) && expected.items && expected.items.length > 0 && itemsF1.f1 < 0.6) {
    fails.push(`items_f1_low: ${itemsF1.f1} (matched ${itemsF1.matched}/${expected.items.length})`)
  }

  const pass = fails.length === 0

  return {
    pass,
    json_valid: true,
    checks,
    fails,
    items_f1: itemsF1,
    got,
  }
}
