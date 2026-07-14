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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// No statusCode at all means the request never got an HTTP response back (DNS,
// socket, timeout) — transient too.
function isTransientPushError(err: any): boolean {
  const status = err?.statusCode
  if (status == null) return true
  return status === 429 || status >= 500
}

// web-push's WebPushError message is always the generic "Received unexpected
// response code" — the push service's real status and body hang off the error
// object, never the message. Fold them in so the #error-log line is diagnosable.
function pushErrDetail(err: any, userId: string, endpoint: string, attempts: number): string {
  let host = 'unknown'
  try { host = new URL(endpoint).host } catch (_e) { /* keep 'unknown' */ }
  const status = err?.statusCode ?? 'no response'
  const body = String(err?.body ?? err?.message ?? err ?? '').replace(/\s+/g, ' ').trim().slice(0, 200)
  return `push send failed: ${status} — ${body} | host:${host} user:${userId} attempts:${attempts}`
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
        content: `**SideQuest** — push address expired (FYI)\n\`${statusCode} → sub deleted\` topic:\`${topic}\` user:\`${userId}\` endpoint:\`${host}\`\nSelf-heal re-subscribes on next rotation / hub-open / play.`,
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
): Promise<{ sent: boolean; reason?: string }> {
  const { data: sub } = await supabase
    .from('push_subscriptions')
    .select('endpoint, keys_p256dh, keys_auth')
    .eq('user_id', userId)
    .eq('app', PUSH_APP)
    .maybeSingle()

  if (!sub) return { sent: false, reason: 'no push subscription' }

  const pushSubscription = {
    endpoint: sub.endpoint,
    keys: { p256dh: sub.keys_p256dh, auth: sub.keys_auth },
  }

  for (let attempt = 0; ; attempt++) {
    try {
      await webpush.sendNotification(pushSubscription, JSON.stringify(payload), { TTL: 86400 })
      return { sent: true }
    } catch (err: any) {
      if (err?.statusCode === 410 || err?.statusCode === 404) {
        await supabase.from('push_subscriptions').delete().eq('user_id', userId).eq('app', PUSH_APP)
        await reportAddressDeath(userId, 'passed_on_leaderboard', err.statusCode, sub.endpoint)
        return { sent: false, reason: 'address expired' }
      }
      if (!isTransientPushError(err) || attempt >= PUSH_RETRIES) {
        // One recipient's failure must not abort the whole sweep — this runs over
        // every eligible user, so a throw here would silently drop everyone after.
        await reportServerError('passed_on_leaderboard', pushErrDetail(err, userId, sub.endpoint, attempt + 1))
        return { sent: false, reason: 'send failed' }
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

    const results: any[] = []
    for (const row of candidates ?? []) {
      const r = await sendPushToUser(supabase, row.user_id, {
        title: 'You got passed 📊',
        body: bodyFor(row.old_rank),
        tag: 'sq-leaderboard-drop',
        url: '/games/',
        icon: '/games/favicon.svg',
      })
      results.push({ user_id: row.user_id, old_rank: row.old_rank, new_rank: row.new_rank, ...r })
    }
    return new Response(JSON.stringify({ count: results.length, results }), { status: 200, headers: corsHeaders })
  } catch (err: any) {
    console.error('sq-passed-on-leaderboard error:', err)
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders })
  }
})
