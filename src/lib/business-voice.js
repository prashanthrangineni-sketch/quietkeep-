// src/lib/business-voice.js
//
// ATTENDANCE, STOCK AND PAYROLL BY VOICE. (15 Oct 2026)
//
// Measured before this file (run 38732952552, gap list): "mark Raju absent
// today", "add 50 units of soap to stock" and "run payroll for this month"
// had no name in the brain and were saved as reminders and tasks - 18 of 18.
// The brain now answers attendance / stock / payroll; this file decides what
// each one may do. The capture route does the reads and writes; every rule
// that can be got wrong lives here, where tests/business-voice.test.mjs
// reaches it.
//
//   attendance  read back "Mark Ravi absent today? Yes or no?"; written only
//               after a spoken yes (isSpokenYes), only when the level table
//               says do. Writes attendance_logs (one row per person per day).
//   stock       read back "Add 20 kg rice to stock? Yes or no?"; written only
//               after a spoken yes. Writes inventory_items.current_stock and a
//               stock_movements row. "How much sugar is left?" only answers.
//   payroll     a DRAFT pay summary from recorded attendance, spoken and
//               returned for the screen. Writes nothing. Pays nothing: paying
//               salary is money leaving an account (PIN level), never by voice.
//
// BUSINESS WORKSPACE ONLY. With no workspace_id these sentences write no
// business record and no keep: Aaria says they work in the business app.
//
// Pure: no I/O.

import { decide, DECISION, isSpokenYes, isSpokenNo } from './action-levels.js'

export const BUSINESS_INTENTS = new Set(['attendance', 'stock', 'payroll'])

// The brain's word -> the type the level table knows it by.
export const BIZ_TYPE = Object.freeze({
  attendance: 'attendance',
  stock: 'stock',
  payroll: 'payroll',
  pay_salary: 'salary_payment',
})

// The permission each needs in the workspace (check_biz_permission).
export const BIZ_PERMISSION = Object.freeze({
  attendance: ['team', 'edit'],
  stock: ['inventory', 'edit'],
  stock_check: ['inventory', 'view'],
  payroll: ['payroll', 'view'],
})

// How long a read-back question stays open (same as a voice delete).
export const BIZ_WINDOW_MS = 3 * 60_000
export const BIZ_ASKED = 'voice.biz_asked'
export const BIZ_ANSWERED = 'voice.biz_answered'

const TZ = 'Asia/Kolkata'

const langOf = (language) => {
  const b = String(language || 'en').split('-')[0].toLowerCase()
  return b === 'te' || b === 'hi' ? b : 'en'
}

// ── dates, in India time ────────────────────────────────────────────────────
export function istDate(at = Date.now()) {
  const d = new Date(at)
  if (isNaN(d.getTime())) return null
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(d).filter((x) => x.type !== 'literal').map((x) => [x.type, x.value]))
  return `${p.year}-${p.month}-${p.day}`
}

const dayDiff = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000)

function monthName(ymd) {
  const d = new Date(`${ymd}T12:00:00+05:30`)
  return new Intl.DateTimeFormat('en-IN', { timeZone: TZ, month: 'long' }).format(d)
}
function shortDate(ymd) {
  const d = new Date(`${ymd}T12:00:00+05:30`)
  return new Intl.DateTimeFormat('en-IN', { timeZone: TZ, day: 'numeric', month: 'short' }).format(d)
}

// ── what was said, made safe ─────────────────────────────────────────────────
const STATUS_WORDS = [
  ['half_day', /\bhalf[\s-]?day\b|\baadha\s+din\b|\bsagam\s+roju\b|హాఫ్\s*డే|సగం\s*రోజు|आधा\s*दिन|हाफ\s*डे/i],
  ['leave', /\bleave\b|\bchutti\b|\bchhutti\b|\bselavu\b|సెలవు|छुट्टी/i],
  ['absent', /\babsent\b|\bnahi\s+aay[aie]\b|\braaledu\b|\brale\b|ఆబ్సెంట్|రాలేదు|गैरहाज़िर|गैरहाजिर|नहीं\s+आय|एब्सेंट|अनुपस्थित/i],
  ['present', /\bpresent\b|\bhaazir\b|\bhazir\b|\bvachchadu\b|\bvachadu\b|\baaya\b|ప్రెజెంట్|వచ్చాడు|వచ్చింది|हाज़िर|हाजिर|प्रेजेंट|उपस्थित/i],
]
const STATUSES = new Set(['present', 'absent', 'half_day', 'leave'])

