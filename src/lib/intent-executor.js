// src/lib/intent-executor.js  v2
// Execution layer — maps intent_type → real action
// v2 adds: WhatsApp dispatch, contact disambiguation, task next-step guide,
//          navigation intent, improved follow-up engine

// The recogniser repeats its partial results into the transcript, so "ఐదు
// నిమిషాల్లో" arrives as "ఐదు ఐదు ఐదు ఐదు ఐదు నిమిషాల్లో …". The time parser
// below cannot see through that, so the stutter is collapsed before reading it.
// Relative, with the extension, NOT the '@/lib/...' alias. That alias only
// exists inside the Next build; the unit suite loads these modules under plain
// Node, where it does not resolve and the import throws before any test runs.
import { collapseRepeats } from './transcript-clean.js'
import { nameTokens, rankContactsForName, contactSearchWords } from './contact-match.js'
import { say, naturalTimeWords } from './reply-phrases.js'

// ── TIME PARSING ──────────────────────────────────────────────────────────────
// Speech-to-text emits "10 a.m." / "5 P.M." with full stops and inconsistent
// spacing. Normalise those to the bare "am" / "pm" the matchers below expect,
// otherwise a spoken time parses to null and is silently discarded.
function normalizeMeridiem(s) {
  return String(s).toLowerCase()
    .replace(/\ba\.?\s?m\.?/g, 'am')
    .replace(/\bp\.?\s?m\.?/g, 'pm')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseTimeToDate(timeStr, referenceDate = new Date()) {
  if (!timeStr) return null;
  const t = normalizeMeridiem(timeStr);
  let hours = null; let minutes = 0;

  const ap = t.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/);
  if (ap) {
    hours   = parseInt(ap[1]);
    minutes = ap[2] ? parseInt(ap[2]) : 0;
    if (ap[3] === 'pm' && hours < 12) hours += 12;
    if (ap[3] === 'am' && hours === 12) hours = 0;
  }
  const h24 = t.match(/^(\d{1,2}):(\d{2})$/);
  if (h24) { hours = parseInt(h24[1]); minutes = parseInt(h24[2]); }

  if (hours === null || hours > 23 || minutes > 59) return null;
  const d = new Date(referenceDate);
  d.setHours(hours, minutes, 0, 0);
  if (d <= new Date()) d.setDate(d.getDate() + 1);
  return d;
}

function parseDateString(dateStr) {
  if (!dateStr) return null;
  const s = String(dateStr);
  if (!s || s === 'Invalid Date' || s === '[object Date]') return null;
  try { const d = new Date(s); if (!isNaN(d.getTime())) return d; } catch {}
  return null;
}

// ── TIMEZONE ──────────────────────────────────────────────────────────────────
// setHours() resolves in the SERVER's timezone. On Vercel that is UTC, so
// "tomorrow at 10 a.m." was stored as 10:00Z — which is 15:30 IST. Every
// English voice reminder fired 5 hours 30 minutes late. The Sarvam path was
// never affected because the brain returns an absolute offset (+05:30).
// Found 22 Aug 2026, after the parser fix stopped masking it.
export const DEFAULT_TZ = 'Asia/Kolkata';

function tzOffsetMs(date, timeZone) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p = Object.fromEntries(
    dtf.formatToParts(date).filter(x => x.type !== 'literal').map(x => [x.type, x.value])
  );
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, p.hour === '24' ? 0 : +p.hour, +p.minute, +p.second);
  return asUTC - date.getTime();
}

// Wall-clock time in `timeZone` -> the correct UTC instant.
// Two passes so a DST boundary resolves to the right side.
function zonedWallClockToUtc(y, mo, d, hh, mm, timeZone) {
  const guess = Date.UTC(y, mo, d, hh, mm, 0, 0);
  let off = tzOffsetMs(new Date(guess), timeZone);
  off = tzOffsetMs(new Date(guess - off), timeZone);
  return new Date(guess - off);
}

// The calendar date as seen in `timeZone`, not on the server.
function zonedDateParts(date, timeZone) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const p = Object.fromEntries(
    dtf.formatToParts(date).filter(x => x.type !== 'literal').map(x => [x.type, x.value])
  );
  return { y: +p.year, mo: +p.month - 1, d: +p.day };
}

// ── RELATIVE TIMES: "in five minutes", "ఐదు నిమిషాల్లో", "दस मिनट में" ────────
//
// computeReminderAt below understands two things: a calendar DATE and a clock
// TIME. "In five minutes" is neither. So it returned null, reminder_at was left
// empty, no reminders row was written — and Aaria said out loud "రిమైండర్ సెట్
// చేశాను", I have set the reminder.
//
// Observed live at 17:08 IST on 26 September 2026: keep
// da579c00-cccb-4fec-b387-1df2fc5a7b0b, reminder_at NULL, no reminders row, and
// a spoken confirmation that it was done. Telling someone their reminder is set
// when it is not is the worst failure this product can have, and the immediate
// cause was that the commonest phrasing in the language was not parsed at all.
//
// Note the numbers are WORDS, not digits. Speech recognition writes "ఐదు", not
// "5", so digit-only matching would have missed every spoken reminder in Telugu.
const NUMBER_WORDS = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20,
  thirty: 30, forty: 40, fortyfive: 45, sixty: 60, ninety: 90, a: 1, an: 1,
  // Telugu
  'ఒకటి': 1, 'ఒక': 1, 'రెండు': 2, 'మూడు': 3, 'నాలుగు': 4, 'ఐదు': 5, 'అయిదు': 5,
  'ఆరు': 6, 'ఏడు': 7, 'ఎనిమిది': 8, 'తొమ్మిది': 9, 'పది': 10, 'పదిహేను': 15,
  'ఇరవై': 20, 'ముప్పై': 30, 'నలభై': 40, 'అరవై': 60,
  // Hindi
  'एक': 1, 'दो': 2, 'तीन': 3, 'चार': 4, 'पांच': 5, 'पाँच': 5, 'छह': 6, 'सात': 7,
  'आठ': 8, 'नौ': 9, 'दस': 10, 'पंद्रह': 15, 'बीस': 20, 'तीस': 30, 'चालीस': 40,
};

