// src/lib/aaria-llm.js
// Aaria's understanding brain — multilingual, conversational, Sarvam-powered.
//
// WHY THIS EXISTS (measured on production, 13 Aug 2026)
//   - The remote Aaria NLU (/api/voice/understand) answers
//     {intent:"unknown", confidence:0.0, engine_used:"deterministic"} even for
//     "remind me to call Gautam tomorrow", in ~3.5s. Aaria's health shows
//     sarvam:saaras:v3 (STT) and sarvam:bulbul:v3 (TTS) healthy but
//     pipecat_available:false — so speech in/out work, understanding does not.
//   - Consequence in QuietKeep: the English-first regex parser is effectively
//     the only brain.
//       Telugu  "గౌతమ్ కి రేపు ఉదయం కాల్ చేయమని గుర్తు చెయ్"  → intent "note", no reminder
//       Hindi   "कल सुबह दस बजे बिजली का बिल भरने की याद दिलाना" → intent "note", no reminder
//       both answered with "Intent recorded: … Open loop. Next step unresolved."
//       "Ramesh se paanch sau rupaye aaye" (money RECEIVED) → logged as expense.
//
// PROVIDER: Sarvam (sarvam-m). Chosen because Pranix already pays for Sarvam
// credits, it is purpose-built for Indian languages, and SARVAM_API_KEY is
// already present in production. Auth mirrors src/app/api/sarvam-stt/route.js.
//
// ARCHITECTURE NOTE: sttRouter.ts states Aaria should own provider choice and
// keys. This module is the pragmatic path while Aaria's NLU is deterministic;
// when Aaria's understanding endpoint gains a real LLM, point this at Aaria and
// delete the direct call.
//
// Fail-safe: every path returns null on error/timeout, so voice capture keeps
// its existing regex behaviour if anything goes wrong.

const SARVAM_CHAT_URL = 'https://api.sarvam.ai/v1/chat/completions';
// 13 Aug 2026: Sarvam returned
//   "Model 'sarvam-m' has been deprecated. Please use one of the available
//    models instead: sarvam-105b, sarvam-105b-conversations."
// Overridable without a redeploy via SARVAM_CHAT_MODEL.
const MODEL = process.env.SARVAM_CHAT_MODEL || 'sarvam-105b';
const TIMEOUT_MS = 7000;

const LANG_NAMES = {
  en: 'English', hi: 'Hindi (हिंदी)', te: 'Telugu (తెలుగు)', ta: 'Tamil (தமிழ்)',
  kn: 'Kannada (ಕನ್ನಡ)', ml: 'Malayalam (മലയാളം)', mr: 'Marathi (मराठी)',
  bn: 'Bengali (বাংলা)', gu: 'Gujarati (ગુજરાતી)', pa: 'Punjabi (ਪੰਜਾਬੀ)',
  or: 'Odia (ଓଡ଼ିଆ)',
};

function langName(code) {
  const base = String(code || 'en').split('-')[0].toLowerCase();
  return LANG_NAMES[base] || 'English';
}

// Intents this app can actually execute.
const INTENTS = [
  'reminder', 'task', 'contact', 'meeting', 'purchase',
  'expense', 'income', 'ledger_debit', 'sale', 'invoice',
  'document', 'query', 'note',
];

