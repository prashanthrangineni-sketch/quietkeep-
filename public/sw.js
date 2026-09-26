// QuietKeep Service Worker v4
// SPRINT 2 FIX: Reminder scheduling now persists to IndexedDB.
// Previously: _scheduledReminders used in-memory setTimeout — SW killed after 30-60s
// of inactivity, all pending timers died silently, reminders never fired on web.
// Now: each scheduled reminder is written to IndexedDB. On every SW activate (page
// load, push event, etc.), all pending reminders are re-read and timers rebuilt.
// Reminders now survive SW suspension, page reloads, and browser restarts.

const CACHE_VERSION = 'quietkeep-v5';
const STATIC_CACHE  = CACHE_VERSION + '-static';
const DYNAMIC_CACHE = CACHE_VERSION + '-dynamic';
const REMINDER_DB   = 'qk-sw-reminders';
const REMINDER_STORE = 'pending';

const STATIC_ASSETS = [
  '/',
  '/login',
  '/dashboard',
  '/offline',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
];

// ── IndexedDB helpers ────────────────────────────────────────────
function openReminderDB() {
  return new Promise(function(resolve, reject) {
    var req = indexedDB.open(REMINDER_DB, 1);
    req.onupgradeneeded = function(e) {
      var db = e.target.result;
      if (!db.objectStoreNames.contains(REMINDER_STORE)) {
        db.createObjectStore(REMINDER_STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = function() { resolve(req.result); };
    req.onerror   = function() { reject(req.error); };
  });
}

function idbPutReminder(db, reminder) {
  return new Promise(function(resolve, reject) {
    var tx  = db.transaction(REMINDER_STORE, 'readwrite');
    var req = tx.objectStore(REMINDER_STORE).put(reminder);
    req.onsuccess = resolve;
    req.onerror   = function() { reject(req.error); };
  });
}

function idbDeleteReminder(db, id) {
  return new Promise(function(resolve, reject) {
    var tx  = db.transaction(REMINDER_STORE, 'readwrite');
    var req = tx.objectStore(REMINDER_STORE).delete(id);
    req.onsuccess = resolve;
    req.onerror   = function() { reject(req.error); };
  });
}

function idbGetAllReminders(db) {
  return new Promise(function(resolve, reject) {
    var tx  = db.transaction(REMINDER_STORE, 'readonly');
    var req = tx.objectStore(REMINDER_STORE).getAll();
    req.onsuccess = function() { resolve(req.result || []); };
    req.onerror   = function() { reject(req.error); };
  });
}

// ── In-memory timer map (rebuilt from IDB on each SW activation) ─
var _activeTimers = {};

// A REMINDER IS SPOKEN. THE BANNER IS THE FALLBACK, NOT THE FEATURE.
//
// This worker cannot speak: speechSynthesis does not exist in a service worker,
// and neither does an audio element. So it hands the reminder to whichever page
// is open — src/lib/context/aaria.jsx listens for REMINDER_DUE and says it in
// Aaria's own voice, in the user's language — and shows a notification only when
// there is no page there to say it.
//
// On the Android app this path is the second string to the bow anyway: the
// native ReminderAlarm plugin speaks with the app fully closed.
function notifyInstead(id, text) {
  return self.registration.showNotification('⏰ QuietKeep Reminder', {
    body: text,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: 'reminder-' + id,
    requireInteraction: true,
    vibrate: [300, 100, 300],
    // `speak` is read by the page when the notification is tapped, so a reminder
    // that arrived as a banner is still read out once someone opens it.
    data: { url: '/reminders', speak: text },
  });
}

function fireReminder(id, text) {
  return self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    .then(function(clientList) {
      if (clientList && clientList.length) {
        clientList.forEach(function(c) {
          c.postMessage({ type: 'REMINDER_DUE', id: id, text: text });
        });
        return;   // a page is speaking it; a banner on top of that is noise
      }
      return notifyInstead(id, text);
    })
    .catch(function() { return notifyInstead(id, text); });
}

function scheduleReminder(db, id, text, fireAt) {
  var delay = fireAt - Date.now();

  // Clear any existing timer for this id
  if (_activeTimers[id]) {
    clearTimeout(_activeTimers[id]);
    delete _activeTimers[id];
  }

  if (delay <= 0) {
    // Past due — fire immediately and clean up
    fireReminder(id, text);
    idbDeleteReminder(db, id).catch(function() {});
    return;
  }

  _activeTimers[id] = setTimeout(function() {
    fireReminder(id, text);
    delete _activeTimers[id];
    openReminderDB().then(function(db2) {
      idbDeleteReminder(db2, id).catch(function() {});
    }).catch(function() {});
  }, delay);
}

// ── Rebuild all timers from IndexedDB ────────────────────────────
// Called on every SW activate so reminders survive SW suspension.
function rebuildTimersFromIDB() {
  return openReminderDB().then(function(db) {
    return idbGetAllReminders(db).then(function(reminders) {
      reminders.forEach(function(r) {
        scheduleReminder(db, r.id, r.text, r.fireAt);
      });
      console.log('[SW v4] rebuilt', reminders.length, 'reminder timers from IDB');
    });
  }).catch(function(err) {
    console.warn('[SW v4] rebuildTimersFromIDB failed:', err);
  });
}

// ── INSTALL ──────────────────────────────────────────────────────
self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(function(cache) {
        return cache.addAll(STATIC_ASSETS);
      })
      .then(function() {
        return self.skipWaiting();
      })
      .catch(function(err) {
        console.warn('[SW] Install cache warning:', err);
        return self.skipWaiting();
      })
  );
});

