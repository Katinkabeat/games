// Supabase Edge Function: {{slug}}-push-notification
//
// Deploy with:
//   supabase functions deploy {{slug}}-push-notification
//
// Trigger / call types — all sourced from {{slug}}_games row events
// (see {{slug}}_multiplayer.sql section 20 + {{slug}}_nudge.sql):
//   1. game_invited     — {{slug}}_games AFTER INSERT (invitee[s] set).
//                         Fans out to every invited user.
//   2. opponent_joined  — {{slug}}_games AFTER UPDATE, waiting→active.
//                         Notifies the creator.
//   3. turn_change      — {{slug}}_games AFTER UPDATE, current_player_idx
//                         changed while status='active'. Notifies the new
//                         current player. One ping per turn change.
//   4. game_finished    — {{slug}}_games AFTER UPDATE, active→finished.
//                         Fans out to every player (won / lost / tie /
//                         you forfeited), using {{slug}}_players.is_winner.
//   5. nudge            — client POST (after the {{slug}}_nudge RPC stamps
//                         the 12h cooldown). Reminds the current player.
//   6. game_closed      — {{slug}}_expire_stale_invites closed a
//                         never-filled game (only the creator was seated).
//                         Notifies the lone creator. (c150 policy)
//
// Reuses the shared push_subscriptions table. Every push address is stored
// under the single 'sidequest' app — the SQ hub is the only surface that
// subscribes, and a game never registers an address of its own.
// Respects per-user/game/topic prefs via sq_notification_enabled.

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'

const VAPID_PRIVATE_KEY    = Deno.env.get('VAPID_PRIVATE_KEY')!
const VAPID_PUBLIC_KEY      = Deno.env.get('VAPID_PUBLIC_KEY')!
const VAPID_SUBJECT         = Deno.env.get('VAPID_SUBJECT')!
const SUPABASE_URL          = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const APP = '{{slug}}'
const GAME_LABEL = '{{name}}{{emojiSuffix}}'
const ICON = '/{{slug}}/favicon.svg'

function gameUrl(gameId: string): string {
  return `/{{slug}}/multi/${gameId}`
}

// Respect the recipient's notification prefs before sending. Calls
// sq_notification_enabled(user, app, topic) — if false, skip the send.
// Fail-open on RPC error so a transient DB blip doesn't break the platform.
async function sendIfOptedIn(
  supabase: any,
  userId: string,
  app: string,
  topic: string,
  payload: { title: string; body: string; tag: string; url: string; icon?: string }
): Promise<{ sent: boolean; reason?: string; via?: string }> {
  const { data: enabled, error } = await supabase.rpc('sq_notification_enabled', {
    p_user_id: userId,
    p_app: app,
    p_topic: topic,
  })
  if (error) {
    console.error('sq_notification_enabled failed (fail-open):', error)
  } else if (enabled === false) {
    return { sent: false, reason: 'opted out' }
  }
  return sendPushToUser(supabase, userId, payload, topic)
}

// The one app every push address is stored under. The SQ hub is the only surface
// that ever calls pushManager.subscribe, and it hardcodes this value — a game
// never registers an address of its own. (Note this is unrelated to the per-game
// values in user_notification_prefs, which are alive and well.)
const PUSH_APP = 'sidequest'

// ── Transient-failure retry (c276) ───────────────────────────────────────────
// A 5xx / 429 / timeout from a push service is that service having a moment, not
// a dead address. With no retry a single blip silently drops a real turn ping.
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

async function sendPushToUser(
  supabase: any,
  userId: string,
  payload: { title: string; body: string; tag: string; url: string; icon?: string },
  topic = 'unknown'
): Promise<{ sent: boolean; reason?: string; via?: string }> {
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

  for (let attempt = 0; ; attempt++) {
    try {
      await webpush.sendNotification(pushSubscription, JSON.stringify(payload), { TTL: 86400 })
      return { sent: true, via: PUSH_APP, tag: payload.tag, user: userId }
    } catch (pushErr: any) {
      if (pushErr?.statusCode === 410 || pushErr?.statusCode === 404) {
        await supabase.from('push_subscriptions').delete().eq('user_id', userId).eq('app', PUSH_APP)
        await reportAddressDeath('{{name}}', userId, PUSH_APP, topic, pushErr.statusCode, sub.endpoint)
        return { sent: false, reason: 'address expired', tag: payload.tag, user: userId }
      }
      if (!isTransientPushError(pushErr) || attempt >= PUSH_RETRIES) {
        // One recipient's failed send is not the whole call's failure: throwing
        // here would abort the fan-out loops (game_finished), so the *other*
        // players would silently get no push either.
        await reportServerError('{{name}}', topic, pushErrDetail(pushErr, userId, sub.endpoint, attempt + 1))
        return { sent: false, reason: 'send failed', tag: payload.tag, user: userId }
      }
      await sleep(PUSH_BACKOFF_MS[attempt])
    }
  }
}

