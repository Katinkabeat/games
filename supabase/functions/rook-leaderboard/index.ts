// Read-only leaderboard data for the Rook Discord bot (card c203).
// Auth is a shared secret in the `x-rook-secret` header (deploy with --no-verify-jwt).
// The service-role key stays server-side; the bot never holds DB credentials.
// Body: { "week": 0 | 1 }  (0 = this week to date, 1 = last completed week; default 1)
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { guard, serviceClient, json, dbError } from '../_shared/rook.ts'

serve(async (req: Request) => {
  const blocked = guard(req); if (blocked) return blocked

  let week = 1
  const body = await req.json().catch(() => ({}))
  if (body && body.week === 0) week = 0

  const supabase = serviceClient()
  const { data, error } = await supabase.rpc('rook_weekly_leaderboards', { p_week: week })
  if (error) return dbError('rook-leaderboard', error)
  return json(data)
})
