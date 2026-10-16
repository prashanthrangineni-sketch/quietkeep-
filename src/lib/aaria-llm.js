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
// Measured on production 13 Aug 2026 with the Hindi benchmark utterance:
//   sarvam-105b-conversations  200, 4.2s, clean JSON, correct reminder + Hindi reply
//   sarvam-105b (reasoning)    200, 4.9s, finish_reason "length", content null —
//                              it spends the whole budget on reasoning_content.
// So: the conversational variant is the brain. Do not switch back without
// re-running /api/debug/aaria-llm.
const MODEL = process.env.SARVAM_CHAT_MODEL || 'sarvam-105b-conversations';
// Sarvam answers the full understanding prompt in ~4-5s. 7s was cutting it off.
const TIMEOUT_MS = Number(process.env.SARVAM_CHAT_TIMEOUT_MS || 12000);

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

// Intents the brain may answer. The first fourteen are things the app saves or
// does. The last six (15 Oct 2026, measured gap list in
// measurements/understanding-latest.md) are mostly things it must NOT save:
//   trip, compliance  saved as their own keep types (read-back level)
//   confirm           a bare yes / no / cancel - only means something as the
//                     answer to a question Aaria asked; on its own it saves nothing
//   delete            remove ONE existing item - read back, then a spoken yes
//   pay               money leaving an account - never by voice (PIN level)
//   none              thanks, small talk, a statement needing no action
// What each one is allowed to do is decided by src/lib/action-levels.js, not here.
//
// The last three (15 Oct 2026) are the shop's own records, business workspace
// only, handled by src/lib/business-voice.js:
//   attendance  mark a staff member present / absent / half day / leave
//   stock       add to, take from, or ask about an inventory item
//   payroll     a DRAFT salary worked out from recorded attendance - never paid
export const INTENTS = [
  'reminder', 'task', 'contact', 'meeting', 'purchase',
  'expense', 'income', 'ledger_debit', 'sale', 'invoice',
  'document', 'navigation', 'query', 'note',
  'trip', 'compliance', 'confirm', 'delete', 'pay', 'none',
  'attendance', 'stock', 'payroll',
];

// THE CLOCK THE MODEL READS MUST BE THE USER'S.
//
// CURRENT TIME used to be handed over as a bare UTC ISO string with the timezone
// named beside it, and the model was left to do the arithmetic. It did not. On
// 26 September 2026 at 17:34 IST it resolved "in five minutes" and reported
// 12:09 — the UTC wall clock — which the app then read out loud and then failed
// to store, because 12:09 taken as Indian time is five and a half hours in the
// past.
//
// Both the local wall clock and the absolute instant are now stated, so there is
// nothing left to infer.
function clockFor(nowISO, timeZone) {
  const d = new Date(nowISO);
  if (isNaN(d.getTime())) return String(nowISO);
  const local = new Intl.DateTimeFormat('en-GB', {
    timeZone, hour12: false,
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }).format(d);
  return `${local} local time in ${timeZone} (the same instant is ${d.toISOString()} UTC)`;
}

