// Rook activity stats for role sync (card c203, feature 4). Shared-secret auth.
// Returns { users: [{ discord_id, username, daily_streak, is_champion }] } for
// every linked + active account. Service-role stays server-side.
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { guard, serviceClient, json, dbError } from '../_shared/rook.ts'

serve(async (req: Request) => {
  const blocked = guard(req); if (blocked) return blocked

  const supabase = serviceClient()
  const { data, error } = await supabase.rpc('rook_activity')
  if (error) return dbError('rook-activity', error)
  return json(data)
})
