// Supabase Edge Function: sq-daily-reminder
//
// Hub-level daily reminder ping. Called once per 30-min slot by a
// pg_cron job (see sq_daily_reminder_cron.sql). For each user whose
// chosen local-time slot matches "now in their tz" AND who has at
// least one unplayed daily, sends ONE push: "Your daily puzzles
// are ready 🎲".
//
// Why a single hub-level push instead of per-game:
//   • Stays at one ping/day no matter how many daily games you have
//   • Time + opt-out controlled in one place (SideQuest > Notifications)
//   • Body stays generic; the corner-dot on the hub tile shows which
//     games actually have something unplayed
//
// All filtering happens in sq_daily_reminder_candidates() — which
// also enforces the user's per-topic opt-in and master toggle. Edge
// function just dispatches webpush to whoever the SQL returns.

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
  // Daily reminder is hub-level — try the sidequest subscription first,
  // then any per-game subscription as fallback.
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

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    // SQL does the work: returns user_ids whose local-time slot is
    // "now", who have daily_reminder enabled + master on, and who
    // have at least one unplayed daily.
    const { data: candidates, error } = await supabase.rpc('sq_daily_reminder_candidates')
    if (error) {
      console.error('sq_daily_reminder_candidates failed:', error)
      return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders })
    }

    const results: any[] = []
    for (const row of candidates ?? []) {
      const r = await sendPushToUser(supabase, row.user_id, {
        title: 'Your daily puzzles are ready 🎲',
        body: 'Tap to play today\'s SideQuest dailies.',
        tag: 'sq-daily-reminder',
        url: '/games/',
        icon: '/games/favicon.svg',
      })
      results.push({ user_id: row.user_id, ...r })
    }
    return new Response(JSON.stringify({ count: results.length, results }), { status: 200, headers: corsHeaders })
  } catch (err: any) {
    console.error('sq-daily-reminder error:', err)
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders })
  }
})