function buildPrompt({ text, language, nowISO, timezone, workspaceMode }) {
  return `You are Aaria, the voice assistant inside QuietKeep. Decide what the app should DO with what the user said.

CURRENT TIME: ${nowISO} (timezone ${timezone})
MODE: ${workspaceMode === 'business' ? 'Business workspace' : 'Personal'}

The user said (speech-to-text; may contain errors; may be any Indian language, native script or romanised):
"""${text}"""

Reply with ONLY a JSON object, no explanation, no markdown fence:
{
  "intent": one of ${JSON.stringify(INTENTS)},
  "confidence": number 0-1,
  "language_detected": BCP-47 code of the language the USER spoke, e.g. "te-IN",
  "clean_text": the utterance written clearly in the user's own language, wake words removed,
  "title": short label in the user's language, max 60 chars,
  "entities": {
    "person": string or null,
    "datetime_iso": absolute ISO 8601 datetime if a time is stated or implied, else null,
    "datetime_is_explicit": boolean,
    "amount": number or null,
    "currency": "INR" or null,
    "direction": "in" if money received, "out" if money spent/paid/given, else null,
    "item": string or null,
    "location": string or null
  },
  "missing": array from ["datetime","person","amount","item"] — only what you truly need before acting; [] if you can act now,
  "reply": the sentence Aaria SPEAKS next
}

RULES FOR "reply" (it is spoken aloud):
- Write it ONLY in ${langName(language)}. Never answer in English if the user spoke another language.
- Under 20 words, warm, natural, no markdown, no emoji, no jargon.
- If "missing" is not empty, "reply" MUST be a natural question asking for that one thing.
- Otherwise confirm what was done, saying the time in a human way.

OTHER RULES:
- "remind me to pay the electricity bill" is a reminder, NOT an invoice.
- Money RECEIVED (aaye / received / వచ్చాయి / मिले) = "income", direction "in".
  Money PAID (diye / spent / కట్టాను / दिए) = "expense", direction "out". Never swap these.
- Resolve relative time against CURRENT TIME. "tomorrow morning" → next day 09:00 local.
- For a reminder with no usable time, put "datetime" in "missing" and ASK.
- If the user is asking a question rather than storing something, intent = "query".`;
}

/**
 * Understand an utterance; produce a spoken reply in the user's language.
 * Returns null on any failure so callers fall back safely.
 */
export async function aariaUnderstandLLM(text, opts = {}) {
  const clean = (text || '').trim();
  if (!clean) return null;

  const apiKey = process.env.SARVAM_API_KEY;
  if (!apiKey) return null;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);

  try {
    const prompt = buildPrompt({
      text: clean.slice(0, 1000),
      language: opts.language || 'en-IN',
      nowISO: opts.nowISO || new Date().toISOString(),
      timezone: opts.timezone || 'Asia/Kolkata',
      workspaceMode: opts.workspaceMode || 'personal',
    });

    const res = await fetch(SARVAM_CHAT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // sarvam-stt uses this header; chat completions also accepts Bearer.
        'api-subscription-key': apiKey,
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.2,
        max_tokens: 700,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: ctrl.signal,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.error('[aaria-llm] sarvam HTTP', res.status, errText.slice(0, 200));
      return null;
    }

    const data = await res.json();
    const raw = data?.choices?.[0]?.message?.content?.trim() || '';
    const jsonText = raw.replace(/```json|```/g, '').trim();

    let parsed;
    try { parsed = JSON.parse(jsonText); }
    catch {
      const m = jsonText.match(/\{[\s\S]*\}/);
      if (!m) return null;
      try { parsed = JSON.parse(m[0]); } catch { return null; }
    }

    if (!parsed || typeof parsed !== 'object' || !parsed.intent) return null;

    const ents = parsed.entities || {};
    return {
      intent: INTENTS.includes(parsed.intent) ? parsed.intent : 'note',
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.7,
      language: parsed.language_detected || opts.language || 'en-IN',
      cleanText: parsed.clean_text || clean,
      title: parsed.title || null,
      entities: {
        person: ents.person ?? null,
        datetimeISO: ents.datetime_iso ?? null,
        datetimeIsExplicit: !!ents.datetime_is_explicit,
        amount: typeof ents.amount === 'number' ? ents.amount : null,
        currency: ents.currency ?? null,
        direction: ents.direction ?? null,
        item: ents.item ?? null,
        location: ents.location ?? null,
      },
      missing: Array.isArray(parsed.missing) ? parsed.missing : [],
      reply: typeof parsed.reply === 'string' && parsed.reply.trim() ? parsed.reply.trim() : null,
      engine: 'sarvam-m',
    };
  } catch (err) {
    if (err?.name !== 'AbortError') {
      console.error('[aaria-llm] error:', err?.message || String(err));
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export default aariaUnderstandLLM;
