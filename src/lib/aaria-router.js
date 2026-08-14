// src/lib/aaria-router.js
// ─────────────────────────────────────────────────────────────────────────────
// Aaria's REFLEX layer — the things she must do instantly, without a server.
//
// WHY THIS EXISTS
// Every utterance today takes the same path: POST /api/voice/capture → Sarvam →
// ~4s → an answer. That is the right cost for "remind me to call Gautam
// tomorrow". It is an absurd cost for "open invoices", which is a keystroke
// wearing a sentence. An assistant that takes four seconds to change screens
// does not feel like an assistant; it feels like a form.
//
// So: a tiny deterministic router runs first, on-device, in under a millisecond.
// If it recognises a reflex it acts immediately. If it does not — and this is
// the important half — it returns null and the utterance goes to the real brain
// untouched.
//
// THE DANGEROUS FAILURE MODE, AND THE GUARD AGAINST IT
// The tempting implementation is "if the text contains 'invoices', navigate".
// That implementation destroys the app, because
//     "remind me to send the invoice tomorrow"
// contains 'invoice' and is emphatically not a navigation request. Losing a
// user's reminder to an over-eager shortcut is far worse than making them wait
// four seconds.
//
// Two guards, both enforced below and both covered by tests:
//   1. STRUCTURE — the utterance must be *entirely* a command. A verb, an
//      optional article, a destination, and nothing else. Trailing words mean
//      the user was talking about something, not asking for it.
//   2. CONTENT VETO — if the utterance carries any marker of something worth
//      keeping (a time, a reminder verb, an amount, a person to contact), the
//      router refuses even a structurally perfect match.
//
// When the two disagree, the veto wins. The cost of a false negative is four
// seconds. The cost of a false positive is lost data.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Every screen Aaria can open, with the words a real person would actually say.
 *
 * Keywords are matched whole, longest-first, so "business dashboard" cannot be
 * swallowed by "dashboard". Romanised Hindi/Telugu sit alongside native script
 * because people type and speak both, often in the same sentence.
 */
