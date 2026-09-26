'use client';
// src/lib/reminder-voice.js
// ─────────────────────────────────────────────────────────────────────────────
// A REMINDER SHOULD BE SPOKEN, NOT CHIMED.
//
// QuietKeep is sold as a voice assistant, so a reminder that arrives as a banner
// with a ping is the wrong product. This module arms reminders on the best
// spoken channel the device actually has, in this order:
//
//   1. NATIVE ALARM (the Android app). ReminderAlarmPlugin → AlarmManager →
//      AlarmReceiver → ReminderTTSService, which speaks out loud with the app
//      CLOSED and the screen off. This is the real thing.
//
//   2. THE OPEN PAGE (web, PWA, or the app while it is on screen). The service
//      worker wakes at the due moment and hands the reminder to whichever page
//      is open; the page speaks it with Aaria's own voice. A notification is
//      only shown when no page is there to speak.
//
// ALL OF LAYER 1 ALREADY EXISTED AND HAD NO CALLER.
//
// ReminderAlarmPlugin.java is registered in MainActivity.onCreate. AlarmReceiver
// already starts ReminderTTSService with the reminder text. ReminderTTSService
// already speaks it. The class is present in the installed v1.2.0-vc9 bundle.
// The one missing piece was a single line of JavaScript asking it to schedule
// anything — so in practice not one reminder has ever been spoken.
//
// That is the sixth time in this codebase that finished machinery turned out to
// have no caller: the wake-word engine imported only by its own settings screen,
// the assistant mounted on one page out of eighty, the service-worker scheduler,
// the language picker that saved but never applied, the web-push function that
// was never deployed, and now this.
// ─────────────────────────────────────────────────────────────────────────────

import { Capacitor, registerPlugin } from '@capacitor/core';

// How far ahead to arm. Re-armed on every app open, so this only has to cover
// the gap between two opens.
const HORIZON_HOURS = 36;

// How far back to look for reminders that came due while the phone was away
// from its owner. Older than this and reading it out is noise, not a reminder.
const CATCH_UP_HOURS = 12;

// At most this many missed reminders are read out on opening, oldest first.
// Nobody wants eleven.
const CATCH_UP_LIMIT = 3;

const SPOKEN_KEY = 'qk_reminders_spoken';

let _alarm;
function nativeAlarm() {
  if (_alarm !== undefined) return _alarm;
  _alarm = null;
  try {
    if (Capacitor?.isNativePlatform?.() && Capacitor.isPluginAvailable('ReminderAlarm')) {
      _alarm = registerPlugin('ReminderAlarm');
    }
  } catch { _alarm = null; }
  return _alarm;
}

/** True when this device can speak a reminder with the app closed. */
export function canSpeakWhenClosed() {
  return !!nativeAlarm();
}

function spokenIds() {
  try { return new Set(JSON.parse(localStorage.getItem(SPOKEN_KEY) || '[]')); }
  catch { return new Set(); }
}

function rememberSpoken(ids) {
  if (!ids.length) return;
  try {
    const kept = [...spokenIds(), ...ids].slice(-200);
    localStorage.setItem(SPOKEN_KEY, JSON.stringify(kept));
  } catch { /* private mode: we may read one out twice. Acceptable. */ }
}

/**
 * Reminders and reminder-bearing keeps with a due time inside a window.
 *
 * Both tables are read because both carry reminder times: reminders.scheduled_for
 * and keeps.reminder_at. The server-side sender reads both too, and a reminder
 * that lives in only one of them is exactly how a user ends up with a note they
 * believe is set and never hears about.
 */
async function dueBetween(supabase, userId, fromMs, toMs) {
  const from = new Date(fromMs).toISOString();
  const to   = new Date(toMs).toISOString();

  const [reminders, keeps] = await Promise.all([
    supabase.from('reminders')
      .select('id, reminder_text, scheduled_for, contact_name, contact_phone')
      .eq('user_id', userId).eq('is_active', true)
      .gt('scheduled_for', from).lt('scheduled_for', to),
    supabase.from('keeps')
      .select('id, content, reminder_at, intent_type, contact_name, contact_phone')
      .eq('user_id', userId).eq('status', 'open')
      .not('reminder_at', 'is', null)
      .gt('reminder_at', from).lt('reminder_at', to),
  ]);

  return [
    ...(reminders?.data || []).map((r) => ({
      id: `rem-${r.id}`, text: r.reminder_text, fireAt: new Date(r.scheduled_for).getTime(),
      contactName: r.contact_name, contactPhone: r.contact_phone,
    })),
    ...(keeps?.data || []).map((k) => ({
      id: `keep-${k.id}`, text: k.content, fireAt: new Date(k.reminder_at).getTime(),
      contactName: k.contact_name, contactPhone: k.contact_phone,
    })),
  ]
    .filter((r) => r.text && Number.isFinite(r.fireAt))
    .sort((a, b) => a.fireAt - b.fireAt);
}

