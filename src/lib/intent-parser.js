// src/lib/intent-parser.js  v7
// v7: FIXED GEO_TRIGGER_PATTERNS — was missing \s+ after alternation group, causing
//     "when I reach X" to never match. Added false-positive filter. All test cases pass.
// v6: detectGeoIntent returns type field.
// v5: detectRouteIntent() added.
// v4: detectGeoIntent(); parseIntent() geo field.
// v3: NAME_PATTERNS case-insensitive.

// Words that follow a name but are never part of one. Without this the
// capture swallowed the next token: "Call Ravi at 5 p.m." produced the
// contact "Ravi At", and the app told the user «"Ravi At" isn't in your
// contacts». Fixed 22 Aug 2026.
// W14 (9 Sep 2026): the 22 Aug fix above works - "Ravi At", "Me To",
// "Gautam Tomorrow" and "Petrol At" no longer reproduce. What it does not cover
// is CODE-MIXED speech, because every stopword in it is English.
//
// In Telugu the verb follows the name: "Gautam ki call cheyali" means "call
// Gautam". The English pattern "call <name>" then captures the VERB, and we
// saved a contact called "Cheyali Safe". Verified against the live database:
// that row exists, alongside the historical artefacts the August fix retired.
//
// So the Indic verbs and particles that commonly sit after "call" are added
// here. This suppresses the wrong capture; it does NOT yet extract the right
// name from Telugu word order, which needs a separate pattern for
// "<name> ki/ko <verb>" and is deliberately out of scope for this fix.
const NAME_STOPWORDS = 'at|to|me|on|by|in|the|about|for|from|regarding|re|and|a|an|tomorrow|today|tonight|next|this|that|him|her|them|us|now'
  + '|please|pls|dayachesi|kripya'
  + '|cheyali|cheyyali|cheyyi|cheyi|chey|chesi|cheseyi|chestha|pettu|ivvu|kottu|gurthu|maatladali|matladali|maatladu|matladu|pampu|pampinchu'
  + '|karo|karna|kar|karke|kardo|karenge|bolo|bol|bhejo|bhej|dena|dedo|diye|milna|lagao|lagaao|lagado|baat'
  + '|ki|ko|se|ka|ke|ku|tho|nunchi|nundi|kosam|gurinchi'
  + '|garu|gari|ji|bhai'
  + '|safe|save|call|phone|dial|message|email|invoice|contact';

const INDIC_STOP_WORDS = [
  'కాల్', 'ఫోన్', 'మెసేజ్', 'చెయ్యి', 'చేయి', 'చెయ్', 'చేయండి', 'చెయ్యండి', 'చేయాలి', 'చెయ్యాలి',
  'పెట్టు', 'ఇవ్వు', 'కొట్టు', 'పంపు', 'పంపించు', 'మాట్లాడు', 'మాట్లాడాలి', 'గారు', 'గారి', 'గారికి',
  'కి', 'కు', 'తో', 'కోసం', 'గురించి',
  'कॉल', 'काल', 'फोन', 'फ़ोन', 'मैसेज', 'करो', 'कर', 'करदो', 'करना', 'करेंगे', 'लगाओ', 'लगादो',
  'भेजो', 'भेज', 'देना', 'देदो', 'बोलो', 'बोल', 'बात', 'जी', 'भाई', 'को', 'से', 'का', 'के'
];

const STOP_NAME_SET = new Set(NAME_STOPWORDS.split('|').map(s => s.toLowerCase()));
const INDIC_STOP_SET = new Set(INDIC_STOP_WORDS);

