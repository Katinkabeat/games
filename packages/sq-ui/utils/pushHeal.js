// A1 push-address heal (card c270). Injects a hidden, hub-scoped iframe into a
// game so the single `sidequest` push subscription gets refreshed while the
// user is simply playing — not only when they open the hub directly (c249).
//
// Why an iframe: after the per-game push migration, the games carry zero
// push-subscription code and can't touch the `sidequest` subscription, which is
// owned by the hub service worker at /games/. Every SQ app is same-origin, so a
// hidden /games/?heal=1 frame runs in the hub SW scope, reads the shared
// Supabase session from localStorage, and re-subscribes the address itself.
//
// Guarded by Notification.permission === 'granted' so it NEVER prompts, and
// injected at most once per page session.

let installed = false;

export function installPushHeal({ hubHealUrl = '/games/?heal=1' } = {}) {
  if (installed) return;
  // Only heal when the browser has already granted permission. If it hasn't,
  // there's no address to refresh and we must not prompt from a hidden frame.
  if (typeof Notification === 'undefined') return;
  if (Notification.permission !== 'granted') return;
  if (typeof document === 'undefined') return;
  installed = true;

  const inject = () => {
    // Belt-and-suspenders against a double-inject across HMR / bfcache.
    if (document.querySelector('iframe[data-sq-push-heal]')) return;
    const iframe = document.createElement('iframe');
    iframe.src = hubHealUrl;
    iframe.hidden = true;
    iframe.title = 'notification-heal';
    iframe.setAttribute('aria-hidden', 'true');
    iframe.setAttribute('data-sq-push-heal', '');
    iframe.style.display = 'none';
    document.body.appendChild(iframe);
  };

  // Defer past initial paint so the heal never competes with the game load.
  if (document.readyState === 'complete') {
    inject();
  } else {
    window.addEventListener('load', inject, { once: true });
  }
}
