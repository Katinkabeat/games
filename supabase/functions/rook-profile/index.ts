// Rook /profile feed (card c203). Shared-secret auth. Takes { discord_id } and
// returns that linked player's stats + badge signals, or { linked: false }.
// Service-role stays server-side; the bot only ever asks for the caller's own id.
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { guard, serviceClient, json, dbError } from '../_shared/rook.ts'

serve(async (req: Request) => {
  const blocked = guard(req); if (blocked) return blocked

  const { discord_id } = await req.json().catch(() => ({}))
  if (!discord_id) return json({ error: 'missing discord_id' }, 400)

  const supabase = serviceClient()
  const { data, error } = await supabase.rpc('rook_profile', { p_discord_id: String(discord_id) })
  if (error) return dbError('rook-profile', error)
  return json(data)
})
