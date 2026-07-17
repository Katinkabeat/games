// Shared client-error reporting for the SideQuest games (c265).
//
// When a client-side side-effect that normally has NO user-visible failure path
// breaks — a fire-and-forget push that 404s, say — nothing surfaces it. console.warn
// only reaches a developer with devtools open, so a break can hide for months
// (exactly what c260 found: Wordy's player_joined push had 404'd unnoticed).
//
// reportClientError POSTs a compact record to the `sq-report-client-error` edge
// function, which forwards it to a PRIVATE Discord channel (#error-log) under
// Rook's name. The webhook URL lives server-side in the edge function, never in
// the client bundle (a Discord webhook URL in public JS is an abuse magnet).
//
// It is best-effort and MUST NOT throw or block the caller: reporting a failure
// can never be allowed to become a second failure. Callers fire it and move on.
//
// sq-ui carries no dependencies, so the caller passes in url + anonKey.

const DEFAULT_TIMEOUT_MS = 8000

// The push-notification functions retry transient sends internally with an 11s
// per-recipient deadline (PUSH_DEADLINE_MS, c276). The client must outwait that
// deadline, or a slow-but-successful send gets reported as a timeout failure.
const PUSH_TIMEOUT_MS = 13000

// Per page-load dedup. A widespread break (an endpoint down for everyone) would
// otherwise fire one report per affected action; we only want to hear about a
// given signature once per session. Keyed by game:type:status so different
// game_ids collapse to one report, but a NEW kind of failure still gets through.
const reportedThisSession = new Set()

function signatureOf(game, type, status) {
  return `${game}:${type}:${status ?? 'net'}`
}

/**
 * Report a swallowed client-side failure to #error-log via Rook.
 *
 * @param {object}  opts
 * @param {string}  opts.url      the sq-report-client-error function URL
 * @param {string}  opts.anonKey  the Supabase anon key (sent as apikey, gates drive-by hits)
 * @param {string}  opts.game     which game ('wordy' | 'yahdle' | ...)
 * @param {string}  opts.type     what failed ('player_joined' | 'rematch_requested' | ...)
 * @param {string} [opts.detail]  short free-text context (ids, error message); truncated server-side
 * @param {number} [opts.status]  HTTP status if there was one; omit for a network/timeout error
 * @param {number} [opts.timeoutMs]
 * @returns {Promise<{reported: boolean, reason?: string}>} never rejects
 */
export async function reportClientError({ url, anonKey, game, type, detail, status, dedupeKey, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  try {
    if (!url || !anonKey || !game || !type) {
      return { reported: false, reason: 'missing url/anonKey/game/type' }
    }
    // dedupeKey lets callers (e.g. the global error handler) collapse by a finer
    // signature than game:type:status — two distinct JS errors must each report,
    // but the same error repeating must not.
    const sig = dedupeKey || signatureOf(game, type, status)
    if (reportedThisSession.has(sig)) return { reported: false, reason: 'deduped this session' }
    reportedThisSession.add(sig)

    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${anonKey}`,
          'apikey': anonKey,
        },
        body: JSON.stringify({ game, type, detail: detail ?? null, status: status ?? null }),
        signal: ctrl.signal,
      })
      if (!res.ok) {
        // If the report itself failed, un-mark so a later attempt this session can retry.
        reportedThisSession.delete(sig)
        console.warn(`[report] client-error report failed: HTTP ${res.status}`)
        return { reported: false, reason: `http ${res.status}` }
      }
      return { reported: true }
    } finally {
      clearTimeout(timer)
    }
  } catch (err) {
    console.warn('[report] client-error report error:', err)
    return { reported: false, reason: err?.name === 'AbortError' ? 'timeout' : 'network error' }
  }
}

/**
 * Fire a fire-and-forget "side-effect" push (one whose action has ALREADY
 * succeeded — a join happened, a rematch was requested) and, if the push
 * transport fails, report it to #error-log instead of swallowing it.
 *
 * This is the shape c262 gives Wordy's player_joined and Yahdle's
 * rematch_requested: never block the caller, never toast (the action stood on
 * its own), but never hide a broken push either. A 200 with { sent:false } is
 * NOT a failure here — that's a normal opt-out / no-subscription outcome; only
 * a non-2xx status or a network/timeout error is reported.
 *
 * Best-effort and non-throwing: callers `void` it and move on.
 *
 * @param {object} opts
 * @param {string} opts.pushUrl   the game's push-notification function URL
 * @param {string} opts.reportUrl the sq-report-client-error function URL
 * @param {string} opts.anonKey   Supabase anon key (for both calls)
 * @param {object} opts.body      the push payload
 * @param {string} opts.game      game key, for the report
 * @param {string} opts.type      push type, for the report
 * @param {string} [opts.detail]  extra context (ids), for the report
 */
export async function firePushAndReport({ pushUrl, reportUrl, anonKey, body, game, type, detail, timeoutMs = PUSH_TIMEOUT_MS }) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(pushUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${anonKey}`,
        'apikey': anonKey,
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    })
    if (!res.ok) {
      console.warn(`[push] ${game}/${type} failed: HTTP ${res.status}`)
      reportClientError({ url: reportUrl, anonKey, game, type, detail, status: res.status })
    }
  } catch (err) {
    console.warn(`[push] ${game}/${type} error:`, err)
    const kind = err?.name === 'AbortError' ? 'timeout' : 'network error'
    reportClientError({ url: reportUrl, anonKey, game, type, detail: detail ? `${detail}; ${kind}` : kind, status: null })
  } finally {
    clearTimeout(timer)
  }
}

