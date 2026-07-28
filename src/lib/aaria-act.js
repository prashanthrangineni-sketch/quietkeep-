// src/lib/aaria-act.js
// Aaria as the ACTION BRAIN (SOT P1).
//
// WHY
// /api/voice/capture parses utterances with regex. When that fails, the
// utterance is filed as a generic 'note' and NOTHING happens — the assistant
// silently does nothing useful. That is the gap this closes: hand those
// utterances to Aaria, which understands intent and can act on it.
//
// FLOW (contract taken from Aaria's OpenAPI spec, not guessed):
//   POST /api/voice/understand { text, product, lang_hint }
//     -> { intent, entities, confidence, engine_used }
//   POST /api/voice/act        { intent, entities, product, user_identity, scope }
//     -> { success, result, action_taken, isolation_verified, error_message }
//
// SAFETY — scope defaults to 'read'.
// This helper runs AUTOMATICALLY on utterances the regex could not parse, so it
// must never silently mutate data. Read scope lets Aaria answer/look things up;
// a caller must opt in explicitly to 'write'. isolation_verified is surfaced so
// the caller can tell whether Aaria confirmed per-product tenant isolation.
//
// Fail-safe by construction: every path returns null rather than throwing, and
// the whole thing is time-boxed, so a slow or down Aaria can never block or
// break a voice capture.

const AARIA_BASE_URL = process.env.AARIA_BASE_URL || 'https://pranix-aaria.onrender.com';
const PRODUCT = 'QuietKeep';

// Aaria is on Render and can cold-start. Cap total added latency.
const UNDERSTAND_TIMEOUT_MS = 3500;
const ACT_TIMEOUT_MS = 4000;

// Below this we don't trust the interpretation enough to act on it.
const MIN_CONFIDENCE = 0.55;

async function postJSON(path, body, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${AARIA_BASE_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    return await res.json().catch(() => null);
  } catch {
    return null; // timeout, abort, network — all non-fatal
  } finally {
    clearTimeout(timer);
  }
}

/** Understand only — no side effects. */
export async function aariaUnderstand(text, { lang = 'en' } = {}) {
  const clean = (text || '').trim().slice(0, 1000);
  if (!clean) return null;
  return postJSON('/api/voice/understand',
    { text: clean, product: PRODUCT, lang_hint: lang }, UNDERSTAND_TIMEOUT_MS);
}

/**
 * Understand, then act if the interpretation is confident enough.
 * Returns null when Aaria is unavailable or unsure, so callers can fall back.
 */
export async function aariaAssist(text, { userId, lang = 'en', scope = 'read' } = {}) {
  if (!userId) return null;

  const understood = await aariaUnderstand(text, { lang });
  if (!understood?.intent) return null;

  const confidence = typeof understood.confidence === 'number' ? understood.confidence : 0;
  const intent = understood.intent;

  // Unknown / low confidence: report the read WITHOUT acting on it.
  if (intent === 'unknown' || confidence < MIN_CONFIDENCE) {
    return {
      handled: false,
      intent,
      confidence,
      engine_used: understood.engine_used || 'aaria',
      reason: intent === 'unknown' ? 'unknown_intent' : 'low_confidence',
    };
  }

  const acted = await postJSON('/api/voice/act', {
    intent,
    entities: understood.entities || {},
    product: PRODUCT,
    user_identity: String(userId),
    scope,
  }, ACT_TIMEOUT_MS);

  if (!acted) {
    return { handled: false, intent, confidence, engine_used: understood.engine_used || 'aaria', reason: 'act_unavailable' };
  }

  return {
    handled: !!acted.success,
    intent,
    confidence,
    entities: understood.entities || {},
    engine_used: understood.engine_used || 'aaria',
    action_taken: acted.action_taken || null,
    result: acted.result ?? null,
    isolation_verified: !!acted.isolation_verified,
    scope,
    error: acted.error_message || null,
  };
}

export default aariaAssist;
