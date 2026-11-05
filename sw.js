/* Fullmedia Alchemist service worker (2026-10-11): device reminders only.
   Shows the push the server sends (post due today / past due) and opens the
   app when tapped. No caching, no offline copy, nothing else. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_e) { d = { body: e.data ? e.data.text() : '' }; }
  const title = String(d.title || 'Fullmedia Alchemist').slice(0, 80);
  e.waitUntil(self.registration.showNotification(title, {
    body: String(d.body || '').slice(0, 200),
    icon: '/assets/logo-mark-180.png',
    badge: '/assets/logo-mark-180.png',
    tag: String(d.tag || 'fa'),
    data: { url: '/dashboard/' },
  }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL('/dashboard/', self.location.origin).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) { if (c.url.startsWith(url) && 'focus' in c) return c.focus(); }
    return self.clients.openWindow(url);
  }));
});