export const DESTINATIONS = [
  // ── Personal ───────────────────────────────────────────────────────────────
  { path: '/dashboard',    label: 'Dashboard',    keywords: ['dashboard', 'home', 'home screen', 'main screen', 'ghar', 'होम'] },
  // NOTE ON THE MISSING TELUGU/HINDI WORDS HERE.
  // The natural words for "reminders" — గుర్తులు, यादें, "yaad" — share a stem
  // with the words for "remind me", which the content veto below must catch.
  // A veto that fires on గుర్తు cannot help firing inside గుర్తులు. Faced with
  // that collision the veto wins: losing a spoken Telugu reminder is far worse
  // than making a Telugu speaker tap the menu. The router test enforces that no
  // keyword in this table is unreachable, so this stays honest.
  { path: '/reminders',    label: 'Reminders',    keywords: ['reminders', 'reminder list', 'my reminders', 'रिमाइंडर'] },
  { path: '/calendar',     label: 'Calendar',     keywords: ['calendar', 'my calendar', 'schedule', 'कैलेंडर', 'క్యాలెండర్'] },
  { path: '/documents',    label: 'Documents',    keywords: ['documents', 'my documents', 'docs', 'papers', 'दस्तावेज', 'పత్రాలు'] },
  { path: '/memories',     label: 'Memories',     keywords: ['memories', 'my memories', 'జ్ఞాపకాలు'] },
  { path: '/finance',      label: 'Money',        keywords: ['finance', 'money', 'my money', 'spending', 'expenses', 'paisa', 'पैसा', 'డబ్బు'] },
  { path: '/bills',        label: 'Bills',        keywords: ['bills', 'my bills', 'बिल', 'బిల్లులు'] },
  { path: '/health',       label: 'Health',       keywords: ['health', 'my health', 'सेहत', 'ఆరోగ్యం'] },
  { path: '/mood',         label: 'Mood',         keywords: ['mood', 'my mood', 'mood tracker', 'मूड'] },
  { path: '/family',       label: 'Family',       keywords: ['family', 'my family', 'परिवार', 'కుటుంబం'] },
  { path: '/contacts',     label: 'Contacts',     keywords: ['contacts', 'my contacts', 'people', 'संपर्क'] },
  { path: '/messages',     label: 'Messages',     keywords: ['messages', 'my messages', 'inbox', 'chats', 'संदेश'] },
  { path: '/trips',        label: 'Trips',        keywords: ['trips', 'my trips', 'travel', 'यात्रा'] },
  { path: '/geo',          label: 'Places',       keywords: ['places', 'saved places', 'locations', 'geo'] },
  { path: '/driving',      label: 'Driving mode', keywords: ['driving', 'driving mode', 'drive mode'] },
  { path: '/camera',       label: 'Camera',       keywords: ['camera', 'scan a document', 'कैमरा'] },
  { path: '/drive',        label: 'Drive',        keywords: ['drive', 'my drive', 'files'] },
  { path: '/warranty',     label: 'Warranties',   keywords: ['warranty', 'warranties', 'guarantee'] },
  { path: '/kids',         label: 'Kids mode',    keywords: ['kids', 'kids mode', 'child mode', 'बच्चे'] },
  { path: '/sos',          label: 'SOS',          keywords: ['sos', 'emergency contacts screen'] },
  { path: '/emergency',    label: 'Emergency',    keywords: ['emergency', 'आपातकाल'] },
  // "today brief" is deliberately absent: the veto catches the word "today",
  // as it must, so that keyword could never fire. Unreachable keywords are
  // removed rather than left in to look thorough.
  { path: '/daily-brief',  label: 'Daily brief',  keywords: ['daily brief', 'my brief', 'briefing'] },
  { path: '/news',         label: 'News',         keywords: ['news', 'खबर', 'వార్తలు'] },
  { path: '/smart-home',   label: 'Smart home',   keywords: ['smart home', 'home devices', 'devices'] },
  { path: '/connectors',   label: 'Connections',  keywords: ['connectors', 'connections', 'integrations'] },
  { path: '/subscription', label: 'Subscription', keywords: ['subscription', 'my plan', 'billing', 'upgrade'] },
  { path: '/profile',      label: 'Profile',      keywords: ['profile', 'my profile', 'my account', 'प्रोफाइल'] },
  { path: '/settings',     label: 'Settings',     keywords: ['settings', 'preferences', 'सेटिंग', 'సెట్టింగ్‌లు'] },
  { path: '/settings/voice', label: 'Voice settings', keywords: ['voice settings', 'voice options', 'wake word settings'] },
  { path: '/more',         label: 'More',         keywords: ['more', 'all features', 'everything', 'menu'] },
  { path: '/ask-aaria',    label: 'Ask Aaria',    keywords: ['ask aaria', 'aaria chat', 'talk to aaria'] },

  // ── Business ───────────────────────────────────────────────────────────────
  { path: '/b/dashboard',  label: 'Business dashboard', keywords: ['business dashboard', 'shop dashboard', 'business home'] },
  { path: '/b/invoices',   label: 'Invoices',     keywords: ['invoices', 'my invoices', 'billing screen', 'चालान'] },
  { path: '/b/customers',  label: 'Customers',    keywords: ['customers', 'my customers', 'clients', 'ग्राहक', 'కస్టమర్లు'] },
  { path: '/b/inventory',  label: 'Inventory',    keywords: ['inventory', 'stock', 'my stock', 'स्टॉक'] },
  { path: '/b/ledger',     label: 'Ledger',       keywords: ['ledger', 'khata', 'my khata', 'खाता', 'ఖాతా'] },
  { path: '/b/collections', label: 'Collections', keywords: ['collections', 'dues', 'money owed', 'udhaar', 'उधार'] },
  { path: '/b/team',       label: 'Team',         keywords: ['team', 'my team', 'staff', 'employees', 'स्टाफ'] },
  { path: '/b/attendance', label: 'Attendance',   keywords: ['attendance', 'हाजिरी'] },
  { path: '/b/payroll',    label: 'Payroll',      keywords: ['payroll', 'salaries', 'salary', 'वेतन'] },
  { path: '/b/tasks',      label: 'Tasks',        keywords: ['tasks', 'my tasks', 'todo', 'to do list'] },
  { path: '/b/reports',    label: 'Reports',      keywords: ['reports', 'business reports'] },
  { path: '/b/compliance', label: 'Compliance',   keywords: ['compliance', 'gst', 'gst filing', 'tax'] },
  { path: '/b/scan',       label: 'Scan & pay',   keywords: ['take payment', 'qr code', 'payment screen'] },
  { path: '/b/chat',       label: 'Business chat', keywords: ['business chat'] },
  { path: '/b/geo',        label: 'Business map', keywords: ['business map', 'field staff'] },
  { path: '/b/more',       label: 'Business menu', keywords: ['business menu', 'business more'] },
];