export function buildPrompt({ text, language, nowISO, timezone, workspaceMode, pageLabel }) {
  return `You are Aaria, the voice assistant inside QuietKeep. Decide what the app should DO with what the user said.

CURRENT TIME: ${clockFor(nowISO, timezone)}
Every time you state back to the user must be the LOCAL wall clock above, never UTC.
MODE: ${workspaceMode === 'business' ? 'Business workspace' : 'Personal'}${pageLabel ? `
SCREEN THE USER IS LOOKING AT: ${pageLabel}
Use this to break ties, nothing more. On Invoices, a bare amount and a name is
most likely an invoice; on Money it is most likely an expense. If the words are
explicit, the words win — never override what the user actually said.` : ''}

The user said (speech-to-text; may contain errors; may be any Indian language, native script or romanised):
"""${text}"""

Reply with ONLY a JSON object, no explanation, no markdown fence.

OMIT ANY KEY YOU HAVE NO VALUE FOR. Do not write nulls, do not write empty
strings, do not pad the object. Every token you emit is time the user spends
waiting for you to speak, so emit only what you actually know:
{
  "intent": one of ${JSON.stringify(INTENTS)},
  "confidence": number 0-1,
  "language_detected": BCP-47 code of the language the USER spoke, e.g. "te-IN",
  "clean_text": the same sentence, written the way the user meant it - words they spoke in English written in ENGLISH LETTERS, Telugu/Hindi/other words kept in their own script. Do not translate, do not add words. (Speech-to-text set to Telugu writes English as Telugu letters: "రిమాండ్ మీ టు పిక్ అప్ బియర్" is "Remind me to pick up beer"),
  "entities": {
    "place": ONLY when the reminder should fire on ARRIVING at, reaching, passing or being near a place ("when I reach Chintal Kunta", "when I'm at office", "on the way home near the bakery", "చింతల్ కుంట కి వెళ్ళినప్పుడు", "दफ्तर पहुंचूं तो") - the place name in ENGLISH LETTERS, nothing else ("Chintal Kunta"). A place is never a person. When you give a place, OMIT relative_minutes and datetime_iso unless the user ALSO named a time,
    "person": the person's or shop's name in ENGLISH LETTERS only (write "Surya Kiran", never "సూర్య కిరణ్" or "सूर्य किरण"; "రాముకి" is "Ramu", "राजू को" is "Raju", "Gupta ji ne" is "Gupta", "Kapoor ke naam pe" is "Kapoor", "Kiran tho" is "Kiran", "Ravi Traders కి" is "Ravi Traders"; the phone's contact list is in English letters and a name in another script matches nobody). Whenever a name is said, give it - for every intent,
    "relative_minutes": number - when the user gave a DURATION FROM NOW ("in five minutes", "ek minute ke baad", "ఐదు నిమిషాల్లో", "in two hours" = 120). Give ONLY this and omit datetime_iso; the app adds it to the clock itself,
    "datetime_iso": absolute ISO 8601 datetime, ONLY when the user named a clock time or a day ("at ten", "tomorrow morning", "kal subah"),
    "amount": number,
    "direction": "in" if money received, "out" if money spent/paid/given,
    "item": string,
    "status": attendance only - "present" | "absent" | "half_day" | "leave",
    "quantity": stock only - number, how much,
    "unit": stock only - "kg", "litre", "bag", "packet", "pcs" ...,
    "stock_op": stock only - "add" | "remove" | "out" (finished, none left) | "check" (asking how much)
  },
  "missing": array from ["datetime","person","amount","item"] — only what you truly need before acting; omit if you can act now,
  "reply": the sentence Aaria SPEAKS next
}

RULES FOR "reply" (it is spoken aloud):
- Write it ONLY in ${langName(language)}. Never answer in English if the user spoke another language.
- Under 20 words, warm, natural, no markdown, no emoji, no jargon.
- If "missing" is not empty, "reply" MUST be a natural question asking for that one thing.
- Otherwise say what you are ABOUT TO DO. State the time THE WAY THE USER SAID
  IT: "in one minute", "tomorrow morning", "at ten". Never convert a relative
  time into a clock time in the reply - on 30 September 2026 "ek minute ke
  baad" was confirmed aloud as "in one minute at a quarter to eight" while the
  reminder was correctly stored for 8:09 pm. The stored datetime_iso is where
  the arithmetic goes; the spoken sentence only echoes what was asked.

NEVER SAY SOMETHING IS ALREADY DONE. You are reading the sentence, not saving it.
The saving happens after you answer and it can fail. Write "I'll remind you at
six" — never "I have set the reminder", "saved", "done", "పెట్టాను", "సెట్
చేశాను", "कर दिया", "सेट कर दिया". A promise you might not keep is a mistake the
user can see and repeat; a statement of fact that is false is one they cannot.
On 26 September 2026 this rule did not exist and three reminders were confirmed
out loud that were never created.

OTHER RULES:
- "remind me to pay the electricity bill" is a reminder, NOT an invoice.
- MONEY DIRECTION - ask WHO GAVE TO WHOM, never go by the verb "give" alone:
  Someone ELSE gave / paid the user = "income", direction "in": "received 500 from Gupta",
  "collected 2000 from Ravi", "Ravi paid me 300", "Gupta ji ne 500 de diye", "Gupta se 500
  mile", "paise aaye", "Ravi nundi 500 vacchindi", "Ravi 500 ichadu", "baki tirigi icchadu",
  "వచ్చింది" / "मिले" / "आए".
  The USER gave / paid / spent = "expense", direction "out": "gave Gupta 500", "paid 500 to
  Ravi", "Ravi ko 500 diye", "maine 500 diya", "Ravi ki 500 ichanu", "500 kharchu chesanu",
  "కట్టాను" / "दिए". "X ne ... diya" and "X ichadu / ichindi" are X giving TO the user: "in".
  Never swap these.
- Resolve relative time against CURRENT TIME. "tomorrow morning" → next day 09:00 local.
- For a reminder with no usable time AND no place, put "datetime" in "missing" and ASK.
- A reminder with a "place" is complete: do NOT ask for a time, and in "reply" say
  it will remind them WHEN THEY REACH that place - never state a clock time. On
  1 October 2026 "remind me to pick up beer when I reach Chintal Kunta" was
  answered "I'll remind you at 5:34 pm" - the moment he spoke - and saved as an alarm.
- If the user wants to go somewhere or get directions ("set location to Charminar",
  "చార్మినార్ కి వెళ్ళాలి", "चारमीनार ले चलो"), intent = "navigation" and
  entities.item = ONLY the place name, in English letters. Reply that you are starting navigation.
- If the user is asking a question rather than storing something, intent = "query" -
  also when it asks about money, reminders or meetings already saved ("what did I
  spend today", "repu naaku emaina reminders unnaya?", "आज कितना खर्च किया?").
- Sold something = "sale" ("ammanu", "అమ్మాను", "becha", "sale ayindi"). Lent money or
  gave on credit = "ledger_debit", direction "out" ("appu icchanu", "उधार दिए", "on credit"),
  not expense. Someone paid back what they owed = "income", direction "in" ("baki ke de
  diye", "tirigi icchadu"). Send someone a message = "contact".
- "trip": plan or book travel - a trip, ticket, flight, train, bus, hotel. Put the place in entities.item.
- "compliance": a licence, certificate, permit, registration, insurance or renewal with an
  expiry or due date to track. Give datetime_iso when a date is said; do not ask for one.
- "pay": send, transfer or pay money to someone NOW (UPI, PhonePe, Paytm, "pampu",
  "bhej do", "transfer karo"). Not "I paid" (that is expense). Reply that payments are
  done in the app with the PIN - never say you will send it.
- "delete": remove, delete or cancel ONE item already saved ("delete the gym reminder",
  "Ravi ki call reminder teeseyi", "हटा दो", "cancel kar do"). It names the item;
  "cancel that" alone is "confirm". entities.item = the words that describe it;
  person when it names someone. Reply by asking which item, never say it is deleted.
- "confirm": ONLY a bare yes / no / okay / cancel with nothing else ("yes please", "okay",
  "avunu", "sare", "haan ji", "ठीक है", "nahi, rehne do", "vaddu le", "no, cancel that").
  A bare yes or no is ALWAYS "confirm", never "none". Not a new instruction.
- BUSINESS RECORDS (staff and shop stock). Use these in either mode; the app decides.
  "attendance": staff present / absent / half day / leave ("mark Ravi absent today", "Ravi
  ki half day", "sab present hain", "Lakshmi ee roju raaledu", "రవి ఈరోజు రాలేదు", "सुनीता आज काम पर नहीं आई"). person =
  the staff name, or "all" for everyone. Give "status". datetime_iso only if another day
  is named. Reply as a question: "Mark Ravi absent today?"
  "stock": shop inventory - adding, taking out, running out, running low, reorder, or asking
  how much is left ("add 20 kg rice to stock", "out of stock: oil", "sugar stock entha undi",
  "chawal ka stock kitna hai"). item = the product in English letters ("బియ్యం" / "chawal"
  is "rice"), quantity, unit, stock_op. Asking how much is "stock" with stock_op "check",
  never "query".
  "payroll": working out staff salary or wages ("prepare this month's salary", "Ravi ki
  entha jeetham", "salary banao"). person when one is named. Paying salary NOW is "pay".
- "none": thanks, greetings, small talk, how the user feels, or a statement that needs
  nothing done ("thank you", "nenu chala alasipoyanu", "just testing"). Never a bare yes or no.
  Reply briefly. Nothing is saved.
- Romanised Telugu numbers and times: okati 1, rendu 2, moodu 3, naalugu 4, aidu 5,
  aaru 6, edu 7, enimidi 8, tommidi 9, padi 10, padakondu 11, pannendu 12, iravai 20,
  vanda 100, veyyi 1000, vela thousand ("moodu vela" 3000); repu tomorrow, ellundi day
  after tomorrow, ivala today, udayam morning, sayantram evening, ratri night,
  nimishalu / nimishallo minutes, gantalu / gantalaki hours or o'clock
  ("aidu nimishallo" = relative_minutes 5; "repu udayam padi gantalaki" = tomorrow 10:00).`;
}

