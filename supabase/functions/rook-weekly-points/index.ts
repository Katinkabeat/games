// Read-only weekly POINTS board for the Rook Discord bot (card c214).
// The competitive "resets every Monday" lane that sits alongside the per-game
// leaderboards. Auth is a shared secret in the `x-rook-secret` header
// (deploy with --no-verify-jwt). The service-role key stays server-side; the
// bot never holds DB credentials.
//
// Body (all optional — the bot's config.js owns the scoring knobs):
//   {
//     "week": 0 | 1,            // 0 = this week to date, 1 = last completed week (default 1)
//     "limit": 10,              // how many leaders to return
//     "win": 100, "tie": 50,    // versus point values
//     "solo": 25,               // solo/daily completion value
//     "botWin": 25,             // Wordy-vs-bot win value
//     "botWinsPerDay": 3        // daily cap on counted bot wins
//   }
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { guard, serviceClient, json, dbError } from '../_shared/rook.ts'

// Coerce a body value to an int, falling back to a default if absent/invalid.
const intOr = (v: unknown, dflt: number) => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.trunc(n) : dflt
}

serve(async (req: Request) => {
  const blocked = guard(req); if (blocked) return blocked

  const body = await req.json().catch(() => ({}))
  const week = body && body.week === 0 ? 0 : 1

  const supabase = serviceClient()
  const { data, error } = await supabase.rpc('rook_weekly_points', {
    p_week: week,
    p_limit: intOr(body?.limit, 10),
    p_win: intOr(body?.win, 100),
    p_tie: intOr(body?.tie, 50),
    p_solo: intOr(body?.solo, 25),
    p_bot_win: intOr(body?.botWin, 25),
    p_bot_wins_per_day: intOr(body?.botWinsPerDay, 3),
  })
  if (error) return dbError('rook-weekly-points', error)
  return json(data)
})