// Prefix match, because Telugu and Hindi inflect the unit: నిమిషం, నిమిషాలు,
// నిమిషాల్లో; मिनट, मिनटों. A whole-word list would miss the forms people
// actually say.
const MINUTE_UNIT = ['minute', 'minutes', 'min', 'mins', 'నిమిష', 'मिनट'];
const HOUR_UNIT   = ['hour', 'hours', 'hr', 'hrs', 'గంట', 'घंट'];

// Clock-time markers that indicate a time of day rather than relative duration
const CLOCK_TIME_PERIOD_WORDS = [
  'ఉదయం', 'మార్నింగ్', 'పొద్దున్న', 'మధ్యాహ్నం', 'సాయంత్రం', 'ఈవెనింగ్', 'రాత్రి', 'నైట్',
  'morning', 'afternoon', 'evening', 'night',
  'सुबह', 'दोपहर', 'शाम', 'रात', 'मॉर्निंग', 'इवनिंग', 'नाइट',
];

const TELUGU_NUMBER_WORDS = {
  'ఒకటి': 1, 'ఒక': 1, 'రెండు': 2, 'మూడు': 3, 'నాలుగు': 4, 'ఐదు': 5, 'అయిదు': 5,
  'ఆరు': 6, 'ఏడు': 7, 'ఎనిమిది': 8, 'తొమ్మిది': 9, 'పది': 10, 'పదకొండు': 11, 'పన్నెండు': 12,
};

const HINDI_NUMBER_WORDS = {
  'एक': 1, 'दो': 2, 'तीन': 3, 'चार': 4, 'पांच': 5, 'पाँच': 5, 'छह': 6, 'सात': 7,
  'आठ': 8, 'नौ': 9, 'दस': 10, 'ग्यारह': 11, 'बारह': 12,
};

function unitOf(word) {
  const w = String(word || '').toLowerCase().replace(/[.,!?;:]+$/, '');
  if (MINUTE_UNIT.some((u) => w.startsWith(u))) return 'minute';
  if (HOUR_UNIT.some((u) => w.startsWith(u)))   return 'hour';
  return null;
}

function numberOf(word) {
  const w = String(word || '').toLowerCase().replace(/[.,!?;:]+$/, '');
  if (/^\d{1,3}$/.test(w)) return parseInt(w, 10);
  return Object.prototype.hasOwnProperty.call(NUMBER_WORDS, w) ? NUMBER_WORDS[w] : null;
}

/**
 * Minutes from now that this utterance asks for, or null.
 *
 * Scans for a minute/hour word and looks back up to three words for the count,
 * which survives the filler that sits between them in every language here
 * ("in five more minutes", "ఐదు నిమిషాల్లో", "दस मिनट के बाद").
 */
export function relativeMinutesFromText(rawText) {
  const text = collapseRepeats(String(rawText || ''));
  if (!text.trim()) return null;

  // Clock time expressions (e.g. "ఉదయం 9 గంటలకి" / "at 9 o'clock" / "9 గంటలకి")
  // are times of day, NEVER relative offsets from now.
  // "గంటలకి" / "గంటలకు" is Telugu dative (-కి / -కు) meaning "at X o'clock".
  // Locative relative is "గంటల్లో" (-లో / -ల్లో = in) or "గంటల తర్వాత" (after).
  if (
    /గంటల[కకికు]|గంట[కకికు]|o'?clock|\b(?:at|around)\s+\d{1,2}|बजे/i.test(text) ||
    CLOCK_TIME_PERIOD_WORDS.some(w => text.includes(w))
  ) {
    // Only allow if explicit relative marker like "నిమిషాల్లో" / "in X minutes" is also present
    if (!/నిమిష|minute|मिनट/i.test(text)) {
      return null;
    }
  }

  if (/half an hour|అరగంట|आधा घंटा/i.test(text)) return 30;

  const words = text.trim().split(/\s+/);
  for (let i = 0; i < words.length; i++) {
    const unit = unitOf(words[i]);
    if (!unit) continue;

    // Reject "గంటలకి" / "గంటలకు" / "గంటకి" / "గంటకు" for relative hours
    if (unit === 'hour' && /గంటల[కకికు]|గంట[కకికు]/.test(words[i])) {
      continue;
    }

    for (let back = 1; back <= 3 && i - back >= 0; back++) {
      const n = numberOf(words[i - back]);
      if (n === null) continue;
      const minutes = unit === 'hour' ? n * 60 : n;
      // A sane window. Anything beyond two days is a date, not an offset, and
      // treating it as one would move a reminder to the wrong week.
      if (minutes > 0 && minutes <= 48 * 60) return minutes;
      break;
    }
  }
  return null;
}

/**
 * Parse an explicit clock time (morning/afternoon/evening/night + hour) from text.
 * Resolves Telugu ("ఉదయం 9 గంటలకి"), Hindi ("कल सुबह 9 बजे"), and English ("9 in the morning").
 */
