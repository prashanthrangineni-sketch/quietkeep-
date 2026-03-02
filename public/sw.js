const CACHE_NAME = 'quietkeep-v1';
const STATIC_ASSETS = [
  '/',
  '/dashboard',
  '/daily-brief',
  '/finance',
  '/settings',
  '/profile',
  '/manifest.json',
];

// Install — cache static pages
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

// Activate — clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// Fetch — network first, fall back to cache
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET and external requests (Supabase API etc)
  if (request.method !== 'GET') return;
  if (!url.origin.includes(self.location.origin)) return;

  // API routes — network only, no caching
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(request).catch(() =>
      new Response(JSON.stringify({ error: 'Offline — no network' }), {
        headers: { 'Content-Type': 'application/json' },
      })
    ));
    return;
  }

  // Pages — network first, cache fallback
  event.respondWith(
    fetch(request)
      .then((response) => {
        // Cache successful responses
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      })
      .catch(() =>
        caches.match(request).then((cached) => {
          if (cached) return cached;
          // Fallback for uncached pages when offline
          return caches.match('/dashboard');
        })
      )
  );
});

// Push notification handler
self.addEventListener('push', (event) => {
  if (!event.data) return;
  let data = {};
  try { data = event.data.json(); } catch { data = { title: 'QuietKeep', body: event.data.text() }; }

  event.waitUntil(
    self.registration.showNotification(data.title || 'QuietKeep Reminder', {
      body: data.body || 'You have a reminder',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: data.tag || 'quietkeep-reminder',
      requireInteraction: true,
      vibrate: [200, 100, 200],
      data: { url: data.url || '/dashboard' },
      actions: [
        { action: 'open', title: '✅ Open' },
        { action: 'dismiss', title: '❌ Dismiss' },
      ],
    })
  );
});

// Notification click handler
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  if (event.action === 'dismiss') return;

  const url = event.notification.data?.url || '/dashboard';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // If app is already open, focus it
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.focus();
          client.navigate(url);
          return;
        }
      }
      // Otherwise open new window
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});

// Background sync for offline keeps
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-keeps') {
    event.waitUntil(syncOfflineKeeps());
  }
});

async function syncOfflineKeeps() {
  // Placeholder — will sync queued offline keeps when back online
  console.log('[QuietKeep SW] Syncing offline keeps...');
}
