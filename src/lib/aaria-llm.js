// src/lib/aaria-llm.js
// Aaria's understanding brain — multilingual, conversational.
//
// WHY THIS EXISTS
// Intent detection was regex-first (`intent-parser.js`) with the remote Aaria
// service as fallback. Measured on production 13 Aug 2026:
//   - Aaria /api/voice/understand returned {intent:"unknown", confidence:0.0,
//     engine_used:"deterministic"} for "remind me to call Gautam tomorrow",
//     in ~3.5s. It rescues nothing.
//   - Telugu "గౌతమ్ కి రేపు ఉదయం కాల్ చేయమని గుర్తు చెయ్" (= remind me to call
//     Gautam tomorrow morning) → intent "note", reply "Intent recorded: … Open
//     loop. Next step unresolved." No reminder created.
//   - Hindi "कल सुबह दस बजे बिजली का बिल भरने की याद दिलाना" → same.
//   - "Ramesh se paanch sau rupaye aaye" (money RECEIVED) → logged as an
//     *expense* — wrong direction.
//
// This module understands the utterance properly and answers in the user's own
// language. Everything is best-effort: any failure returns null and the caller
// keeps its existing behaviour.

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-haiku-4-5-20251001'; // low latency matters for voice
const TIMEOUT_MS = 6000;

const LANG_NAMES = {
  en: 'English', 'en-IN': 'English',
  hi: 'Hindi (हिंदी)', 'hi-IN': 'Hindi (हिंदी)',
  te: 'Telugu (తెలుగు)', 'te-IN': 'Telugu (తెలుగు)',
  ta: 'Tamil (தமிழ்)', 'ta-IN': 'Tamil (தமிழ்)',
  kn: 'Kannada (ಕನ್ನಡ)', 'kn-IN': 'Kannada (ಕನ್ನಡ)',
  ml: 'Malayalam (മലയാളം)', 'ml-IN': 'Malayalam (മലയാളം)',
  mr: 'Marathi (मराठी)', 'mr-IN': 'Marathi (मराठी)',
  bn: 'Bengali (বাংলা)', 'bn-IN': 'Bengali (বাংলা)',
  gu: 'Gujarati (ગુજરાતી)', 'gu-IN': 'Gujarati (ગુજરાતી)',
  pa: 'Punjabi (ਪੰਜਾਬੀ)', 'pa-IN': 'Punjabi (ਪੰਜਾਬੀ)',
};

// Intents the app can actually execute today.
const INTENTS = [
  'reminder',      // time-based nudge
  'task',          // to-do, no firm time
  'contact',       // call/message someone
  'meeting',       // scheduled with people
  'purchase',      // buy / shopping item
  'expense',       // money SPENT
  'income',        // money RECEIVED (business ledger credit)
  'ledger_debit',  // money given / credit extended
  'sale',          // a sale was made
  'invoice',       // bill/invoice to raise or pay
  'document',      // scan/store a document
  'query',         // a question — user wants an answer back
  'note',          // plain note, nothing to execute
];

function buildPrompt({ text, language, nowISO, timezone, workspaceMode, recentContext }) {
  const langName = LANG_NAMES[language] || LANG_NAMES[String(language || '').slice(0, 2)] || 'English';
  return `You are Aaria, a voice assistant for QuietKeep. You understand what the user said and decide what the app should DO.

CURRENT TIME: ${nowISO} (timezone ${timezone || 'Asia/Kolkata'})
MODE: ${workspaceMode === 'business' ? 'Business workspace' : 'Personal'}
${recentContext ? `RECENT CONVERSATION:\n${recentContext}\n` : ''}
The user said (speech-to-text, may contain errors, may be in any Indian language, native script or romanised):
"""${text}"""

Return ONLY a JSON object, no prose, with exactly these fields:
{
  "intent": one of ${JSON.stringify(INTENTS)},
  "confidence": 0.0-1.0,
  "language_detected": BCP-47 code of the language the USER actually spoke (e.g. "te-IN"),
  "clean_text": the utterance rewritten clearly in the user's own language, wake words removed,
  "title": a short label for this item in the user's language (max 60 chars),
  "entities": {
     "person": name of the person mentioned, else null,
     "datetime_iso": absolute ISO 8601 datetime if a time is stated or clearly implied, else null,
     "datetime_is_explicit": true only if the user actually stated a time/day,
     "amount": number if money is mentioned, else null,
     "currency": "INR" or null,
     "direction": for money — "in" if received/credit, "out" if spent/paid/given, else null,
     "item": thing to buy/scan/store, else null,
     "location": place mentioned, else null
  },
  "missing": array of slots you genuinely need before acting. Use only ["datetime","person","amount","item"]. Empty array if you can act now.
  "reply": what Aaria SAYS OUT LOUD next.
}

RULES FOR "reply" — this is spoken aloud, so it must sound like a person:
- Write it ONLY in ${langName}. Never reply in English if the user spoke another language.
- Keep it under 20 words, warm and natural. No markdown, no emoji, no technical words.
- If "missing" is non-empty, the reply MUST be a natural question asking for exactly that one thing.
- If nothing is missing, confirm what you have done, including the time in a human way.

OTHER RULES:
- "remind me to pay the electricity bill" is a REMINDER, not an invoice.
- Money RECEIVED ("paise aaye", "received", "వచ్చాయి") is "income" with direction "in".
  Money PAID ("diye", "spent", "కట్టాను") is "expense" with direction "out". Never confuse these.
- Resolve relative time against CURRENT TIME. "tomorrow morning" → next day 09:00.
- If the user only says a vague time like "later" or gives none for a reminder, put "datetime" in "missing" and ASK.
- If the user is asking a question rather than storing something, use intent "query".`;
}

/**
 * Understand an utterance and produce a spoken reply in the user's language.
 * Returns null on any failure so callers can fall back safely.
 */
export async function aariaUnderstandLLM(text, opts = {}) {
  const clean = (text || '').trim();
  if (!clean) return null;

  const apiKey = process.env.ANTHROPIC_API_KEY;
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
      recentContext: opts.recentContext || '',
    });

    const res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 600,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: ctrl.signal,
    });

    if (!res.ok) {
      console.error('[aaria-llm] anthropic HTTP', res.status);
      return null;
    }

    const data = await res.json();
    const raw = data?.content?.[0]?.text?.trim() || '';
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
      engine: 'claude-haiku',
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
