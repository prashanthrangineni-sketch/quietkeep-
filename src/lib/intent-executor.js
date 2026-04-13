// src/lib/intent-executor.js  v2
// Execution layer — maps intent_type → real action
// v2 adds: WhatsApp dispatch, contact disambiguation, task next-step guide,
//          navigation intent, improved follow-up engine

// ── TIME PARSING ──────────────────────────────────────────────────────────────
function parseTimeToDate(timeStr, referenceDate = new Date()) {
  if (!timeStr) return null;
  const t = timeStr.toLowerCase().trim();
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

// ── COMPUTE reminder_at FROM ENTITIES ─────────────────────────────────────────
export function computeReminderAt(entities) {
  if (!entities) return null;
  const { dates = [], times = [] } = entities;
  let base = null;
  for (const d of dates) { const p = parseDateString(d); if (p) { base = p; break; } }
  if (times.length > 0) {
    const td = parseTimeToDate(times[0], base || new Date());
    if (td) {
      if (base) { base = new Date(base); base.setHours(td.getHours(), td.getMinutes(), 0, 0); }
      else base = td;
    }
  }
  return base;
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
export function computeFollowUp(parsed, contactResult = null) {
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

  // Reminder/task with no time: ask when
  if ((type === 'reminder' || type === 'task') && !entities?.dates?.length && !entities?.times?.length) {
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
      const query = content.replace(/^(navigate to|go to|directions to|take me to)\s*/i, '').trim() || content;
      window.open(`https://maps.google.com/maps?q=${encodeURIComponent(query)}`, '_blank');
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

  if (parsed.type === 'reminder' && reminderAt) {
    const dt      = new Date(reminderAt);
    const timeStr = dt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
    const dateStr = dt.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
    return `Reminder set for ${dateStr} at ${timeStr}.`;
  }

  if (parsed.type === 'task' && reminderAt) {
    const dt      = new Date(reminderAt);
    const timeStr = dt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
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
