// Notification-tap navigation (fixes cross-board / cross-game deep links when
// the installed PWA is already open).
//
// Notifications are owned by the hub service worker at /games/. When the app is
// already open and the user taps a notification, the SW cannot simply open a
// fresh window at the target — Android no-ops `clients.openWindow()` inside an
// already-running installed PWA — and it cannot call `client.navigate()` on a
// game window either, because games are served OUTSIDE the hub SW's /games/
// scope and are therefore uncontrolled. So instead the SW focuses whatever
// window is open and posts a `{ type: 'NAVIGATE', url }` message; this listener
// performs the actual hop from inside the page. Without it, a tap while the app
// is open does nothing (or leaves you on the previous board). The hub does the
// equivalent inline in its App.jsx.
//
// Safe to call in every game's main.jsx even though games register no service
// worker of their own: `navigator.serviceWorker` still receives a message that
// a service worker posts directly to this window client.

let installed = false;

export function installNotificationNav() {
  if (installed) return;
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  if (typeof window === 'undefined') return;
  installed = true;

  navigator.serviceWorker.addEventListener('message', (event) => {
    const data = event.data;
    if (!data || data.type !== 'NAVIGATE' || typeof data.url !== 'string' || !data.url) return;
    // Already on the tapped board — don't trigger a needless reload.
    const here = window.location.pathname + window.location.search;
    if (data.url === here) return;
    window.location.href = data.url;
  });
}