function parseClockTimeFromText(rawText, timeZone = DEFAULT_TZ) {
  if (!rawText) return null;
  const s = collapseRepeats(String(rawText)).toLowerCase();

  // 1. Period detection
  let period = null; // 'morning' | 'afternoon' | 'evening' | 'night'
  if (/ఉదయం|మార్నింగ్|పొద్దున్న|morning|\bam\b|\ba\.m\b|सुबह|मॉर्निंग|प्रातः/.test(s)) {
    period = 'morning';
  } else if (/మధ్యాహ్నం|afternoon|दोपहर/.test(s)) {
    period = 'afternoon';
  } else if (/సాయంత్రం|ఈవెనింగ్|సాయంకాలం|evening|शाम|इवनिंग/.test(s)) {
    period = 'evening';
  } else if (/రాత్రి|నైట్|night|रात|नाइट/.test(s)) {
    period = 'night';
  } else if (/\bpm\b|\bp\.m\b/.test(s)) {
    period = 'evening';
  }

  // 2. Date detection
  let dateOffsetDays = 0;
  if (/రేపు|tomorrow|कल/.test(s)) {
    dateOffsetDays = 1;
  } else if (/ఎల్లుండి|परसों|day after tomorrow/.test(s)) {
    dateOffsetDays = 2;
  }

  // 3. Hour and minute extraction
  let hour = null;
  let minute = 0;

  // Numeric digit match: e.g. "9", "9:30", "10"
  // Look for digit followed by time markers or preceded by period words
  const digitTimeMatch = s.match(/(?:^|\s|[^\d])(\d{1,2})(?::(\d{2}))?\s*(?:గంట|గంటల|గంటలకి|గంటలకు|గంటకి|గంటకు|బజే|बजे|o'?clock|am|pm|\b)/i);
  if (digitTimeMatch) {
    const val = parseInt(digitTimeMatch[1], 10);
    if (val >= 1 && val <= 24) {
      hour = val;
      if (digitTimeMatch[2]) minute = parseInt(digitTimeMatch[2], 10);
    }
  }

  // Word-based number match if no digit found
  if (hour === null) {
    for (const [w, val] of Object.entries(TELUGU_NUMBER_WORDS)) {
      if (s.includes(w)) { hour = val; break; }
    }
  }
  if (hour === null) {
    for (const [w, val] of Object.entries(HINDI_NUMBER_WORDS)) {
      if (s.includes(w)) { hour = val; break; }
    }
  }
  if (hour === null) {
    const m = s.match(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/);
    if (m && NUMBER_WORDS[m[1]]) hour = NUMBER_WORDS[m[1]];
  }

  // Half-hour words (e.g. "ముప్పై", "తీస్", "half", "thirty")
  if (minute === 0 && /ముప్పై|तीस|thirty|న్నర|half/.test(s)) {
    minute = 30;
  }

  if (hour === null) return null;

  // 4. Convert to 24-hour wall-clock in user's zone
  let hh = hour;
  if (period === 'morning') {
    if (hh === 12) hh = 0;
    else if (hh > 12) hh = hh; // already 24h
  } else if (period === 'afternoon') {
    if (hh < 12) hh += 12;
  } else if (period === 'evening') {
    if (hh < 12) hh += 12;
  } else if (period === 'night') {
    if (hh >= 1 && hh <= 4) {
      // late night / early morning 1am-4am
    } else if (hh < 12) {
      hh += 12; // 8pm -> 20, 9pm -> 21, 10pm -> 22, 11pm -> 23
    } else if (hh === 12) {
      hh = 0;
    }
  } else {
    // Period unmentioned: check current hour in timeZone
    const nowParts = new Intl.DateTimeFormat('en-US', {
      timeZone, hour12: false, hour: '2-digit', minute: '2-digit',
    }).formatToParts(new Date()).filter(x => x.type !== 'literal');
    const np = Object.fromEntries(nowParts.map(x => [x.type, x.value]));
    const curHour = np.hour === '24' ? 0 : +np.hour;
    if (hh <= 12) {
      if (curHour < hh) {
        // e.g. at 7 AM, "9" means 9 AM today
      } else if (curHour < hh + 12 && hh + 12 < 24) {
        // e.g. at 11 AM, "5" means 5 PM today
        hh += 12;
      }
    }
  }

  return { hh, mm: minute, dateOffsetDays, hasClockTime: true };
}

// ── COMPUTE reminder_at FROM ENTITIES ─────────────────────────────────────────
export function computeReminderAt(entities, timeZone = DEFAULT_TZ, rawText = '') {
  if (!entities && !rawText) return null;
  const { dates = [], times = [] } = entities || {};

  // First check if rawText contains a specific clock time (e.g. "ఉదయం 9 గంటలకి", "कल सुबह 9 बजे")
  // so that "ఉదయం 9 గంటలకి" is never mistaken for 9 hours from now.
  const textClock = parseClockTimeFromText(rawText, timeZone);

  // A relative offset is checked only when no date, no parsed time, and no text clock was found
  if (!dates.length && !times.length && !textClock && rawText) {
    const mins = relativeMinutesFromText(rawText);
    if (mins !== null) return new Date(Date.now() + mins * 60000);
  }

  let baseDate = null;
  for (const d of dates) { const p = parseDateString(d); if (p) { baseDate = p; break; } }

  // Hours and minutes are wall-clock in the user's zone
  let hh = null, mm = 0;
  if (times.length > 0) {
    const td = parseTimeToDate(times[0], new Date());
    if (td) { hh = td.getHours(); mm = td.getMinutes(); }
  } else if (textClock) {
    hh = textClock.hh;
    mm = textClock.mm;
  }

  if (baseDate === null && hh === null) return null;

  const targetDate = baseDate || new Date();
  if (textClock?.dateOffsetDays) {
    targetDate.setDate(targetDate.getDate() + textClock.dateOffsetDays);
  }

  const { y, mo, d } = zonedDateParts(targetDate, timeZone);

  // A date with no spoken time keeps previous behaviour
  if (hh === null) {
    const nowParts = new Intl.DateTimeFormat('en-US', {
      timeZone, hour12: false, hour: '2-digit', minute: '2-digit',
    }).formatToParts(new Date()).filter(x => x.type !== 'literal');
    const np = Object.fromEntries(nowParts.map(x => [x.type, x.value]));
    hh = np.hour === '24' ? 0 : +np.hour;
    mm = +np.minute;
  }

  let result = zonedWallClockToUtc(y, mo, d, hh, mm, timeZone);
  // Bare time with no date ("at 10 a.m.") that has already passed today rolls to tomorrow
  if (!baseDate && (!textClock || textClock.dateOffsetDays === 0) && result.getTime() <= Date.now()) {
    result = zonedWallClockToUtc(y, mo, d + 1, hh, mm, timeZone);
  }
  return result;
}

// ── SERVER: SCHEDULE PRECISE REMINDER NUDGE ───────────────────────────────────
export async function scheduleReminderNudge(supabase, { userId, keepId, reminderAt, content, domainType = 'personal' }) {
  if (!reminderAt) return null;
  const dt = reminderAt instanceof Date ? reminderAt : new Date(reminderAt);
  if (isNaN(dt.getTime())) return null;
  const dedupKey = `${keepId}:reminder:${dt.toISOString().slice(0, 16)}`;
  const { data } = await supabase.from('nudge_queue').insert({
    user_id:           userId,
    keep_id:           keepId,
    nudge_type:        'reminder',
    title:             `⏰ ${(content || '').slice(0, 80)}`,
    body:              `Reminder: ${(content || '').slice(0, 120)}`,
    channel:           'app',
    scheduled_for:     dt.toISOString(),
    delivered:         false,
    priority_score:    0.95,
    domain_type:       domainType,
    deduplication_key: dedupKey,
    delivery_log:      [],
    delivery_status:   'pending',
  }).select('id').single();
  return data?.id || null;
}

// ── SERVER: MATCH CONTACT BY NAME (with disambiguation support) ───────────────
// Returns:
//   null                → no match
//   { single: contact } → exactly one match or clear best
//   { multiple: contacts[], ambiguous: true } → 2+ matches, need clarification
export async function matchContactByName(supabase, userId, name) {
  if (!name || !userId) return null;
  const { data: contacts } = await supabase
    .from('contacts')
    .select('id,name,phone,email,relation,avatar_emoji')
    .eq('user_id', userId)
    .ilike('name', `%${name}%`)
    .limit(6);
  if (contacts?.length) {
    const exact = contacts.find(c => c.name.toLowerCase() === name.toLowerCase());
    if (exact) return { single: exact };
    if (contacts.length === 1) return { single: contacts[0] };
    // Multiple partial matches — return all for disambiguation
    return { multiple: contacts, ambiguous: true };
  }

  // NOTHING UNDER THE WHOLE STRING - TRY THE WORDS.
  // 1 Oct 2026: "Venu Yadav" matched nothing among 1,920 contacts, the
  // reminder was saved with no number, and nobody was told. There are nine
  // Venus. Fetch everyone sharing any word of the name, then let
  // rankContactsForName decide: one contact with every word is a match;
  // anything else is a question, never a guess.
  // 7 Nov 2026 (AG-V6): search with the stripped, both-script forms too, so
  // "అశోక్కి" fetches a contact saved as "Ashok".
  const words = contactSearchWords(name);
  if (!words.length) return null;
  const { data: near } = await supabase
    .from('contacts')
    .select('id,name,phone,email,relation,avatar_emoji')
    .eq('user_id', userId)
    .or(words.map((w) => `name.ilike.%${w}%`).join(','))
    .limit(120);
  return rankContactsForName(name, near || []);
}

// ── SERVER: FIND ALL MATCHING CONTACTS ────────────────────────────────────────
// Returns flat array of all partial matches — used alongside matchContactByName
// for passing to computeFollowUp and the disambiguation UI.
export async function findAllMatchingContacts(supabase, userId, name) {
  if (!name || !userId) return [];
  const { data: contacts } = await supabase
    .from('contacts')
    .select('id,name,phone,email,relation,avatar_emoji')
    .eq('user_id', userId)
    .ilike('name', `%${name}%`)
    .limit(8);
  return contacts || [];
}

// ── FOLLOW-UP LOGIC ───────────────────────────────────────────────────────────
// Returns follow_up object or null if intent is complete
// reminderAt is passed in because the Sarvam brain resolves times the regex
// cannot see ("రేపు ఉదయం", "कल सुबह") and writes them straight to reminderAt.
// Testing entities alone made the app ask "When should I remind you?" on a
// reminder it had already set and scheduled. Fixed 22 Aug 2026.
export function computeFollowUp(parsed, contactResult = null, reminderAt = null) {
  const { type, entities } = parsed;

  // Contact / meeting: check for disambiguation or missing info
  if (type === 'contact' || type === 'meeting') {
    const name = entities?.names?.[0];

    // Multiple contacts with same partial name → ask user to pick
    if (contactResult?.ambiguous) {
      const names = contactResult.multiple.map(c => c.name).join(', ');
      return {
        follow_up:      `Multiple contacts found for "${name}": ${names}. Which one?`,
        action_hint:    'disambiguate_contact',
        contacts:       contactResult.multiple,
        suggested_name: name,
      };
    }

    // THE TIME THE USER ALREADY GAVE.
    //
    // "Call Surya Kiran in five minutes" answers "now or later?" before it is
    // asked. This branch asked anyway, because it never looked at reminderAt —
    // a parameter it has taken since 22 August. Observed on the founder's phone
    // on 26 September 2026: the keep was stored with reminder_at 21:39 IST and
    // a reminders row was written, and Aaria still asked which he wanted. The
    // same sentence prefixed with "remind me to" is classified as a reminder,
    // skips this branch entirely, and was confirmed correctly — which is why
    // one phrasing worked and the other did not.
    //
    // A DAY WITH NO HOUR is the one case still worth a question, and it is a
    // different question. computeReminderAt fills in the current time of day as
    // a placeholder for "call Surya tomorrow", so the hour genuinely is not
    // known yet — but "now or a reminder?" is not what is missing. The time is.
    const dayNamedWithoutAClockTime =
      (entities?.dates?.length > 0) && !(entities?.times?.length > 0);
    const timeAlreadyGiven = isUsableInstant(reminderAt) && !dayNamedWithoutAClockTime;

    if (name && contactResult?.single?.phone && dayNamedWithoutAClockTime) {
      return {
        follow_up:   `What time should I call ${name}?`,
        action_hint: 'time_needed',
        contact:     contactResult.single,
      };
    }

    // Name found, phone available, and no time said → read back to confirm call
    // In the language it was asked in (22 Nov 2026: a Telugu request was
    // answered "Call Surya Kiran now or set a reminder?").
    if (name && contactResult?.single?.phone && !timeAlreadyGiven) {
      const contactName = contactResult.single.name || name;
      const askLang = scriptOf(parsed.subject || parsed.content || parsed.text || '');
      return {
        follow_up:   askLang === 'te'
          ? `${contactName}కి ఇప్పుడే కాల్ చేయనా?`
          : askLang === 'hi'
            ? `${contactName} को अभी कॉल करूँ?`
            : `Call ${contactName} now or set a reminder?`,
        action_hint: 'call_or_remind',
        contact:     contactResult.single,
      };
    }

    // Name found, no phone in contacts
    if (name && (contactResult === null || !contactResult?.single?.phone)) {
      const askLang = scriptOf(parsed.subject || parsed.content || parsed.text || '');
      return {
        follow_up:      askLang === 'te'
          ? `${name} మీ కాంటాక్ట్స్‌లో లేరు.`
          : askLang === 'hi'
            ? `${name} आपके कॉन्टैक्ट्स में नहीं हैं।`
            : `"${name}" isn't in your contacts.`,
        action_hint:    'add_contact',
        suggested_name: name,
      };
    }

    // No name extracted at all
    if (!name) {
      const askLang = scriptOf(parsed.subject || parsed.content || parsed.text || '');
      return {
        follow_up:   askLang === 'te'
          ? 'ఎవరికి కాల్ చేయాలి? పేరు చెప్పండి.'
          : askLang === 'hi'
            ? 'किसे कॉल करना है? नाम बताइए।'
            : 'Who do you want to contact? Say their name.',
        action_hint: 'name_needed',
      };
    }
  }

  // A REMINDER TO CALL SOMEONE WE CANNOT DIAL.
  //
  // The contact/meeting branch above has always asked "which one?" and "not in
  // your contacts". A reminder never did: "call Venu Yadav in two minutes" is
  // classified as a reminder, so it skipped both questions and was saved with
  // no number (1 Oct 2026). The time is already set; the question is who.
  if ((type === 'reminder' || type === 'task') && parsed.wants_call) {
    const name = entities?.names?.[0];
    if (name && contactResult?.ambiguous) {
      const list = contactResult.multiple.map(c => c.name);
      const lead = contactResult.partial
        ? `I couldn't find "${name}" exactly.`
        : `Several contacts match "${name}".`;
      return {
        follow_up:      `${lead} Which one: ${list.join(', ')}?`,
        action_hint:    'disambiguate_contact',
        contacts:       contactResult.multiple,
        suggested_name: name,
      };
    }
    if (name && contactResult === null) {
      return {
        follow_up:      `"${name}" isn't in your contacts, so I can remind you but can't dial. Add their number to QuietKeep to have me call.`,
        action_hint:    'add_contact',
        suggested_name: name,
      };
    }
  }

  // Reminder/task with no time: ask when.
  // reminderAt short-circuits this — if a time was resolved by any route, the
  // reminder is already scheduled and asking again is wrong.
  // A PLACE IS AN ANSWER TO "WHEN". "Remind me when I reach Chintal Kunta"
  // fires on arrival, not at a clock time, so it must not be asked for one.
  if ((type === 'reminder' || type === 'task') && !reminderAt && !parsed.geo?.detected
      && !entities?.dates?.length && !entities?.times?.length) {
    return {
      follow_up:   'When should I remind you? Say a time like "at 3pm" or "tomorrow morning".',
      action_hint: 'time_needed',
    };
  }

  // Meeting with no date.
  //
  // isUsableInstant(reminderAt) is the same short-circuit the reminder branch
  // above carries, and for the same reason: a relative offset ("in five
  // minutes", "ఐదు నిమిషాల్లో") resolves directly to an instant and writes
  // NOTHING into entities.dates or entities.times, so testing the entities
  // alone cannot see a time that is plainly there.
  //
  // This bit me one commit ago. Releasing "call Surya Kiran in 5 minutes" from
  // the now-or-later question dropped it straight into this branch, which asked
  // "When is this meeting?" about an instruction that had just been given a
  // time — one useless question traded for another.
  if (type === 'meeting'
      && !isUsableInstant(reminderAt)
      && !entities?.dates?.length
      && !entities?.times?.length) {
    return {
      follow_up:   'When is this meeting? Add a date and time.',
      action_hint: 'time_needed',
    };
  }

  return null;
}

// ── DESTINATION FROM SPEECH ───────────────────────────────────────────────────
// Riders say it many ways: "navigate to Charminar", "set location to Charminar",
// "take me to Charminar please", "how do I get to Golconda fort",
// "Charminar ki vellali". Found 21 Sep 2026: only the first worked on the main
// mic, none worked in Drive mode, and nothing understood "set location to".
const NAV_REQUEST = /\b(?:navigat\w*|directions?|route to|take me|drive me|go to|get me to|set (?:the |my )?(?:location|destination)|destination|show (?:me )?(?:the )?(?:way|route)|way to|how (?:do i|to|can i) (?:get|reach|go))\b|\s(?:ki|ku|ko|ka)\s+(?:location\s+set\w*|set\s+location\w*|vell\w*|dari\w*|jana\w*|jaana\w*|le chalo|rasta\w*|chalo)\b/i;

export function isNavigationRequest(text) {
  const s = String(text || '');
  return NAV_REQUEST.test(s) && !/\b(?:remind|remember|don.t forget)\b/i.test(s);
}

export function extractDestination(text) {
  let s = String(text || '').trim().replace(/[.?!,]+$/, '');
  const roman = s.match(/^(.+?)\s+(?:ki|ku|ko|ka)\s+(?:location\s+set\w*|set\s+location\w*|vell\w*|dari\w*|jana\w*|jaana\w*|le chalo|rasta\w*|chalo)\b/i);
  if (roman) {
    s = roman[1];
  } else {
    const m = s.match(/\b(?:navigat\w*|directions?|route|take me|drive me|go|going|get me|get|reach|set (?:the |my )?(?:location|destination)|destination|way)\b\s*(?:to|for|till|towards|is|as)?\s+(.+)$/i);
    if (m) s = m[1];
  }
  s = s
    .replace(/^(?:to|the)\s+/i, '')
    .replace(/\s+(?:on|in|using|with|via)\s+(?:google\s+)?maps?$/i, '')
    .replace(/\s+please$/i, '')
    .trim();
  if (/^(?:google\s+)?maps?$/i.test(s)) return '';
  return s.slice(0, 120);
}

export function navigationUrl(destination) {
  return `https://www.google.com/maps/dir/?api=1&travelmode=driving&dir_action=navigate&destination=${encodeURIComponent(destination)}`;
}

// ── CLIENT: EXECUTE ACTION FROM INTENTCARD ────────────────────────────────────
// Safe browser-only actions. Called from IntentCard handleExecute().
// Returns { executed, action_taken, url? }
export function executeClientAction(intent) {
  const type    = intent.intent_type;
  const content = intent.content || '';
  const phone   = intent.contact_phone || null;
  const name    = intent.contact_name  || null;

  switch (type) {

    case 'contact': {
      if (phone) {
        if (typeof window !== 'undefined') window.location.href = `tel:${phone}`;
        return { executed: true, action_taken: `Calling ${name || phone}` };
      }
      // No phone — open WhatsApp with name pre-filled if possible
      return { executed: false, action_taken: 'No phone number — add contact first' };
    }

    case 'meeting': {
      // Prefill Google Calendar event with content as title
      const start = new Date();
      const end   = new Date(start.getTime() + 3_600_000);
      const fmt   = (d) => d.toISOString().replace(/[-:.]/g, '').slice(0, 15) + 'Z';
      const url   = `https://calendar.google.com/calendar/r/eventedit?text=${encodeURIComponent(content)}&dates=${fmt(start)}/${fmt(end)}`;
      if (typeof window !== 'undefined' && window.open) window.open(url, '_blank');
      return { executed: true, action_taken: 'Opened Google Calendar' };
    }

    case 'trip':
    case 'navigation': {
      // Extract destination from content or navigation_query
      const query = intent.navigation_query || extractDestination(content) || content;
      if (typeof window !== 'undefined' && window.open) window.open(navigationUrl(query), '_blank');
      return { executed: true, action_taken: `Opened Maps: ${query.slice(0, 40)}` };
    }

    case 'purchase': {
      // Detect platform from content
      const lower = content.toLowerCase();
      let url;
      if (lower.includes('flipkart'))      url = `https://www.flipkart.com/search?q=${encodeURIComponent(content)}`;
      else if (lower.includes('swiggy'))   url = `https://www.swiggy.com`;
      else if (lower.includes('zomato'))   url = `https://www.zomato.com`;
      else if (lower.includes('blinkit') || lower.includes('grocery')) url = `https://blinkit.com`;
      else                                 url = `https://www.amazon.in/s?k=${encodeURIComponent(content)}`;
      window.open(url, '_blank');
      return { executed: true, action_taken: `Opened shopping: ${content.slice(0, 40)}` };
    }

    case 'document': {
      if (typeof document !== 'undefined') {
        const inp    = document.createElement('input');
        inp.type     = 'file';
        inp.accept   = 'application/pdf,image/*';
        inp.capture  = 'environment';
        inp.click();
        return { executed: true, action_taken: 'Opened camera/file picker' };
      }
      return { executed: false, action_taken: 'File picker unavailable' };
    }

    case 'task': {
      // Tasks don't auto-execute but return a guide for next step
      return {
        executed:     false,
        action_taken: null,
        guide:        `Next step for: "${content.slice(0, 60)}"`,
      };
    }

    default:
      return { executed: false, action_taken: null };
  }
}

// ── CLIENT: WHATSAPP DISPATCH ──────────────────────────────────────────────────
// Opens WhatsApp with pre-filled message. Phone must be E.164 without '+'.
export function openWhatsApp(phone, message = '') {
  if (!phone) return false;
  const cleaned = phone.replace(/\D/g, '');
  const url = message
    ? `https://wa.me/${cleaned}?text=${encodeURIComponent(message)}`
    : `https://wa.me/${cleaned}`;
  window.open(url, '_blank');
  return true;
}

// ── EXECUTABLE_TYPES ───────────────────────────────────────────────────────────
// Set of intent types that have a meaningful client-side execute action.
// Used by IntentCard to decide whether to show the execute button.
export const EXECUTABLE_TYPES = new Set([
  'contact',
  'meeting',
  'trip',
  'navigation',
  'purchase',
  'document',
]);

// ── GET EXECUTE LABEL ──────────────────────────────────────────────────────────
// Returns the label string for the execute button, or null if not applicable.
// Used by IntentCard.
export function getExecuteLabel(intent) {
  const type  = intent.intent_type;
  const phone = intent.contact_phone;
  const name  = intent.contact_name;
  switch (type) {
    case 'contact':    return phone ? `📞 Call ${name || ''}`.trim() : '📞 Call';
    case 'meeting':    return '📅 Calendar';
    case 'trip':
    case 'navigation': return '🗺️ Maps';
    case 'purchase':   return '🛒 Shop';
    case 'document':   return '📎 Scan';
    default:           return null;
  }
}

// ── NEVER CONFIRM SOMETHING THAT DID NOT HAPPEN ───────────────────────────────
//
// This is the rule the rest of this file has to obey, so it sits above the
// function that broke it.
//
// buildExecutionTTS is handed `reminderAt` — the instant that was actually
// resolved — and decided its wording from `parsed.entities.times` instead: the
// words EXTRACTED from the sentence. Those are not the same thing. A time can be
// extracted and still fail to resolve, and on 26 September 2026 that is exactly
// what happened three times in a row. Aaria said, in Telugu, "రిమైండర్ సెట్
// చేశాను" — I have set the reminder — with reminder_at NULL and no row in
// `reminders`. Keeps dd35295b, da579c00 and 1e426c18, all the same shape.
//
// A user who is told the reminder failed can set it again. A user who is told it
// succeeded cannot. Silence would be better than a false confirmation, and a
// question is better than silence.
//
// The sentence is chosen by the script of the user's own words, so a Telugu
// speaker is asked in Telugu. Same approach as ReminderTTSService on the Android
// side, and for the same reason: it works with the callers that already exist
// rather than only after every one of them is updated.
const ASK_FOR_TIME = {
  en: 'I did not catch when. When should I remind you?',
  te: 'ఎప్పుడు అని నాకు అర్థం కాలేదు. ఎప్పుడు గుర్తు చేయాలి?',
  hi: 'मुझे समय समझ नहीं आया। कब याद दिलाऊँ?',
};

export function scriptOf(text) {
  const s = String(text || '');
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (c >= 0x0C00 && c <= 0x0C7F) return 'te';
    if (c >= 0x0900 && c <= 0x097F) return 'hi';
    if (c >= 0x0B80 && c <= 0x0BFF) return 'ta';
    if (c >= 0x0C80 && c <= 0x0CFF) return 'kn';
    if (c >= 0x0D00 && c <= 0x0D7F) return 'ml';
    if (c >= 0x0980 && c <= 0x09FF) return 'bn';
    if (c >= 0x0A80 && c <= 0x0AFF) return 'gu';
    if (c >= 0x0A00 && c <= 0x0A7F) return 'pa';
    if (c >= 0x0B00 && c <= 0x0B7F) return 'or';
  }
  return 'en';
}

function calendarDayDiff(d1, d2, timeZone = DEFAULT_TZ) {
  const p1 = zonedDateParts(d1, timeZone);
  const p2 = zonedDateParts(d2, timeZone);
  const utc1 = Date.UTC(p1.y, p1.mo, p1.d);
  const utc2 = Date.UTC(p2.y, p2.mo, p2.d);
  return Math.round((utc2 - utc1) / 86400000);
}

function zonedTimeParts(date, timeZone = DEFAULT_TZ) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hour12: false, hour: '2-digit', minute: '2-digit',
  }).formatToParts(date).filter(x => x.type !== 'literal');
  const p = Object.fromEntries(parts.map(x => [x.type, x.value]));
  const hour = p.hour === '24' ? 0 : +p.hour;
  const minute = +p.minute;
  return { hour, minute };
}

