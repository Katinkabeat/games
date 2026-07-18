// Supabase Edge Function: SQ Friend Request Notification
// Fires from a DB trigger on INSERT to public.friendships when a pending
// row is created. Sends a Web Push to the recipient with a SideQuest-
// branded "X wants to be friends" notification.
//
// Mirrors wordy/supabase/functions/push-notification/index.ts in pattern,
// trimmed to the single friend-request use case.

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'

const VAPID_PRIVATE_KEY    = Deno.env.get('VAPID_PRIVATE_KEY')!
const VAPID_PUBLIC_KEY     = Deno.env.get('VAPID_PUBLIC_KEY')!
const VAPID_SUBJECT        = Deno.env.get('VAPID_SUBJECT')!
const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Helper: respect the recipient's notification prefs before sending.
// Calls sq_notification_enabled(user, app, topic) — if false, skip
// the send entirely. Fail-open on RPC error so a transient DB blip
// doesn't break the platform.
async function sendIfOptedIn(
  supabase: any,
  userId: string,
  app: string,
  topic: string,
  payload: { title: string; body: string; tag: string; url: string; icon?: string }
): Promise<{ sent: boolean; reason?: string; via?: string; tag?: string; user?: string }> {
  const { data: enabled, error } = await supabase.rpc('sq_notification_enabled', {
    p_user_id: userId,
    p_app: app,
    p_topic: topic,
  })
  if (error) {
    console.error('sq_notification_enabled failed (fail-open):', error)
  } else if (enabled === false) {
    return { sent: false, reason: 'opted out', tag: payload.tag, user: userId }
  }
  return sendPushToUser(supabase, userId, payload, topic)
}

// The one app every push address is stored under (see sendPushToUser).
const PUSH_APP = 'sidequest'

// ── Transient-failure retry (c276) ───────────────────────────────────────────
// A 5xx / 429 / timeout from a push service is that service having a moment, not
// a dead address. With no retry a single blip silently drops a real notification.
// Retry twice with a short backoff; only a failure of every attempt is worth
// reporting. Mirrors the five game push functions.
const PUSH_RETRIES = 2
const PUSH_BACKOFF_MS = [400, 1200]

// Hard ceiling on total time spent retrying ONE recipient, across all attempts.
//
// The caller is a Postgres trigger going through pg_net, whose HTTP timeout is
// 15s (sq_pgnet_timeout_15s.sql). If we exceed that, pg_net severs the call and
// discards the response — the exact mechanism that was silently dropping turn
// notifications (c278). Retrying is only safe if we always answer well inside
// that window.
//
// A push service can fail SLOWLY: Mozilla was taking ~4.8s to return each 502.
// Three of those plus backoff is ~16s, which overruns even the raised budget —
// so an unbounded retry count turns one failed push into a severed call. The
// loop only starts another attempt if the backoff plus a full worst-case attempt
// still fits inside the deadline, so send time per recipient never exceeds it.
// 11s admits two ~5s slow-fail attempts (so the retry still fires when a service
// is failing slowly) while leaving pg_net headroom for function overhead.
const PUSH_DEADLINE_MS = 11000

// Per-attempt socket-inactivity timeout (web-push passes it to https.request).
// Kills a hung socket — the "single attempt hanging >15s" hole — without
// tripping on Mozilla's ~4.8s slow-fails, which stay under it and return a real
// status. Also what makes the deadline projection above trustworthy: no attempt
// can outlive it.
const PUSH_ATTEMPT_TIMEOUT_MS = 5000

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// No statusCode at all means the request never got an HTTP response back (DNS,
// socket, timeout) — transient too.
function isTransientPushError(err: any): boolean {
  const status = err?.statusCode
  if (status == null) return true
  return status === 429 || status >= 500
}

// Last 8 chars of the push endpoint — enough to tell one address from another
// without logging the whole (sensitive, capability-bearing) URL. Lets an
// #error-log line be correlated against the push_subscriptions row: same ep on a
// later failure = the address never healed; different ep = it rotated and the
// failure is the push service's, not a stale address.
function epFingerprint(endpoint: string): string {
  const s = String(endpoint ?? '')
  return s.length > 8 ? s.slice(-8) : (s || 'unknown')
}