const DE_VOWELS = {
  '\u0905': 'a', '\u0906': 'aa', '\u0907': 'i', '\u0908': 'ee', '\u0909': 'u', '\u090A': 'oo',
  '\u090F': 'e', '\u0910': 'ai', '\u0913': 'o', '\u0914': 'au', '\u090B': 'ri'
};
const DE_MATRAS = {
  '\u093E': 'aa', '\u093F': 'i', '\u0940': 'ee', '\u0941': 'u', '\u0942': 'oo',
  '\u0943': 'ri', '\u0947': 'e', '\u0948': 'ai', '\u094B': 'o', '\u094C': 'au'
};
const DE_CONSONANTS = {
  '\u0915': 'k', '\u0916': 'kh', '\u0917': 'g', '\u0918': 'gh', '\u0919': 'n',
  '\u091A': 'ch', '\u091B': 'chh', '\u091C': 'j', '\u091D': 'jh', '\u091E': 'n',
  '\u091F': 't', '\u0920': 'th', '\u0921': 'd', '\u0922': 'dh', '\u0923': 'n',
  '\u0924': 't', '\u0925': 'th', '\u0926': 'd', '\u0927': 'dh', '\u0928': 'n',
  '\u092A': 'p', '\u092B': 'ph', '\u092C': 'b', '\u092D': 'bh', '\u092E': 'm',
  '\u092F': 'y', '\u0930': 'r', '\u0932': 'l', '\u0933': 'l', '\u0935': 'v',
  '\u0936': 'sh', '\u0937': 'sh', '\u0938': 's', '\u0939': 'h'
};

const TE_VOWELS = {
  '\u0C05': 'a', '\u0C06': 'aa', '\u0C07': 'i', '\u0C08': 'ee', '\u0C09': 'u', '\u0C0A': 'oo',
  '\u0C0E': 'e', '\u0C0F': 'e', '\u0C10': 'ai', '\u0C12': 'o', '\u0C13': 'o', '\u0C14': 'au', '\u0C0B': 'ri'
};
const TE_MATRAS = {
  '\u0C3E': 'aa', '\u0C3F': 'i', '\u0C40': 'ee', '\u0C41': 'u', '\u0C42': 'oo',
  '\u0C43': 'ri', '\u0C46': 'e', '\u0C47': 'e', '\u0C48': 'ai', '\u0C4A': 'o', '\u0C4B': 'o', '\u0C4C': 'au'
};
const TE_CONSONANTS = {
  '\u0C15': 'k', '\u0C16': 'kh', '\u0C17': 'g', '\u0C18': 'gh', '\u0C19': 'n',
  '\u0C1A': 'ch', '\u0C1B': 'chh', '\u0C1C': 'j', '\u0C1D': 'jh', '\u0C1E': 'n',
  '\u0C1F': 't', '\u0C20': 'th', '\u0C21': 'd', '\u0C22': 'dh', '\u0C23': 'n',
  '\u0C24': 't', '\u0C25': 'th', '\u0C26': 'd', '\u0C27': 'dh', '\u0C28': 'n',
  '\u0C2A': 'p', '\u0C2B': 'ph', '\u0C2C': 'b', '\u0C2D': 'bh', '\u0C2E': 'm',
  '\u0C2F': 'y', '\u0C30': 'r', '\u0C31': 'r', '\u0C32': 'l', '\u0C33': 'l', '\u0C35': 'v',
  '\u0C36': 'sh', '\u0C37': 'sh', '\u0C38': 's', '\u0C39': 'h'
};

function transliterateIndic(str) {
  if (!/[\u0900-\u097F\u0C00-\u0C7F]/.test(str)) {
    return toTitleCase(str);
  }
  let res = '';
  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    if (DE_VOWELS[c]) res += DE_VOWELS[c];
    else if (DE_MATRAS[c]) res += DE_MATRAS[c];
    else if (DE_CONSONANTS[c]) {
      const next = str[i + 1];
      if (next === '\u094D') {
        res += DE_CONSONANTS[c];
        i++;
      } else if (DE_MATRAS[next]) {
        res += DE_CONSONANTS[c];
      } else {
        const isEnd = (i === str.length - 1 || str[i + 1] === ' ');
        const afterVirama = (i > 0 && str[i - 1] === '\u094D');
        res += DE_CONSONANTS[c] + (!isEnd || afterVirama ? 'a' : '');
      }
    } else if (TE_VOWELS[c]) res += TE_VOWELS[c];
    else if (TE_MATRAS[c]) res += TE_MATRAS[c];
    else if (TE_CONSONANTS[c]) {
      const next = str[i + 1];
      if (next === '\u0C4D') {
        res += TE_CONSONANTS[c];
        i++;
      } else if (TE_MATRAS[next]) {
        res += TE_CONSONANTS[c];
      } else {
        res += TE_CONSONANTS[c] + 'a';
      }
    } else if (c === '\u0902' || c === '\u0901' || c === '\u0C02' || c === '\u0C01') {
      res += 'n';
    } else {
      res += c;
    }
  }
  return res
    .replace(/aa/g, 'a')
    .replace(/ee/g, 'i')
    .replace(/oo/g, 'u')
    .replace(/\b\w/g, c => c.toUpperCase());
}

