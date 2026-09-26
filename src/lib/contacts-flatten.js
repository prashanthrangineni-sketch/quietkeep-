// src/lib/contacts-flatten.js
// ─────────────────────────────────────────────────────────────────────────────
// One shape on each side of contact sync, and the function that bridges them.
//
// The Android plugin resolves a contact per person, with arrays inside:
//
//   { name: "Aravind", phones: ["+91 98765 43210", "040 2345 6789"],
//                      emails: ["aravind@example.com"] }
//
// /api/contacts/sync accepts a flat row per number:
//
//   { name: "Aravind", phone: "+91 98765 43210", email: "aravind@example.com" }
//
// Nothing has ever converted between the two, which is the whole reason the
// contacts table is empty and "remind me to call Aravind" has no number to dial.
//
// A person with two numbers becomes two rows with the same name. That is
// deliberate: the API dedups on (user_id, phone), so both numbers survive, and
// matchContactByName() can then offer a choice instead of a number being
// silently dropped. The old inline version in the Contacts page took phones[0]
// and discarded the rest.
//
// THIS FILE IMPORTS NOTHING. It is loaded by the browser bundle, by the
// Capacitor WebView, and by plain `node` in tests/contacts-flatten.test.mjs.
// An import of '@capacitor/core' here would break the test run — that exact
// mistake cost a CI failure on 26 September.
// ─────────────────────────────────────────────────────────────────────────────

/** Mirrors MAX_BATCH in src/app/api/contacts/sync/route.js. */
export const MAX_CONTACTS = 2000;

function trimmedStrings(...values) {
  const out = [];
  for (const value of values) {
    const list = Array.isArray(value) ? value : [value];
    for (const item of list) {
      if (item === null || item === undefined) continue;
      const s = String(item).trim();
      if (s) out.push(s);
    }
  }
  return out;
}

/** Digits only, so "+91 98765 43210" and "09876543210" are seen as one number. */
function phoneKey(phone) {
  const digits = String(phone).replace(/\D/g, '');
  return digits.length > 10 ? digits.slice(-10) : digits;
}

/**
 * Device contacts -> rows the sync API accepts.
 *
 * Accepts both the native plugin shape ({ name, phones: [], emails: [] }) and
 * the flat shape ({ name, phone, email }), because the web contact picker and
 * the older inline code produce the latter.
 *
 * Drops: entries with no name, and entries with no number at all — a name
 * without a number cannot be called, messaged or dialled from a reminder, so
 * storing it would only inflate the count we report back to the user.
 */
export function flattenContacts(raw, { limit = MAX_CONTACTS } = {}) {
  const rows = [];
  const seen = new Set();

  for (const c of Array.isArray(raw) ? raw : []) {
    const name = String(c?.name ?? '').trim();
    if (!name) continue;

    const phones = trimmedStrings(c?.phones, c?.phone);
    if (!phones.length) continue;
    const emails = trimmedStrings(c?.emails, c?.email);

    let kept = 0;
    for (const phone of phones) {
      const key = `${name.toLowerCase()}|${phoneKey(phone)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      // Only the first surviving row carries the email. Repeating it on every
      // number is noise, and the API keeps one row per phone.
      rows.push({ name, phone, email: kept === 0 ? (emails[0] || null) : null });
      kept += 1;
      if (rows.length >= limit) return rows;
    }
  }

  return rows;
}

export default flattenContacts;
