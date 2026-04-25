// SideQuest Service Worker — handles push notifications for all games

self.addEventListener('push', (event) => {
  let data = { title: "Rae's Side Quest", body: 'Something is waiting for you' };
  try {
    if (event.data) data = event.data.json();
  } catch {
    // fallback to defaults
  }

  const tag = data.tag || 'sidequest';
  const options = {
    body: data.body,
    icon: data.icon || '/games/favicon.svg',
    badge: '/games/favicon.svg',
    tag,
    renotify: true,
    data: { url: data.url || '/games/' },
  };

  // Always show the notification. Turn-based games rely on push to alert
  // a player whose turn it now is — even if they're staring at the board
  // waiting, they need the cue.
  event.waitUntil(self.registration.showNotification(data.title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/games/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // Focus an existing matching tab if any
      for (const client of windowClients) {
        if ('focus' in client && client.url.includes(targetUrl)) {
          return client.focus();
        }
      }
      // Otherwise focus any tab on our origin and tell it to navigate
      for (const client of windowClients) {
        if ('focus' in client && client.url.includes('/games/')) {
          return client.focus().then((c) => {
            c.postMessage({ type: 'NAVIGATE', url: targetUrl });
          });
        }
      }
      // Fallback: open a new window
      return clients.openWindow(targetUrl);
    })
  );
});

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});
