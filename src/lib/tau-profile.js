// src/lib/tau-profile.js
// T28 (22 Nov 2026): Aaria's personal profile, built from what the person
// actually does.
//
// Why: the old builder (tau-learning.js updateBehaviourProfile) only read
// tau_intent_log, which voice commands never write to. On 22 Nov the table held
// 19 rows across 5 users, so no profile was ever saved (tau_behaviour_profile: 0
// rows) while the voice route had recorded 210 habit rows in behavior_patterns.
//
// This builder reads the person's own keeps (what they asked Aaria to do) and
// behavior_patterns, in Indian time, and produces:
//   - the tau_behaviour_profile row (same columns the dashboard already reads);
//   - `habits`: plain facts such as "calls Amma in the evening" with how sure
//     Aaria is. Each habit keeps its `status` across rebuilds:
//       learned   - seen often enough, not yet confirmed by the person
//       confirmed - the person said yes; Aaria may act on it
//       declined  - the person said no; Aaria never offers it again
//     (Founder decision 22 Nov: hybrid learning - learn alone, ask once before
//     acting on something new. T29 adds the asking and the settings.)
//
// Pure functions here; the database read/write lives in refreshTauProfile().
// No model, no network beyond Supabase, no new spend.

export const PROFILE_WINDOW_DAYS = 60;
export const HALF_LIFE_DAYS = 14;          // habits fade when not seen (founder vision: ~2 weeks)
export const MIN_DAYS_FOR_HABIT = 3;       // seen on 3 different days before it counts
export const REFRESH_AFTER_MS = 6 * 3600e3;
const TZ = 'Asia/Kolkata';

const DAY_MS = 864e5;
const BUCKETS = ['morning', 'afternoon', 'evening', 'night'];
// Same buckets the dashboard chips use (tau-learning.js getSuggestionChips).
export function bucketOf(hour) {
  return hour >= 5 && hour < 12 ? 'morning' : hour >= 12 && hour < 17 ? 'afternoon' : hour >= 17 && hour < 21 ? 'evening' : 'night';
}

/** Hour, day-of-week and calendar day of an instant in Indian time. */
export function localParts(iso, timeZone = TZ) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone, hour: '2-digit', hour12: false, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(d).map((p) => [p.type, p.value]));
  const hour = Number(parts.hour) % 24;
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
  return { hour, dow, day: `${parts.year}-${parts.month}-${parts.day}`, bucket: bucketOf(hour) };
}

function scriptLang(text) {
  const s = String(text || '');
  if (/[ఀ-౿]/.test(s)) return 'te';
  if (/[ऀ-ॿ]/.test(s)) return 'hi';
  if (/[஀-௿]/.test(s)) return 'ta';
  if (/[ಀ-೿]/.test(s)) return 'kn';
  if (/[ഀ-ൿ]/.test(s)) return 'ml';
  if (/[ঀ-৿]/.test(s)) return 'bn';
  if (/[઀-૿]/.test(s)) return 'gu';
  if (/[਀-੿]/.test(s)) return 'pa';
  if (/[଀-୿]/.test(s)) return 'or';
  return /[a-z]/i.test(s) ? 'en' : null;
}

const mode = (arr) => {
  const c = {};
  for (const v of arr) if (v !== null && v !== undefined) c[v] = (c[v] || 0) + 1;
  const top = Object.entries(c).sort((a, b) => b[1] - a[1])[0];
  return top ? { value: top[0], share: top[1] / arr.length } : { value: null, share: 0 };
};
const median = (nums) => {
  const s = [...nums].sort((a, b) => a - b);
  return s.length ? s[Math.floor((s.length - 1) / 2)] : null;
};
const slug = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 60);

/** How sure Aaria is: more days = surer; fades with a 14-day half-life. */
export function habitConfidence(distinctDays, lastSeenIso, now = new Date()) {
  const base = Math.min(0.95, distinctDays / (distinctDays + 2));
  const ageDays = Math.max(0, (now.getTime() - new Date(lastSeenIso).getTime()) / DAY_MS);
  return Math.round(base * Math.pow(0.5, ageDays / HALF_LIFE_DAYS) * 100) / 100;
}