/** present | absent | half_day | leave | null - the brain's word, else the sentence's. */
export function attendanceStatus(status, text = '') {
  const s = String(status || '').toLowerCase().replace(/[\s-]+/g, '_')
  if (STATUSES.has(s)) return s
  if (s === 'halfday' || s === 'half') return 'half_day'
  if (s === 'on_leave') return 'leave'
  if (s === 'late') return 'present'
  for (const [k, re] of STATUS_WORDS) if (re.test(String(text || ''))) return k
  return null
}

const ALL_WORDS = /^(all|everyone|everybody|all staff|all workers|staff|sab|sabhi|sab log|sare|saare|andaru|andariki|అందరూ|అందరికీ|सब|सभी|सबको)$/i
const ALL_IN_TEXT = /\b(everyone|everybody|all (the )?(staff|workers|employees)|sab(hi)?\s+(log|staff)?\s*(present|absent|aaye|hain)|sab present|andaru|andariki)\b|అందరూ|అందరికీ|सब\s|सभी/i

const norm = (s) => String(s || '').toLowerCase().normalize('NFC').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

// Spelling-tolerant key for a romanised Indian name: "Raaju" / "Raju",
// "Sathish" / "Satish", "Lakshmi" / "Laxmi".
const sound = (w) => w.replace(/x/g, 'ks').replace(/([kgcjtdpbs])h/g, '$1').replace(/w/g, 'v')
  .replace(/ee/g, 'i').replace(/oo/g, 'u').replace(/(.)\1+/g, '$1')

function nameScore(said, name) {
  const a = norm(said), b = norm(name)
  if (!a || !b) return 0
  if (a === b) return 3
  const bw = b.split(' '), aw = a.split(' ')
  if (aw.every((w) => bw.includes(w))) return 2                 // "Ravi" in "Ravi Kumar"
  if (aw.every((w) => bw.some((v) => sound(v) === sound(w)))) return 2
  const pre = (x, y) => { const n = Math.min(x.length, y.length); if (n < 4) return false; let i = 0; while (i < n && x[i] === y[i]) i++; return i >= n - 1 }
  if (aw.some((w) => bw.some((v) => pre(sound(w), sound(v))))) return 1
  return 0
}

/**
 * Which staff member(s) were meant.
 * @returns {{ all: true, members } | { match } | { candidates } | { none: true }}
 */
