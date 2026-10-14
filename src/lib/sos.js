// src/lib/sos.js
//
// SOS ON ITS OWN PATH - the app side. (AARIA_ONE_PLAN item 3)
//
// Nothing here goes through the AI or the server. The decision "this is an
// SOS" is a short list of whole-utterance words; the action is the phone's
// own countdown screen and SMS radio (android SosCountdownActivity via
// SOSPlugin). On the web, where there is no SMS radio, the Emergency screen
// opens with its hold button, exactly as before.
//
// THE WORD IN A SENTENCE IS NOT THE COMMAND. "my friend said SOS means save
// our souls" must not trigger anything (100-task evaluation, en-sos-trap-01),
// and "emergency lights ki battery change cheyyali" is a reminder. So the
// WHOLE utterance must be an SOS phrase - at most four words, nothing else.

// Each entry is a whole phrase, in the scripts and romanisations the
// recogniser returns. Lower-cased, punctuation stripped, before matching.
const SOS_PHRASES = new Set([
  // English
  'sos', 'emergency', 'help', 'help me', 'help me please', 'i need help', 'save me', 'send help', 'call for help',
  'aaria sos', 'aaria emergency', 'aaria help', 'aaria help me',
  // Hindi (Devanagari + romanised)
  'bachao', 'mujhe bachao', 'madad', 'madad karo', 'mujhe madad chahiye', 'emergency hai', 'help karo',
  'बचाओ', 'मुझे बचाओ', 'मदद', 'मदद करो', 'मुझे मदद चाहिए', 'इमरजेंसी', 'आपातकाल', 'इमरजेंसी है',
  // Telugu (script + romanised)
  'kapadandi', 'nannu kapadandi', 'sahayam', 'sahayam kavali', 'help kavali', 'emergency undi', 'atyavasaram',
  'కాపాడండి', 'నన్ను కాపాడండి', 'సహాయం', 'సహాయం కావాలి', 'సహాయం కావాలి అత్యవసరం', 'అత్యవసరం', 'ఎమర్జెన్సీ',
]);

export function normaliseUtterance(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[.,!?।…]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .replace(/^(?:hey|hi|hello|ok|okay) /u, '');
}

/** True only when the WHOLE utterance is an SOS phrase. */
export function isSosUtterance(text) {
  const t = normaliseUtterance(text);
  if (!t) return false;
  if (t.split(' ').length > 4) return false;
  return SOS_PHRASES.has(t);
}

function plugin() {
  try {
    const p = typeof window !== 'undefined' && window.Capacitor?.Plugins?.SOSPlugin;
    return p && typeof p.trigger === 'function' ? p : null;
  } catch { return null; }
}

/** Is the phone's own SOS path (countdown + SMS radio) available here? */
export function nativeSosAvailable() {
  return !!plugin();
}

/**
 * Start the SOS. On the phone: the ten-second countdown screen over the lock
 * screen, then the phone sends the SMS itself. Returns what happened, never
 * throws. { started, path: 'native' | 'web', reason? }
 */
export async function triggerSOS(source = 'app', { navigate } = {}) {
  const p = plugin();
  if (p) {
    try {
      const r = await p.trigger({ source });
      return { started: !!r?.started, path: 'native', reason: r?.reason || null, countdown_ms: r?.countdown_ms ?? null };
    } catch (e) {
      return { started: false, path: 'native', reason: String(e?.message || e) };
    }
  }
  // Web: the Emergency screen with its hold button.
  try { if (typeof navigate === 'function') navigate('/emergency?sos=1'); } catch {}
  return { started: false, path: 'web', reason: 'no_native_sos' };
}

/** Keep the emergency contacts on the phone so an SOS needs no internet. */
export async function syncEmergencyContactsToPhone(contacts) {
  const p = plugin();
  if (!p || typeof p.syncContacts !== 'function') return { saved: null, reason: 'no_native_sos' };
  const list = (Array.isArray(contacts) ? contacts : [])
    .map((c) => ({ name: String(c?.name || ''), phone: String(c?.phone || '').trim() }))
    .filter((c) => c.phone);
  try {
    const r = await p.syncContacts({ contacts: list });
    return { saved: r?.saved ?? list.length, reason: null };
  } catch (e) {
    return { saved: null, reason: String(e?.message || e) };
  }
}

/** Ask for permission to send SMS on the person's behalf. */
export async function requestSmsPermission() {
  const p = plugin();
  if (!p || typeof p.requestSmsPermission !== 'function') return { sms_permission: null };
  try { return await p.requestSmsPermission(); } catch { return { sms_permission: null }; }
}

export async function sosStatus() {
  const p = plugin();
  if (!p || typeof p.status !== 'function') return null;
  try { return await p.status(); } catch { return null; }
}

/** The on-phone journal: every trigger/cancel/sent/delivered with timings. */
export async function sosJournal() {
  const p = plugin();
  if (!p || typeof p.journal !== 'function') return [];
  try { const r = await p.journal(); return Array.isArray(r?.events) ? r.events : []; } catch { return []; }
}

/**
 * The item-3 numbers from a journal: of the SOS events that fired, how many
 * had every SMS delivered, and how long the first SMS took to be handed to
 * the radio. Unknown is null, never zero.
 */
export function summariseJournal(events) {
  const byEvent = new Map();
  for (const e of events || []) {
    if (!e?.event) continue;
    if (!byEvent.has(e.event)) byEvent.set(e.event, []);
    byEvent.get(e.event).push(e);
  }
  let fired = 0, delivered = 0, cancelled = 0;
  const firstHandoffMs = [];
  for (const list of byEvent.values()) {
    const kinds = list.map((e) => e.kind);
    if (kinds.includes('cancelled')) { cancelled++; continue; }
    if (!kinds.includes('handed_to_radio')) continue;
    fired++;
    const handed = list.filter((e) => e.kind === 'handed_to_radio');
    const deliveredParts = list.filter((e) => e.kind === 'delivered').length;
    const expectedParts = handed.reduce((n, e) => n + (e.data?.parts || 1), 0);
    if (deliveredParts >= expectedParts && expectedParts > 0) delivered++;
    const first = Math.min(...handed.map((e) => e.data?.ms_after_trigger ?? Infinity));
    if (Number.isFinite(first)) firstHandoffMs.push(first);
  }
  const sorted = [...firstHandoffMs].sort((a, b) => a - b);
  const p50 = sorted.length ? sorted[Math.floor((sorted.length - 1) / 2)] : null;
  return {
    events_fired: fired,
    events_cancelled: cancelled,
    delivered_pct: fired ? Math.round((1000 * delivered) / fired) / 10 : null,
    first_sms_handoff_ms_p50: p50,
    first_sms_handoff_ms_max: sorted.length ? sorted[sorted.length - 1] : null,
  };
}
