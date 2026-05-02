// {{name}} Service Worker — handles push notifications.
// Bump CACHE_VERSION on every user-visible deploy so PWAs pick up the new SW.

const CACHE_VERSION = '{{slug}}-v1'

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
