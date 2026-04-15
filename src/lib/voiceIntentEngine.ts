/**
 * src/lib/voiceIntentEngine.ts
 *
 * Phase 2 — Lotus Voice Intent Engine
 *
 * DETERMINISTIC. No LLM. No API calls for intent resolution itself.
 * Pattern matching only — every branch is predictable and testable.
 *
 * ARCHITECTURE:
 *   voiceIntentEngine  ← this file  (parse + classify + return action)
 *   voiceQueryEngine   ← existing   (DB fetches: bills, subs, reminders)
 *   VoiceTalkback      ← existing   (speak(), wake word, TTS)
 *   dashboard          ← caller     (wires them together)
 *
 * THIS FILE DOES NOT:
 *   - Import from voiceQueryEngine (avoids circular deps)
 *   - Call speak() directly (caller owns TTS)
 *   - Write to Supabase (caller handles that)
 *   - Import React or Next.js hooks (pure TS, usable anywhere)
 *
 * RETURN FORMAT:
 *   {
 *     handled:    boolean,      // true = do NOT save as keep
 *     intentType: string,       // classified intent label
 *     response:   string,       // TTS response text (caller speaks it)
 *     action?:    () => void,   // side effect (navigation, etc) — caller executes
 *     entities:   IntentEntities // extracted structured data
 *   }
 *
 * USAGE (dashboard/page.jsx handleSave, after wake word stripped):
 *   import { parseVoiceIntent } from '@/lib/voiceIntentEngine';
 *   const intent = parseVoiceIntent(commandText);
 *   if (intent.handled) {
 *     speak(intent.response);
 *     intent.action?.();
 *     return; // do not save as keep
 *   }
 *   // else → fall through to /api/voice/capture
 */

// ── Types ──────────────────────────────────────────────────────────────────

export interface IntentEntities {
  /** Extracted person / contact name, e.g. "call Suresh" → "Suresh" */
  name?: string;
  /** Extracted time string, e.g. "at 5pm" → "5pm" */
  time?: string;
  /** Extracted date string, e.g. "tomorrow" → "tomorrow" */
  date?: string;
  /** Extracted page path for navigation, e.g. "/reminders" */
  path?: string;
  /** Extracted quantity, e.g. "3 keeps" → 3 */
  quantity?: number;
  /** Raw command remainder after intent prefix stripped */
  remainder?: string;
}

export interface IntentResult {
  /** If true, caller should NOT save as keep — intent was fully handled */
  handled:    boolean;
  /** Classified intent label for telemetry */
  intentType: IntentType;
  /** TTS response string — caller passes this to speak() */
  response:   string;
  /**
   * Optional side effect (navigation, DB action).
   * Caller MUST execute this. Engine does not execute it.
   * Defined as a factory so it can close over router/supabase from the call site.
   * Pass { router } to getAction() to build the final function.
   */
  actionKey?: ActionKey;
  /** Structured entities extracted from the command */
  entities:   IntentEntities;
  /**
   * Confidence score 0.0–1.0. Optional — defaults to 1.0 when not set.
   * Added in Phase 8A. Callers should use: intent.confidence ?? 1.0
   */
  confidence?: number;
}

/** Phase 8A: minimum confidence to handle as intent (below = save as keep). */
export const CONFIDENCE_THRESHOLD = 0.55;

export type IntentType =
  | 'navigation'
  | 'query_reminders'
  | 'query_bills'
  | 'query_subscriptions'
  | 'query_expenses'
  | 'query_brief'
  | 'query_keeps_count'
  | 'query_time'
  | 'query_date'
  | 'control_wake_mode'
  | 'control_cancel'
  | 'control_stop'
  | 'create_keep'      // explicit "note: ..." or "remind me ..." prefix
  | 'unknown';

export type ActionKey = string; // e.g. 'navigate:/reminders'

// ── Normalisation ──────────────────────────────────────────────────────────

/**
 * normalise(text)
 *
 * Phase 3 requirement: lowercase + remove punctuation + collapse spaces.
 * Used internally — does NOT modify the original transcript.
 */
export function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')   // remove punctuation
    .replace(/\s+/g, ' ')        // collapse multiple spaces
    .trim();
}

// ── Wake word normalisation ────────────────────────────────────────────────