// Keeps that are noise, not behaviour: closed junk, rehearsal echoes.
function usable(k) {
  return k && k.created_at && k.status !== 'closed';
}

function summarise(group, now) {
  const parts = group.map((g) => g.p);
  const days = new Set(parts.map((p) => p.day));
  const last = group.map((g) => g.at).sort().at(-1);
  const b = mode(parts.map((p) => p.bucket));
  const dowMode = mode(parts.map((p) => p.dow));
  return {
    days: days.size,
    count: group.length,
    bucket: b.value,
    hour: median(parts.filter((p) => p.bucket === b.value).map((p) => p.hour)),
    // A weekday only counts when most of the occurrences fall on it.
    dow: dowMode.share >= 0.7 && days.size >= MIN_DAYS_FOR_HABIT ? Number(dowMode.value) : null,
    last_seen: last,
    confidence: habitConfidence(days.size, last, now),
  };
}

/**
 * Build the profile.
 * keeps:    [{ intent_type, created_at, contact_name, location_name, voice_text, content, status }]
 * patterns: [{ pattern_type, location_name, time_bucket, frequency, last_seen_at, metadata }]
 * previous: the habits array from the last build (to keep yes/no answers)
 */
export function buildTauProfile({ userId, keeps = [], patterns = [], previous = [], now = new Date(), timeZone = TZ } = {}) {
  const since = now.getTime() - PROFILE_WINDOW_DAYS * DAY_MS;
  const rows = keeps
    .filter(usable)
    .filter((k) => new Date(k.created_at).getTime() >= since)
    .map((k) => ({ k, at: k.created_at, p: localParts(k.created_at, timeZone) }))
    .filter((r) => r.p);

  // ── profile row (the columns the dashboard already reads) ──
  const byBucket = Object.fromEntries(BUCKETS.map((b) => [b, []]));
  for (const r of rows) byBucket[r.p.bucket].push(r.k.intent_type || 'note');
  const counts = {};
  for (const r of rows) { const t = r.k.intent_type || 'note'; counts[t] = (counts[t] || 0) + 1; }
  const top_intents = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([intent, count]) => ({ intent, count }));
  const activeDays = new Set(rows.map((r) => r.p.day)).size;
  const place = (re) => mode(rows.filter((r) => re.test(String(r.k.location_name || ''))).map((r) => r.k.intent_type)).value;

  const row = {
    user_id: userId,
    morning_intent: mode(byBucket.morning).value,
    afternoon_intent: mode(byBucket.afternoon).value,
    evening_intent: mode(byBucket.evening).value,
    night_intent: mode(byBucket.night).value,
    office_intent: place(/office|work|ఆఫీస్|ऑफिस/i),
    home_intent: place(/home|house|ఇల్లు|ఇంటి|घर/i),
    top_intents,
    language_preference: mode(rows.map((r) => scriptLang(r.k.voice_text || r.k.content))).value,
    voice_capture_daily_avg: activeDays ? Math.round(rows.length / activeDays) : 0,
    most_active_hour: rows.length ? Number(mode(rows.map((r) => r.p.hour)).value) : null,
    last_updated: now.toISOString(),
  };

  // ── habits ──
  const found = [];
  const groupBy = (list, keyFn) => {
    const m = new Map();
    for (const r of list) { const k = keyFn(r); if (!k) continue; if (!m.has(k)) m.set(k, []); m.get(k).push(r); }
    return m;
  };

  // 1. Whom they call, and when.
  for (const [name, group] of groupBy(rows.filter((r) => r.k.contact_name), (r) => slug(r.k.contact_name))) {
    const s = summarise(group, now);
    if (s.days < MIN_DAYS_FOR_HABIT) continue;
    found.push({ id: `call:${name}:${s.bucket}`, kind: 'call', name: group[0].k.contact_name, ...s });
  }
  // 2. What they do, at what part of the day (and on which weekday, if fixed).
  for (const [key, group] of groupBy(rows, (r) => `${r.k.intent_type || 'note'}|${r.p.bucket}`)) {
    const s = summarise(group, now);
    if (s.days < MIN_DAYS_FOR_HABIT) continue;
    const intent = key.split('|')[0];
    found.push({ id: `action:${intent}:${s.bucket}${s.dow !== null ? `:d${s.dow}` : ''}`, kind: 'action', intent, ...s });
  }
  // 3. Places they keep things for.
  for (const [placeName, group] of groupBy(rows.filter((r) => r.k.location_name), (r) => slug(r.k.location_name))) {
    const s = summarise(group, now);
    if (s.days < 2) continue;
    found.push({ id: `place:${placeName}`, kind: 'place', name: group[0].k.location_name, ...s });
  }
  // 4. Contacts the voice route counted often (behavior_patterns), if the keeps missed them.
  for (const p of patterns) {
    if (p?.pattern_type !== 'contact' || (p.frequency || 0) < MIN_DAYS_FOR_HABIT) continue;
    const name = p.metadata?.contact_name || p.location_name;
    if (!name || found.some((h) => h.kind === 'call' && slug(h.name) === slug(name))) continue;
    const bucket = BUCKETS.includes(p.time_bucket) ? p.time_bucket : null;
    found.push({
      id: `call:${slug(name)}:${bucket || 'any'}`, kind: 'call', name, days: p.frequency, count: p.frequency,
      bucket, hour: null, dow: null, last_seen: p.last_seen_at,
      confidence: habitConfidence(p.frequency, p.last_seen_at || now.toISOString(), now),
    });
  }

  // Keep the person's earlier answers (hybrid: never ask twice).
  const before = new Map((previous || []).map((h) => [h.id, h]));
  const habits = found
    .map((h) => ({
      ...h,
      status: before.get(h.id)?.status || 'learned',
      first_seen: before.get(h.id)?.first_seen || now.toISOString(),
    }))
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 40);
  // The person's own answers outlive the data: a declined or forgotten habit is
  // never offered again, a confirmed one is kept (fading lowers its confidence),
  // and anything they taught Aaria directly ("remember that...") stays.
  for (const h of previous || []) {
    if (!h?.id || habits.some((x) => x.id === h.id)) continue;
    if (['declined', 'forgotten', 'confirmed'].includes(h.status) || h.kind === 'fact') {
      habits.push(h.kind === 'fact' || !h.last_seen ? h : { ...h, confidence: habitConfidence(h.days || 1, h.last_seen, now) });
    }
  }

  return { row, habits };
}