// Escape hatch: if Sarvam ever changes its SSE shape, set SARVAM_STREAM=0 and
// the original single-shot request comes back with no redeploy.
const STREAM_DISABLED = process.env.SARVAM_STREAM === '0';

/**
 * Read an OpenAI-style SSE completion, stopping the moment the JSON object the
 * model is writing is closed.
 *
 * Why not just await res.json(): a buffered response is only readable once the
 * generation has fully stopped, so we wait for every token the model chooses to
 * emit after the answer -- a markdown fence, an apology, filler toward
 * max_tokens. None of that is ever parsed; all of it is time the user spends
 * listening to silence. Here we count braces (ignoring any inside strings) and
 * abort as soon as depth returns to zero.
 *
 * Falls through to whatever it has accumulated if the stream ends first, so a
 * malformed or non-SSE body degrades to the same behaviour as before.
 */
export async function readUntilJsonComplete(body, ctrl) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let sse = '';        // unparsed SSE buffer
  let out = '';        // model content so far
  let depth = 0, inString = false, escaped = false, started = false;

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      sse += decoder.decode(value, { stream: true });

      let nl;
      while ((nl = sse.indexOf('\n')) !== -1) {
        const line = sse.slice(0, nl).trim();
        sse = sse.slice(nl + 1);
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;

        let piece = '';
        try { piece = JSON.parse(payload)?.choices?.[0]?.delta?.content || ''; }
        catch { continue; }
        if (!piece) continue;
        const base = out.length;
        out += piece;

        for (let i = 0; i < piece.length; i++) {
          const ch = piece[i];
          if (inString) {
            if (escaped) escaped = false;
            else if (ch === '\\') escaped = true;
            else if (ch === '"') inString = false;
            continue;
          }
          if (ch === '"') { inString = true; continue; }
          if (ch === '{') { depth++; started = true; continue; }
          if (ch === '}') {
            depth--;
            if (started && depth === 0) {
              try { ctrl.abort(); } catch { /* already done */ }
              // Cut exactly at the brace. The closing token often arrives in
              // the same chunk as a trailing fence or a stray sentence; keeping
              // those would push the caller onto its regex fallback path for no
              // reason.
              return out.slice(0, base + i + 1).trim();
            }
          }
        }
      }
    }
  } catch {
    // An abort here is ours, fired on the closing brace above.
  } finally {
    try { reader.releaseLock(); } catch { /* noop */ }
  }
  return out.trim();
}

