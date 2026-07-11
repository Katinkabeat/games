// Supabase Edge Function: sq-push-resync (c252)
//
// Heals a rotated/expired push address WITHOUT the hub being open.
//
// Background: SideQuest consolidated all games onto a single `sidequest` push
// subscription managed only by the hub (Apr 2026). After that, opening a game
// no longer refreshes your push address — only opening the hub does. So when
// the push service rotates or expires a subscription while nothing is open, the
// first push 410s, the edge fn deletes the row, and the player goes silent
// until they next open the hub. The hub-open heal (ensurePushSubscribed, c249)
// is the only net, and it doesn't cover a player who lives inside a game tab.
//
// This function is the missing SW-level net. The hub service worker's
// `pushsubscriptionchange` handler re-subscribes the moment the address
// rotates and POSTs { oldEndpoint, oldAuth, endpoint, keys } here; we find the
// row by its OLD endpoint and swap in the new address + keys. Because the SW
// has no auth session, this is deployed `--no-verify-jwt`; instead it is gated
// by PROOF OF POSSESSION — the caller must present the old endpoint (a
// high-entropy secret) and, when the browser exposes it, the old subscription's
// `auth` key, which must match the stored row. Only the browser that actually
// held that subscription can rotate it; knowing an endpoint alone is not enough
// to redirect someone's pushes.
//
// Deploy: supabase functions deploy sq-push-resync --project-ref yyhewndblruwxsrqzart --no-verify-jwt

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

// A push endpoint is a URL; anything wildly off-shape is a bad/hostile caller.
function looksLikeEndpoint(v: unknown): v is string {
  return typeof v === 'string' && v.length >= 20 && v.length <= 1024 && /^https:\/\//.test(v)
}
function shortStr(v: unknown, max: number): string | null {
  return typeof v === 'string' && v.length > 0 && v.length <= max ? v : null
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)

  let payload: any
  try { payload = await req.json() } catch { return json({ error: 'bad json' }, 400) }

  const oldEndpoint = payload?.oldEndpoint
  const newEndpoint = payload?.endpoint
  const p256dh      = shortStr(payload?.keys?.p256dh, 512)
  const auth        = shortStr(payload?.keys?.auth, 512)
  const oldAuth     = shortStr(payload?.oldAuth, 512) // optional proof-of-possession

  if (!looksLikeEndpoint(oldEndpoint) || !looksLikeEndpoint(newEndpoint) || !p256dh || !auth) {
    return json({ error: 'missing or malformed fields' }, 400)
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

  // Endpoints are globally unique, so match on endpoint alone (not user/app).
  const { data: row, error: selErr } = await admin
    .from('push_subscriptions')
    .select('id, keys_auth')
    .eq('endpoint', oldEndpoint)
    .maybeSingle()

  if (selErr) {
    console.error('sq-push-resync select failed:', selErr)
    return json({ error: 'lookup failed' }, 500)
  }
  // No row for that old endpoint: nothing to heal (already cleaned up, or never
  // ours). Answer 200 so a routine no-op never reads as a failure to the SW.
  if (!row) return json({ resynced: false, reason: 'no matching subscription' })

  // Proof of possession: when the browser gave us the old auth key, it must
  // match the stored row. A caller who only guessed the endpoint can't pass.
  if (oldAuth && oldAuth !== row.keys_auth) {
    return json({ error: 'proof of possession failed' }, 403)
  }

  const { error: updErr } = await admin
    .from('push_subscriptions')
    .update({
      endpoint: newEndpoint,
      keys_p256dh: p256dh,
      keys_auth: auth,
      updated_at: new Date().toISOString(),
    })
    .eq('id', row.id)

  if (updErr) {
    console.error('sq-push-resync update failed:', updErr)
    return json({ error: 'update failed' }, 500)
  }

  return json({ resynced: true })
})