/**
 * Phase 3 — stripWakeVariants(text, wakeWord)
 *
 * Strips common wake word prefixes:
 *   "lotus buy milk"       → "buy milk"
 *   "hey lotus buy milk"   → "buy milk"
 *   "lotus please buy milk"→ "buy milk"
 *   "lotus, buy milk"      → "buy milk"
 *
 * Case-insensitive. Returns original if no match (caller handles that case).
 */
export function stripWakeVariants(text: string, wakeWord = 'lotus'): {
  stripped: boolean;
  command: string;
} {
  const lower = text.toLowerCase().trim();
  const wl    = wakeWord.toLowerCase();

  // Patterns in priority order
  const variants = [
    new RegExp(`^hey\\s+${wl}[,!?\\s]+`, 'i'),
    new RegExp(`^${wl}\\s+please[,!?\\s]+`, 'i'),
    new RegExp(`^${wl}[,!?\\s]+`, 'i'),
  ];

  for (const re of variants) {
    if (re.test(lower)) {
      const command = text.replace(re, '').trim();
      return { stripped: true, command };
    }
  }
  return { stripped: false, command: text };
}

/**
 * Phase 3 — hasMinimumLength(text)
 *
 * Confidence check: ignore very short inputs that can't be meaningful commands.
 * Threshold: 3 characters after normalisation (covers "ok", "hi", etc.).
 */
export function hasMinimumLength(text: string, minChars = 3): boolean {
  return normalise(text).length >= minChars;
}

// ── Navigation route table ────────────────────────────────────────────────

interface NavRoute {
  patterns: RegExp[];
  path:     string;
  label:    string;
}

const NAV_ROUTES: NavRoute[] = [
  {
    patterns: [/\breminder[s]?\b/, /\bopen reminder/, /\bshow reminder/, /\bmy reminder/],
    path: '/reminders', label: 'Reminders',
  },
  {
    patterns: [/\bcalendar\b/, /\bschedule\b/, /\bevents?\b/],
    path: '/calendar', label: 'Calendar',
  },
  {
    patterns: [/\bcamera\b/, /\btake photo\b/, /\bscan\b/, /\bscan document\b/],
    path: '/camera', label: 'Camera',
  },
  {
    patterns: [/\bbills?\b/, /\bopen bill/, /\bshow bill/, /\bpayment[s]?\b/],
    path: '/bills', label: 'Bills',
  },
  {
    patterns: [/\bfinance\b/, /\bexpense[s]?\b/, /\bspending\b/, /\bbudget\b/],
    path: '/finance', label: 'Finance',
  },
  {
    patterns: [/\bsettings?\b/, /\bpreference[s]?\b/],
    path: '/settings', label: 'Settings',
  },
  {
    patterns: [/\bdrive mode\b/, /\bstart driving\b/, /\bdriving mode\b/, /\bopen drive\b/],
    path: '/drive', label: 'Drive Mode',
  },
  {
    patterns: [/\bgeo\b/, /\blocation reminder/, /\bgeo.?fenc/, /\bwhen i reach\b/],
    path: '/geo', label: 'Geo Reminders',
  },
  {
    patterns: [/\bdaily brief\b/, /\bread my brief\b/, /\bmorning brief\b/, /\bbrief\b/],
    path: '/daily-brief', label: 'Daily Brief',
  },
  {
    patterns: [/\bdocument[s]?\b/, /\bmy doc/],
    path: '/documents', label: 'Documents',
  },
  {
    patterns: [/\bvoice log\b/, /\bvoice history\b/, /\bmy session[s]?\b/],
    path: '/voice', label: 'Voice Log',
  },
  {
    patterns: [/\bgo home\b/, /\bopen home\b/, /\bhome screen\b/, /\bdashboard\b/],
    path: '/dashboard', label: 'Home',
  },
  {
    patterns: [/\bfamily\b/],
    path: '/family', label: 'Family',
  },
  {
    patterns: [/\bhealth\b/],
    path: '/health', label: 'Health',
  },
  {
    patterns: [/\bmessage[s]?\b/, /\bchat\b/],
    path: '/messages', label: 'Messages',
  },
];

// ── Query pattern table ───────────────────────────────────────────────────

interface QueryPattern {
  intentType: IntentType;
  patterns:   RegExp[];
  /** Static response for offline / no-DB cases */
  offlineResponse: string;
}

