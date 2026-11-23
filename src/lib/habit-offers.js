// src/lib/habit-offers.js
// T31 (23 Nov 2026): Aaria offers help from what she learned, at the right moment.
//
// Founder decisions (22 Nov): she offers "whenever she is sure" (no fixed daily
// limit); hybrid by default — she asks ONCE before acting on a learned habit;
// "Let her act" users get it done straight away; "Ask me first" users only via
// the "What Aaria learned" page. Safety never changes: this file only ever
// creates REMINDERS (a safe, undoable action). Money, location sharing and
// unknown-number calls are not touched here and keep their fingerprint rules.
//
// What "yes" does: the habit becomes a repeating reminder (T30) at the habit's
// time — "You usually call Amma around 8 pm" -> a daily 8 pm reminder "Call Amma"
// with the contact attached, so the alarm can offer to dial.

import { decideHabitUse, habitSentence } from './tau-profile.js';

const TZ_OFFSET_MIN = 330;            // India
const ASK_AGAIN_AFTER_DAYS = 7;       // a habit offered and not answered is not re-asked for a week
const DEFAULT_HOUR = { morning: 9, afternoon: 14, evening: 19, night: 21 };
const DAY_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_TE = ['ఆదివారం', 'సోమవారం', 'మంగళవారం', 'బుధవారం', 'గురువారం', 'శుక్రవారం', 'శనివారం'];
const DAY_HI = ['रविवार', 'सोमवार', 'मंगलवार', 'बुधवार', 'गुरुवार', 'शुक्रवार', 'शनिवार'];

const INTENT_TASK = {
  expense: { en: 'Log today\'s expenses', te: 'ఈరోజు ఖర్చులు నమోదు చేయండి', hi: 'आज के खर्च लिखिए' },
  task: { en: 'Check today\'s tasks', te: 'ఈరోజు పనులు చూడండి', hi: 'आज के काम देखिए' },
  reminder: { en: 'Your usual reminder time', te: 'మీ రోజువారీ గుర్తు సమయం', hi: 'आपका रोज़ का याद समय' },
};

/** What a "yes" creates, or null when this habit cannot become a reminder. */
export function planForHabit(h) {
  if (!h || !['call', 'action'].includes(h.kind)) return null;
  if (h.kind === 'action' && !INTENT_TASK[h.intent]) return null;
  const hour = Number.isInteger(h.hour) ? h.hour : DEFAULT_HOUR[h.bucket];
  if (!Number.isInteger(hour)) return null;
  const weekly = h.dow !== null && h.dow !== undefined;
  return {
    recurrence: weekly ? 'weekly' : 'daily',
    hour, minute: 0, dow: weekly ? h.dow : null,
    text: h.kind === 'call' ? `Call ${h.name}` : INTENT_TASK[h.intent].en,
    textByLang: h.kind === 'call'
      ? { en: `Call ${h.name}`, te: `${h.name}కి కాల్ చేయండి`, hi: `${h.name} को कॉल कीजिए` }
      : INTENT_TASK[h.intent],
    contact_name: h.kind === 'call' ? h.name : null,
  };
}

/** The next instant at hour:minute India time (on weekday `dow` if given), after now. */
export function nextAt(hour, minute = 0, dow = null, now = new Date()) {
  const local = new Date(now.getTime() + TZ_OFFSET_MIN * 60000);       // shifted clock, read with UTC getters
  const t = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), hour, minute) - TZ_OFFSET_MIN * 60000);
  let at = t;
  let guard = 0;
  while ((at.getTime() <= now.getTime() || (dow !== null && dow !== undefined
    && new Date(at.getTime() + TZ_OFFSET_MIN * 60000).getUTCDay() !== dow)) && guard++ < 8) {
    at = new Date(at.getTime() + 864e5);
  }
  return at;
}

const clock = (hour, lang) => {
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  if (lang === 'te') return `${hour < 12 ? 'ఉదయం' : hour < 16 ? 'మధ్యాహ్నం' : hour < 20 ? 'సాయంత్రం' : 'రాత్రి'} ${h12} గంటలకు`;
  if (lang === 'hi') return `${hour < 12 ? 'सुबह' : hour < 16 ? 'दोपहर' : hour < 20 ? 'शाम' : 'रात'} ${h12} बजे`;
  return `${h12} ${hour < 12 ? 'am' : 'pm'}`;
};

