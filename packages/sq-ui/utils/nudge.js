// Shared nudge plumbing for the SideQuest games (c259).
//
// Two things every game needs and each was doing its own way:
//
//   isNudgeEnabled — does this player actually receive nudges for this game?
//     Used to hide the 🔔 bell for opponents who've opted out, so we never
//     offer an action that can't land. Mirrors the edge function's
//     sendIfOptedIn(app, 'nudge') gate exactly.
//
//   postNudge — POST the nudge to the game's push edge function and tell the
//     caller whether a notification was *delivered*, not merely whether the
//     HTTP call succeeded. The edge functions answer 200 with a body of
//     { sent: false, reason: 'opted out' | 'no push subscription' } or
//     { skipped: '...' }. Reading res.ok alone therefore reports success for
//     a nudge that was never delivered — the bug c260 left open in Wordy.
//
// sq-ui carries no dependencies of its own, so the caller passes in its own
// supabase client rather than this module importing one.

import { reportClientError } from './report.js'

// The four push functions all resolve a nudge to one of these shapes.
export const NUDGE_OPTED_OUT = 'opted out'
export const NUDGE_NO_SUBSCRIPTION = 'no push subscription'

const DEFAULT_TIMEOUT_MS = 8000

/**
 * Whether `userId` has the 'nudge' topic enabled for `app`.
 *
 * Fail-open: an RPC or transport error returns true. A pref check is a
 * courtesy, and a hiccup in it must never hide a bell that would have
 * worked — the server re-checks the same pref before sending anyway.
 * A missing userId returns false; there's nobody to nudge.
 */
export async function isNudgeEnabled(supabase, userId, app) {
  if (!userId) return false
  try {
    const { data, error } = await supabase.rpc('sq_notification_enabled', {
      p_user_id: userId, p_app: app, p_topic: 'nudge',
    })
    if (error) return true
    return data !== false
  } catch {
    return true
  }
}

/**
 * POST a nudge to a push edge function and report whether it was delivered.
 *
 * Returns { delivered, reason, status }:
 *   delivered  true only when the edge function answered { sent: true }.
 *   reason     why nothing was delivered — one of the NUDGE_* constants, an
 *              edge-function `skipped` value, or 'http <status>' / 'timeout' /
 *              'network error'. null when delivered.
 *   status     the HTTP status, or null if the request never completed.
 *
 * An unparseable 200 body counts as delivered: the push functions only fail
 * to serialize if something odd happened downstream of an actual send, and
 * a false "couldn't send" toast on a nudge that landed is the worse error.
 */
export async function postNudge({ url, anonKey, body, reportUrl, game, timeoutMs = DEFAULT_TIMEOUT_MS }) {
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
      body: JSON.stringify(body),
      signal: ctrl.signal,
    })

    if (!res.ok) {
      console.warn(`[nudge] push failed: HTTP ${res.status}`)
      // Transport failure — the push endpoint itself is broken. Report to
      // #error-log (c266) so a systemically-down nudge fn surfaces. The
      // { sent:false } opt-out branch below is a normal outcome, NOT reported.
      if (reportUrl && game) {
        reportClientError({ url: reportUrl, anonKey, game, type: 'nudge', detail: `HTTP ${res.status}`, status: res.status })
      }
      return { delivered: false, reason: `http ${res.status}`, status: res.status }
    }

    const payload = await res.json().catch(() => null)
    if (!payload) return { delivered: true, reason: null, status: res.status }
    if (payload.sent === true) return { delivered: true, reason: null, status: res.status }

    const reason = payload.reason ?? payload.skipped ?? 'not delivered'
    console.warn(`[nudge] push not delivered: ${reason}`)
    return { delivered: false, reason, status: res.status }
  } catch (err) {
    const reason = err?.name === 'AbortError' ? 'timeout' : 'network error'
    console.warn('[nudge] push error:', reason, err)
    if (reportUrl && game) {
      reportClientError({ url: reportUrl, anonKey, game, type: 'nudge', detail: reason, status: null })
    }
    return { delivered: false, reason, status: null }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Player-facing copy for a postNudge failure. Never names the recipient's
 * notification settings — that's their business, not the nudger's.
 */
export function nudgeFailureMessage(reason) {
  if (reason === NUDGE_OPTED_OUT || reason === NUDGE_NO_SUBSCRIPTION) {
    return "They're not set up to get reminders right now."
  }
  return "Couldn't reach them just now — try again in a bit."
}