export function matchStaff(members, person, text = '') {
  const list = (Array.isArray(members) ? members : []).filter((m) => m && m.id && m.name)
  if (!list.length) return { none: true, empty: true }
  const p = String(person || '').trim()
  if ((p && ALL_WORDS.test(p)) || (!p && ALL_IN_TEXT.test(String(text || '')))) return { all: true, members: list }
  if (!p) return { none: true }
  const scored = list.map((m) => ({ m, s: nameScore(p, m.name) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s)
  if (!scored.length) return { none: true }
  const top = scored.filter((x) => x.s === scored[0].s)
  return top.length === 1 ? { match: top[0].m } : { candidates: top.slice(0, 3).map((x) => x.m) }
}

const UNIT_WORDS = [
  ['kg', /^(kg|kgs|kilo|kilos|kilogram|kilograms|kilolu|किलो|కిలో|కిలోలు)$/i],
  ['g', /^(g|gm|gms|gram|grams)$/i],
  ['litre', /^(l|ltr|ltrs|litre|litres|liter|liters|लीटर|లీటర్|లీటర్లు)$/i],
  ['ml', /^(ml|millilitre|milliliter)$/i],
  ['bag', /^(bag|bags|bori|boriyan|bora|bastha|basthalu|bastalu|बोरी|బస్తా|బస్తాలు)$/i],
  ['packet', /^(packet|packets|pkt|pkts|pack|packs|paket|पैकेट|ప్యాకెట్|ప్యాకెట్లు)$/i],
  ['box', /^(box|boxes|dabba|dabbe|डब्बा|डब्बे|డబ్బా|డబ్బాలు)$/i],
  ['pcs', /^(pc|pcs|piece|pieces|unit|units|nos|no|number|numbers)$/i],
]
export function normUnit(u) {
  const s = String(u || '').trim()
  if (!s) return null
  for (const [k, re] of UNIT_WORDS) if (re.test(s)) return k
  return s.toLowerCase()
}

/** Which inventory item was meant. Same shape as matchStaff. */
export function matchItem(items, item) {
  const list = (Array.isArray(items) ? items : []).filter((x) => x && x.id && x.name)
  const q = String(item || '').trim()
  if (!q || !list.length) return { none: true }
  const scored = list.map((x) => {
    let s = nameScore(q, x.name)
    if (!s && x.sku && norm(x.sku) === norm(q)) s = 3
    if (!s && norm(x.name).includes(norm(q)) && norm(q).length >= 3) s = 1
    return { x, s }
  }).filter((r) => r.s > 0).sort((a, b) => b.s - a.s)
  if (!scored.length) return { none: true }
  const top = scored.filter((r) => r.s === scored[0].s)
  return top.length === 1 ? { match: top[0].x } : { candidates: top.slice(0, 3).map((r) => r.x) }
}

const STOCK_OPS = new Set(['add', 'remove', 'out', 'check'])
const OUT_WORDS = /\bout of stock\b|\bkhatam\b|\bkhtm\b|\bayipoyindi\b|\bipoyindi\b|\bfinished\b|\bnil\b|అయిపోయింది|ఖతం|खत्म|ख़त्म/i
const CHECK_WORDS = /\bhow (much|many)\b|\bentha\b|\benni\b|\bkitna\b|\bkitne\b|\bkitni\b|ఎంత|ఎన్ని|कितना|कितने|कितनी|\?\s*$/i
const REMOVE_WORDS = /\b(remove|reduce|minus|take out|took out|used|sold|kam karo|nikalo|teeseyi|teesey|tagginchu)\b|తీసేయ్|తగ్గించు|कम करो|निकालो/i
const ADD_WORDS = /\b(add|added|plus|restock|received|came|aaya|aaye|jodo|daalo|kalupu|vachindi|vachayi)\b|కలుపు|వచ్చింది|వచ్చాయి|जोड़ो|डालो|आया|आए/i

/** add | remove | out | check - the brain's word, else the sentence's. */
export function stockOp(op, text = '', quantity = null) {
  const o = String(op || '').trim().toLowerCase()
  if (STOCK_OPS.has(o)) return o
  const t = String(text || '')
  if (OUT_WORDS.test(t)) return 'out'
  if (CHECK_WORDS.test(t) && quantity == null) return 'check'
  if (REMOVE_WORDS.test(t)) return 'remove'
  if (ADD_WORDS.test(t)) return 'add'
  return quantity == null ? 'check' : null
}

const fmtQty = (n) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100))
const qtyUnit = (n, unit) => `${fmtQty(n)}${unit ? ` ${unit}` : ''}`
const rupees = (n) => `₹${Math.round(n).toLocaleString('en-IN')}`

// ── the spoken lines ─────────────────────────────────────────────────────────
const STATUS_SAY = {
  en: { present: 'present', absent: 'absent', half_day: 'half day', leave: 'on leave' },
  te: { present: 'ప్రెజెంట్', absent: 'ఆబ్సెంట్', half_day: 'హాఫ్ డే', leave: 'సెలవు' },
  hi: { present: 'प्रेज़ेंट', absent: 'एब्सेंट', half_day: 'हाफ डे', leave: 'छुट्टी पर' },
}
function dayWord(date, today, l) {
  const d = dayDiff(today, date)
  if (l === 'te') return d === 0 ? 'ఈరోజు' : d === -1 ? 'నిన్న' : d === 1 ? 'రేపు' : shortDate(date)
  if (l === 'hi') return d === 0 ? 'आज' : shortDate(date)
  return d === 0 ? 'today' : d === -1 ? 'yesterday' : d === 1 ? 'tomorrow' : `on ${shortDate(date)}`
}

