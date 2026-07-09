// {{name}} Service Worker — push notifications ONLY.
//
// This SW deliberately has no `fetch` handler and no `caches` use, so it does
// NOT cache the app shell: a normal reload always pulls the new hashed bundles
// from Pages. There is therefore nothing to cache-bust and no CACHE_VERSION to
// bump on deploy. (An earlier template shipped an unused CACHE_VERSION const
// plus a "bump it every deploy" comment — it did nothing, and cost real
// debugging time working out whether a stale build was being served.)
//
// If you later add offline/app-shell caching, add a `fetch` handler + a
// CACHE_VERSION you actually read in `activate` to evict old caches, and only
// then does bumping it on each user-visible deploy mean anything. See Rungles,
// whose SW genuinely caches, for that shape.

self.addEventListener('push', (event) => {
  let data = { title: '{{name}}', body: "It's your turn!" }
  try {
    if (event.data) data = event.data.json()
  } catch {
    // fallback to defaults
  }

  const tag = data.tag || '{{slug}}-turn'

  const options = {
    body: data.body,
    icon: '/{{slug}}/favicon.svg',
    badge: '/{{slug}}/favicon.svg',
    tag,
    renotify: true,
    data: { url: data.url || '/{{slug}}/' },
  }

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      const targetUrl = data.url || ''
      const hasFocusedClient = windowClients.some(
        c => c.visibilityState === 'visible' && c.focused
             && targetUrl && c.url.includes(targetUrl)
      )
      if (hasFocusedClient) return
      return self.registration.showNotification(data.title, options)
    })
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const targetUrl = event.notification.data?.url || '/{{slug}}/'

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.includes('/{{slug}}/') && 'focus' in client) {
          return client.focus().then((focusedClient) => {
            focusedClient.postMessage({ type: 'NAVIGATE', url: targetUrl })
          })
        }
      }
      return clients.openWindow(targetUrl)
    })
  )
})

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim())
})
