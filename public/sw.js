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
      // 1. A window already showing the target board — just focus it.
      for (const client of windowClients) {
        if ('focus' in client && client.url.includes(targetUrl)) {
          return client.focus();
        }
      }
      // 2. Any SideQuest window is open (the hub lobby OR a game). Focus it and
      //    tell the page to navigate itself to the target. We deliberately do
      //    NOT call client.navigate() here: games are served outside this SW's
      //    /games/ scope, so they're uncontrolled and navigate() would reject.
      //    And clients.openWindow() is a no-op inside an already-running
      //    installed PWA on Android — which is why a tap used to do nothing (or
      //    strand you on the previous board) whenever the app was already open.
      //    The page listens for this NAVIGATE message and does the hop itself:
      //    the hub in App.jsx, the games via sq-ui installNotificationNav().
      for (const client of windowClients) {
        if ('focus' in client) {
          return client.focus().then((c) => {
            (c || client).postMessage({ type: 'NAVIGATE', url: targetUrl });
          });
        }
      }
      // 3. Nothing open (app fully closed) — open a fresh window at the target.
      return clients.openWindow(targetUrl);
    })
  );
});

// ── Push subscription rotation self-heal (c252) ──────────────────────────────
// The push service can rotate or expire a subscription while nothing is open.
// When it does the browser fires `pushsubscriptionchange` and invalidates the
// old endpoint — every turn/nudge push to it then 410s, the edge fn deletes the
// DB row, and the player goes silent until they next open the hub. The hub-open
// heal (ensurePushSubscribed, c249) doesn't cover a player who lives inside a
// game tab, which is exactly how a whole day of turn notifications got lost.
//
// This handler re-subscribes the instant the address rotates and swaps the new
// address into the DB row via the public sq-push-resync endpoint, keyed by the
// old endpoint + proof-of-possession. Healing no longer depends on the hub
// being opened. VAPID PUBLIC key + function URL are safe to embed in this
// static file (both already ship in the client bundle).
const VAPID_PUBLIC_KEY = 'BCIDqV3c-WrF0HXoeZDJMWCDwr8Ho8L0kOrKdok4LB1cjUpiilEYfiASeqM5kIoKU1J03L-UoS7TJfPZw9f40Ck';
const RESYNC_URL = 'https://yyhewndblruwxsrqzart.supabase.co/functions/v1/sq-push-resync';

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil((async () => {
    try {
      // Identify the row by the OLD endpoint. Without it we can't tell the
      // resync endpoint which subscription to swap — bail to the hub-open net.
      const oldJson = event.oldSubscription ? event.oldSubscription.toJSON() : null;
      const oldEndpoint = oldJson && oldJson.endpoint;
      if (!oldEndpoint) return;
      const oldAuth = (oldJson.keys && oldJson.keys.auth) || null;

      // Prefer the browser-provided new subscription; some browsers leave it
      // null and expect us to re-subscribe ourselves.
      let newSub = event.newSubscription
        || (await self.registration.pushManager.getSubscription())
        || (await self.registration.pushManager.subscribe({
             userVisibleOnly: true,
             applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
           }));
      if (!newSub) return;

      const nj = newSub.toJSON();
      if (!nj || !nj.endpoint || !nj.keys || !nj.keys.p256dh || !nj.keys.auth) return;

      await fetch(RESYNC_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          oldEndpoint,
          oldAuth,
          endpoint: nj.endpoint,
          keys: { p256dh: nj.keys.p256dh, auth: nj.keys.auth },
        }),
      });
    } catch {
      // Best-effort: ensurePushSubscribed on the next hub open remains the backstop.
    }
  })());
});

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});