// Verbs that mean "take me there". Anything else is not a navigation request.
//
// Sorted longest-first at module load. This is not cosmetic: "show" is a prefix
// of "show me", so unsorted, "show me the invoices" matches 'show', leaves
// "me the invoices" as the destination, finds nothing, and silently fails.
const NAV_VERBS = [
  'open', 'go to', 'goto', 'show', 'show me', 'take me to', 'switch to',
  'navigate to', 'bring up', 'jump to', 'let me see', 'view',
  'kholo', 'khol', 'dikhao', 'dikha', 'खोलो', 'दिखाओ', 'दिखा',
  'teruvu', 'chupinchu', 'chupu', 'తెరువు', 'చూపించు',
].sort((a, b) => b.length - a.length);

/**
 * CONTENT VETO — markers that this utterance is worth keeping, not obeying.
 *
 * Deliberately broad. A missed shortcut costs four seconds; a swallowed
 * reminder costs the user's trust in the whole product, which is the thing
 * QuietKeep is actually selling.
 */
const CONTENT_MARKERS = [
  // reminder / task verbs
  /\bremind\b/i, /\bremember\b/i, /\bdon'?t forget\b/i, /\bnote\b/i, /\blog\b/i,
  /\badd\b/i, /\bcreate\b/i, /\bsave\b/i, /\bmake\b/i, /\bsend\b/i, /\bpay\b/i,
  /\bcall\b/i, /\btext\b/i, /\bmessage\b/i, /\bbook\b/i, /\bbuy\b/i,
  /\byaad\b/i, /\byad\b/i, /याद/, /గుర్తు/,
  // time markers
  /\btomorrow\b/i, /\btoday\b/i, /\btonight\b/i, /\byesterday\b/i, /\bnext week\b/i,
  /\bat \d/i, /\b\d{1,2}\s*(am|pm)\b/i, /\bo'?clock\b/i, /\bmorning\b/i,
  /\bevening\b/i, /\bafternoon\b/i, /\bmonday\b/i, /\btuesday\b/i, /\bwednesday\b/i,
  /\bthursday\b/i, /\bfriday\b/i, /\bsaturday\b/i, /\bsunday\b/i,
  /कल/, /आज/, /రేపు/, /ఇవాళ/,
  // money markers — an amount is never a navigation request
  /\b\d+\s*(rupees|rs|₹|rupaye)\b/i, /₹\s*\d/, /\brupees\b/i, /\brupaye\b/i,
];

function hasContentMarker(text) {
  return CONTENT_MARKERS.some((re) => re.test(text));
}

/**
 * Two levels of cleanup, deliberately kept apart.
 *
 * `light` only removes punctuation. Control words are matched against it,
 * because the filler list below contains "can you" — and stripping that from
 * "what can you do" leaves "what do", which matches nothing. Asking an
 * assistant what it can do is not an edge case.
 */
function light(raw) {
  return String(raw || '')
    .toLowerCase()
    .replace(/[.,!?;:—–-]+/g, ' ')    // em dash and en dash included: people speak them as pauses
    .replace(/।/g, ' ')               // Devanagari danda
    .replace(/\s+/g, ' ')
    .trim();
}