/**
 * The JSON body sent to the chat endpoint. Exported so the evaluation script
 * (scripts/eval-understanding.mjs) sends every model exactly what production
 * sends Sarvam; tests/aaria-llm-request.test.mjs pins the default body
 * byte-for-byte.
 */
export function buildRequestBody({ model, prompt, stream }) {
  return {
    model,
    temperature: 0.2,
    // Generation time scales with tokens produced, and this is the single
    // biggest component of voice latency (measured 13 Aug 2026: ~9s of a
    // ~12s round trip is Sarvam generating this JSON). Everything the app
    // actually acts on fits comfortably in 300.
    // 300 -> 450 on 1 Oct 2026: clean_text repeats the sentence, and a
    // Telugu sentence is token-heavy. Cut short, the JSON never closes and
    // the whole answer is lost to the regex fallback. The stream still
    // stops at the closing brace, so unused room costs nothing.
    max_tokens: 450,
    // Streaming does not make the model faster. It makes US faster: a
    // non-streamed request cannot be read until the server has finished,
    // so we also pay for whatever the model emits AFTER the closing brace
    // -- trailing prose, a markdown fence, padding toward max_tokens. With
    // the stream we stop at the brace and cancel the rest.
    stream,
    messages: [{ role: 'user', content: prompt }],
  };
}

