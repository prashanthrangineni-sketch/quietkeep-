// src/lib/aaria-watch.js
// ─────────────────────────────────────────────────────────────────────────────
// The part where Aaria speaks first.
//
// Everything else in this app is reactive: the user says something, the app
// answers. That is a search box with a microphone attached. What makes an
// assistant feel like one is noticing — telling you the reminder you set for
// this morning is still sitting there, before you go to bed having forgotten it.
//
// WHAT IT WATCHES
// Reminders that are due and still open. That is it, for now. The data is
// already there — `keeps.reminder_at` with `status = 'pending'` — and nothing
// in the product currently looks at it outside the nudge cron, which does not
// run because CRON_SECRET and pg_cron were never set up. So the single most
// valuable thing this can do is surface what the cron would have.
//
// THREE RULES, ALL LEARNED THE HARD WAY IN OTHER PRODUCTS
//
//  1. IT NEVER SPEAKS UNPROMPTED. A phone that starts talking in a meeting is
//     uninstalled that afternoon. The watcher raises a quiet badge; the voice
//     only happens if the user opens the panel.
//
//  2. IT NEVER NAGS. One notice per item per day, remembered locally. A
//     reminder you have already been told about twice is noise, and noise is
//     how a notification surface dies.
//
//  3. IT IS CHEAP AND IT FAILS SILENTLY. One GET, throttled, on focus. A
//     watcher that costs the user battery or throws errors into a page they
//     were using is worse than no watcher.
// ─────────────────────────────────────────────────────────────────────────────

const LS_SEEN = 'qk_aaria_seen_notices';
const THROTTLE_MS = 10 * 60 * 1000;    // at most one check every ten minutes

let lastCheckAt = 0;

function today() {
  // Local date, not UTC: "already told them today" must mean the user's day.
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function loadSeen() {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_SEEN) || '{}');
    // Drop anything from a previous day so the store cannot grow forever.
    return raw.day === today() ? raw : { day: today(), ids: [] };
  } catch {
    return { day: today(), ids: [] };
  }
}

function markSeen(ids) {
  try {
    const seen = loadSeen();
    const merged = Array.from(new Set([...(seen.ids || []), ...ids]));
    localStorage.setItem(LS_SEEN, JSON.stringify({ day: today(), ids: merged }));
  } catch {}
}

/**
 * Look for things worth mentioning.
 *
 * @param {string} accessToken
 * @param {object} [opts]
 * @param {boolean} [opts.force] ignore the throttle (used on an explicit ask)
 * @returns {Promise<{text:string, count:number, ids:string[]}|null>}
 *          null when there is nothing to say — which is most of the time, and
 *          is the correct answer.
 */
export async function checkForNotices(accessToken, opts = {}) {
  if (!accessToken) return null;
  if (typeof window === 'undefined') return null;

  const now = Date.now();
  if (!opts.force && now - lastCheckAt < THROTTLE_MS) return null;
  lastCheckAt = now;

  let keeps = [];
  try {
    const res = await fetch('/api/keeps?status=pending&limit=200', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    const json = await res.json().catch(() => null);
    keeps = Array.isArray(json?.keeps) ? json.keeps : [];
  } catch {
    return null;   // offline, or the API is unhappy. Not the user's problem.
  }

  const seen = new Set(loadSeen().ids || []);
  const nowMs = Date.now();

  const overdue = keeps.filter((k) => {
    if (!k?.reminder_at || !k?.id) return false;
    if (seen.has(k.id)) return false;
    const t = Date.parse(k.reminder_at);
    return Number.isFinite(t) && t < nowMs;
  });

  if (!overdue.length) return null;

  // Oldest first — the thing most likely to have been genuinely forgotten.
  overdue.sort((a, b) => Date.parse(a.reminder_at) - Date.parse(b.reminder_at));

  const ids = overdue.map((k) => k.id);
  markSeen(ids);

  const first = String(overdue[0].content || '').trim();
  const snippet = first.length > 60 ? `${first.slice(0, 60)}…` : first;

  const text = overdue.length === 1
    ? `One reminder is past its time: ${snippet}`
    : `${overdue.length} reminders are past their time. The oldest: ${snippet}`;

  return { text, count: overdue.length, ids };
}

/** Used by tests and by "check again" in the UI. */
export function resetThrottle() { lastCheckAt = 0; }

export default checkForNotices;