function cleanCandidateName(raw) {
  if (!raw) return null;
  let s = raw.trim();
  // Strip honorifics
  s = s.replace(/\s+\b(?:garu|ji|gari|bhai)\b/gi, '');
  s = s.replace(/^\b(?:garu|ji|gari|bhai)\b/gi, '');
  s = s.replace(/\s*(?:గారు|గారికి|గారి)\s*/g, '');
  s = s.replace(/\s*(?:जी|भाई)\s*/g, '');
  // Strip case suffixes attached directly
  s = s.replace(/([\u0C00-\u0C7F]{2,})(?:గారికి|గారు|కి|కు|తో)$/, '$1');
  s = s.replace(/([\u0900-\u097F]{2,})(?:जी|को|से)$/, '$1');
  s = s.trim();
  if (!s) return null;

  const words = s.split(/\s+/);
  if (words.length > 2) return null;
  for (const w of words) {
    const lw = w.toLowerCase();
    if (STOP_NAME_SET.has(lw) || INDIC_STOP_SET.has(w)) return null;
  }
  return transliterateIndic(s).trim();
}

function extractContactName(text) {
  if (!text) return null;
  const stripped = stripWakePhrase(text);

  // Unicode word boundary for Indic & ASCII
  const WB = '(?=$|[^\\p{L}\\p{M}\\p{N}])';

  // Disallow Indic particles / stopwords as name tokens
  const indicStopDisallowed = INDIC_STOP_WORDS.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const tokenLookahead = `(?!(?:${NAME_STOPWORDS})\\b)(?!(?:${indicStopDisallowed})${WB})`;
  const sovToken = `${tokenLookahead}[A-Za-z\\u0C00-\\u0C7F\\u0900-\\u097F]+`;

  // Pattern 1: Indic SOV
  // [Name] (garu|ji)? (ki|ko|se|tho|to|ku|కి|కు|తో|కోసం|గురించి|को|से) (call|phone|message|cheyyi|karo|lagao|bhejo|maatladali|మాట్లాడు|చెయ్యి|करो)...
  const sovRegex = new RegExp(
    `^(${sovToken}(?:\\s+${sovToken})?)(?:\\s+(?:garu|ji|gari|bhai|గారు|గారి|గారికి|जी|भाई))?\\s*(?:ki|ko|se|tho|to|ku|కి|కు|తో|కోసం|గురించి|को|से)?\\s+(?:call|phone|dial|message|msg|baat|cheyyi|cheyi|cheyali|cheyyali|pettu|pampu|pampinchu|maatladali|matladali|maatladu|matladu|karo|kar|kardo|karna|lagao|lagaao|lagado|bhejo|bhej|కాల్|ఫోన్|మెసేజ్|చెయ్యి|చేయి|చేయాలి|చెయ్యాలి|పెట్టు|పంపు|పంపించు|మాట్లాడు|మాట్లాడాలి|कॉल|काल|फोन|फ़ोन|मैसेज|करो|कर|लगाओ|भेजो|बात)${WB}`,
    'iu'
  );
  const sovMatch = stripped.match(sovRegex);
  if (sovMatch?.[1]) {
    const c = cleanCandidateName(sovMatch[1]);
    if (c) return c;
  }

  // Pattern 2: English SVO
  // (call|phone|dial|ring|contact|tell|meet|remind|message|email|invoice to) [Name]
  const svoRegex = new RegExp(
    `(?:call|phone|dial|contact|tell|meet|remind|message|email|invoice to)\\s+(${sovToken}(?:\\s+${sovToken})?)`,
    'iu'
  );
  const svoMatch = stripped.match(svoRegex);
  if (svoMatch?.[1]) {
    const c = cleanCandidateName(svoMatch[1]);
    if (c) return c;
  }

  // Pattern 3: Indic verb first: (call cheyyi|call karo|కాల్ చెయ్యి|कॉल करो) [Name]
  const verbFirstRegex = new RegExp(
    `(?:call\\s+(?:cheyyi|cheyi|chey|karo|kar)|కాల్\\s*(?:చెయ్యి|చేయి)|कॉल\\s*(?:करो|कर))\\s+(${sovToken}(?:\\s+${sovToken})?)`,
    'iu'
  );
  const verbFirstMatch = stripped.match(verbFirstRegex);
  if (verbFirstMatch?.[1]) {
    const c = cleanCandidateName(verbFirstMatch[1]);
    if (c) return c;
  }

  return null;
}

