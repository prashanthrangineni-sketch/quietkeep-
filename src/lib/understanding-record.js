// src/lib/understanding-record.js
//
// WHY THIS EXISTS
// On the morning of 30 September 2026 the founder said
//   "5 నిమిషాల్లో సూర్య కిరణ్‌కి కాల్ చెయ్యి"
// and Aaria asked "when?". Nothing in the database could say why. The audit
// row for a voice capture records the intent and a confidence and whether a
// follow-up was needed - and not whether the language model ran at all, what
// it returned, whether it timed out, or whether it saw a time in the sentence.
// The diagnosis took a morning of guessing. It turned out to be the recogniser
// (the sentence had arrived as "Inshallah Surya Kiran ki call chahiye" - no
// number, no minutes, so the brain rightly asked). One field would have said
// so in a second.
//
// Two pure functions, no I/O:
//
//   whyBrainRun(...)   - the decision the capture route used to make inline,
//                        returned WITH its reasons so the audit can carry them.
//   describeUnderstanding(...) - the compact record written to audit_log and
//                        returned to the client. Never the prompt, never the
//                        key, never the raw model output: the transcript is
//                        already stored on the keep, and everything else here
//                        is small, structured and safe to keep forever.
//
// Both are exercised by tests/understanding-record.test.mjs, and the live
// brain is exercised by scripts/eval-understanding.mjs against
// tests/fixtures/understanding-cases.json - which is how "the model
// understands Telugu" stops being a belief and becomes a number.

export const MONEY_TYPES = new Set([
  'expense', 'income', 'purchase', 'sale', 'invoice', 'ledger_credit', 'ledger_debit',
])

// Romanised Hindi / Telugu function words. A sentence carrying these arrives
// tagged en-IN from the recogniser and the English regex parser will file it
// as a note. Measured 13 Aug 2026.
export const ROMAN_INDIC =
  /\b(se|ko|ka|ki|ke|liye|diye|diya|aaye|aaya|mile|mila|rupaye|rupay|rupees|hazaar|hajaar|sau|lakh|kal|aaj|parso|subah|shaam|raat|baje|yaad|dilana|karna|chahiye|nahi|gurthu|repu|nenu|meeru|cheyyi|kavali|ivvu|vachindi|ravali)\b/i

/**
 * Should the language model read this sentence, and why.
 *
 * @param {object} args
 * @param {{type?:string, confidence?:number}} args.parsed  regex parser result
 * @param {string} args.text                                cleaned transcript
 * @param {string} args.language                            BCP-47, e.g. te-IN
 * @param {Date|null} args.reminderAt                       what the regex resolved
 * @returns {{ run: boolean, reasons: string[] }}
 */
export function whyBrainRun({ parsed, text, language, reminderAt }) {
  const reasons = []
  const type = parsed?.type
  const confidence = parsed?.confidence ?? 0
  const langBase = String(language || 'en').split('-')[0]

  if (type === 'unknown' || type === 'note' || confidence < 0.7) reasons.push('regex_weak')
  if (langBase !== 'en') reasons.push('non_english')
  if (MONEY_TYPES.has(type)) reasons.push('money_shaped')
  if (ROMAN_INDIC.test(text || '')) reasons.push('romanised_indic')
  if ((type === 'reminder' || type === 'task') && !reminderAt) reasons.push('no_time_found')

  return { run: reasons.length > 0, reasons }
}

/**
 * The record of one understanding attempt. Small, structured, no secrets.
 *
 * @param {object} args
 * @param {{run:boolean, reasons:string[]}} args.decision  from whyBrainRun
 * @param {object|null} args.llmAssist   what aariaUnderstandLLM returned (null = nothing usable)
 * @param {number|null} args.latencyMs   wall time of the brain call
 * @param {string|null} args.failure     'timeout' | 'http' | 'no_json' | 'threw' | null
 * @param {number} args.threshold        the confidence gate the route applies
 */
export function describeUnderstanding({ decision, llmAssist, latencyMs = null, failure = null, threshold = 0.55 }) {
  if (!decision?.run) {
    return { engine: 'regex', ran: false, reasons: [], outcome: 'regex_only' }
  }
  if (!llmAssist) {
    return {
      engine: 'llm',
      ran: true,
      reasons: decision.reasons,
      outcome: failure ? `failed_${failure}` : 'returned_nothing',
      latency_ms: latencyMs,
    }
  }
  const confidence = typeof llmAssist.confidence === 'number' ? llmAssist.confidence : null
  const accepted = confidence !== null && confidence >= threshold
  return {
    engine: 'llm',
    ran: true,
    reasons: decision.reasons,
    outcome: accepted ? 'accepted' : 'below_threshold',
    model: llmAssist.engine || null,
    intent: llmAssist.intent ?? null,
    confidence,
    language_detected: llmAssist.language || null,
    person_found: Boolean(llmAssist.entities?.person),
    time_found: Boolean(llmAssist.entities?.datetimeISO),
    missing: Array.isArray(llmAssist.missing) ? llmAssist.missing : [],
    latency_ms: latencyMs,
  }
}