// ── ACTIVATE: delete old caches + rebuild reminder timers ────────
self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys
          .filter(function(k) {
            return k.startsWith('quietkeep-') && k !== STATIC_CACHE && k !== DYNAMIC_CACHE;
          })
          .map(function(k) {
            return caches.delete(k);
          })
      );
    }).then(function() {
      return self.clients.claim();
    }).then(function() {
      // SPRINT 2 FIX: Rebuild all pending reminder timers from IDB on every activation.
      // This is what makes reminders survive SW suspension — the SW may be killed and
      // restarted many times before a reminder is due, but IDB is persistent.
      return rebuildTimersFromIDB();
    })
  );
});

// ── FETCH ────────────────────────────────────────────────────────
self.addEventListener('fetch', function(event) {
  var request = event.request;
  var url;
  try { url = new URL(request.url); } catch(e) { return; }

  if (request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(
      caches.match(request).then(function(cached) {
        if (cached) return cached;
        return fetch(request).then(function(response) {
          if (response && response.ok) {
            var clone = response.clone();
            caches.open(STATIC_CACHE).then(function(c) { c.put(request, clone); });
          }
          return response;
        });
      })
    );
    return;
  }

  event.respondWith(
    fetch(request)
      .then(function(response) {
        if (response && response.ok) {
          var clone = response.clone();
          caches.open(DYNAMIC_CACHE).then(function(c) { c.put(request, clone); });
        }
        return response;
      })
      .catch(function() {
        return caches.match(request).then(function(cached) {
          if (cached) return cached;
          if (request.mode === 'navigate') {
            return caches.match('/offline').then(function(offlinePage) {
              return offlinePage || caches.match('/');
            });
          }
          return new Response('Offline', { status: 503 });
        });
      })
  );
});

// ── PUSH NOTIFICATIONS ───────────────────────────────────────────
self.addEventListener('push', function(event) {
  var data = {
    title: 'QuietKeep',
    body: 'You have a new notification',
    icon: '/icon-192.png',
    url: '/dashboard',
    tag: 'quietkeep-notification',
  };

  try {
    if (event.data) {
      var parsed = event.data.json();
      data = Object.assign({}, data, parsed);
    }
  } catch (e) { /* ignore */ }

  event.waitUntil(
    // Rebuild reminder timers on push receive (SW may have been sleeping)
    rebuildTimersFromIDB().then(function() {
      return self.registration.showNotification(data.title, {
        body: data.body,
        icon: data.icon || '/icon-192.png',
        badge: '/icon-192.png',
        tag: data.tag,
        requireInteraction: false,
        data: { url: data.url || '/dashboard' },
        vibrate: [200, 100, 200],
      });
    })
  );
});

// ── NOTIFICATION CLICK ───────────────────────────────────────────
self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  var targetUrl = (event.notification.data && event.notification.data.url) || '/dashboard';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
      for (var i = 0; i < clientList.length; i++) {
        var client = clientList[i];
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }
      return clients.openWindow(targetUrl);
    })
  );
});

// ── REMINDER MESSAGES ────────────────────────────────────────────
// Main thread posts: { type: 'SCHEDULE_REMINDER', id, text, fireAt }
// SPRINT 2: Reminder is now persisted to IDB before scheduling the timer,
// so it survives SW suspension.
self.addEventListener('message', function(event) {
  var msg = event.data;
  if (!msg || !msg.type) return;

  if (msg.type === 'SCHEDULE_REMINDER') {
    var id     = msg.id;
    var text   = msg.text;
    var fireAt = msg.fireAt;

    openReminderDB().then(function(db) {
      // Persist first — timer is rebuilt from IDB on next SW activation
      return idbPutReminder(db, { id: id, text: text, fireAt: fireAt })
        .then(function() {
          scheduleReminder(db, id, text, fireAt);
          event.source && event.source.postMessage({
            type: 'REMINDER_SCHEDULED',
            id: id,
            delay: fireAt - Date.now(),
          });
        });
    }).catch(function(err) {
      console.warn('[SW v4] SCHEDULE_REMINDER failed:', err);
    });
  }

  if (msg.type === 'CANCEL_REMINDER') {
    var cid = msg.id;
    if (_activeTimers[cid]) {
      clearTimeout(_activeTimers[cid]);
      delete _activeTimers[cid];
    }
    openReminderDB().then(function(db) {
      idbDeleteReminder(db, cid).catch(function() {});
    }).catch(function() {});
  }
});
