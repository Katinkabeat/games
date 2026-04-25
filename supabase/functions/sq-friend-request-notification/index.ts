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

async function sendPushToUser(
  supabase: any,
  userId: string,
  payload: { title: string; body: string; tag: string; url: string; icon?: string }
): Promise<{ sent: boolean; reason?: string; via?: string }> {
  const apps = ['sidequest', 'wordy', 'rungles']

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
      return { sent: true, via: app }
    } catch (pushErr: any) {
      if (pushErr.statusCode === 410 || pushErr.statusCode === 404) {
        await supabase.from('push_subscriptions').delete().eq('user_id', userId).eq('app', app)
        continue
      }
      throw pushErr
    }
  }

  return { sent: false, reason: 'no push subscription' }
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const payload = await req.json()

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

    const result = await sendPushToUser(supabase, recipientId, {
      title: "Rae's Side Quest",
      body: `${requesterName} wants to be friends!`,
      tag: `sq-friend-${requesterId}`,
      url: '/games/',
      icon: '/games/favicon.svg',
    })

    return new Response(JSON.stringify(result), { status: 200, headers: corsHeaders })
  } catch (err: any) {
    console.error('Friend request notification error:', err)
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders })
  }
})