const NAME_PATTERNS = [
  new RegExp(
    '(?:call|phone|dial|contact|tell|meet|remind|message|email|invoice to)\\s+' +
    `((?!(?:${NAME_STOPWORDS})\\b)[A-Za-z][a-zA-Z]+` +
    `(?:\\s+(?!(?:${NAME_STOPWORDS})\\b)[A-Za-z][a-zA-Z]+)?)`,
    'i'
  ),
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
// Speech-to-text writes the meridiem with full stops — "10 a.m.", "5 p.m." —
// and the previous `(?:am|pm)` never matched that form. The capture stopped at
// the digit, parseTimeToDate() received a bare "10", returned null, and the
// spoken time was silently dropped: the reminder landed on the right day at
// the wrong time. Typed "10am" parsed fine, which made it look intermittent.
// Reproduced and fixed 22 Aug 2026.
const TIME_PATTERNS = [
  /\bat\s+(\d{1,2}(?::\d{2})?\s*(?:a\.?\s?m\.?|p\.?\s?m\.?)?)/i,
  /\b(\d{1,2}(?::\d{2})?\s*(?:a\.?\s?m\.?|p\.?\s?m\.?))/i,
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
// v8: three fixes to parseRegionalAmount.
//   1. Native script was missing entirely — only romanised spellings existed, so
//      "పది" from Telugu STT could never match 'padi'. Telugu and Devanagari added,
//      plus digit normalisation (౧౦ / १० → 10).
//   2. Matching was lower.includes(word), i.e. substring. 'edu' (Telugu seven) also
//      sits inside veduka/chedu/nedu, so unrelated sentences resolved to 7.
//      Now matched on Unicode-aware word boundaries.
//   3. The first key in object order won rather than the best one. Longest match
//      now wins, so declaration order no longer decides the answer.
const REGIONAL_NUMBERS = {
  // Hindi — romanised
  'ek': 1, 'do': 2, 'teen': 3, 'char': 4, 'paanch': 5,
  'chhe': 6, 'saat': 7, 'aath': 8, 'nau': 9, 'das': 10,
  'bees': 20, 'tees': 30, 'chalees': 40, 'pachaas': 50,
  'sau': 100, 'hazaar': 1000, 'hazar': 1000, 'lakh': 100000,
  // Hindi — Devanagari
  'एक': 1, 'दो': 2, 'तीन': 3, 'चार': 4, 'पांच': 5, 'पाँच': 5,
  'छह': 6, 'छे': 6, 'सात': 7, 'आठ': 8, 'नौ': 9, 'दस': 10,
  'बीस': 20, 'तीस': 30, 'चालीस': 40, 'पचास': 50,
  'सौ': 100, 'हजार': 1000, 'हज़ार': 1000, 'लाख': 100000,
  // Telugu — romanised
  'okati': 1, 'rendu': 2, 'moodu': 3, 'nalugu': 4, 'aidu': 5,
  'aaru': 6, 'edu': 7, 'enimidi': 8, 'tommidi': 9, 'padi': 10,
  'vanda': 100, 'vela': 1000, 'velu': 1000, 'laksha': 100000,
  // Telugu — script
  'ఒకటి': 1, 'రెండు': 2, 'మూడు': 3, 'నాలుగు': 4, 'ఐదు': 5,
  'ఆరు': 6, 'ఏడు': 7, 'ఎనిమిది': 8, 'తొమ్మిది': 9, 'పది': 10,
  'ఇరవై': 20, 'ముప్పై': 30, 'నలభై': 40, 'యాభై': 50,
  'వంద': 100, 'వెయ్యి': 1000, 'వేలు': 1000, 'లక్ష': 100000,
  // Tamil — romanised
  'onnu': 1, 'randu': 2, 'moonu': 3, 'naalu': 4, 'anju': 5,
  'saavira': 1000,
};

// Multiplier words, in every script we accept.
const MULTIPLIER_WORDS = [
  'sau', 'hazaar', 'hazar', 'vanda', 'vela', 'velu', 'lakh', 'laksha', 'saavira',
  'सौ', 'हजार', 'हज़ार', 'लाख',
  'వంద', 'వెయ్యి', 'వేలు', 'లక్ష',
];

// Telugu ౦-౯ (U+0C66..) and Devanagari ०-९ (U+0966..) → ASCII, so "౧౦" parses as "10".
// Helps times as well as amounts.
function normalizeIndicDigits(str) {
  return String(str)
    .replace(/[౦-౯]/g, (d) => String(d.charCodeAt(0) - 0x0C66))
    .replace(/[०-९]/g, (d) => String(d.charCodeAt(0) - 0x0966));
}

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// \b is ASCII-only and matches nothing useful against Telugu or Devanagari, so use an
// explicit "not a letter or digit" boundary that behaves the same in every script.
// \p{M} matters: Telugu vowel signs (ి in పది) and Devanagari marks (ँ in पाँच)
// are combining marks, not letters. Leaving them out cuts words in half.
function wordRe(word) {
  return new RegExp(`(?:^|[^\\p{L}\\p{N}\\p{M}])${escapeRe(word)}(?=$|[^\\p{L}\\p{N}\\p{M}])`, 'iu');
}

// Longest match wins — a short key can no longer beat a longer, more specific one
// purely because it was declared first.
function matchNumberWord(text) {
  let best = null;
  for (const [word, num] of Object.entries(REGIONAL_NUMBERS)) {
    if (wordRe(word).test(text) && (!best || word.length > best.word.length)) {
      best = { word, num };
    }
  }
  return best;
}

function parseRegionalAmount(text) {
  const lower = normalizeIndicDigits(String(text || '')).toLowerCase();

  // "paanch sau" → 500, "ek hazaar" → 1000, "rendu vela" → 2000, "పది వేలు" → 10000
  for (const mw of MULTIPLIER_WORDS) {
    const re = new RegExp(`([\\p{L}\\p{N}\\p{M}]+)\\s+${escapeRe(mw)}(?=$|[^\\p{L}\\p{N}\\p{M}])`, 'iu');
    const m = lower.match(re);
    if (m) {
      const base = REGIONAL_NUMBERS[m[1]] ?? parseInt(m[1], 10);
      const mult = REGIONAL_NUMBERS[mw];
      if (base && mult) return base * mult;
    }
  }

  const hit = matchNumberWord(lower);
  return hit ? hit.num : null;
}

export { parseRegionalAmount };

function extractEntities(text) {
  const entities = { names: [], dates: [], times: [] };
  const contactName = extractContactName(text);
  if (contactName) {
    entities.names.push(contactName);
  } else {
    for (const p of NAME_PATTERNS) {
      const m = text.match(p);
      if (m?.[1]) entities.names.push(toTitleCase(m[1].trim()));
    }
  }
  for (const { re } of DATE_PATTERNS) {
    const m = text.match(re);
    if (m) { const d = DATE_PATTERNS.find(p => p.re === re)?.resolve(m); if (d) entities.dates.push(String(d).slice(0, 20)); }
  }
  for (const re of TIME_PATTERNS) {
    const m = text.match(re);
    if (m?.[1]) entities.times.push(m[1]);
  }
  const IGNORED_NAMES = new Set(['me', 'me to', 'to', 'us', 'him', 'her', 'them', 'myself', 'someone']);
  entities.names = [...new Set(entities.names)].filter(n => !IGNORED_NAMES.has(n.toLowerCase()));
  entities.dates = [...new Set(entities.dates)];
  entities.times = [...new Set(entities.times)];
  return entities;
}

function classifyIntent(lower) {
  // Explicit reminder triggers take priority over generic keywords (e.g. "remind me to pay the bill")
  if (/remind|remember|don.t forget|alert me/.test(lower))              return { type: 'reminder',   conf: 0.90 };

  // Going somewhere: "navigate to X", "set location to X", "take me to X".
  // Before this rule nothing produced 'navigation', so voice navigation never
  // auto-opened Maps (found 21 Sep 2026). Anchored to the start, and a spoken
  // time keeps it a plan rather than an instant action.
  if (/^(?:please\s+|hey\s+aaria\s+|aaria\s+)?(?:navigate|navigation|directions?|route to|take me|drive me|go to|get me to|set (?:the |my )?(?:location|destination)|show (?:me )?(?:the )?(?:way|route)|how (?:do i|to|can i) (?:get|reach|go))\b/.test(lower)
      && !/\b(?:tomorrow|tonight|today|morning|evening|at \d|\d\s?(?:am|pm))\b/.test(lower))
                                                                        return { type: 'navigation', conf: 0.90 };

  // v12: Business ledger patterns — MUST run before generic expense/invoice patterns
  // Only meaningful when workspace_id is set; resolver confirms the subtype.
  if (/received|paid me|collected/.test(lower) && /\d/.test(lower))
                                                                        return { type: 'ledger_credit', conf: 0.92 };
  if (/\bsale\b|\bsold\b/.test(lower) && /\d/.test(lower))                  return { type: 'sale',          conf: 0.91 };
  if (/gave|give credit|advance to|credit to|lent/.test(lower) && /\d/.test(lower))
                                                                        return { type: 'ledger_debit',  conf: 0.90 };
  if (/invoice|\bbill\b|receipt|payment due|gst|tax/.test(lower))        return { type: 'invoice',    conf: 0.85 };
  if (/payroll|salary|wages|pay staff|pay team/.test(lower))            return { type: 'task',       conf: 0.82 };
  if (/attendance|present|absent|leave/.test(lower))                    return { type: 'task',       conf: 0.78 };
  if (/stock|inventory|reorder|out of stock/.test(lower))               return { type: 'task',       conf: 0.80 };
  if (/compliance|license|permit|renewal|expire/.test(lower))           return { type: 'compliance', conf: 0.83 };
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
  if (/call cheyyi|call cheyali|call cheyi|phone cheyyi|phone cheyi|message pampinchu|message pampu|matladali|maatladali|matladu|maatladu|కాల్|ఫోన్|మెసేజ్\s*(?:పంపు|పంపించు)|మాట్లాడు|మాట్లాడాలి/.test(lower)) return { type: 'contact', conf: 0.83 };
  if (/teeseyi|delete cheyyi|cancel cheyyi/.test(lower))               return { type: 'task',       conf: 0.80 };
  if (/chupinchu|kanipinchu|show cheyyi/.test(lower))                   return { type: 'note',       conf: 0.70 };

  // ── Hindi intent patterns ─────────────────────────────────────────
  if (/yaad dilao|yaad karo|remind karo|bhool mat/.test(lower))         return { type: 'reminder',   conf: 0.86 };
  if (/likh|note kar|yaad rakh/.test(lower))                            return { type: 'note',       conf: 0.84 };
  if (/kharch|paisa|rupay|rupees|kharcha kiya/.test(lower))             return { type: 'expense',    conf: 0.85 };
  if (/call kar|phone kar|message bhej|call lagao|call kardo|baat kar|कॉल|फ़ोन|फोन|मैसेज\s*भेज|बात\s*कर/.test(lower)) return { type: 'contact', conf: 0.83 };
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

export function stripWakePhrase(text) {
  if (!text) return '';
  return text
    .replace(/^(?:hi|hey|hello|ok|okay)?\s*(?:aaria|arya|aria|aariya|ariaa)\s*(?:can\s+you\s+please|please|can\s+you)?\s*/i, '')
    .trim();
}

export function parseIntent(text) {
  const rawText  = (text || '').trim();
  const trimmed  = stripWakePhrase(rawText) || rawText;
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
