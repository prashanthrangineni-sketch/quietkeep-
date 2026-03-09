// File: public/sw.js — NEW FILE — Service Worker for Web Push (Sprint 2, Step 13)
const CACHE_NAME = 'quietkeep-v1';
const STATIC = ['/', '/dashboard', '/login'];

// Cache static pages on install
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

// Fetch — network first, cache fallback
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});

// Push notification handler
self.addEventListener('push', event => {
  let data = { title: 'QuietKeep', body: 'You have a reminder', icon: '/icon-192.png', url: '/dashboard' };
  try { if (event.data) data = { ...data, ...event.data.json() }; } catch {}
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: data.icon || '/icon-192.png',
      badge: '/icon-72.png',
      tag: data.tag || 'quietkeep-reminder',
      requireInteraction: data.persistent || false,
      actions: data.actions || [],
      data: { url: data.url || '/dashboard' },
      vibrate: [200, 100, 200],
    })
  );
});

// Notification click — open app or specific page
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = event.notification.data?.url || '/dashboard';
  if (event.action === 'call' && event.notification.data?.phone) {
    clients.openWindow(`tel:${event.notification.data.phone}`);
    return;
  }
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      return clients.openWindow(url);
    })
  );
});