/** True when the stored profile is older than 6 hours (or missing). */
export function needsRefresh(lastUpdatedIso, now = new Date()) {
  if (!lastUpdatedIso) return true;
  return now.getTime() - new Date(lastUpdatedIso).getTime() > REFRESH_AFTER_MS;
}

/**
 * Read the person's data, build the profile, save it. Server-side only (service role).
 * Never throws: learning must never break a voice turn.
 */
export async function refreshTauProfile(db, userId, { now = new Date(), force = false } = {}) {
  if (!db || !userId) return { ok: false, reason: 'no_user' };
  try {
    const { data: existing } = await db.from('tau_behaviour_profile')
      .select('*').eq('user_id', userId).maybeSingle();
    if (!force && existing && !needsRefresh(existing.last_updated, now)) return { ok: true, skipped: 'fresh' };

    const since = new Date(now.getTime() - PROFILE_WINDOW_DAYS * DAY_MS).toISOString();
    const [{ data: keeps }, { data: patterns }] = await Promise.all([
      db.from('keeps')
        .select('intent_type,created_at,contact_name,location_name,voice_text,content,status')
        .eq('user_id', userId).gte('created_at', since)
        .order('created_at', { ascending: false }).limit(1000),
      db.from('behavior_patterns')
        .select('pattern_type,location_name,time_bucket,frequency,last_seen_at,metadata')
        .eq('user_id', userId).eq('pattern_type', 'contact').limit(100),
    ]);

    const { row, habits } = buildTauProfile({
      userId, keeps: keeps || [], patterns: patterns || [], previous: existing?.habits || [], now,
    });
    if (!(keeps || []).length) return { ok: true, skipped: 'no_data' };

    let { error } = await db.from('tau_behaviour_profile').upsert({ ...row, habits }, { onConflict: 'user_id' });
    // The habits column arrives with migration 20261122_tau_profile_habits.sql.
    // Until it is applied, save the profile row alone so nothing breaks.
    if (error && /habits/i.test(error.message || '')) {
      ({ error } = await db.from('tau_behaviour_profile').upsert(row, { onConflict: 'user_id' }));
    }
    if (error) return { ok: false, reason: error.message };
    return { ok: true, habits: habits.length };
  } catch (e) {
    return { ok: false, reason: e?.message || 'error' };
  }
}

