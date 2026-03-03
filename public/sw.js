const CACHE_NAME = 'quietkeep-v2';
const STATIC = ['/', '/dashboard', '/daily-brief', '/calendar', '/finance', '/driving', '/profile', '/settings', '/kids', '/family', '/documents'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(STATIC).catch(() => {})));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.hostname.includes('supabase') || url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/')) return;
  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request).catch(() => caches.match('/dashboard')));
    return;
  }
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request).then(r => {
      if (r.ok && e.request.method === 'GET') caches.open(CACHE_NAME).then(c => c.put(e.request, r.clone()));
      return r;
    }))
  );
});

self.addEventListener('push', e => {
  if (!e.data) return;
  const d = e.data.json();
  e.waitUntil(self.registration.showNotification(d.title || 'QuietKeep', {
    body: d.body || 'New reminder',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    vibrate: [200, 100, 200],
    data: { url: d.url || '/dashboard' },
    actions: [{ action: 'open', title: 'View' }, { action: 'dismiss', title: 'Dismiss' }],
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  if (e.action !== 'dismiss') e.waitUntil(clients.openWindow(e.notification.data?.url || '/dashboard'));
});
