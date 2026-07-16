// Rook activity stats for role sync (card c203, feature 4). Shared-secret auth.
// Returns { users: [{ discord_id, username, is_champion, signals }] } for
// every linked + active account. Service-role stays server-side.
//
// Optional scoring knobs (win/tie/solo/botWin/botWinsPerDay) are forwarded to
// rook_activity so the champion crown is computed with the bot's config.js values
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

  const supabase = serviceClient()
  const { data, error } = await supabase.rpc('rook_activity', {
    p_win: intOr(body?.win, 100),
    p_tie: intOr(body?.tie, 50),
    p_solo: intOr(body?.solo, 25),
    p_bot_win: intOr(body?.botWin, 25),
    p_bot_wins_per_day: intOr(body?.botWinsPerDay, 3),
  })
  if (error) return dbError('rook-activity', error)
  return json(data)
})