function formatNaturalDateTime(dt, lang = 'en', timeZone = DEFAULT_TZ) {
  const diff = calendarDayDiff(new Date(), dt, timeZone);
  const { hour, minute } = zonedTimeParts(dt, timeZone);
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;

  if (lang === 'te') {
    let dateStr = '';
    if (diff === 0) dateStr = 'ఈరోజు';
    else if (diff === 1) dateStr = 'రేపు';
    else if (diff === 2) dateStr = 'ఎల్లుండి';
    else dateStr = dt.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone });

    const period = hour < 12 ? 'ఉదయం' : (hour < 16 ? 'మధ్యాహ్నం' : (hour < 20 ? 'సాయంత్రం' : 'రాత్రి'));
    const timeStr = minute === 0 ? `${period} ${hour12} గంటలకు` : `${period} ${hour12}:${minute < 10 ? '0' : ''}${minute}కి`;
    return { dateStr, timeStr, full: `${dateStr ? dateStr + ' ' : ''}${timeStr}`.trim() };
  }

  if (lang === 'hi') {
    let dateStr = '';
    if (diff === 0) dateStr = 'आज';
    else if (diff === 1) dateStr = 'कल';
    else if (diff === 2) dateStr = 'परसों';
    else dateStr = dt.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone });

    const period = hour < 12 ? 'सुबह' : (hour < 16 ? 'दोपहर' : (hour < 20 ? 'शाम' : 'रात'));
    const timeStr = minute === 0 ? `${period} ${hour12} बजे` : `${period} ${hour12}:${minute < 10 ? '0' : ''}${minute} बजे`;
    return { dateStr, timeStr, full: `${dateStr ? dateStr + ' ' : ''}${timeStr}`.trim() };
  }

  // T27: Tamil, Kannada, Malayalam, Bengali, Gujarati, Punjabi, Marathi, Odia
  const other = naturalTimeWords(lang, diff, hour, minute,
    dt.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone }));
  if (other) return other;

  // English fallback
  let dateStr = '';
  if (diff === 0) dateStr = 'today';
  else if (diff === 1) dateStr = 'tomorrow';
  else dateStr = dt.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone });

  const timeStr = dt.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone });
  return { dateStr, timeStr, full: `${dateStr} at ${timeStr}` };
}

