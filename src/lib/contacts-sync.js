// src/lib/contacts-sync.js
// ─────────────────────────────────────────────────────────────────────────────
// The one call that was missing.
//
// WHAT WAS ALREADY BUILT, AND NEVER JOINED
//   * android/app/src/main/java/com/pranix/quietkeep/plugins/ContactsPlugin.java
//     A registered Capacitor plugin. It asks for READ_CONTACTS itself and
//     resolves { contacts: [{ name, phones: [...], emails: [...] }] }.
//     Present in the installed v1.2.0-vc9 bundle. Never once called.
//   * src/app/api/contacts/sync/route.js
//     Accepts { contacts: [{ name, phone, email }], consent: true }, normalises
//     Indian numbers, upserts on (user_id, phone), links khata customers.
//     Never once called from the app either.
//
// WHY NEITHER FIRED
// The Contacts page tested for `window.__QK_CONTACTS__.getAll` — a plain
// JavaScript bridge object that is not defined anywhere in this repository or in
// the Android project — and otherwise fell back to navigator.contacts, which a
// Capacitor WebView does not expose. So inside the QuietKeep Android app the
// page told the user that phonebook sync "needs the QuietKeep Android app", and
// the contacts table stayed empty for every real user.
//
// A Capacitor plugin is reachable only through registerPlugin(). That is the
// wire. Everything else here is guards and honesty about what happened.
//
// WHY IT MATTERS NOW
// On 26 September a reminder fired on the founder's phone with the app closed
// and said "Reminder — remind me to call Aravind in five minutes", and stopped
// there. reminder-voice.js will attach a dial action to an alarm, but only when
// the reminder carries a number. With an empty contacts table there is no number
// to carry, so the assistant can only ever narrate the instruction back.
//
// CONSENT
// /api/contacts/sync refuses anything without consent === true, and that is
// correct: reading someone's whole phonebook is not a side effect of opening a
// screen. This module never assumes consent. The caller passes it, having shown
// a disclosure, and the Android permission dialog is the second gate. Nothing
// here syncs on mount.
// ─────────────────────────────────────────────────────────────────────────────

import { Capacitor, registerPlugin } from '@capacitor/core';
import { flattenContacts, MAX_CONTACTS } from './contacts-flatten.js';

export { flattenContacts, MAX_CONTACTS };

let _plugin;   // undefined = not looked for yet, null = not available

/** The real native plugin, or null off-device. Looked up once. */
function nativePlugin() {
  if (_plugin !== undefined) return _plugin;
  _plugin = null;
  try {
    if (Capacitor?.isNativePlatform?.() && Capacitor.isPluginAvailable('ContactsPlugin')) {
      _plugin = registerPlugin('ContactsPlugin');
    }
  } catch {
    _plugin = null;
  }
  return _plugin;
}

/** The legacy bridge the Contacts page used to look for. Kept as a fallback. */
function legacyBridge() {
  if (typeof window === 'undefined') return null;
  const fn = window.__QK_CONTACTS__?.getAll;
  return typeof fn === 'function' ? window.__QK_CONTACTS__ : null;
}

function webPickerAvailable() {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  return 'contacts' in navigator
    && 'ContactsManager' in window
    && typeof navigator.contacts?.select === 'function';
}

/**
 * Which route is available here, best first.
 *   'native' — the whole phonebook, re-syncable, permission persists.
 *   'web'    — the browser picker; the user multi-selects, nothing persists.
 *   null     — neither. Say so; do not offer a button that cannot work.
 *
 * Call this from an effect, not during render: on the server it is always null,
 * and returning a different answer after hydration is a mismatch.
 */
export function contactSource() {
  if (nativePlugin() || legacyBridge()) return 'native';
  if (webPickerAvailable()) return 'web';
  return null;
}

export function canSyncContacts() {
  return contactSource() !== null;
}

/**
 * Read the device phonebook and return rows /api/contacts/sync accepts.
 *
 * On Android this triggers the READ_CONTACTS permission dialog inside the
 * plugin. If the user declines, the plugin resolves an empty list rather than
 * rejecting — so an empty result here means "nothing to send", which may be a
 * refusal or an empty phonebook. The caller must not report it as a success.
 */
export async function readDeviceContacts() {
  const plugin = nativePlugin();
  if (plugin) {
    const res = await plugin.getAll();
    return flattenContacts(res?.contacts);
  }

  const bridge = legacyBridge();
  if (bridge) {
    const raw = await bridge.getAll();
    return flattenContacts(Array.isArray(raw) ? raw : raw?.contacts);
  }

  if (webPickerAvailable()) {
    const picked = await navigator.contacts.select(['name', 'tel', 'email'], { multiple: true });
    return flattenContacts((picked || []).map((p) => ({
      name: p?.name?.[0] || '',
      phones: p?.tel || [],
      emails: p?.email || [],
    })));
  }

  return [];
}

/**
 * Read the phonebook and sync it.
 *
 * Resolves { synced, skipped, linked_customers, sent, source } on success, and
 * { sent: 0, empty: true, source } when the device handed us nothing — an
 * outcome the UI has to distinguish, because "0 contacts synced" and "you said
 * no to the permission" are not the same sentence.
 *
 * Throws on a refused consent flag, a missing token, or an API error. Callers
 * show the message; nothing here retries on its own.
 */
export async function syncDeviceContacts({ accessToken, consent } = {}) {
  if (consent !== true) throw new Error('consent_required');
  if (!accessToken) throw new Error('Please sign in again before syncing contacts.');

  const source = contactSource();
  if (!source) throw new Error('This device cannot share its phonebook with QuietKeep.');

  const contacts = await readDeviceContacts();
  if (!contacts.length) return { sent: 0, synced: 0, skipped: 0, linked_customers: 0, empty: true, source };

  const res = await fetch('/api/contacts/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ contacts, consent: true, source }),
  });

  let json = null;
  try { json = await res.json(); } catch { /* keep the status code as the message */ }
  if (!res.ok) throw new Error(json?.detail || json?.error || `Sync failed (${res.status})`);

  return { ...(json || {}), sent: contacts.length, source };
}

export default syncDeviceContacts;