// A TIME WITH NO ZONE IS INDIA TIME. The prompt gives the model the clock in
// Asia/Kolkata, but it sometimes answers "2026-10-16T08:00:00" with no offset.
// The server runs in UTC, so new Date() read that as 8 AM UTC and an 8 AM
// reminder fired at 1:30 PM IST (measured: 2 of 48 timed sentences, run
// 38726346076). A bare date-time gets +05:30; anything else passes through.
export function withIndiaZone(iso) {
  if (typeof iso !== 'string') return iso ?? null;
  const s = iso.trim();
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(s)) return s;
  return `${s}+05:30`;
}

/**
 * Turn the model's raw text into the object the capture route acts on.
 * Pure: no I/O. Returns { result } or { failure: 'no_json' | 'no_intent' }.
 * Exported so the evaluation script scores every model through the same
 * parser production uses.
 */
export function parseBrainResponse(raw, { clean, nowISO, language, model }) {
  const jsonText = raw.replace(/```json|```/g, '').trim();

  let parsed;
  try { parsed = JSON.parse(jsonText); }
  catch {
    const m = jsonText.match(/\{[\s\S]*\}/);
    if (!m) return { failure: 'no_json' };
    try { parsed = JSON.parse(m[0]); } catch { return { failure: 'no_json' }; }
  }

  if (!parsed || typeof parsed !== 'object' || !parsed.intent) return { failure: 'no_intent' };

  const ents = parsed.entities || {};

  // A DURATION IS ADDED HERE, BY CODE, NOT BY THE MODEL.
  // relative_minutes wins over datetime_iso when both arrive: the number is
  // what the user said; the clock time is the model's arithmetic, and on
  // 30 September 2026 that arithmetic put "1 minute" thirty minutes out.
  const now = new Date(nowISO || Date.now());
  const relMin = Number(ents.relative_minutes);
  let datetimeISO = withIndiaZone(ents.datetime_iso ?? null);
  if (Number.isFinite(relMin) && relMin > 0 && relMin <= 60 * 24 * 366 && !isNaN(now.getTime())) {
    datetimeISO = new Date(now.getTime() + Math.round(relMin) * 60_000).toISOString();
  }

  // A PLACE REMINDER HAS NO CLOCK TIME UNLESS ONE WAS SAID. If the model
  // still sent a datetime within two minutes of now, that is "the moment
  // you spoke", not a time the user asked for - drop it.
  const place = typeof ents.place === 'string' && ents.place.trim()
    ? ents.place.trim().slice(0, 80) : null;
  if (place && datetimeISO && !(Number.isFinite(relMin) && relMin > 0)) {
    const dt = new Date(datetimeISO);
    if (!isNaN(dt.getTime()) && Math.abs(dt.getTime() - now.getTime()) < 2 * 60_000) datetimeISO = null;
  }

  // A MONEY INTENT ALREADY SAYS WHICH WAY THE MONEY WENT. The model names
  // the intent correctly and sometimes leaves "direction" out (2 of 38 in
  // run 38744054174, both "income"). income is always in; expense and
  // ledger_debit are always out. Only a MISSING direction is filled - one
  // the model gave is kept as it is.
  const intent = INTENTS.includes(parsed.intent) ? parsed.intent : 'note'
  const DIRECTION_OF = { income: 'in', expense: 'out', ledger_debit: 'out' }
  const direction = ents.direction ?? DIRECTION_OF[intent] ?? null

  return { result: {
    intent,
    confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.7,
    language: parsed.language_detected || language || 'en-IN',
    cleanText: parsed.clean_text || clean,
    // Only what the MODEL rewrote - null when it sent none, so callers can
    // tell "cleaned" from "the raw words echoed back".
    modelCleanText: typeof parsed.clean_text === 'string' && parsed.clean_text.trim()
      ? parsed.clean_text.trim().slice(0, 1000) : null,
    title: parsed.title || null,
    entities: {
      place,
      person: ents.person ?? null,
      datetimeISO,
      relativeMinutes: Number.isFinite(relMin) && relMin > 0 ? Math.round(relMin) : null,
      amount: typeof ents.amount === 'number' ? ents.amount : null,
      direction,
      item: ents.item ?? null,
      // Business records only (attendance / stock); null everywhere else.
      status: typeof ents.status === 'string' && ents.status.trim() ? ents.status.trim().toLowerCase() : null,
      quantity: typeof ents.quantity === 'number' && Number.isFinite(ents.quantity) ? ents.quantity : null,
      unit: typeof ents.unit === 'string' && ents.unit.trim() ? ents.unit.trim().slice(0, 20) : null,
      stockOp: typeof ents.stock_op === 'string' && ents.stock_op.trim() ? ents.stock_op.trim().toLowerCase() : null,
    },
    missing: Array.isArray(parsed.missing) ? parsed.missing : [],
    reply: typeof parsed.reply === 'string' && parsed.reply.trim() ? parsed.reply.trim() : null,
    engine: model,
  } };
}