async function getUsername(supabase: any, userId: string): Promise<string> {
  const { data: profile } = await supabase
    .from('profiles')
    .select('username')
    .eq('id', userId)
    .maybeSingle()
  return profile?.username ?? 'Someone'
}

// Report an unexpected push-function failure to the private #error-log channel
// (c266 Phase 3). Best-effort; never throws. Only the top-level catch calls it,
// so routine 410/404 expired-subscription cleanup (handled inline) never lands here.
const ERRORLOG_WEBHOOK = Deno.env.get('SQ_DISCORD_ERRORLOG_WEBHOOK') ?? ''

// Report an expired-and-deleted push address to #error-log as a low-noise FYI
// (c268). A 410/404 on a *previously-valid* subscription silently darkens a
// real player. Distinct from reportServerError (a red alarm from the top-level
// catch): the hub SW self-heal (c252) + refresh-on-play (c270) re-create the
// address on the next rotation / hub-open / play, so this is an FYI, not an alarm.
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
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  let payload: any = null
  try {
    payload = await req.json()
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    // ── game_invited: {{slug}}_games INSERT with invitee(s) ──
    // Fans out to every invited user (multi-friend games), falling back
    // to the single invited_user_id for 1v1 rows.
    if (payload.type === 'game_invited') {
      const { record } = payload
      const invitees: string[] = (Array.isArray(record?.invited_user_ids) && record.invited_user_ids.length)
        ? record.invited_user_ids
        : (record?.invited_user_id ? [record.invited_user_id] : [])
      if (!record?.id || !record.created_by || !invitees.length) {
        return new Response(JSON.stringify({ skipped: 'missing fields' }), { status: 200, headers: corsHeaders })
      }
      const inviterName = await getUsername(supabase, record.created_by)
      const results: any[] = []
      for (const inviteeId of invitees) {
        const r = await sendIfOptedIn(supabase, inviteeId, APP, 'invite', {
          title: `${GAME_LABEL} — game invite`,
          body: `${inviterName} invited you to a ${GAME_LABEL} game. Tap to play!`,
          tag: `{{slug}}-invite-${record.id}`,
          url: gameUrl(record.id),
          icon: ICON,
        })
        results.push({ user_id: inviteeId, ...r })
      }
      return new Response(JSON.stringify({ results }), { status: 200, headers: corsHeaders })
    }

    // ── opponent_joined: {{slug}}_games UPDATE waiting→active ──
    if (payload.type === 'opponent_joined') {
      const { record } = payload
      if (!record?.id || !record.created_by || !record.invited_user_id) {
        return new Response(JSON.stringify({ skipped: 'missing fields' }), { status: 200, headers: corsHeaders })
      }
      const joinerName = await getUsername(supabase, record.invited_user_id)
      const result = await sendIfOptedIn(supabase, record.created_by, APP, 'opponent_joined', {
        title: `${GAME_LABEL} — opponent joined!`,
        body: `${joinerName} joined your game. Time to play!`,
        tag: `{{slug}}-join-${record.id}`,
        url: gameUrl(record.id),
        icon: ICON,
      })
      return new Response(JSON.stringify(result), { status: 200, headers: corsHeaders })
    }

    // ── turn_change: {{slug}}_games UPDATE current_player_idx changed ──
    if (payload.type === 'turn_change') {
      const { record, old_record } = payload
      if (!record || record.status !== 'active') {
        return new Response(JSON.stringify({ skipped: 'game not active' }), { status: 200, headers: corsHeaders })
      }
      if (old_record && record.current_player_idx === old_record.current_player_idx) {
        return new Response(JSON.stringify({ skipped: 'turn did not change' }), { status: 200, headers: corsHeaders })
      }

      const { data: currentPlayer } = await supabase
        .from('{{slug}}_players')
        .select('user_id')
        .eq('game_id', record.id)
        .eq('player_index', record.current_player_idx)
        .single()
      if (!currentPlayer) {
        return new Response(JSON.stringify({ skipped: 'player not found' }), { status: 200, headers: corsHeaders })
      }

      let moverName = 'Opponent'
      if (old_record && old_record.current_player_idx != null) {
        const { data: mover } = await supabase
          .from('{{slug}}_players')
          .select('user_id')
          .eq('game_id', record.id)
          .eq('player_index', old_record.current_player_idx)
          .single()
        if (mover) moverName = await getUsername(supabase, mover.user_id)
      }

      const result = await sendIfOptedIn(supabase, currentPlayer.user_id, APP, 'your_turn', {
        title: `${GAME_LABEL} — your turn!`,
        body: `${moverName} played. Your move!`,
        tag: `{{slug}}-turn-${record.id}`,
        url: gameUrl(record.id),
        icon: ICON,
      })
      return new Response(JSON.stringify(result), { status: 200, headers: corsHeaders })
    }

    // ── game_finished: {{slug}}_games UPDATE active→finished ──
    // Fans out to every player. Outcome comes from {{slug}}_players.is_winner
    // (authoritative for N players — the top-score group all win, so a
    // tie-for-first reads as a win for each tied player).
    if (payload.type === 'game_finished') {
      const { record } = payload
      if (!record?.id) {
        return new Response(JSON.stringify({ skipped: 'missing fields' }), { status: 200, headers: corsHeaders })
      }
      // Admin closes are silent — only used to clean up stuck test games.
      if (record.closed_by_admin) {
        return new Response(JSON.stringify({ skipped: 'closed_by_admin' }), { status: 200, headers: corsHeaders })
      }

      const { data: pls } = await supabase
        .from('{{slug}}_players')
        .select('user_id, is_winner')
        .eq('game_id', record.id)
      const playerRows = pls ?? []
      if (!playerRows.length) {
        return new Response(JSON.stringify({ skipped: 'no players' }), { status: 200, headers: corsHeaders })
      }

      const winners = playerRows.filter((p: any) => p.is_winner)
      const winnerIds = new Set(winners.map((p: any) => p.user_id))
      const winnerNames: string[] = []
      for (const w of winners) winnerNames.push(await getUsername(supabase, w.user_id))
      const winnerLabel = winnerNames.join(' & ') || 'Someone'
      const tie = winners.length > 1

      const results: any[] = []
      for (const p of playerRows) {
        const userId = p.user_id
        let title = `${GAME_LABEL} — game over`
        let body: string

        if (record.forfeit_user_id === userId) {
          if (record.end_reason === 'claim') {
            // Claimed against while idle — NOT a voluntary forfeit.
            body = `${winnerLabel} claimed the win because your turn was idle 7+ days.`
          } else {
            body = 'You forfeited the game.'
          }
        } else if (winnerIds.has(userId)) {
          title = `${GAME_LABEL} — you won!`
          if (record.end_reason === 'forfeit' && !tie) {
            body = `${await getUsername(supabase, record.forfeit_user_id)} forfeited, you win!`
          } else {
            body = tie ? 'You tied for 1st! 🏆' : 'You won! 🏆'
          }
        } else {
          body = `${winnerLabel} won${tie ? ' (tie)' : ''}. Rematch?`
        }

        const r = await sendIfOptedIn(supabase, userId, APP, 'game_finished', {
          title,
          body,
          tag: `{{slug}}-finish-${record.id}`,
          url: gameUrl(record.id),
          icon: ICON,
        })
        results.push({ user_id: userId, ...r })
      }
      return new Response(JSON.stringify({ results }), { status: 200, headers: corsHeaders })
    }

    // ── game_closed: expire sweep closed a never-filled game ──
    // Only fires when just the creator was seated at expiry (unplayable),
    // so there's exactly one recipient. Reuses the game_finished pref
    // bucket so it honors the same opt-out.
    if (payload.type === 'game_closed') {
      const { record } = payload
      if (!record?.id || !record.created_by) {
        return new Response(JSON.stringify({ skipped: 'missing fields' }), { status: 200, headers: corsHeaders })
      }
      const result = await sendIfOptedIn(supabase, record.created_by, APP, 'game_finished', {
        title: `${GAME_LABEL} — game closed`,
        body: 'Your game closed because no one else joined in time.',
        tag: `{{slug}}-closed-${record.id}`,
        url: gameUrl(record.id),
        icon: ICON,
      })
      return new Response(JSON.stringify(result), { status: 200, headers: corsHeaders })
    }

    // ── nudge: client POST, remind the current player it's their turn ──
    // The {{slug}}_nudge RPC has already validated eligibility; the client
    // stamps the cooldown ({{slug}}_mark_nudged) only after this send lands
    // (c264). We just look up who to ping and send.
    if (payload.type === 'nudge') {
      const { game_id, nudger_name } = payload
      const { data: game } = await supabase
        .from('{{slug}}_games')
        .select('current_player_idx, status')
        .eq('id', game_id)
        .single()
      if (!game || game.status !== 'active') {
        return new Response(JSON.stringify({ skipped: 'game not active' }), { status: 200, headers: corsHeaders })
      }
      const { data: currentPlayer } = await supabase
        .from('{{slug}}_players')
        .select('user_id')
        .eq('game_id', game_id)
        .eq('player_index', game.current_player_idx)
        .single()
      if (!currentPlayer) {
        return new Response(JSON.stringify({ skipped: 'player not found' }), { status: 200, headers: corsHeaders })
      }
      const result = await sendIfOptedIn(supabase, currentPlayer.user_id, APP, 'nudge', {
        title: `${GAME_LABEL} — your turn!`,
        body: `${nudger_name || 'Someone'} is waiting for your move! 🔔`,
        tag: `{{slug}}-nudge-${game_id}`,
        url: gameUrl(game_id),
        icon: ICON,
      })
      return new Response(JSON.stringify(result), { status: 200, headers: corsHeaders })
    }

    return new Response(JSON.stringify({ skipped: 'unknown type' }), { status: 200, headers: corsHeaders })
  } catch (err: any) {
    console.error('{{name}} push notification error:', err)
    await reportServerError('{{name}}', payload?.type ?? 'unknown', err?.message)
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders })
  }
})