// Does this instruction actually ask for a phone call?
//
// The SAME verb list that src/lib/reminder-voice.js uses when it decides
// whether to attach a dial action to a scheduled alarm. If the two ever drift
// apart, Aaria promises a call the alarm will not place, or the alarm places
// one she never mentioned. They are kept identical on purpose.
const CALL_VERB = /\b(call|phone|ring|dial)\b|కాల్|ఫోన్|कॉल|फ़ोन|फोन/i;

function looksLikeACall(parsed) {
  return CALL_VERB.test(
    String(parsed?.subject || parsed?.content || parsed?.text || '')
  );
}

/** A real, future instant — not null, not Invalid Date, not already past. */
export function isUsableInstant(value) {
  if (!value) return false;
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return false;
  // One minute of slack: the write and the check are not simultaneous.
  return d.getTime() > Date.now() - 60000;
}

// ── TTS CONFIRMATION ───────────────────────────────────────────────────────────
export function buildExecutionTTS(parsed, contactResult, reminderAt, followUp, langOverride = null) {
  const name = parsed.entities?.names?.[0];
  const lang = langOverride || scriptOf(parsed.subject || parsed.content || parsed.text || '');

  if (followUp) return followUp.follow_up;

  // THE GUARD. Anything that claims a reminder was set must pass through here
  // first, and it only passes when there is an instant to set it to.
  if ((parsed.type === 'reminder' || parsed.type === 'task') && !isUsableInstant(reminderAt)) {
    return ASK_FOR_TIME[lang] || say('ask_for_time', lang) || ASK_FOR_TIME.en;
  }

  const contact = contactResult?.single || null;

  // A PERSON, A NUMBER, AND A TIME — nothing left to ask.
  if (
    contact?.phone
    && isUsableInstant(reminderAt)
    && looksLikeACall(parsed)
    && parsed.type !== 'reminder'
    && parsed.type !== 'task'
  ) {
    const dt = new Date(reminderAt);
    const natural = formatNaturalDateTime(dt, lang, DEFAULT_TZ);
    if (lang === 'te') {
      return `సరే — ${natural.full} ${contact.name || name}కి కాల్ చేస్తాను.`;
    }
    if (lang === 'hi') {
      return `ठीक है — ${natural.full} ${contact.name || name} को कॉल करूँगा।`;
    }
    return say('call_at', lang, { when: natural.full, name: contact.name || name })
      ?? `Right — ${natural.full} I'll call ${contact.name || name}.`;
  }

  if (parsed.type === 'contact' && contact?.phone) {
    if (lang === 'te') {
      return `కాంటాక్ట్ సేవ్ అయింది. ${name || 'కాంటాక్ట్'} మీ కాంటాక్ట్స్‌లో ఉంది. కాల్ చేయడానికి బటన్ నొక్కండి.`;
    }
    if (lang === 'hi') {
      return `कॉन्टैक्ट सेव हो गया। ${name || 'कॉन्टैक्ट'} आपके कॉन्टैक्ट्स में है। कॉल करने के लिए बटन दबाएँ।`;
    }
    return say('contact_saved', lang, { name: name || contact.name || '' })
      ?? `Keep saved. ${name || 'Contact'} is in your contacts. Tap the call button to dial now.`;
  }

  if (parsed.type === 'reminder') {
    const dayNamedWithoutAClockTime =
      (parsed.entities?.dates?.length > 0) && !(parsed.entities?.times?.length > 0);
    const hasSpecificTime = isUsableInstant(reminderAt) && !dayNamedWithoutAClockTime;
    const taskContent     = (parsed.subject || '').replace(/^remind\s+(?:me\s+)?(?:to\s+)?/i, '').trim();

    if (reminderAt) {
      const dt = new Date(reminderAt);
      const natural = formatNaturalDateTime(dt, lang, DEFAULT_TZ);

      if (hasSpecificTime) {
        if (lang === 'te') {
          return `సరే, ${natural.full} గుర్తు చేస్తాను.`;
        }
        if (lang === 'hi') {
          return `ठीक है, ${natural.full} याद दिलाऊँगा।`;
        }
        return say('remind_at', lang, { when: natural.full })
          ?? `Got it — I'll remind you to ${taskContent || 'do this'} ${natural.full}.`;
      } else {
        if (lang === 'te') {
          return `సరే, ${natural.dateStr || 'గుర్తు'} చేస్తాను. ఏ సమయానికి గుర్తు చేయాలి?`;
        }
        if (lang === 'hi') {
          return `ठीक है, ${natural.dateStr || 'याद'} दिलाऊँगा। किस समय याद दिलाऊँ?`;
        }
        return say('remind_day_ask', lang, { date: natural.dateStr })
          ?? `Got it — I'll remind you to ${taskContent || 'do this'} ${natural.dateStr}. What time should I set it for?`;
      }
    } else {
      if (lang === 'te') {
        return `నోట్‌గా సేవ్ చేశాను, సమయం అర్థం కాలేదు — రిమైండర్ పెట్టమంటారా?`;
      }
      if (lang === 'hi') {
        return `नोट के रूप में सेव कर लिया है, समय समझ नहीं आया — क्या रिमाइंडर सेट करूँ?`;
      }
      return say('remind_no_time', lang)
        ?? `I saved that as a note, but I didn't catch a time — want me to set a reminder?`;
    }
  }

  if (parsed.type === 'task' && reminderAt) {
    const dt = new Date(reminderAt);
    const natural = formatNaturalDateTime(dt, lang, DEFAULT_TZ);
    if (lang === 'te') {
      return `టాస్క్ సేవ్ అయింది. ${natural.timeStr} గుర్తు చేస్తాను.`;
    }
    if (lang === 'hi') {
      return `टास्क सेव हो गया। ${natural.timeStr} याद दिलाऊँगा।`;
    }
    return say('task_at', lang, { time: natural.timeStr }) ?? `Task saved. I'll remind you at ${natural.timeStr}.`;
  }

  if (parsed.type === 'meeting') {
    return say('meeting_saved', lang) ?? `Meeting keep saved. Tap to add to Google Calendar.`;
  }

  if (parsed.type === 'purchase') {
    return `Purchase keep saved. Tap to search on Amazon.`;
  }

  if (parsed.type === 'trip' || parsed.type === 'navigation') {
    return `Navigation keep saved. Tap to open Maps.`;
  }

  if (parsed.type === 'expense') {
    return `Expense recorded: ${(parsed.subject || '').slice(0, 60)}.`;
  }

  return `Intent recorded: ${(parsed.subject || '').slice(0, 60)}. Open loop. Next step unresolved.`;
          }