/**
 * Understand an utterance; produce a spoken reply in the user's language.
 * Returns null on any failure so callers fall back safely.
 */
export async function aariaUnderstandLLM(text, opts = {}) {
  const clean = (text || '').trim();
  if (!clean) return null;

  // Every "return null" below names its reason through opts.onFailure, so the
  // capture route can record WHY there was no answer (no key, HTTP error, no
  // JSON, timeout) instead of only that there was none. Optional: callers
  // that do not pass it behave exactly as before.
  const fail = (reason) => { try { opts.onFailure?.(reason); } catch { /* never throw from a report */ } return null; };

  const apiKey = process.env.SARVAM_API_KEY;
  if (!apiKey) return fail('no_key');

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);

  try {
    const prompt = buildPrompt({
      text: clean.slice(0, 1000),
      language: opts.language || 'en-IN',
      nowISO: opts.nowISO || new Date().toISOString(),
      timezone: opts.timezone || 'Asia/Kolkata',
      workspaceMode: opts.workspaceMode || 'personal',
      pageLabel: opts.pageLabel || null,
    });

    const res = await fetch(SARVAM_CHAT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // sarvam-stt uses this header; chat completions also accepts Bearer.
        'api-subscription-key': apiKey,
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(buildRequestBody({ model: MODEL, prompt, stream: !STREAM_DISABLED })),
      signal: ctrl.signal,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.error('[aaria-llm] sarvam HTTP', res.status, errText.slice(0, 200));
      return fail(`http_${res.status}`);
    }

    const raw = (!STREAM_DISABLED && res.body)
      ? await readUntilJsonComplete(res.body, ctrl)
      : ((await res.json())?.choices?.[0]?.message?.content?.trim() || '');
    const { result, failure } = parseBrainResponse(raw, { clean, nowISO: opts.nowISO, language: opts.language, model: MODEL });
    return failure ? fail(failure) : result;
  } catch (err) {
    if (err?.name !== 'AbortError') {
      console.error('[aaria-llm] error:', err?.message || String(err));
      return fail('threw');
    }
    return fail('timeout');
  } finally {
    clearTimeout(timer);
  }
}

export default aariaUnderstandLLM;