// web-push's WebPushError message is always the generic "Received unexpected
// response code" — the push service's real status and body hang off the error
// object, never the message. Fold them in so the #error-log line is diagnosable.
function pushErrDetail(err: any, userId: string, app: string, endpoint: string, attempts: number): string {
  let host = 'unknown'
  try { host = new URL(endpoint).host } catch (_e) { /* keep 'unknown' */ }
  const status = err?.statusCode ?? 'no response'
  const body = String(err?.body ?? err?.message ?? err ?? '').replace(/\s+/g, ' ').trim().slice(0, 200)
  return `push send failed: ${status} — ${body} | app:${app} host:${host} ep:${epFingerprint(endpoint)} user:${userId} attempts:${attempts}`
}

// Topics where a held-back delivery goes stale before it's seen ride
// Urgency: high (c283). friend_request deliberately isn't one of them — a
// friend request is still fresh an hour later, and the high-urgency budget
// stays reserved for turn/nudge/invite pushes so FCM doesn't deprioritize
// the sender. The set matches the game push fns' shared contract.
const HIGH_URGENCY_TOPICS = new Set(['your_turn', 'nudge', 'invite', 'opponent_joined'])

// Sends, retrying transient failures. 410/404 propagate raw so the caller can run
// its expired-address cleanup; anything else surfaces as an enriched Error.
async function sendWithRetry(
  pushSubscription: any,
  payload: unknown,
  userId: string,
  app: string,
  endpoint: string,
  topic: string,
): Promise<void> {
  const urgency = HIGH_URGENCY_TOPICS.has(topic) ? 'high' : 'normal'
  const startedAt = Date.now()
  for (let attempt = 0; ; attempt++) {
    try {
      await webpush.sendNotification(pushSubscription, JSON.stringify(payload), { TTL: 86400, timeout: PUSH_ATTEMPT_TIMEOUT_MS, urgency })
      return
    } catch (err: any) {
      if (err?.statusCode === 410 || err?.statusCode === 404) throw err
      // Project the next attempt BEFORE committing to it: an after-the-fact
      // elapsed check can pass just under the deadline and still admit a
      // backoff + full attempt, grazing pg_net's 15s. attempt < PUSH_RETRIES
      // whenever this is read, so the backoff index is safe.
      const nextWouldOverrun =
        Date.now() - startedAt + PUSH_BACKOFF_MS[attempt] + PUSH_ATTEMPT_TIMEOUT_MS > PUSH_DEADLINE_MS
      if (!isTransientPushError(err) || attempt >= PUSH_RETRIES || nextWouldOverrun) {
        throw new Error(pushErrDetail(err, userId, app, endpoint, attempt + 1))
      }
      await sleep(PUSH_BACKOFF_MS[attempt])
    }
  }
}

async function sendPushToUser(
  supabase: any,
  userId: string,
  payload: { title: string; body: string; tag: string; url: string; icon?: string },
  topic = 'unknown'
): Promise<{ sent: boolean; reason?: string; via?: string; tag?: string; user?: string }> {
  // Every push address lives under the unified 'sidequest' app: the hub is the only
  // surface that ever calls pushManager.subscribe, and it hardcodes that value. The
  // old per-game fallback list ('wordy', 'rungles', …) dated from when each game
  // held its own notification settings; nothing has written a per-game row since the
  // unification and none survive in the table, so the loop only ever hit iteration
  // one. Single lookup now — a miss here means the user genuinely has no address.
  const { data: sub } = await supabase
    .from('push_subscriptions')
    .select('endpoint, keys_p256dh, keys_auth')
    .eq('user_id', userId)
    .eq('app', PUSH_APP)
    .maybeSingle()

  if (!sub) return { sent: false, reason: 'no push subscription', tag: payload.tag, user: userId }

  const pushSubscription = {
    endpoint: sub.endpoint,
    keys: { p256dh: sub.keys_p256dh, auth: sub.keys_auth },
  }

  try {
    await sendWithRetry(pushSubscription, payload, userId, PUSH_APP, sub.endpoint, topic)
    return { sent: true, via: PUSH_APP, tag: payload.tag, user: userId }
  } catch (pushErr: any) {
    if (pushErr.statusCode === 410 || pushErr.statusCode === 404) {
      await supabase.from('push_subscriptions').delete().eq('user_id', userId).eq('app', PUSH_APP)
      await reportAddressDeath('SideQuest', userId, PUSH_APP, topic, pushErr.statusCode, sub.endpoint)
      return { sent: false, reason: 'address expired', tag: payload.tag, user: userId }
    }
    // One recipient's failed send is not the whole call's failure: throwing here
    // aborted the fan-out loops (game_finished), so the *other* players silently
    // got no push either. Report it and let the caller carry on.
    await reportServerError('SideQuest', topic, pushErr?.message ?? String(pushErr))
    return { sent: false, reason: 'send failed', tag: payload.tag, user: userId }
  }
}

