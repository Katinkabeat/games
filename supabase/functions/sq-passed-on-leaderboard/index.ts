// Supabase Edge Function: sq-passed-on-leaderboard
//
// Hub notification for NON-Discord players: "you dropped on the weekly
// leaderboard". Rook's #highlights only celebrates positive moves, and
// only on Discord — this is the hub-side counterpart for the sting of
// getting passed.
//
// Called hourly by a pg_cron job (see sq_passed_on_leaderboard_cron.sql).
// All the work lives in sq_passed_on_leaderboard_candidates(): it diffs
// the current weekly ranks against the persisted snapshot, keeps only
// NOTABLE drops (lost #1, or fell out of the top 5) whose owner has the
// topic opted in, refreshes the snapshot, and returns the rows. This
// function is a pure dispatcher.

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

// The one app every push address is stored under. The old per-game fallback list
// ('wordy', 'rungles', …) dated from when each game held its own notification
// settings; the hub is now the only surface that ever subscribes, nothing has
// written a per-game row since, and none survive in the table.
const PUSH_APP = 'sidequest'

// ── Transient-failure retry (c276) ───────────────────────────────────────────
// A 5xx / 429 / timeout from a push service is that service having a moment, not
// a dead address. With no retry a single blip silently drops a real reminder.
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
function pushErrDetail(err: any, userId: string, endpoint: string, attempts: number): string {
  let host = 'unknown'
  try { host = new URL(endpoint).host } catch (_e) { /* keep 'unknown' */ }
  const status = err?.statusCode ?? 'no response'
  const body = String(err?.body ?? err?.message ?? err ?? '').replace(/\s+/g, ' ').trim().slice(0, 200)
  return `push send failed: ${status} — ${body} | host:${host} ep:${epFingerprint(endpoint)} user:${userId} attempts:${attempts}`
}

// ── #error-log reporting (c265/c268) ─────────────────────────────────────────
// This function predated the error-log channel: its push failures went nowhere.
const ERRORLOG_WEBHOOK = Deno.env.get('SQ_DISCORD_ERRORLOG_WEBHOOK') ?? ''

async function reportAddressDeath(userId: string, topic: string, statusCode: number, endpoint: string) {
  if (!ERRORLOG_WEBHOOK) return
  let host = 'unknown'
  try { host = new URL(endpoint).host } catch (_e) { /* keep 'unknown' */ }
  try {
    await fetch(ERRORLOG_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'Rook',
        content: `**SideQuest** — push address expired (FYI)\n\`${statusCode} → sub deleted\` topic:\`${topic}\` user:\`${userId}\` endpoint:\`${host}\` ep:\`${epFingerprint(endpoint)}\`\nSelf-heal re-subscribes on next rotation / hub-open / play.`,
        allowed_mentions: { parse: [] },
      }),
    })
  } catch (_e) {
    // best-effort: a failed report must never mask the push flow
  }
}

async function reportServerError(topic: string, detail: string) {
  if (!ERRORLOG_WEBHOOK) return
  try {
    await fetch(ERRORLOG_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'Rook',
        content: `**SideQuest** — push function error\n\`${topic}\`\ndetail: ${String(detail ?? '').slice(0, 500)}`,
        allowed_mentions: { parse: [] },
      }),
    })
  } catch (_e) {
    // best-effort: a failed report must never mask the original error
  }
}

async function sendPushToUser(
  supabase: any,
  userId: string,
  payload: { title: string; body: string; tag: string; url: string; icon?: string }
): Promise<{ sent: boolean; reason?: string; tag?: string; user?: string }> {
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

  const startedAt = Date.now()
  for (let attempt = 0; ; attempt++) {
    try {
      await webpush.sendNotification(pushSubscription, JSON.stringify(payload), { TTL: 86400, timeout: PUSH_ATTEMPT_TIMEOUT_MS })
      return { sent: true, tag: payload.tag, user: userId }
    } catch (err: any) {
      if (err?.statusCode === 410 || err?.statusCode === 404) {
        await supabase.from('push_subscriptions').delete().eq('user_id', userId).eq('app', PUSH_APP)
        await reportAddressDeath(userId, 'passed_on_leaderboard', err.statusCode, sub.endpoint)
        return { sent: false, reason: 'address expired', tag: payload.tag, user: userId }
      }
      // Project the next attempt BEFORE committing to it: an after-the-fact
      // elapsed check can pass just under the deadline and still admit a
      // backoff + full attempt, grazing pg_net's 15s. attempt < PUSH_RETRIES
      // whenever this is read, so the backoff index is safe.
      const nextWouldOverrun =
        Date.now() - startedAt + PUSH_BACKOFF_MS[attempt] + PUSH_ATTEMPT_TIMEOUT_MS > PUSH_DEADLINE_MS
      if (!isTransientPushError(err) || attempt >= PUSH_RETRIES || nextWouldOverrun) {
        // One recipient's failure must not abort the whole sweep — this runs over
        // every eligible user, so a throw here would silently drop everyone after.
        await reportServerError('passed_on_leaderboard', pushErrDetail(err, userId, sub.endpoint, attempt + 1))
        return { sent: false, reason: 'send failed', tag: payload.tag, user: userId }
      }
      await sleep(PUSH_BACKOFF_MS[attempt])
    }
  }
}

// Copy varies by which standing was lost (we have old/new rank).
function bodyFor(oldRank: number): string {
  return oldRank === 1
    ? 'Someone just took your #1 spot on this week’s board. Time to win it back.'
    : 'You slipped out of the top 5 on this week’s board. A game or two could fix that.'
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    // SQL does the diff, opt-in filtering, and snapshot refresh; we just
    // dispatch a push per returned row.
    const { data: candidates, error } = await supabase.rpc('sq_passed_on_leaderboard_candidates')
    if (error) {
      console.error('sq_passed_on_leaderboard_candidates failed:', error)
      return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders })
    }

    // Recipients in parallel: pg_net's 15s budget covers the WHOLE sweep, so the
    // call must take ≈ the slowest recipient, not the sum of all of them — a
    // sequential loop lets one slow recipient sever the call and silently drop
    // everyone after (c278 follow-up).
    const results = await Promise.all((candidates ?? []).map(async (row: any) => {
      const r = await sendPushToUser(supabase, row.user_id, {
        title: 'You got passed 📊',
        body: bodyFor(row.old_rank),
        tag: 'sq-leaderboard-drop',
        url: '/games/',
        icon: '/games/favicon.svg',
      })
      return { user_id: row.user_id, old_rank: row.old_rank, new_rank: row.new_rank, ...r }
    }))
    return new Response(JSON.stringify({ count: results.length, results }), { status: 200, headers: corsHeaders })
  } catch (err: any) {
    console.error('sq-passed-on-leaderboard error:', err)
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders })
  }
})