const QUERY_PATTERNS: QueryPattern[] = [
  {
    intentType: 'query_reminders',
    patterns: [
      /\bremind(?:er[s]?)?\b.*\btoday\b/,
      /\btoday[']?s?\s+reminder[s]?\b/,
      /\bwhat[']?s?\s+(?:my\s+)?reminder[s]?\b/,
      /\bshow\s+(?:my\s+)?reminder[s]?\b/,
      /\blist\s+reminder[s]?\b/,
      /\bany\s+reminder[s]?\b/,
    ],
    offlineResponse: 'Fetching your reminders.',
  },
  {
    intentType: 'query_bills',
    patterns: [
      /\bpending\s+bill[s]?\b/,
      /\bbill[s]?\s+due\b/,
      /\bupcoming\s+bill[s]?\b/,
      /\bwhat\s+(?:do\s+)?i\s+owe\b/,
      /\bany\s+bill[s]?\b/,
      /\bdue\s+(?:amount|payment)\b/,
    ],
    offlineResponse: 'Fetching your pending bills.',
  },
  {
    intentType: 'query_subscriptions',
    patterns: [
      /\bsubscription[s]?\b/,
      /\brenewing\b/,
      /\bmonthly\s+(?:plan[s]?|payment[s]?)\b/,
      /\bactive\s+plan[s]?\b/,
    ],
    offlineResponse: 'Fetching your subscriptions.',
  },
  {
    intentType: 'query_expenses',
    patterns: [
      /\bexpense[s]?\b/,
      /\bhow\s+much\s+(?:did\s+i|have\s+i)\s+spend\b/,
      /\btotal\s+spending\b/,
      /\bspent\s+this\s+month\b/,
    ],
    offlineResponse: 'Fetching your expenses.',
  },
  {
    intentType: 'query_brief',
    patterns: [
      /\bmy\s+brief\b/,
      /\bdaily\s+brief\b/,
      /\bmorning\s+brief\b/,
      /\bread\s+(?:my\s+)?brief\b/,
      /\bwhat[']?s?\s+(?:on\s+)?today\b/,
    ],
    offlineResponse: 'Opening your daily brief.',
  },
  {
    intentType: 'query_keeps_count',
    patterns: [
      /\bhow\s+many\s+keep[s]?\b/,
      /\bcount\s+(?:my\s+)?keep[s]?\b/,
      /\bopen\s+keep[s]?\b/,
      /\bpending\s+keep[s]?\b/,
    ],
    offlineResponse: 'Checking your keeps.',
  },
  {
    intentType: 'query_time',
    patterns: [
      /\bwhat\s+(?:is\s+)?(?:the\s+)?time\b/,
      /\bcurrent\s+time\b/,
      /\bwhat\s+time\s+is\s+it\b/,
    ],
    offlineResponse: '', // handled inline — no DB needed
  },
  {
    intentType: 'query_date',
    patterns: [
      /\bwhat\s+(?:is\s+)?(?:the\s+)?date\b/,
      /\btoday[']?s?\s+date\b/,
      /\bwhat\s+day\s+is\s+(?:it|today)\b/,
    ],
    offlineResponse: '', // handled inline
  },
];


// ── Step 2: Telugu + Tenglish NLP scoring ────────────────────────────────
//
// Extends the keyword scoring to cover Telugu speakers.
// These patterns are ADDITIVE — they run only when the English regexes miss.
// finalScore = max(english, telugu) with same 0.55 threshold.
//
// Three layers:
//   1. Telugu Unicode script (U+0C00–U+0C7F): highest confidence
//   2. Tenglish keywords: Telugu commands written in English script
//   3. Mixed: English intent keywords with Telugu filler words

interface TeluguPattern {
  intentType:      IntentType;
  teluguKeywords:  string[];   // Telugu Unicode keywords
  tenglishPhrases: string[];   // Romanised Telugu phrases
  fillers:         string[];   // Filler words to ignore during scoring
}

const TELUGU_PATTERNS: TeluguPattern[] = [
  {
    intentType:      'query_bills',
    teluguKeywords:  ['బిల్లులు', 'చెల్లింపు', 'బాకీ', 'డబ్బు'],
    tenglishPhrases: ['bills cheppu', 'naa bills', 'bills emi', 'chellinchadam', 'kattu', 'rupayalu'],
    fillers:         ['naa', 'mee', 'ikkada', 'adi', 'meeru'],
  },
  {
    intentType:      'query_reminders',
    teluguKeywords:  ['రిమైండర్', 'గుర్తు', 'పని', 'సమయం'],
    tenglishPhrases: ['remind cheyyi', 'gurtupettu', 'naa reminders', 'alarms cheppu', 'matla'],
    fillers:         ['naa', 'ku', 'ki', 'adi', 'ivi'],
  },
  {
    intentType:      'query_expenses',
    teluguKeywords:  ['ఖర్చు', 'వ్యయం', 'డబ్బు', 'మొత్తం'],
    tenglishPhrases: ['kharchu cheppu', 'spend cheyyi', 'total yekkuva', 'paisa ela', 'rupayalu'],
    fillers:         ['ee', 'nenu', 'aa', 'anni', 'naa'],
  },
  {
    intentType:      'query_subscriptions',
    teluguKeywords:  ['సదస్యత', 'నెల', 'చందా'],
    tenglishPhrases: ['subscription renew', 'monthly plan', 'maasam charge', 'renew avutundi'],
    fillers:         ['naa', 'mee', 'ivi', 'adi'],
  },
  {
    intentType:      'query_keeps_count',
    teluguKeywords:  ['నోట్సు', 'కీప్', 'లిస్టు'],
    tenglishPhrases: ['naa keeps', 'notes cheppu', 'list chudandi', 'emi undi'],
    fillers:         ['naa', 'lo', 'ki', 'aa'],
  },
  {
    intentType:      'control_cancel',
    teluguKeywords:  ['ఆపు', 'వద్దు', 'మానేయి'],
    tenglishPhrases: ['aapandi', 'aappu', 'vaddandi', 'vaddhu', 'cancel cheyyi'],
    fillers:         [],
  },
];

/** TELUGU_SCRIPT_RANGE: U+0C00–U+0C7F */
function hasTeluguScript(text: string): boolean {
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp >= 0x0C00 && cp <= 0x0C7F) return true;
  }
  return false;
}

/**
 * scoreTeluguIntent(norm) → { intentType, score } | null
 *
 * Returns the best-matching Telugu intent above CONFIDENCE_THRESHOLD.
 * Called from parseVoiceIntent ONLY when English regex + fuzzy match both fail.
 * Safe: pure function, no side effects, no network.
 */
function scoreTeluguIntent(norm: string): { intentType: IntentType; score: number } | null {
  const lower = norm.toLowerCase();
  const hasScript = hasTeluguScript(norm);

  let best: { intentType: IntentType; score: number } | null = null;

  for (const tp of TELUGU_PATTERNS) {
    let score = 0;

    // Layer 1: Telugu Unicode script keywords (highest weight)
    if (hasScript) {
      const teHits = tp.teluguKeywords.filter(k => norm.includes(k));
      if (teHits.length > 0) score = Math.max(score, 0.7 + teHits.length * 0.1);
    }

    // Layer 2: Tenglish phrase matching
    const tenglishHits = tp.tenglishPhrases.filter(p => lower.includes(p));
    if (tenglishHits.length >= 2) score = Math.max(score, 0.75);
    else if (tenglishHits.length === 1) score = Math.max(score, 0.60);

    // Layer 3: token overlap with Telugu keywords (romanised approximation)
    const tokens = lower.split(/\s+/).filter(t => !tp.fillers.includes(t) && t.length > 1);
    const keyTokens = [...tp.tenglishPhrases.flatMap(p => p.split(' ')), ...tp.fillers];
    const overlap = tokens.filter(t => keyTokens.some(k => k.includes(t) || t.includes(k)));
    if (overlap.length >= 2) score = Math.max(score, 0.58);

    if (score >= CONFIDENCE_THRESHOLD && (!best || score > best.score)) {
      best = { intentType: tp.intentType, score: Math.min(1.0, score) };
    }
  }

  return best;
}

// ── Control patterns ──────────────────────────────────────────────────────

const CANCEL_PATTERNS = [
  /\bcancel\b/, /\bstop\b/, /\bnever mind\b/, /\bforget it\b/, /\bignore\b/,
];
const WAKE_MODE_ON_PATTERNS  = [/\bturn on\s+(?:wake\s+)?lotus\b/, /\benable\s+(?:wake\s+)?lotus\b/, /\blotus\s+on\b/];
const WAKE_MODE_OFF_PATTERNS = [/\bturn off\s+(?:wake\s+)?lotus\b/, /\bdisable\s+(?:wake\s+)?lotus\b/, /\blotus\s+off\b/];

// ── Explicit create-keep patterns ─────────────────────────────────────────
// "note: buy milk" / "remind me to buy milk" → create_keep
// These are PASS-THROUGH — handled = false, but intentType is set for caller logging.

const CREATE_KEEP_PATTERNS = [
  /^(?:note|remember|save)[:\s]+/i,
  /^(?:remind me(?:\s+to)?)[:\s]+/i,
  /^(?:task|todo|add task)[:\s]+/i,
  /^(?:buy|purchase)[:\s]+/i,
  /^(?:call|contact|ring)[:\s]+/i,
  /^(?:create keep|new keep)[:\s]+/i,
];

// ── Inline handlers (no DB needed) ───────────────────────────────────────

function handleInline(intentType: IntentType): string | null {
  if (intentType === 'query_time') {
    const t = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
    return `The time is ${t}.`;
  }
  if (intentType === 'query_date') {
    const d = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });
    return `Today is ${d}.`;
  }
  return null;
}

