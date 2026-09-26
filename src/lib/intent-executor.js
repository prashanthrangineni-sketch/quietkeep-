// src/lib/intent-executor.js  v2
// Execution layer — maps intent_type → real action
// v2 adds: WhatsApp dispatch, contact disambiguation, task next-step guide,
//          navigation intent, improved follow-up engine

function parseTimeToDate(){return null} function parseDateString(){return null}

// ── TIMEZONE ──────────────────────────────────────────────────────────────────
// setHours() resolves in the SERVER's timezone. On Vercel that is UTC, so
// "tomorrow at 10 a.m." was stored as 10:00Z — which is 15:30 IST. Every
// English voice reminder fired 5 hours 30 minutes late. The Sarvam path was
// never affected because the brain returns an absolute offset (+05:30).
// Found 22 Aug 2026, after the parser fix stopped masking it.
export const DEFAULT_TZ = 'Asia/Kolkata';

export function computeReminderAt(){return null}

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
  if (!contacts?.length) return null;
  const exact = contacts.find(c => c.name.toLowerCase() === name.toLowerCase());
  if (exact) return { single: exact };
  if (contacts.length === 1) return { single: contacts[0] };
  // Multiple partial matches — return all for disambiguation
  return { multiple: contacts, ambiguous: true };
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

    // Name found, phone available → offer call vs remind
    if (name && contactResult?.single?.phone) {
      return {
        follow_up:   `Call ${name} now or set a reminder?`,
        action_hint: 'call_or_remind',
        contact:     contactResult.single,
      };
    }

    // Name found, no phone in contacts
    if (name && contactResult === null) {
      return {
        follow_up:      `"${name}" isn't in your contacts. Add a number to call them, or I'll save this as a reminder.`,
        action_hint:    'add_contact',
        suggested_name: name,
      };
    }

    // No name extracted at all
    if (!name) {
      return {
        follow_up:   'Who do you want to contact? Say their name.',
        action_hint: 'name_needed',
      };
    }
  }

  // Reminder/task with no time: ask when.
  // reminderAt short-circuits this — if a time was resolved by any route, the
  // reminder is already scheduled and asking again is wrong.
  if ((type === 'reminder' || type === 'task') && !reminderAt && !entities?.dates?.length && !entities?.times?.length) {
    return {
      follow_up:   'When should I remind you? Say a time like "at 3pm" or "tomorrow morning".',
      action_hint: 'time_needed',
    };
  }

  // Meeting with no date
  if (type === 'meeting' && !entities?.dates?.length && !entities?.times?.length) {
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
const NAV_REQUEST = /\b(?:navigat\w*|directions?|route to|take me|drive me|go to|get me to|set (?:the |my )?(?:location|destination)|destination|show (?:me )?(?:the )?(?:way|route)|way to|how (?:do i|to|can i) (?:get|reach|go))\b|\s(?:ki|ku|ko|ka)\s+(?:vell\w*|dari\w*|jana\w*|jaana\w*|le chalo|rasta\w*|chalo)\b/i;

export function isNavigationRequest(text) {
  const s = String(text || '');
  return NAV_REQUEST.test(s) && !/\b(?:remind|remember|don.t forget)\b/i.test(s);
}

export function extractDestination(text) {
  let s = String(text || '').trim().replace(/[.?!,]+$/, '');
  const roman = s.match(/^(.+?)\s+(?:ki|ku|ko|ka)\s+(?:vell\w*|dari\w*|jana\w*|jaana\w*|le chalo|rasta\w*|chalo)\b/i);
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
        window.location.href = `tel:${phone}`;
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
      window.open(url, '_blank');
      return { executed: true, action_taken: 'Opened Google Calendar' };
    }

    case 'trip':
    case 'navigation': {
      // Extract destination from content
      const query = extractDestination(content) || content;
      window.open(navigationUrl(query), '_blank');
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

// ── TTS CONFIRMATION ───────────────────────────────────────────────────────────
export function buildExecutionTTS(parsed, contactResult, reminderAt, followUp) {
  const name = parsed.entities?.names?.[0];

  if (followUp) return followUp.follow_up;

  const contact = contactResult?.single || null;

  if (parsed.type === 'contact' && contact?.phone) {
    return `Keep saved. ${name || 'Contact'} is in your contacts. Tap the call button to dial now.`;
  }

  if (parsed.type === 'reminder') {
    const hasSpecificTime = parsed.entities?.times?.length > 0;
    const taskContent     = (parsed.subject || '').replace(/^remind\s+(?:me\s+)?(?:to\s+)?/i, '').trim();

    if (reminderAt) {
      // Format in the USER's zone. Without the timeZone option these render in
      // the server's zone (UTC on Vercel), so a correctly stored 04:30Z was
      // read back to the user as "4:30 am" when they had said 10 a.m. The
      // reminder fired at the right moment; the confirmation lied about it.
      // Found 22 Aug 2026 in the spoken confirmation, after the stored value
      // was already correct.
      const dt      = new Date(reminderAt);
      const timeStr = dt.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: DEFAULT_TZ });
      const dateStr = dt.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: DEFAULT_TZ });

      if (hasSpecificTime) {
        return `Got it — I'll remind you to ${taskContent || 'do this'} ${dateStr} at ${timeStr}.`;
      } else {
        return `Got it — I'll remind you to ${taskContent || 'do this'} ${dateStr}. What time should I set it for?`;
      }
    } else {
      return `I saved that as a note, but I didn't catch a time — want me to set a reminder?`;
    }
  }

  if (parsed.type === 'task' && reminderAt) {
    const dt      = new Date(reminderAt);
    const timeStr = dt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: DEFAULT_TZ });
    return `Task saved. I'll remind you at ${timeStr}.`;
  }

  if (parsed.type === 'meeting') {
    return `Meeting keep saved. Tap to add to Google Calendar.`;
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