// ── Global error reporting (c266 Phase 1) ───────────────────────────────────
//
// Turns #error-log from "a couple of push checks" into "the app actually broke
// and I'll hear about it": uncaught exceptions, unhandled promise rejections,
// and React render crashes (via SQErrorBoundary) all report here.
//
// Install once per app from its entry (main.jsx). The SQErrorBoundary calls
// reportRenderCrash() using the config set at install time, so it needs no props.

let _globalCfg = null
let _installed = false
const _seenGlobal = new Set()
// A soft ceiling so a hot error loop (many DISTINCT messages) can't firehose the
// channel. Repeats of one message are already collapsed by _seenGlobal.
const MAX_DISTINCT_PER_SESSION = 25

// Noise that is never worth a report: cross-origin opaque errors, the benign
// ResizeObserver loop notice, and anything originating in a browser extension.
function looksBenign(message = '', stack = '') {
  const m = String(message || '')
  if (!m && !stack) return true
  if (m === 'Script error.' || m === 'Script error') return true
  if (/ResizeObserver loop/i.test(m)) return true
  if (/(chrome|moz|safari-web|ms-browser)-extension:\/\//i.test(String(stack)) || /extension:\/\//i.test(m)) return true
  return false
}

// Redact JWT/token-shaped substrings so a credential can never ride into Discord.
function redact(s = '') {
  return String(s || '')
    .replace(/eyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}/g, '[jwt]')
    .replace(/\b[A-Za-z0-9_-]{40,}\b/g, '[token]')
    .slice(0, 400)
}

function firstFrame(stack = '') {
  const line = String(stack || '')
    .split('\n').map((s) => s.trim())
    .find((s) => s.startsWith('at ') || s.includes('@'))
  return line ? line.slice(0, 200) : ''
}

function reportGlobal(type, message, stack) {
  if (!_globalCfg) return
  if (looksBenign(message, stack)) return
  const frame = firstFrame(stack)
  const key = `${type}:${message}:${frame}`
  if (_seenGlobal.has(key)) return
  if (_seenGlobal.size >= MAX_DISTINCT_PER_SESSION) return
  _seenGlobal.add(key)
  const route = typeof location !== 'undefined' ? location.pathname : ''
  const detail = redact([message, frame, route].filter(Boolean).join(' | '))
  reportClientError({
    url: _globalCfg.reportUrl,
    anonKey: _globalCfg.anonKey,
    game: _globalCfg.game,
    type,
    detail,
    status: null,
    dedupeKey: `${_globalCfg.game}:${key}`,
  })
}

function _onError(event) {
  // Resource-load failures (img/script/link) also fire 'error' but have no Error
  // object and a DOM element as target — not a code exception, skip them.
  if (event?.target && event.target !== window && event.target.tagName) return
  const err = event?.error
  reportGlobal('js-error', event?.message || err?.message || 'unknown error', err?.stack || '')
}

function _onRejection(event) {
  const r = event?.reason
  if (r?.name === 'AbortError') return // aborted fetches are routine, not failures
  const message = (r && (r.message || String(r))) || 'unhandled rejection'
  reportGlobal('unhandled-rejection', message, r?.stack || '')
}

/**
 * Install global error reporting for an app. Call once from main.jsx before
 * render. Safe to call again (updates config, doesn't double-bind). Returns an
 * uninstall function.
 *
 * @param {object} opts
 * @param {string} opts.game     game key ('wordy' | 'yahdle' | ...)
 * @param {string} opts.reportUrl the sq-report-client-error function URL
 * @param {string} opts.anonKey   Supabase anon key
 */
export function installGlobalErrorReporting({ game, reportUrl, anonKey }) {
  if (typeof window === 'undefined') return () => {}
  _globalCfg = { game, reportUrl, anonKey }
  if (_installed) return () => {}
  window.addEventListener('error', _onError)
  window.addEventListener('unhandledrejection', _onRejection)
  _installed = true
  return () => {
    window.removeEventListener('error', _onError)
    window.removeEventListener('unhandledrejection', _onRejection)
    _installed = false
    _globalCfg = null
  }
}

/** Called by SQErrorBoundary.componentDidCatch on a render crash. No-op until installed. */
export function reportRenderCrash(error, info) {
  reportGlobal('render-crash', error?.message || 'render crash', error?.stack || info?.componentStack || '')
}