const LINES = {
  business_only: {
    en: 'Attendance, stock and salary work in your business workspace. Open QuietKeep Business and say it there.',
    te: 'అటెండెన్స్, స్టాక్, జీతం బిజినెస్ వర్క్‌స్పేస్‌లో మాత్రమే. QuietKeep Business తెరిచి అక్కడ చెప్పండి.',
    hi: 'हाज़िरी, स्टॉक और सैलरी बिज़नेस वर्कस्पेस में होते हैं। QuietKeep Business खोलकर वहाँ बोलिए।',
  },
  no_permission: {
    en: 'Your role in this business cannot do that. Ask the owner.',
    te: 'ఈ బిజినెస్‌లో మీ రోల్‌కి ఆ అనుమతి లేదు. ఓనర్‌ని అడగండి.',
    hi: 'इस बिज़नेस में आपकी भूमिका को यह अनुमति नहीं है। मालिक से पूछिए।',
  },
  att_readback: {
    en: ({ who, status, day }) => `Mark ${who} ${status} ${day}? Yes or no?`,
    te: ({ who, status, day, all }) => `${all ? who : `${who} ని`} ${day} ${status} అని వేయమంటారా? అవును లేదా వద్దు చెప్పండి.`,
    hi: ({ who, status, day, all }) => `${all ? who : `${who} को`} ${day} ${status} लगा दूँ? हाँ या ना बोलिए।`,
  },
  att_everyone: { en: 'everyone', te: 'అందరినీ', hi: 'सबको' },
  att_which_status: {
    en: (who) => `Should I mark ${who} present, absent, half day or on leave?`,
    te: (who) => `${who} ని ప్రెజెంట్, ఆబ్సెంట్, హాఫ్ డే లేదా సెలవు - ఏది వేయాలి?`,
    hi: (who) => `${who} को प्रेज़ेंट, एब्सेंट, हाफ डे या छुट्टी - क्या लगाऊँ?`,
  },
  att_who: {
    en: 'Which staff member?',
    te: 'ఏ స్టాఫ్ మెంబర్?',
    hi: 'किस कर्मचारी की?',
  },
  att_not_found: {
    en: (who) => `I could not find ${who} in your staff list. Which staff member?`,
    te: (who) => `మీ స్టాఫ్ లిస్ట్‌లో ${who} దొరకలేదు. ఎవరు?`,
    hi: (who) => `आपकी स्टाफ लिस्ट में ${who} नहीं मिला। कौन?`,
  },
  att_which: {
    en: (list) => `Which one: ${list}?`,
    te: (list) => `ఎవరు: ${list}?`,
    hi: (list) => `कौन: ${list}?`,
  },
  no_staff: {
    en: 'No staff are added yet. Add them in Team first.',
    te: 'ఇంకా స్టాఫ్ ఎవరూ లేరు. ముందు Team లో చేర్చండి.',
    hi: 'अभी कोई कर्मचारी नहीं जोड़ा है। पहले Team में जोड़िए।',
  },
  att_done: {
    en: ({ who, status, day }) => `Marked ${who} ${status} ${day}.`,
    te: ({ who, status, day, all }) => `${all ? who : `${who} ని`} ${day} ${status} అని వేశాను.`,
    hi: ({ who, status, day, all }) => `${all ? who : `${who} को`} ${day} ${status} लगा दिया।`,
  },
  stock_add: {
    en: ({ q, name, after }) => `Add ${q} ${name} to stock? It will be ${after}. Yes or no?`,
    te: ({ q, name, after }) => `${name} స్టాక్‌లో ${q} కలపమంటారా? మొత్తం ${after} అవుతుంది. అవును లేదా వద్దు చెప్పండి.`,
    hi: ({ q, name, after }) => `${name} के स्टॉक में ${q} जोड़ दूँ? कुल ${after} होगा। हाँ या ना बोलिए।`,
  },
  stock_new: {
    en: ({ q, name }) => `${name} is not in your stock list. Add it with ${q}? Yes or no?`,
    te: ({ q, name }) => `${name} మీ స్టాక్ లిస్ట్‌లో లేదు. ${q} తో కొత్తగా చేర్చమంటారా? అవును లేదా వద్దు చెప్పండి.`,
    hi: ({ q, name }) => `${name} आपकी स्टॉक लिस्ट में नहीं है। ${q} के साथ जोड़ दूँ? हाँ या ना बोलिए।`,
  },
  stock_remove: {
    en: ({ q, name, after }) => `Take ${q} ${name} out of stock? It will be ${after}. Yes or no?`,
    te: ({ q, name, after }) => `${name} స్టాక్ నుండి ${q} తీసేయమంటారా? ${after} మిగులుతుంది. అవును లేదా వద్దు చెప్పండి.`,
    hi: ({ q, name, after }) => `${name} के स्टॉक से ${q} कम कर दूँ? ${after} बचेगा। हाँ या ना बोलिए।`,
  },
  stock_out: {
    en: ({ name }) => `Mark ${name} out of stock, zero left? Yes or no?`,
    te: ({ name }) => `${name} స్టాక్ అయిపోయింది, సున్నా అని వేయమంటారా? అవును లేదా వద్దు చెప్పండి.`,
    hi: ({ name }) => `${name} का स्टॉक खत्म, शून्य लगा दूँ? हाँ या ना बोलिए।`,
  },
  stock_level: {
    en: ({ name, now }) => `${name}: ${now} in stock.`,
    te: ({ name, now }) => `${name} స్టాక్‌లో ${now} ఉంది.`,
    hi: ({ name, now }) => `${name} का स्टॉक ${now} है।`,
  },
  stock_not_found: {
    en: (name) => `I could not find ${name} in your stock list.`,
    te: (name) => `మీ స్టాక్ లిస్ట్‌లో ${name} దొరకలేదు.`,
    hi: (name) => `आपकी स्टॉक लिस्ट में ${name} नहीं मिला।`,
  },
  stock_which_item: {
    en: 'Which item?',
    te: 'ఏ ఐటమ్?',
    hi: 'कौन सा सामान?',
  },
  stock_which: {
    en: (list) => `Which one: ${list}?`,
    te: (list) => `ఏది: ${list}?`,
    hi: (list) => `कौन सा: ${list}?`,
  },
  stock_how_much: {
    en: (name) => `How much ${name}?`,
    te: (name) => `${name} ఎంత?`,
    hi: (name) => `${name} कितना?`,
  },
  stock_unit_differs: {
    en: ({ name, unit }) => `${name} is counted in ${unit}. How many ${unit}?`,
    te: ({ name, unit }) => `${name} ని ${unit} లో లెక్కిస్తాం. ఎన్ని ${unit}?`,
    hi: ({ name, unit }) => `${name} ${unit} में गिना जाता है। कितने ${unit}?`,
  },
  stock_not_enough: {
    en: ({ name, now }) => `Only ${now} ${name} is in stock. How much should I take out?`,
    te: ({ name, now }) => `${name} స్టాక్‌లో ${now} మాత్రమే ఉంది. ఎంత తీసేయాలి?`,
    hi: ({ name, now }) => `${name} का स्टॉक सिर्फ ${now} है। कितना कम करूँ?`,
  },
  stock_done: {
    en: ({ name, after }) => `Done. ${name} is now ${after}.`,
    te: ({ name, after }) => `అయింది. ${name} ఇప్పుడు ${after}.`,
    hi: ({ name, after }) => `हो गया। ${name} अब ${after} है।`,
  },
  biz_kept: {
    en: 'Okay, I have not changed anything.',
    te: 'సరే, ఏమీ మార్చలేదు.',
    hi: 'ठीक है, कुछ नहीं बदला।',
  },
  biz_held: {
    en: 'I have not saved it. Unlock the phone and say yes again.',
    te: 'ఇంకా సేవ్ చేయలేదు. ఫోన్ అన్‌లాక్ చేసి మళ్ళీ అవును అనండి.',
    hi: 'अभी सेव नहीं किया। फ़ोन अनलॉक करके फिर से हाँ बोलिए।',
  },
  biz_refused: {
    en: 'I cannot do that by voice just now. Nothing was changed.',
    te: 'ఇప్పుడు వాయిస్‌తో అది చేయలేను. ఏమీ మారలేదు.',
    hi: 'अभी आवाज़ से यह नहीं कर सकती। कुछ नहीं बदला।',
  },
  biz_failed: {
    en: 'I could not save that just now. Nothing was changed.',
    te: 'ఇప్పుడు సేవ్ చేయలేకపోయాను. ఏమీ మారలేదు.',
    hi: 'अभी सेव नहीं कर पाई। कुछ नहीं बदला।',
  },
  pay_never: {
    en: 'Nothing is paid by voice. Paying salary needs the app and your PIN.',
    te: 'వాయిస్‌తో ఏమీ చెల్లించను. జీతం చెల్లించడానికి యాప్‌లో మీ PIN కావాలి.',
    hi: 'आवाज़ से कुछ भी पे नहीं होता। सैलरी देने के लिए ऐप में आपका PIN चाहिए।',
  },
  payroll_one: {
    en: ({ month, name, days, amount }) => `Draft for ${month}: ${name}, ${days} days worked, ${amount}.`,
    te: ({ month, name, days, amount }) => `${month} డ్రాఫ్ట్: ${name}, ${days} రోజులు పని, ${amount}.`,
    hi: ({ month, name, days, amount }) => `${month} का ड्राफ्ट: ${name}, ${days} दिन काम, ${amount}।`,
  },
  payroll_all: {
    en: ({ month, n, amount }) => `Draft for ${month}: ${n} staff, ${amount} in all. Details are on screen.`,
    te: ({ month, n, amount }) => `${month} డ్రాఫ్ట్: ${n} మంది స్టాఫ్, మొత్తం ${amount}. వివరాలు స్క్రీన్ మీద ఉన్నాయి.`,
    hi: ({ month, n, amount }) => `${month} का ड्राफ्ट: ${n} कर्मचारी, कुल ${amount}। पूरा हिसाब स्क्रीन पर है।`,
  },
  payroll_no_salary: {
    en: (name) => `${name} has no salary set yet. Set it in Team.`,
    te: (name) => `${name} కి ఇంకా జీతం సెట్ చేయలేదు. Team లో సెట్ చేయండి.`,
    hi: (name) => `${name} की सैलरी अभी सेट नहीं है। Team में सेट कीजिए।`,
  },
  payroll_no_attendance: {
    en: (month) => `No attendance is recorded for ${month} yet, so I cannot work out salary.`,
    te: (month) => `${month} కి ఇంకా అటెండెన్స్ లేదు, అందుకే జీతం లెక్కించలేను.`,
    hi: (month) => `${month} की हाज़िरी अभी दर्ज नहीं है, इसलिए सैलरी नहीं निकाल सकती।`,
  },
}

