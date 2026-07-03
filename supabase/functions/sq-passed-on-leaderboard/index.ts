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

async function sendPushToUser(
  supabase: any,
  userId: string,
  payload: { title: string; body: string; tag: string; url: string; icon?: string }
): Promise<{ sent: boolean; reason?: string }> {
  // Hub-level: try the sidequest subscription first, then any per-game
  // subscription as fallback (a player may only have a game installed).
  const apps = ['sidequest', 'yahdle', 'snibble', 'wordy', 'rungles']
  for (const app of apps) {
    const { data: sub } = await supabase
      .from('push_subscriptions')
      .select('endpoint, keys_p256dh, keys_auth')
      .eq('user_id', userId)
      .eq('app', app)
      .maybeSingle()
    if (!sub) continue
    const pushSubscription = {
      endpoint: sub.endpoint,
      keys: { p256dh: sub.keys_p256dh, auth: sub.keys_auth },
    }
    try {
      await webpush.sendNotification(pushSubscription, JSON.stringify(payload), { TTL: 86400 })
      return { sent: true }
    } catch (err: any) {
      if (err.statusCode === 410 || err.statusCode === 404) {
        await supabase.from('push_subscriptions').delete().eq('user_id', userId).eq('app', app)
        continue
      }
      throw err
    }
  }
  return { sent: false, reason: 'no push subscription' }
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