// ── T29: learning modes (founder decision 22 Nov: hybrid by default) ─────────
// hybrid    - learns alone; the first time she wants to use a learned habit she
//             asks once; yes = she acts on it from then on, no = never again.
// ask_first - for people not yet ready: she never uses what she learned until
//             they approve it on the "What Aaria learned" page; they can teach
//             her directly.
// let_act   - for confident people: sure habits are used straight away.
// Safety does not change in any mode: money, sharing location and calling an
// unknown number still need the fingerprint; SOS is never blocked.
export const LEARNING_MODES = ['hybrid', 'ask_first', 'let_act'];
export const DEFAULT_LEARNING_MODE = 'hybrid';
export const OFFER_AT = 0.6;   // sure enough to offer (hybrid)
export const ACT_AT = 0.75;    // sure enough to act without asking (let_act)

export function normaliseMode(mode) {
  return LEARNING_MODES.includes(mode) ? mode : DEFAULT_LEARNING_MODE;
}

/** What Aaria may do with one habit: 'act' | 'offer' | 'none'. */
export function decideHabitUse(habit, mode) {
  if (!habit) return 'none';
  const m = normaliseMode(mode);
  if (['declined', 'forgotten'].includes(habit.status)) return 'none';
  if (habit.status === 'confirmed' || habit.kind === 'fact') return 'act';
  if (m === 'ask_first') return 'none';
  const c = Number(habit.confidence) || 0;
  if (m === 'let_act') return c >= ACT_AT ? 'act' : c >= OFFER_AT ? 'offer' : 'none';
  return c >= OFFER_AT ? 'offer' : 'none'; // hybrid
}

/** Apply the person's answer to one habit. Returns a new array. */
export function answerHabit(habits, id, action, now = new Date()) {
  const to = { confirm: 'confirmed', decline: 'declined', forget: 'forgotten' }[action];
  if (!to) return habits || [];
  return (habits || []).map((h) => (h.id === id ? { ...h, status: to, answered_at: now.toISOString() } : h));
}

/** Something the person tells Aaria directly ("my office is in Hitech City"). */
export function teachFact(habits, text, now = new Date()) {
  const clean = String(text || '').trim().slice(0, 200);
  if (!clean) return habits || [];
  const id = `fact:${slug(clean)}`;
  if ((habits || []).some((h) => h.id === id)) return habits;
  return [...(habits || []), { id, kind: 'fact', text: clean, status: 'confirmed', confidence: 1, first_seen: now.toISOString() }];
}

const BUCKET_WORDS = { morning: 'in the morning', afternoon: 'in the afternoon', evening: 'in the evening', night: 'at night' };
const DAY_WORDS = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];
const INTENT_WORDS = {
  reminder: 'set reminders', task: 'add tasks', note: 'save notes', expense: 'log expenses', contact: 'call people',
  call: 'call people', navigation: 'ask for directions', trip: 'plan trips', meeting: 'note meetings', purchase: 'note things to buy',
  invoice: 'make invoices', document: 'save documents',
};
const clock = (h) => (h === null || h === undefined ? '' : ` (around ${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? 'am' : 'pm'})`);

/** One plain sentence for the "What Aaria learned" page. */
export function habitSentence(h) {
  if (!h) return '';
  if (h.kind === 'fact') return h.text;
  const when = `${h.dow !== null && h.dow !== undefined ? `on ${DAY_WORDS[h.dow]} ` : ''}${BUCKET_WORDS[h.bucket] || ''}`.trim();
  if (h.kind === 'call') return `You usually call ${h.name}${when ? ` ${when}` : ''}${clock(h.hour)}.`;
  if (h.kind === 'place') return `You often keep things for ${h.name}.`;
  return `You usually ${INTENT_WORDS[h.intent] || `use "${h.intent}"`}${when ? ` ${when}` : ''}${clock(h.hour)}.`;
}
