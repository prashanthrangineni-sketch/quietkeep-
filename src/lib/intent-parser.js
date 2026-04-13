// src/lib/intent-parser.js  v7
// v7: FIXED GEO_TRIGGER_PATTERNS — was missing \s+ after alternation group, causing
//     "when I reach X" to never match. Added false-positive filter. All test cases pass.
// v6: detectGeoIntent returns type field.
// v5: detectRouteIntent() added.
// v4: detectGeoIntent(); parseIntent() geo field.
// v3: NAME_PATTERNS case-insensitive.

const NAME_PATTERNS = [
  /(?:call|contact|tell|meet|remind|message|email|invoice to|for)\s+([A-Za-z][a-zA-Z]+(?: [A-Za-z][a-zA-Z]+)?)/i,
  /([A-Za-z][a-zA-Z]+(?: [A-Za-z][a-zA-Z]+)?)\s+(?:trader|stores?|pvt|ltd|llp)/i,
];
const DATE_PATTERNS = [
  { re: /\btoday\b/i,              resolve: () => new Date() },
  { re: /\btomorrow\b/i,           resolve: () => new Date(Date.now() + 86400000) },
  { re: /\bthis (monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i, resolve: (m) => nextWeekday(m[1]) },
  { re: /\b(\d{1,2})[\/\-](\d{1,2})\b/, resolve: (m) => `${m[1]}/${m[2]}` },
  { re: /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\s+(\d{1,2})\b/i, resolve: (m) => `${m[1]} ${m[2]}` },
  { re: /\bby\s+(eod|end of day)\b/i, resolve: () => 'EOD' },
  { re: /\bby\s+(eow|end of week)\b/i, resolve: () => 'EOW' },
];
const TIME_PATTERNS = [
  /\bat\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i,
  /\b(\d{1,2}(?::\d{2})?\s*(?:am|pm))\b/i,
];

function nextWeekday(dayName) {
  const days = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
  const target = days.indexOf(dayName.toLowerCase());
  const now = new Date();
  const delta = (target - now.getDay() + 7) % 7 || 7;
  return new Date(now.getTime() + delta * 86400000);
}

function toTitleCase(str) {
  return str.replace(/\b\w/g, c => c.toUpperCase());
}

// ── Regional number word → digit mapping ──────────────────────────
const REGIONAL_NUMBERS = {
  // Hindi
  'ek': 1, 'do': 2, 'teen': 3, 'char': 4, 'paanch': 5,
  'chhe': 6, 'saat': 7, 'aath': 8, 'nau': 9, 'das': 10,
  'bees': 20, 'tees': 30, 'chalees': 40, 'pachaas': 50,
  'sau': 100, 'hazaar': 1000, 'hazar': 1000, 'lakh': 100000,
  // Telugu
  'okati': 1, 'rendu': 2, 'moodu': 3, 'nalugu': 4, 'aidu': 5,
  'aaru': 6, 'edu': 7, 'enimidi': 8, 'tommidi': 9, 'padi': 10,
  'vela': 1000, 'velu': 1000, 'laksha': 100000,
  // Tamil
  'onnu': 1, 'randu': 2, 'moonu': 3, 'naalu': 4, 'anju': 5,
  'aaru_ta': 6, 'saavira': 1000,
};

function parseRegionalAmount(text) {
  const lower = text.toLowerCase();
  // "paanch sau" → 500, "ek hazaar" → 1000, "rendu vela" → 2000, "padi velu" → 10000
  const multiplierWords = ['sau', 'hazaar', 'hazar', 'vela', 'velu', 'lakh', 'laksha', 'saavira'];
  for (const mw of multiplierWords) {
    const re = new RegExp(`(\\w+)\\s+${mw}`, 'i');
    const m = lower.match(re);
    if (m) {
      const base = REGIONAL_NUMBERS[m[1]] || parseInt(m[1]);
      const mult = REGIONAL_NUMBERS[mw];
      if (base && mult) return base * mult;
    }
  }
  // Single number word: "paanch" → 5
  for (const [word, num] of Object.entries(REGIONAL_NUMBERS)) {
    if (lower.includes(word)) return num;
  }
  return null;
}

export { parseRegionalAmount };

function extractEntities(text) {
  const entities = { names: [], dates: [], times: [] };
  for (const p of NAME_PATTERNS) {
    const m = text.match(p);
    if (m?.[1]) entities.names.push(toTitleCase(m[1].trim()));
  }
  for (const { re } of DATE_PATTERNS) {
    const m = text.match(re);
    if (m) { const d = DATE_PATTERNS.find(p => p.re === re)?.resolve(m); if (d) entities.dates.push(String(d).slice(0, 20)); }
  }
  for (const re of TIME_PATTERNS) {
    const m = text.match(re);
    if (m?.[1]) entities.times.push(m[1]);
  }
  entities.names = [...new Set(entities.names)];
  entities.dates = [...new Set(entities.dates)];
  entities.times = [...new Set(entities.times)];
  return entities;
}

function classifyIntent(lower) {
  // v12: Business ledger patterns — MUST run before generic expense/invoice patterns
  // Only meaningful when workspace_id is set; resolver confirms the subtype.
  if (/received|paid me|collected/.test(lower) && /\d/.test(lower))
                                                                        return { type: 'ledger_credit', conf: 0.92 };
  if (/\bsale\b|\bsold\b/.test(lower) && /\d/.test(lower))                  return { type: 'sale',          conf: 0.91 };
  if (/gave|give credit|advance to|credit to|lent/.test(lower) && /\d/.test(lower))
                                                                        return { type: 'ledger_debit',  conf: 0.90 };
  if (/invoice|bill|receipt|payment due|gst|tax/.test(lower))           return { type: 'invoice',    conf: 0.85 };
  if (/payroll|salary|wages|pay staff|pay team/.test(lower))            return { type: 'task',       conf: 0.82 };
  if (/attendance|present|absent|leave/.test(lower))                    return { type: 'task',       conf: 0.78 };
  if (/stock|inventory|reorder|out of stock/.test(lower))               return { type: 'task',       conf: 0.80 };
  if (/compliance|license|permit|renewal|expire/.test(lower))           return { type: 'compliance', conf: 0.83 };
  if (/remind|remember|don.t forget|alert me/.test(lower))              return { type: 'reminder',   conf: 0.88 };
  if (/meet|meeting|call.*\d|catch up|sync|standup/.test(lower))        return { type: 'meeting',    conf: 0.85 };
  if (/buy|purchase|order|shop|get me|pick up/.test(lower))             return { type: 'purchase',   conf: 0.84 };
  if (/spent|paid|expense|₹|\bcost\b|charged/.test(lower))              return { type: 'expense',    conf: 0.85 };
  if (/trip|travel|flight|hotel|book|visa/.test(lower))                 return { type: 'trip',       conf: 0.82 };
  if (/document|scan|upload|file|paperwork/.test(lower))                return { type: 'document',   conf: 0.80 };
  if (/call|phone|message|email|tell|send|contact/.test(lower))         return { type: 'contact',    conf: 0.82 };
  if (/task|todo|do|finish|complete|fix|check|work on/.test(lower))     return { type: 'task',       conf: 0.78 };
  if (/note|write|jot|record|log/.test(lower))                          return { type: 'note',       conf: 0.72 };

  // ── Telugu intent patterns ────────────────────────────────────────
  if (/gurtu pettuko|remind cheyyi|gurthu/.test(lower))                 return { type: 'reminder',   conf: 0.86 };
  if (/rasuko|rasanu|note cheyyi|rayi/.test(lower))                     return { type: 'note',       conf: 0.84 };
  if (/kharchu chesanu|kharchu|income vacchindi|dabbu/.test(lower))     return { type: 'expense',    conf: 0.85 };
  if (/call cheyyi|phone cheyyi|message pampinchu/.test(lower))         return { type: 'contact',    conf: 0.83 };
  if (/teeseyi|delete cheyyi|cancel cheyyi/.test(lower))               return { type: 'task',       conf: 0.80 };
  if (/chupinchu|kanipinchu|show cheyyi/.test(lower))                   return { type: 'note',       conf: 0.70 };

  // ── Hindi intent patterns ─────────────────────────────────────────
  if (/yaad dilao|yaad karo|remind karo|bhool mat/.test(lower))         return { type: 'reminder',   conf: 0.86 };
  if (/likh|note kar|yaad rakh/.test(lower))                            return { type: 'note',       conf: 0.84 };
  if (/kharch|paisa|rupay|rupees|kharcha kiya/.test(lower))             return { type: 'expense',    conf: 0.85 };
  if (/call kar|phone kar|message bhej/.test(lower))                    return { type: 'contact',    conf: 0.83 };
  if (/hata do|delete kar|cancel kar/.test(lower))                      return { type: 'task',       conf: 0.80 };

  // ── Hinglish patterns (code-switched Hindi-English) ───────────────
  if (/kal\s+(?:remind|yaad)|subah\s+(?:\d|remind)|sham\s+ko/.test(lower)) return { type: 'reminder', conf: 0.84 };
  if (/rupees?\s+kharch|kharch\s+ki(?:ya|ye)|paisa\s+diya/.test(lower)) return { type: 'expense',    conf: 0.83 };
  if (/meeting\s+hai|office\s+(?:mein|me)|kaam\s+(?:pe|par)/.test(lower)) return { type: 'meeting',  conf: 0.82 };
  if (/ghar\s+(?:jaate|jate)\s+(?:waqt|time)|way\s+(?:pe|par)/.test(lower)) return { type: 'reminder', conf: 0.80 };
  if (/abhi\s+(?:note|likh|save)/.test(lower))                          return { type: 'note',       conf: 0.82 };

  return { type: 'note', conf: 0.60 };
}

const SPLIT_PATTERNS = [
  /\band\s+(?:also\s+)?(?:call|remind|buy|pay|meet|send|file|check|do|fix|order|book|contact|schedule)\b/i,
  /\bplus\s+(?:call|remind|buy|pay|meet|send|file|check|do|fix|order|book|contact|schedule)\b/i,
  /\balso\s+(?:call|remind|buy|pay|meet|send|file|check|do|fix|order|book|contact|schedule)\b/i,
  /;\s*/,
];

function splitIntents(text) {
  for (const pattern of SPLIT_PATTERNS) {
    const parts = text.split(pattern).map(s => s.trim()).filter(s => s.length > 4);
    if (parts.length > 1) return parts;
  }
  return [text];
}


// ── Geo intent detection ────────────────────────────────────────────────────
// Detects phrases like "when I reach home", "near office", "when I come here".
// Returns null if no geo intent found — never throws.
// Exported separately so voice/capture can use it without changing parseIntent shape.

// v7 FIX: The old pattern was missing \s+ after the alternation group, so
// "when I reach office" (space before 'office') never matched.
// Also the lazy {1,30}? with (?:\b|$) stopped at the first word boundary,
// dropping the second word of multi-word names like "Garage cafe".
// Fix: single unified pattern with \s+ after trigger phrase, greedy match
// stopped by lookahead for common action words or end-of-string.
const GEO_TRIGGER_PATTERN =
  /\b(?:when\s+i\s+(?:reach|get\s+to|arrive\s+at|go\s+to|come\s+to)|on\s+(?:my\s+|the\s+)?way\s+to|near(?:\s+the)?|at(?:\s+the)?)\s+([a-zA-Z][a-zA-Z\s]{0,29}?)(?=\s*(?:$|,|\.|remind|buy|order|pick|get|grab|call|pay|do|check|please|and\s|i\s))/i;

// Words that look like locations but aren't — suppress them
const GEO_FALSE_POSITIVES = new Set([
  'you','me','him','her','them','us','it','there','anywhere','somewhere','nowhere',
]);

// v7: keep old array name as alias so any other callers don't break
const GEO_TRIGGER_PATTERNS = [GEO_TRIGGER_PATTERN];

const GEO_CURRENT_LOCATION_PATTERNS = [
  /when\s+i\s+(?:come|get|arrive)\s+here/i,
  /(?:at|near)\s+(?:this\s+place|here)/i,
  /whenever\s+i\s+pass\s+(?:this\s+place|here)/i,
  /from\s+here/i,
  // Fix 2: additional natural phrases for current-location intent
  /remind\s+me\s+here\b/i,
  /note\s+(?:this\s+)?here\b/i,
  /when\s+(?:i['\s]+m\s+)?here\s+remind\s+me/i,
  /save\s+(?:this\s+)?here\b/i,
];

// Well-known named locations (matched against extracted location name)
const KNOWN_PLACE_NAMES = new Set([
  'home','office','work','school','college','gym','hospital','market',
  'shop','store','mall','station','airport','bank','temple','church','mosque',
]);


// ── Route intent detection (v5) ─────────────────────────────────────────────
// "on the way to office", "while going home", "near office while going home"
const ROUTE_PATTERNS = [
  // "on the way to X" / "on my way to X"
  { re: /on\s+(?:my\s+)?way\s+to\s+([a-zA-Z][a-zA-Z\s]{1,25}?)(?:\s+(?:from|via|through)|[.,!?]|$)/i, group: 'destination' },
  // "while going to X"
  { re: /while\s+going\s+(?:to\s+)?([a-zA-Z][a-zA-Z\s]{1,25}?)(?:\s+(?:from|via)|[.,!?]|$)/i, group: 'destination' },
  // "going home" / "heading to office"
  { re: /(?:heading|going)\s+(?:to\s+)?([a-zA-Z][a-zA-Z\s]{1,25}?)(?:\s+(?:from|via)|[.,!?]|$)/i, group: 'destination' },
  // "near X while going" — extract the X before "while"
  { re: /near\s+([a-zA-Z][a-zA-Z\s]{1,25}?)\s+while/i, group: 'waypoint' },
];

/**
 * detectRouteIntent(text) → { detected, destination, waypoint } | null
 * destination: the place the user is heading to
 * waypoint: an intermediate place to trigger near (e.g. "near office while going home")
 */
export function detectRouteIntent(text) {
  if (!text) return null;
  const lower = text.toLowerCase().trim();

  // Must have a route signal word
  const hasRouteSignal = /\b(?:on\s+(?:my\s+)?way|while\s+going|heading\s+to|going\s+to|on\s+route)\b/i.test(lower);
  if (!hasRouteSignal) return null;

  let destination = null;
  let waypoint = null;

  for (const { re, group } of ROUTE_PATTERNS) {
    const m = lower.match(re);
    if (m?.[1]) {
      const place = m[1].trim().replace(/\s+/g, ' ');
      if (place.length < 2 || place.length > 30) continue;
      const firstWord = place.split(' ')[0];
      if (!KNOWN_PLACE_NAMES.has(firstWord) && place.split(' ').length > 3) continue;
      if (group === 'destination' && !destination) destination = place;
      if (group === 'waypoint' && !waypoint) waypoint = place;
    }
  }

  if (!destination && !waypoint) return null;
  return { detected: true, destination: destination || null, waypoint: waypoint || null };
}

/**
 * detectGeoIntent(text) → { detected, location_name, use_current_location } | null
 * Returns null if no geo intent is found.
 * location_name is lowercase trimmed.
 */
export function detectGeoIntent(text) {
  if (!text) return null;
  const lower = text.toLowerCase().trim();

  // Current-location phrases take priority
  for (const re of GEO_CURRENT_LOCATION_PATTERNS) {
    if (re.test(lower)) {
      console.log('[GEO] detectGeoIntent: current-location detected', { text: text.slice(0, 60) });
      return { detected: true, type: 'current', location_name: null, use_current_location: true };
    }
  }

  // Named-location patterns (v7: fixed regex + false-positive filter)
  const geoMatch = lower.match(GEO_TRIGGER_PATTERN);
  if (geoMatch?.[1]) {
    const rawName = geoMatch[1].trim().replace(/\s+/g, ' ');
    const firstWord = rawName.split(' ')[0].toLowerCase();
    // Suppress false positives ("near you", "at here", etc.)
    if (rawName.length >= 2 && rawName.length <= 30 && !GEO_FALSE_POSITIVES.has(firstWord)) {
      console.log('[GEO] detectGeoIntent: arrival detected', { rawName, text: text.slice(0, 60) });
      return { detected: true, type: 'arrival', location_name: rawName, use_current_location: false };
    }
  }

  // Fallback: bare "near X" or "at X" for known places (belt-and-suspenders)
  for (const place of KNOWN_PLACE_NAMES) {
    const bareNear = new RegExp(`\\b(?:near|at|reach)\\s+(?:the\\s+)?${place}\\b`, 'i');
    if (bareNear.test(lower)) {
      console.log('[GEO] detectGeoIntent: known-place arrival', { place });
      return { detected: true, type: 'arrival', location_name: place, use_current_location: false };
    }
  }



  return null;
}

export function computeSimilarityKey(text) {
  const STOP = new Set(['the','a','an','to','for','in','on','at','by','of','and','or','is','are','was','were','will','have','has','had','be','it','i','me','my','he','she','they','their','this','that','with','as','but']);
  return (text || '').toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP.has(w))
    .sort()
    .join('_')
    .slice(0, 60);
}

export function parseIntent(text) {
  const trimmed  = (text || '').trim();
  const lower    = trimmed.toLowerCase();
  const entities = extractEntities(trimmed);
  const { type: intentType, conf } = classifyIntent(lower);
  const parts    = splitIntents(trimmed);
  const isMulti  = parts.length > 1;

  const confidence = Math.min(0.95,
    conf
    + Math.min(0.10, trimmed.length / 200)
    + (entities.dates.length > 0 ? 0.03 : 0)
    + (entities.names.length > 0 ? 0.02 : 0)
  );

  const geo = detectGeoIntent(trimmed);

  return {
    type: intentType, subject: trimmed.slice(0, 60), confidence,
    is_multi: isMulti,
    sub_intents: isMulti ? parts.map(p => ({ text: p, ...classifyIntent(p.toLowerCase()) })) : [],
    entities, similarity_key: computeSimilarityKey(trimmed),
    metadata: { length: trimmed.length, wordCount: trimmed.split(/\s+/).filter(Boolean).length },
    // v4: geo trigger intent — null if not a geo keep, otherwise { detected, location_name, use_current_location }
    geo: geo || null,
    // v5: route intent — null if not a route keep, otherwise { detected, destination, waypoint }
    route: detectRouteIntent(trimmed) || null,
  };
}