// ── #error-log reporting (c265/c268) ─────────────────────────────────────────
// This function predates the error-log channel entirely: its push failures used
// to go nowhere at all. Same two reporters as the game functions —
// reportAddressDeath is a low-noise FYI (the SW self-heal re-subscribes on the
// next rotation / hub-open), reportServerError is the red alarm.
const ERRORLOG_WEBHOOK = Deno.env.get('SQ_DISCORD_ERRORLOG_WEBHOOK') ?? ''

async function reportAddressDeath(
  game: string, userId: string, app: string, topic: string, statusCode: number, endpoint: string
) {
  if (!ERRORLOG_WEBHOOK) return
  let host = 'unknown'
  try { host = new URL(endpoint).host } catch (_e) { /* keep 'unknown' */ }
  try {
    await fetch(ERRORLOG_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'Rook',
        content: `**${game}** — push address expired (FYI)\n\`${statusCode} → sub deleted\` app:\`${app}\` topic:\`${topic}\` user:\`${userId}\` endpoint:\`${host}\` ep:\`${epFingerprint(endpoint)}\`\nSelf-heal re-subscribes on next rotation / hub-open / play.`,
        allowed_mentions: { parse: [] },
      }),
    })
  } catch (_e) {
    // best-effort: a failed report must never mask the push flow
  }
}

async function reportServerError(game: string, type: string, detail: string) {
  if (!ERRORLOG_WEBHOOK) return
  try {
    await fetch(ERRORLOG_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'Rook',
        content: `**${game}** — push function error\n\`${type}\`\ndetail: ${String(detail ?? '').slice(0, 500)}`,
        allowed_mentions: { parse: [] },
      }),
    })
  } catch (_e) {
    // best-effort: a failed report must never mask the original error
  }
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  let payload: any = null
  try {
    payload = await req.json()

    // Two callers supported:
    //   1. DB webhook style: { record: <friendships row>, old_record: ... }
    //   2. Direct invocation: { requester_id, recipient_id }
    let requesterId: string | undefined
    let recipientId: string | undefined

    if (payload.record) {
      const r = payload.record
      if (r.status !== 'pending') {
        return new Response(JSON.stringify({ skipped: 'not a new pending row' }), { status: 200, headers: corsHeaders })
      }
      requesterId = r.requested_by
      recipientId = r.requested_by === r.user_a ? r.user_b : r.user_a
    } else {
      requesterId = payload.requester_id
      recipientId = payload.recipient_id
    }

    if (!requesterId || !recipientId) {
      return new Response(JSON.stringify({ error: 'missing requester_id/recipient_id' }), { status: 400, headers: corsHeaders })
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    const { data: profile } = await supabase
      .from('profiles')
      .select('username')
      .eq('id', requesterId)
      .single()
    const requesterName = profile?.username || 'Someone'

    const result = await sendIfOptedIn(supabase, recipientId, 'sidequest', 'friend_request', {
      title: "Rae's Side Quest",
      body: `${requesterName} wants to be friends!`,
      tag: `sq-friend-${requesterId}`,
      url: '/games/',
      icon: '/games/favicon.svg',
    })

    return new Response(JSON.stringify(result), { status: 200, headers: corsHeaders })
  } catch (err: any) {
    console.error('Friend request notification error:', err)
    await reportServerError('SideQuest', payload?.record ? 'friend_request' : 'unknown', err?.message)
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders })
  }
})