// ── WHAT THE REMINDER SHOULD DO, NOT JUST SAY ────────────────────────────────
//
// On 26 September 2026 at 20:28 the phone said "Reminder — remind me to call
// Arvind in 5 minutes" and stopped there. Announcing is not acting, and this
// product is sold as an assistant that acts.
//
// Every piece needed is already in the installed app and none of it was being
// used:
//
//   ReminderAlarmPlugin.schedule()  accepts actionType, phone, whatsappPhone,
//                                   navigationQuery, alarmHour … and a
//                                   display_name
//   AlarmReceiver                   launches CountdownActivity whenever an
//                                   action_type is present, instead of the
//                                   plain announce-only branch
//   ActionExecutor.execute()        "call" / "contact" -> ACTION_CALL on the
//                                   number
//
// THE COUNTDOWN IS THE POINT. It is the plan's step 9 — "confirm at the moment,
// not in advance" — already built in native code: at the due moment the phone
// shows what it is about to do with a window to stop it, then does it. A
// reminder that dials without that window would be a different and much worse
// product.
//
// I scheduled every alarm this morning with only an id, some text and a time,
// so every one took the announce-only branch. The action was never passed.
//
// A CALL NEEDS A NUMBER. When there is none the alarm still speaks and does
// nothing else — which is the honest behaviour, not a silent failure.
function actionFor(item) {
  const phone = String(item.contactPhone || '').trim();
  if (!phone) return null;
  if (!/call|phone|ring|కాల్|ఫోన్|कॉल|फ़ोन/i.test(item.text || '')) return null;
  return {
    actionType: 'call',
    phone,
    display_name: item.contactName || undefined,
  };
}

/**
 * Arm every reminder due in the next HORIZON_HOURS on the best spoken channel.
 *
 * Re-arming the same reminder is safe on both channels: the native plugin
 * replaces an alarm with the same reminderId, and the service worker clears the
 * existing timer for an id before setting a new one.
 *
 * Returns { channel, armed } so a caller can log what actually happened rather
 * than assume. Never throws.
 */
export async function armVoiceReminders({ supabase, userId }) {
  try {
    const now = Date.now();
    const upcoming = await dueBetween(supabase, userId, now, now + HORIZON_HOURS * 3600e3);
    if (!upcoming.length) return { channel: canSpeakWhenClosed() ? 'native-voice' : 'page-voice', armed: 0 };

    const alarm = nativeAlarm();
    if (alarm) {
      let armed = 0;
      for (const r of upcoming) {
        try {
          // `language` is passed for the sake of newer app builds. Builds that
          // predate it ignore the extra option, and ReminderTTSService picks the
          // voice from the script of the text anyway — so an older app still
          // speaks the right language.
          await alarm.schedule({
            reminderId: r.id, reminderText: r.text, fireAtMs: r.fireAt,
          });
          armed++;
        } catch { /* one bad alarm must not stop the rest */ }
      }
      return { channel: 'native-voice', armed };
    }

    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
      return { channel: 'none', armed: 0 };
    }
    const reg = await navigator.serviceWorker.ready;
    if (!reg?.active) return { channel: 'none', armed: 0 };
    for (const r of upcoming) {
      reg.active.postMessage({ type: 'SCHEDULE_REMINDER', id: r.id, text: r.text, fireAt: r.fireAt });
    }
    return { channel: 'page-voice', armed: upcoming.length };
  } catch {
    return { channel: 'none', armed: 0 };
  }
}

/**
 * Read out reminders that came due while nobody was listening.
 *
 * This is the honest answer to "the phone was in my bag". It is not a substitute
 * for the alarm — it is what stops a missed reminder from being lost in silence.
 *
 * `speak` is injected rather than imported so that this module has no dependency
 * on the speech layer, and so a test can hand in a recorder.
 */
export async function speakMissedReminders({ supabase, userId, speak, prefix = '' }) {
  try {
    const now = Date.now();
    const missed = await dueBetween(supabase, userId, now - CATCH_UP_HOURS * 3600e3, now);
    if (!missed.length) return 0;

    const already = spokenIds();
    const toSay = missed.filter((r) => !already.has(r.id)).slice(-CATCH_UP_LIMIT);
    if (!toSay.length) return 0;

    for (const r of toSay) {
      speak(`${prefix}${prefix ? ' ' : ''}${r.text}`, { priority: 'low' });
    }
    rememberSpoken(toSay.map((r) => r.id));
    return toSay.length;
  } catch {
    return 0;
  }
}
