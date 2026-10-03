// src/lib/reminder-arm.js
// The decisions made when reminders are handed to the phone's alarm, kept free
// of anything that needs a phone so they can be tested with plain node.
// Used by src/lib/reminder-voice.js.

// One spoken reminder is usually stored twice: a row in `reminders` and the
// keep it came from (keeps.reminder_at). Both were being armed, as "rem-<id>"
// and "keep-<id>", so the phone fired two alarms at the same second - the
// reminder was spoken twice over itself and, for a call, the countdown screen
// was opened twice.
//
// A keep is dropped when a reminder row for that same keep is due within a
// minute of it. The reminder row is the one kept, because it is the one that
// can be marked finished. If only the keep knows the number, it is carried
// across - losing the number would turn a call back into an announcement.
const TWIN_WINDOW_MS = 60 * 1000;

export function dedupeTwins(items) {
  const list = Array.isArray(items) ? items.filter(Boolean) : [];
  const reminders = list.filter((r) => String(r.id || '').startsWith('rem-'));
  const out = [];
  for (const item of list) {
    const isKeep = String(item.id || '').startsWith('keep-');
    if (!isKeep) { out.push(item); continue; }
    const twin = reminders.find((r) =>
      r.keepId && item.keepId && r.keepId === item.keepId
      && Math.abs(Number(r.fireAt) - Number(item.fireAt)) <= TWIN_WINDOW_MS);
    if (!twin) { out.push(item); continue; }
    if (!String(twin.contactPhone || '').trim() && String(item.contactPhone || '').trim()) {
      twin.contactPhone = item.contactPhone;
      if (!twin.contactName) twin.contactName = item.contactName;
    }
  }
  return out;
}

// A CALL NEEDS A NUMBER AND THE WORD. With no number the alarm still speaks
// and does nothing else - the honest behaviour, not a silent failure.
export function actionFor(item) {
  const phone = String(item?.contactPhone || '').trim();
  if (!phone) return null;
  if (!/call|phone|ring|కాల్|ఫోన్|कॉल|फ़ोन/i.test(item?.text || '')) return null;
  return {
    actionType: 'call',
    phone,
    display_name: item.contactName || undefined,
  };
}

// What the phone noted the last time an alarm fired (AlarmTrail.java), reduced
// to the fields worth keeping. Anything not on this list is dropped, so a
// future field on the phone cannot leak into the audit row by accident.
const REPORT_FIELDS = [
  'reminder_id', 'fired_at', 'action_type', 'has_phone',
  'fullscreen_allowed', 'notification_posted', 'notifications_enabled',
  'channel_importance', 'direct_start',
  'countdown_shown_at', 'countdown_result', 'call_permission',
  'now_fullscreen_allowed', 'now_notifications_enabled', 'now_exact_alarms',
  'now_call_permission', 'android_sdk', 'error',
];

export function alarmReport(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const key of REPORT_FIELDS) {
    const v = raw[key];
    if (v === undefined || v === null || v === '') continue;
    out[key] = String(v).slice(0, 120);
  }
  return out;
}

// A report is sent once for each distinct state, not on every app open.
export function reportSignature(report) {
  return REPORT_FIELDS.map((k) => `${k}=${report?.[k] ?? ''}`).join('|');
}