/** `normalise` additionally drops politeness filler. Only navigation uses it. */
function normalise(raw) {
  return light(raw)
    .replace(/\b(please|kindly|can you|could you|would you|hey|ok|okay|now|for me|zara|ज़रा)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Remove a leading wake word so "Aaria, open invoices" behaves like "open invoices". */
export function stripWake(raw, wakeWord = 'aaria') {
  const w = String(wakeWord || 'aaria').toLowerCase();
  return String(raw || '')
    .replace(new RegExp(`^\\s*(hey\\s+|ok\\s+|okay\\s+)?${w}\\s*[,:;—–-]*\\s*`, 'i'), '')
    .trim();
}

// Destinations sorted longest-keyword-first, computed once.
// "business dashboard" must win over "dashboard" or every business command
// lands on the personal screen.
const KEYWORD_INDEX = DESTINATIONS
  .flatMap((d) => d.keywords.map((k) => ({ k: k.toLowerCase(), d })))
  .sort((a, b) => b.k.length - a.k.length);

/**
 * The reflex router.
 *
 * @param {string} raw        what the user said
 * @param {object} ctx
 * @param {string} ctx.wakeWord  configured wake word, default 'aaria'
 * @returns {object|null} an action to perform locally, or null to hand to the brain
 */
export function routeUtterance(raw, ctx = {}) {
  const stripped = stripWake(raw, ctx.wakeWord);
  const plain = light(stripped);
  const text = normalise(stripped);
  if (!plain) return null;

  // ── control words: always safe, never carry content ────────────────────────
  // Matched against `plain`, and anchored to the WHOLE utterance — "stop" is a
  // control word, "stop the delivery tomorrow" is a task.
  if (/^(stop|cancel|shut up|quiet|chup|रुको|ఆపు)$/.test(plain)) {
    return { kind: 'stop' };
  }
  if (/^(go )?back$/.test(plain) || /^(peeche|पीछे)$/.test(plain)) {
    return { kind: 'back', spoken: null };
  }
  if (/^(what can you do|what can you do for me|help|aaria help|lotus help|commands)$/.test(plain)) {
    return { kind: 'help' };
  }
  if (/^(dark mode|dark theme|switch to dark|turn on dark mode)$/.test(plain)) {
    return { kind: 'theme', value: 'dark', spoken: 'Dark mode on.' };
  }
  if (/^(light mode|light theme|switch to light|turn off dark mode)$/.test(plain)) {
    return { kind: 'theme', value: 'light', spoken: 'Light mode on.' };
  }
  if (!text) return null;

  // ── GUARD 2: content veto, applied before any navigation match ─────────────
  // Checked against the ORIGINAL text, because normalise() strips punctuation
  // that some markers rely on.
  if (hasContentMarker(stripped)) return null;

  // ── GUARD 1: structure. Verb + optional article + destination + NOTHING else.
  for (const verb of NAV_VERBS) {
    if (!text.startsWith(verb + ' ')) continue;
    const rest = text.slice(verb.length + 1).trim();
    if (!rest) continue;

    const hit = matchDestination(rest);
    if (hit) return navigateTo(hit);

    // Verb matched but the remainder is not a known screen. Do NOT guess —
    // "open the shop at nine" must reach the brain, not a fuzzy screen match.
    return null;
  }

  // Bare destination name, said alone: "invoices", "settings".
  // Only exact whole-utterance matches qualify.
  const bare = matchDestination(text);
  return bare ? navigateTo(bare) : null;
}

/**
 * Try the phrase as spoken before trying any trimmed-down version of it.
 *
 * Order is load-bearing. "billing screen" is the Invoices screen; "billing" on
 * its own is the Subscription screen. Strip the trailing noun first and every
 * "open billing screen" lands on the wrong page. Likewise "my plan" and
 * "main screen" are real keywords that disappear if the article and suffix
 * strippers run unconditionally.
 */
function matchDestination(phrase) {
  const noArticle = phrase.replace(/^(the|my|a)\s+/, '').trim();
  const noSuffix  = phrase.replace(/\s+(screen|page|tab|section)$/, '').trim();
  const bare      = noArticle.replace(/\s+(screen|page|tab|section)$/, '').trim();

  for (const candidate of [phrase, noArticle, noSuffix, bare]) {
    if (!candidate) continue;
    const hit = KEYWORD_INDEX.find((e) => e.k === candidate);
    if (hit) return hit.d;
  }
  return null;
}

function navigateTo(d) {
  return { kind: 'navigate', path: d.path, label: d.label, spoken: `Opening ${d.label}.` };
}

/** Human-readable capability list, spoken when the user asks for help. */
export function helpText(pageLabel) {
  const here = pageLabel ? ` You're on ${pageLabel}.` : '';
  return `I can open any screen — just say "open invoices" or "show my reminders". `
    + `I can save reminders, expenses, notes and khata entries in English, Hindi or Telugu. `
    + `Say "stop" any time to interrupt me.${here}`;
}

export default routeUtterance;
