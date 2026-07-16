// Rook /profile feed (card c203). Shared-secret auth. Takes { discord_id } and
// returns that linked player's stats + badge signals, or { linked: false }.
// Service-role stays server-side; the bot only ever asks for the caller's own id.
//
// Optional scoring knobs (win/tie/solo/botWin/botWinsPerDay) are forwarded to
// rook_profile so the champion crown is computed with the bot's config.js values
// — the same plumbing as rook-weekly-points (review round 2, item 3).
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { guard, serviceClient, json, dbError } from '../_shared/rook.ts'

const intOr = (v: unknown, dflt: number) => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.trunc(n) : dflt
}

serve(async (req: Request) => {
  const blocked = guard(req); if (blocked) return blocked

  const body = await req.json().catch(() => ({}))
  const discord_id = body?.discord_id
  if (!discord_id) return json({ error: 'missing discord_id' }, 400)

  const supabase = serviceClient()
  const { data, error } = await supabase.rpc('rook_profile', {
    p_discord_id: String(discord_id),
    p_win: intOr(body?.win, 100),
    p_tie: intOr(body?.tie, 50),
    p_solo: intOr(body?.solo, 25),
    p_bot_win: intOr(body?.botWin, 25),
    p_bot_wins_per_day: intOr(body?.botWinsPerDay, 3),
  })
  if (error) return dbError('rook-profile', error)
  return json(data)
})
