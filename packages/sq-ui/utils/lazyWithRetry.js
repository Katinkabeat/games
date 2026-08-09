// Retry wrapper for lazy() route imports (c314).
//
// React.lazy has no retry: one dropped chunk fetch permanently rejects the
// import promise, and the whole app collapses to the root error boundary even
// after the network comes back (the 2026-08-05 Wordy incident). This wrapper
// retries the import with backoff before giving up, and on exhaustion reloads
// the document once per tab session — the only fix when a stale index.html
// points at rotated chunk hashes after a deploy.
//
// Only chunk-fetch-shaped failures are retried; a module whose top-level code
// throws is a real bug and rethrows immediately.
//
// Usage: swap `lazy(() => import('./X.jsx'))` for `lazyWithRetry(() => import('./X.jsx'))`.
import { lazy } from 'react'
import { isChunkLoadError } from './report.js'

const ATTEMPTS = 3
const BASE_DELAY_MS = 1000
// One auto-reload per tab session, ever — never cleared on success, so a
// persistently broken deploy can't put the tab in a reload loop. After the one
// reload, exhausted imports throw to the error boundary's retry panel instead.
const RELOAD_FLAG = 'sq-chunk-reloaded'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function importWithRetry(importFn) {
  let lastErr
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      return await importFn()
    } catch (err) {
      if (!isChunkLoadError(err)) throw err
      lastErr = err
      if (attempt < ATTEMPTS) await sleep(BASE_DELAY_MS * attempt)
    }
  }
  try {
    if (typeof sessionStorage !== 'undefined' && !sessionStorage.getItem(RELOAD_FLAG)) {
      sessionStorage.setItem(RELOAD_FLAG, '1')
      window.location.reload()
      return new Promise(() => {}) // stay suspended; the reload is taking over
    }
  } catch {
    // sessionStorage unavailable (privacy mode) — fall through to the boundary
  }
  throw lastErr
}

export function lazyWithRetry(importFn) {
  return lazy(() => importWithRetry(importFn))
}
