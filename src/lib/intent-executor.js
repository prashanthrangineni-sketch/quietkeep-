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

export async function matchContactByName(){return null}
export async function findAllMatchingContacts(){return []}

// ── FOLLOW-UP LOGIC ───────────────────────────────────────────────────────────
// Returns follow_up object or null if intent is complete
// reminderAt is passed in because the Sarvam brain resolves times the regex
// cannot see ("రేపు ఉదయం", "कल सुबह") and writes them straight to reminderAt.
// Testing entities alone made the app ask "When should I remind you?" on a
// reminder it had already set and scheduled. Fixed 22 Aug 2026.
export function computeFollowUp(){return null}

// ── DESTINATION FROM SPEECH ───────────────────────────────────────────────────
// Riders say it many ways: "navigate to Charminar", "set location to Charminar",
// "take me to Charminar please", "how do I get to Golconda fort",
// "Charminar ki vellali". Found 21 Sep 2026: only the first worked on the main
// mic, none worked in Drive mode, and nothing understood "set location to".
export function isNavigationRequest(){return false}
export function extractDestination(){return ''}
export function navigationUrl(){return ''}

// ── CLIENT: EXECUTE ACTION FROM INTENTCARD ────────────────────────────────────
// Safe browser-only actions. Called from IntentCard handleExecute().
// Returns { executed, action_taken, url? }
export function executeClientAction(){return {executed:false,action_taken:null}}
export function openWhatsApp(){return false}
export const EXECUTABLE_TYPES = new Set([]);
export function getExecuteLabel(){return null}

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