/** The question Aaria asks once (hybrid). Telugu, Hindi, English; English for other languages for now. */
export function offerQuestion(h, lang = 'en') {
  const plan = planForHabit(h);
  if (!plan) return null;
  const L = ['te', 'hi'].includes(String(lang).slice(0, 2)) ? String(lang).slice(0, 2) : 'en';
  const when = clock(plan.hour, L);
  const weekly = plan.recurrence === 'weekly';
  if (h.kind === 'call') {
    if (L === 'te') return weekly
      ? `మీరు సాధారణంగా ${DAY_TE[plan.dow]} ${when} ${h.name}కి కాల్ చేస్తారు. ప్రతి ${DAY_TE[plan.dow]} గుర్తు చేయనా?`
      : `మీరు సాధారణంగా ${when} ${h.name}కి కాల్ చేస్తారు. ప్రతి రోజు గుర్తు చేయనా?`;
    if (L === 'hi') return weekly
      ? `आप अक्सर ${DAY_HI[plan.dow]} ${when} ${h.name} को कॉल करते हैं। क्या हर ${DAY_HI[plan.dow]} याद दिलाऊँ?`
      : `आप अक्सर ${when} ${h.name} को कॉल करते हैं। क्या रोज़ याद दिलाऊँ?`;
    return weekly
      ? `You usually call ${h.name} on ${DAY_EN[plan.dow]}s around ${when}. Shall I remind you every ${DAY_EN[plan.dow]}?`
      : `You usually call ${h.name} around ${when}. Shall I remind you every day?`;
  }
  const what = plan.textByLang[L] || plan.text;
  if (L === 'te') return weekly
    ? `ప్రతి ${DAY_TE[plan.dow]} ${when} "${what}" అని గుర్తు చేయనా?`
    : `ప్రతి రోజు ${when} "${what}" అని గుర్తు చేయనా?`;
  if (L === 'hi') return weekly
    ? `क्या हर ${DAY_HI[plan.dow]} ${when} "${what}" याद दिलाऊँ?`
    : `क्या रोज़ ${when} "${what}" याद दिलाऊँ?`;
  return weekly
    ? `${habitSentence(h)} Shall I remind you every ${DAY_EN[plan.dow]} at ${when}?`
    : `${habitSentence(h)} Shall I remind you every day at ${when}?`;
}

/** What she says after "yes" / "no", in the same language. */
export function answerLine(answer, lang = 'en') {
  const L = String(lang).slice(0, 2);
  if (answer === 'yes') return L === 'te' ? 'సరే, అలాగే గుర్తు చేస్తాను.' : L === 'hi' ? 'ठीक है, याद दिलाया जाएगा।' : 'Done — I\'ll remind you.';
  return L === 'te' ? 'సరే, మళ్ళీ అడగను.' : L === 'hi' ? 'ठीक है, फिर नहीं पूछूँगी।' : 'Okay, I won\'t ask again.';
}

/**
 * The one habit worth offering right now, or null.
 * "Right moment" = within the 3 hours before the habit's usual time, so the
 * reminder is still useful today. Sure enough = decideHabitUse() says 'offer'.
 */
export function pickOffer(habits, mode, now = new Date()) {
  const localHour = new Date(now.getTime() + TZ_OFFSET_MIN * 60000).getUTCHours();
  const localDow = new Date(now.getTime() + TZ_OFFSET_MIN * 60000).getUTCDay();
  const cutoff = now.getTime() - ASK_AGAIN_AFTER_DAYS * 864e5;
  const candidates = (habits || []).filter((h) => {
    if (decideHabitUse(h, mode) !== 'offer') return false;
    if (h.reminder_id) return false;
    if (h.asked_at && Date.parse(h.asked_at) > cutoff) return false;
    const plan = planForHabit(h);
    if (!plan) return false;
    if (plan.dow !== null && plan.dow !== localDow) return false;
    return localHour >= plan.hour - 3 && localHour < plan.hour;
  });
  candidates.sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
  return candidates[0] || null;
}

/** Habits Aaria may set up straight away ("Let her act", or already confirmed but not yet set up). */
export function habitsToActOn(habits, mode) {
  return (habits || []).filter((h) => decideHabitUse(h, mode) === 'act' && h.kind !== 'fact' && !h.reminder_id && planForHabit(h));
}

/**
 * Turn a habit into its repeating reminder. Returns the new reminder id or null.
 * `db` is the person's own client (RLS) or the service client (nightly job).
 */
export async function createHabitReminder(db, userId, habit, now = new Date()) {
  const plan = planForHabit(habit);
  if (!db || !userId || !plan) return null;
  try {
    const at = nextAt(plan.hour, plan.minute, plan.dow, now);
    // The id is chosen here so the habit can always find (and switch off) its reminder.
    const id = globalThis.crypto?.randomUUID?.();
    const { data, error } = await db.from('reminders').insert({
      ...(id ? { id } : {}),
      user_id: userId,
      reminder_text: plan.text,
      title: plan.text,
      scheduled_for: at.toISOString(),
      recurrence: plan.recurrence,
      is_active: true,
      space_type: 'personal',
      contact_name: plan.contact_name,
    }).select('id').maybeSingle();
    if (error) return null;
    return data?.id || id || null;
  } catch {
    return null;
  }
}

/** Switch off the reminder a habit created (when the person says no or forget). */
export async function stopHabitReminder(db, habit) {
  if (!db || !habit?.reminder_id || String(habit.reminder_id).startsWith('pending-')) return;
  try { await db.from('reminders').update({ is_active: false, updated_at: new Date().toISOString() }).eq('id', habit.reminder_id); } catch { }
}


// T31: a spoken yes / no to the one habit Aaria just offered (Telugu, Hindi, English).
const OFFER_NO = /^\s*(no|nope|nah|vaddu|vadhu|kaadu|nahi|nahin|mat)\b|^\s*(వద్దు|కాదు|లేదు|नहीं|ना|मत)/i;
const OFFER_YES = /^\s*(yes|yeah|yep|ok|okay|sure|please|avunu|avnu|haan|han|ha|ji|theek hai|thik hai|cheyyi|cheyi)\b|^\s*(అవును|సరే|చేయి|చేయండి|హా|हाँ|हां|जी|ठीक है|ज़रूर|जरूर)/i;
export function offerAnswer(text) {
  const t = String(text || '').trim();
  if (!t || t.split(/\s+/).length > 5) return null;
  if (OFFER_NO.test(t)) return 'no';
  if (OFFER_YES.test(t)) return 'yes';
  return null;
}