export function bizLine(key, language, arg) {
  const l = LINES[key]
  const v = l[langOf(language)] ?? l.en
  return typeof v === 'function' ? v(arg) : v
}

// ── attendance ───────────────────────────────────────────────────────────────
/**
 * What to ask for an attendance sentence. Never writes.
 * @returns {{ tts, pending: object|null }}
 *   pending is the read-back to store; null when Aaria needs to ask something first.
 */
export function planAttendance({ members, person = null, status = null, datetimeISO = null, text = '', language, nowMs = Date.now() }) {
  const l = langOf(language)
  const today = istDate(nowMs)
  const date = (datetimeISO && istDate(datetimeISO)) || today
  const found = matchStaff(members, person, text)
  if (found.empty) return { tts: bizLine('no_staff', language), pending: null }
  if (found.candidates) return { tts: bizLine('att_which', language, found.candidates.map((m) => m.name).join(', ')), pending: null }
  if (found.none) {
    return { tts: person ? bizLine('att_not_found', language, person) : bizLine('att_who', language), pending: null }
  }
  const who = found.all ? LINES.att_everyone[l] : found.match.name
  const st = attendanceStatus(status, text)
  if (!st) return { tts: bizLine('att_which_status', language, who), pending: null }
  const rows = (found.all ? found.members : [found.match]).map((m) => ({ id: m.id, name: m.name }))
  const say = { who, status: STATUS_SAY[l][st], day: dayWord(date, today, l), all: !!found.all }
  return {
    tts: bizLine('att_readback', language, say),
    pending: { type: BIZ_TYPE.attendance, status: st, date, members: rows, all: !!found.all, say, lang: l },
  }
}

