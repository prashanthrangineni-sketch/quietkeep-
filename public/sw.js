// QuietKeep Service Worker v3
// Network-first strategy, offline fallback, cache versioning, push notifications

const CACHE_VERSION = 'quietkeep-v3';
const STATIC_CACHE  = CACHE_VERSION + '-static';
const DYNAMIC_CACHE = CACHE_VERSION + '-dynamic';

const STATIC_ASSETS = [
  '/',
  '/login',
  '/dashboard',
  '/offline',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
];

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

// ── ACTIVATE: delete old caches ──────────────────────────────────
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
    })
  );
});

// ── FETCH ────────────────────────────────────────────────────────
self.addEventListener('fetch', function(event) {
  var request = event.request;
  var url;
  try { url = new URL(request.url); } catch(e) { return; }

  // Skip non-GET
  if (request.method !== 'GET') return;

  // Skip cross-origin (Supabase, Anthropic, etc.)
  if (url.origin !== self.location.origin) return;

  // Skip API routes — always network
  if (url.pathname.startsWith('/api/')) return;

  // Next.js static assets — cache first
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

  // Pages — network first, cache fallback, then offline page
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

// ── PUSH NOTIFICATIONS (via Knock.app) ──────────────────────────
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
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: data.icon || '/icon-192.png',
      badge: '/icon-192.png',
      tag: data.tag,
      requireInteraction: false,
      data: { url: data.url || '/dashboard' },
      vibrate: [200, 100, 200],
    })
  );
});

// ── NOTIFICATION CLICK ──────────────────────────────────────────
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

// ── SCHEDULED REMINDER MESSAGES ─────────────────────────────────────────
// Main thread posts: { type: 'SCHEDULE_REMINDER', id, text, fireAt }
// SW stores them and a periodic sync (or next push) fires them.
// This is the most reliable cross-browser local scheduling approach.
var _scheduledReminders = {};

self.addEventListener('message', function(event) {
  var msg = event.data;
  if (!msg || !msg.type) return;

  if (msg.type === 'SCHEDULE_REMINDER') {
    var id      = msg.id;
    var text    = msg.text;
    var fireAt  = msg.fireAt; // epoch ms
    var delay   = fireAt - Date.now();

    if (delay <= 0) {
      // Already past — fire immediately
      self.registration.showNotification('⏰ QuietKeep Reminder', {
        body: text,
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        tag: 'reminder-' + id,
        requireInteraction: true,
        vibrate: [300, 100, 300],
        data: { url: '/reminders' },
      });
      return;
    }

    // Clear any existing timer for this reminder
    if (_scheduledReminders[id]) clearTimeout(_scheduledReminders[id]);

    _scheduledReminders[id] = setTimeout(function() {
      self.registration.showNotification('⏰ QuietKeep Reminder', {
        body: text,
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        tag: 'reminder-' + id,
        requireInteraction: true,
        vibrate: [300, 100, 300],
        data: { url: '/reminders' },
      });
      delete _scheduledReminders[id];
    }, delay);

    event.source && event.source.postMessage({ type: 'REMINDER_SCHEDULED', id: id, delay: delay });
  }

  if (msg.type === 'CANCEL_REMINDER') {
    var cid = msg.id;
    if (_scheduledReminders[cid]) {
      clearTimeout(_scheduledReminders[cid]);
      delete _scheduledReminders[cid];
    }
  }
});