// ── Entity extraction ─────────────────────────────────────────────────────

function extractEntities(raw: string, intentType: IntentType): IntentEntities {
  const entities: IntentEntities = {};

  // Name: "call Suresh" / "remind Priya"
  const nameMatch = raw.match(
    /\b(?:call|contact|tell|remind|message|ring|email)\s+([A-Za-z][a-zA-Z]+(?:\s+[A-Za-z][a-zA-Z]+)?)/i
  );
  if (nameMatch) entities.name = nameMatch[1];

  // Time: "at 5pm", "at 10:30"
  const timeMatch = raw.match(/\bat\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i);
  if (timeMatch) entities.time = timeMatch[1];

  // Date
  const dateMatch = raw.match(/\b(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i);
  if (dateMatch) entities.date = dateMatch[1].toLowerCase();

  // Remainder (text after intent prefix stripped)
  for (const re of CREATE_KEEP_PATTERNS) {
    if (re.test(raw)) {
      entities.remainder = raw.replace(re, '').trim();
      break;
    }
  }

  return entities;
}

// ── Main parse function ───────────────────────────────────────────────────

/**
 * parseVoiceIntent(rawText)
 *
 * Pure function — no side effects, no async.
 * Input:  raw command text (wake word already stripped by caller)
 * Output: IntentResult
 *
 * Caller responsibilities:
 *   1. Call speak(result.response) if result.response is non-empty
 *   2. Execute result.actionKey via getIntentAction(result.actionKey, { router })
 *   3. If result.handled === false → save as keep normally
 */
export function parseVoiceIntent(rawText: string): IntentResult {
  // Minimum length confidence check (Phase 3)
  if (!hasMinimumLength(rawText)) {
    return {
      handled: false,
      intentType: 'unknown',
      response: '',
      entities: {},
    };
  }

  const norm = normalise(rawText);

  // ── 1. Control: cancel / stop ────────────────────────────────────────
  if (CANCEL_PATTERNS.some(p => p.test(norm))) {
    return {
      handled: true,
      intentType: 'control_cancel',
      response: 'Cancelled.',
      entities: {},
    };
  }

  // ── 2. Control: wake mode on/off ────────────────────────────────────
  if (WAKE_MODE_ON_PATTERNS.some(p => p.test(norm))) {
    return {
      handled: true,
      intentType: 'control_wake_mode',
      response: 'Wake word mode is now on. Say Lotus to activate.',
      actionKey: 'wake_mode:on',
      entities: {},
    };
  }
  if (WAKE_MODE_OFF_PATTERNS.some(p => p.test(norm))) {
    return {
      handled: true,
      intentType: 'control_wake_mode',
      response: 'Wake word mode is now off. All voice input will be processed.',
      actionKey: 'wake_mode:off',
      entities: {},
    };
  }

  // ── 3. Navigation ────────────────────────────────────────────────────
  // Only match when there is a navigation verb or explicit "open/go/show" intent.
  // Bare noun matches (e.g. "reminders") only trigger if no query pattern matches first.
  const navVerb = /\b(?:open|go\s+to|show|navigate|take\s+me\s+to|launch)\b/.test(norm);

  if (navVerb) {
    for (const route of NAV_ROUTES) {
      if (route.patterns.some(p => p.test(norm))) {
        return {
          handled: true,
          intentType: 'navigation',
          response: `Opening ${route.label}.`,
          actionKey: `navigate:${route.path}`,
          entities: { path: route.path },
        };
      }
    }
  }

  // ── 4. Query intents ─────────────────────────────────────────────────
  for (const q of QUERY_PATTERNS) {
    if (q.patterns.some(p => p.test(norm))) {
      const inlineResponse = handleInline(q.intentType);
      if (inlineResponse) {
        // Time/date: no DB needed, respond immediately
        return {
          handled: true,
          intentType: q.intentType,
          response: inlineResponse,
          entities: {},
        };
      }
      // DB-backed query: return immediately with "fetching" response.
      // Caller executes the actual DB fetch via voiceQueryEngine.resolveVoiceCommand().
      return {
        handled: true,
        intentType: q.intentType,
        response: q.offlineResponse,
        actionKey: `query:${q.intentType}`,
        entities: {},
      };
    }
  }

  // ── 5. Navigation fallback (bare nouns without verb) ─────────────────
  for (const route of NAV_ROUTES) {
    if (route.patterns.some(p => p.test(norm))) {
      return {
        handled: true,
        intentType: 'navigation',
        response: `Opening ${route.label}.`,
        actionKey: `navigate:${route.path}`,
        entities: { path: route.path },
      };
    }
  }

  // ── 6b. Step 2: Telugu NLP scoring (additive fallback) ──────────────
  // Runs only when English regex + fuzzy both returned handled=false.
  // Uses finalScore = max(english, telugu, tenglish). Same 0.55 threshold.
  const teluguMatch = scoreTeluguIntent(norm);
  if (teluguMatch) {
    const qp = QUERY_PATTERNS.find(q => q.intentType === teluguMatch.intentType);
    return {
      handled:    true,
      intentType: teluguMatch.intentType,
      response:   qp?.offlineResponse ?? 'Fetching that.',
      actionKey:  `query:${teluguMatch.intentType}`,
      entities:   {},
      confidence: teluguMatch.score,
    };
  }

  // ── 6. Explicit create-keep prefix ───────────────────────────────────
  // Pass-through: handled = false so caller saves it.
  // We just classify it so the caller can log/telemetry it.
  for (const re of CREATE_KEEP_PATTERNS) {
    if (re.test(rawText.trim())) {
      return {
        handled: false,
        intentType: 'create_keep',
        response: '',
        entities: extractEntities(rawText, 'create_keep'),
      };
    }
  }

  // ── 7. Unknown → save as keep ────────────────────────────────────────
  return {
    handled: false,
    intentType: 'unknown',
    response: '',
    entities: extractEntities(rawText, 'unknown'),
  };
}

// ── Action executor factory ───────────────────────────────────────────────

interface ActionContext {
  router?: { push: (path: string) => void };
  setWakeMode?: (enabled: boolean) => void;
}

/**
 * getIntentAction(actionKey, ctx)
 *
 * Converts an actionKey string into a callable function.
 * Call this in the dashboard after parseVoiceIntent returns.
 *
 * Example:
 *   const fn = getIntentAction(result.actionKey, { router });
 *   fn?.();
 *
 * Query actions (query:*) are NOT handled here — they require Supabase.
 * For those, caller should pass result.intentType to resolveVoiceCommand().
 */
export function getIntentAction(
  actionKey: string | undefined,
  ctx: ActionContext
): (() => void) | null {
  if (!actionKey) return null;

  if (actionKey.startsWith('navigate:')) {
    const path = actionKey.slice('navigate:'.length);
    return () => {
      if (ctx.router) {
        setTimeout(() => ctx.router!.push(path), 500); // delay so TTS starts first
      }
    };
  }

  if (actionKey === 'wake_mode:on') {
    return () => ctx.setWakeMode?.(true);
  }
  if (actionKey === 'wake_mode:off') {
    return () => ctx.setWakeMode?.(false);
  }

  // query:* actions are handled by voiceQueryEngine — return null here
  return null;
}

// ── Intent → query engine bridge ─────────────────────────────────────────

/**
 * isQueryIntent(intentType)
 *
 * Returns true when the intent requires a DB fetch.
 * Dashboard uses this to decide whether to call resolveVoiceCommand().
 */
export function isQueryIntent(intentType: IntentType): boolean {
  return intentType.startsWith('query_') &&
    intentType !== 'query_time' &&
    intentType !== 'query_date';
}