/** The attendance_logs rows to upsert for a confirmed read-back. */
export function attendanceRows(pending, { workspaceId, userId }) {
  if (!pending || pending.type !== BIZ_TYPE.attendance || !STATUSES.has(pending.status)) return []
  return (pending.members || []).filter((m) => m && m.id).map((m) => ({
    workspace_id: workspaceId,
    member_id: m.id,
    log_date: pending.date,
    status: pending.status,
    marked_by: userId,
    notes: 'marked by voice',
  }))
}

// ── stock ────────────────────────────────────────────────────────────────────
/**
 * What to say / ask for a stock sentence. Never writes.
 * @returns {{ tts, pending: object|null, readOnly: boolean }}
 */
export function planStock({ items, item = null, quantity = null, unit = null, op = null, text = '', language }) {
  const q = typeof quantity === 'number' && Number.isFinite(quantity) && quantity > 0 ? quantity : null
  const o = stockOp(op, text, q)
  const name = String(item || '').trim()
  if (!name) return { tts: bizLine('stock_which_item', language), pending: null, readOnly: o === 'check' }
  const found = matchItem(items, name)
  if (found.candidates) {
    return { tts: bizLine('stock_which', language, found.candidates.map((x) => x.name).join(', ')), pending: null, readOnly: o === 'check' }
  }
  const it = found.match || null
  const stored = it ? Number(it.current_stock) || 0 : 0
  const itemUnit = it ? normUnit(it.unit) : null
  const saidUnit = normUnit(unit)

  if (o === 'check' || !o) {
    if (!it) return { tts: bizLine('stock_not_found', language, name), pending: null, readOnly: true }
    return { tts: bizLine('stock_level', language, { name: it.name, now: qtyUnit(stored, it.unit) }), pending: null, readOnly: true, item: it }
  }
  if (o === 'out') {
    if (!it) return { tts: bizLine('stock_not_found', language, name), pending: null, readOnly: false }
    return {
      tts: bizLine('stock_out', language, { name: it.name }),
      pending: { type: BIZ_TYPE.stock, op: 'out', item_id: it.id, name: it.name, unit: it.unit || null, before: stored, change: -stored, after: 0 },
      readOnly: false,
    }
  }
  // add / remove need an amount
  const label = it ? it.name : name
  if (q == null) return { tts: bizLine('stock_how_much', language, label), pending: null, readOnly: false }
  // A different unit from the one the item is counted in would make the
  // arithmetic wrong ("2 bags" added to a stock kept in kg). Ask instead.
  if (it && itemUnit && saidUnit && itemUnit !== saidUnit) {
    return { tts: bizLine('stock_unit_differs', language, { name: it.name, unit: it.unit }), pending: null, readOnly: false }
  }
  if (o === 'remove') {
    if (!it) return { tts: bizLine('stock_not_found', language, name), pending: null, readOnly: false }
    if (q > stored) return { tts: bizLine('stock_not_enough', language, { name: it.name, now: qtyUnit(stored, it.unit) }), pending: null, readOnly: false }
    const after = stored - q
    return {
      tts: bizLine('stock_remove', language, { q: qtyUnit(q, it.unit), name: it.name, after: qtyUnit(after, it.unit) }),
      pending: { type: BIZ_TYPE.stock, op: 'remove', item_id: it.id, name: it.name, unit: it.unit || null, before: stored, change: -q, after },
      readOnly: false,
    }
  }
  // add
  if (!it) {
    const newUnit = saidUnit || 'pcs'
    return {
      tts: bizLine('stock_new', language, { q: qtyUnit(q, newUnit), name: titleCase(name) }),
      pending: { type: BIZ_TYPE.stock, op: 'add', item_id: null, name: titleCase(name), unit: newUnit, before: 0, change: q, after: q },
      readOnly: false,
    }
  }
  const after = stored + q
  return {
    tts: bizLine('stock_add', language, { q: qtyUnit(q, it.unit), name: it.name, after: qtyUnit(after, it.unit) }),
    pending: { type: BIZ_TYPE.stock, op: 'add', item_id: it.id, name: it.name, unit: it.unit || null, before: stored, change: q, after },
    readOnly: false,
  }
}

