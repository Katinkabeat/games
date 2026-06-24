// Runtime admin settings for the Rook Discord bot (card c224).
// Rook's FIRST write path — deliberately narrow. Auth is the shared secret in the
// `x-rook-secret` header (deploy with --no-verify-jwt). The service-role key stays
// server-side; the bot never holds DB credentials. The actual write is guarded by
// `rook_set_setting`, which whitelists the (category, key) pairs and only accepts
// booleans — so even a leaked bot token can't write arbitrary data.
//
// Body:
//   { "action": "get" }                                  -> { settings: {...} }
//   { "action": "set", "category": "hype",
//     "key": "rivalry", "value": false }                 -> { settings: {...} }
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { guard, serviceClient, json, dbError } from '../_shared/rook.ts'

serve(async (req: Request) => {
  const blocked = guard(req); if (blocked) return blocked

  const body = await req.json().catch(() => ({}))
  const action = body?.action

  const supabase = serviceClient()

  if (action === 'get') {
    const { data, error } = await supabase.rpc('rook_get_settings')
    if (error) return dbError('rook-config get', error)
    return json({ settings: data ?? {} })
  }

  if (action === 'set') {
    const { category, key, value } = body ?? {}
    if (typeof category !== 'string' || typeof key !== 'string') {
      return json({ error: 'category and key are required strings' }, 400)
    }
    if (typeof value !== 'boolean') {
      return json({ error: 'value must be a boolean' }, 400)
    }
    const { data, error } = await supabase.rpc('rook_set_setting', {
      p_category: category,
      p_key: key,
      p_enabled: value,
    })
    if (error) {
      // A whitelist rejection (check_violation) is intentional admin feedback, not
      // a schema leak — surface it as a 400. Anything else is a generic 500.
      if (/unknown setting/i.test(error.message)) return json({ error: error.message }, 400)
      return dbError('rook-config set', error)
    }
    return json({ settings: data ?? {} })
  }

  return json({ error: 'unknown action (expected "get" or "set")' }, 400)
})