function titleCase(s) {
  return String(s || '').trim().replace(/\s+/g, ' ').slice(0, 80).replace(/\b\p{Ll}/gu, (c) => c.toUpperCase())
}

/**
 * The writes for a confirmed stock read-back.
 * @returns {{ insertItem: object|null, update: {id, current_stock}|null, movement: object }}
 *   The route inserts the item first when insertItem is set, then writes the
 *   movement with that item's id.
 */
export function stockWrites(pending, { workspaceId, nowISO = new Date().toISOString() }) {
  if (!pending || pending.type !== BIZ_TYPE.stock || !Number.isFinite(pending.after) || pending.after < 0) return null
  const movement = {
    workspace_id: workspaceId,
    item_id: pending.item_id,
    change: pending.change,
    balance_after: pending.after,
    reason: pending.op === 'add' ? 'voice_restock' : pending.op === 'out' ? 'voice_out_of_stock' : 'voice_adjustment',
    created_at: nowISO,
  }
  if (!pending.item_id) {
    if (pending.op !== 'add') return null
    return {
      insertItem: { workspace_id: workspaceId, name: pending.name, unit: pending.unit || 'pcs', current_stock: pending.after, status: 'active', created_at: nowISO, updated_at: nowISO },
      update: null,
      movement,
    }
  }
  return { insertItem: null, update: { id: pending.item_id, current_stock: pending.after, updated_at: nowISO }, movement }
}

// ── payroll (draft only) ─────────────────────────────────────────────────────
/** The month a payroll sentence is about: this month, India time. */
export function payPeriod(nowMs = Date.now()) {
  const today = istDate(nowMs)
  const [y, m] = today.split('-').map(Number)
  const start = `${y}-${String(m).padStart(2, '0')}-01`
  return { start, end: today, month: monthName(start) }
}

/**
 * A DRAFT pay summary from recorded attendance. Writes nothing, pays nothing.
 * Present (and late) is a full day, half day is half, absent and leave are 0.
 * Monthly salary: basic_salary / 26 per day worked (the payroll page's
 * working-days figure); daily wage: daily_wage per day worked. Before PF /
 * ESIC: the Payroll page works those out when a payslip is generated.
 */
export function payrollDraft({ members, logs, person = null, text = '', nowMs = Date.now(), language }) {
  const period = payPeriod(nowMs)
  const found = person ? matchStaff(members, person, text) : { all: true, members: (members || []).filter((m) => m && m.id) }
  if (found.empty || (found.all && !found.members.length)) return { tts: bizLine('no_staff', language), draft: null }
  if (found.candidates) return { tts: bizLine('att_which', language, found.candidates.map((m) => m.name).join(', ')), draft: null }
  if (found.none) return { tts: bizLine('att_not_found', language, person), draft: null }
  const who = found.all ? found.members : [found.match]

  const by = new Map()
  for (const r of Array.isArray(logs) ? logs : []) {
    if (!r?.member_id || r.log_date < period.start || r.log_date > period.end) continue
    const a = by.get(r.member_id) || { present: 0, half: 0, absent: 0, leave: 0 }
    if (r.status === 'present' || r.status === 'late') a.present++
    else if (r.status === 'half_day') a.half++
    else if (r.status === 'absent') a.absent++
    else if (r.status === 'leave') a.leave++
    by.set(r.member_id, a)
  }
  const rows = who.map((m) => {
    const a = by.get(m.id) || { present: 0, half: 0, absent: 0, leave: 0 }
    const days = a.present + a.half * 0.5
    const daily = m.salary_type === 'daily'
    const rate = daily ? Number(m.daily_wage) : Number(m.basic_salary) / 26
    const amount = Number.isFinite(rate) && rate > 0 ? Math.round(rate * days) : null
    return {
      member_id: m.id, name: m.name, salary_type: daily ? 'daily' : 'monthly',
      days_present: a.present, days_half: a.half, days_absent: a.absent, days_leave: a.leave,
      days_worked: days, amount,
    }
  })
  const recorded = rows.some((r) => r.days_present + r.days_half + r.days_absent + r.days_leave > 0)
  const total = rows.reduce((s, r) => s + (r.amount || 0), 0)
  const draft = { status: 'draft', paid: false, period_start: period.start, period_end: period.end, month: period.month, rows, total }
  const tail = ` ${bizLine('pay_never', language)}`
  if (!recorded) return { tts: bizLine('payroll_no_attendance', language, period.month), draft }
  if (!found.all) {
    const r = rows[0]
    if (r.amount == null) return { tts: bizLine('payroll_no_salary', language, r.name) + tail, draft }
    return { tts: bizLine('payroll_one', language, { month: period.month, name: r.name, days: fmtQty(r.days_worked), amount: rupees(r.amount) }) + tail, draft }
  }
  return { tts: bizLine('payroll_all', language, { month: period.month, n: rows.length, amount: rupees(total) }) + tail, draft }
}

// ── the pending read-back and its answer ─────────────────────────────────────
/**
 * Is a business read-back still waiting for its answer, in THIS workspace?
 * @param {Array<{action, details, created_at}>} rows  newest first
 */
export function pendingBiz(rows, workspaceId, nowMs = Date.now()) {
  const r = Array.isArray(rows) ? rows[0] : null
  if (!r || r.action !== BIZ_ASKED || !r.details?.pending) return null
  if (!workspaceId || r.details.workspace_id !== workspaceId) return null
  const at = Date.parse(r.created_at || '')
  if (!Number.isFinite(at) || nowMs - at < 0 || nowMs - at > BIZ_WINDOW_MS) return null
  return { ...r.details, asked_at: r.created_at }
}

/** 'yes' (the only way a write happens) | 'no' | 'other' (the question lapses). */
export function readBizAnswer(text) {
  if (isSpokenYes(text)) return 'yes'
  if (isSpokenNo(text)) return 'no'
  return 'other'
}

/** The safety decision for a business write. The write happens only on DO. */
export function bizDecision(type, { spokenYes, unlocked, doneThisHour }) {
  return decide(
    { type },
    { spokenYes: spokenYes === true, unlocked: unlocked === true, pin: false, ownerVoice: null },
    { doneThisHour },
  )
}

/** The line spoken once a confirmed write has been made. */
export function doneLine(pending, language) {
  if (pending?.type === BIZ_TYPE.attendance) return bizLine('att_done', language, pending.say)
  return bizLine('stock_done', language, { name: pending?.name, after: qtyUnit(pending?.after ?? 0, pending?.unit) })
}

export { DECISION }
