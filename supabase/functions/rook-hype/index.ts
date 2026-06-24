// Read-only hype-event feed for the Rook Discord bot (card c222).
// Deterministic "highlights reel" events since a cursor; the bot polls this ~60s,
// posts new events into #highlights, and advances its cursor. Auth is a shared
// secret in the `x-rook-secret` header (deploy with --no-verify-jwt). The
// service-role key stays server-side; the bot never holds DB credentials.
//
// Body:
//   { "since": "2026-06-16T12:00:00Z",  // ISO timestamp cursor (required-ish; see below)
//     "limit": 200 }                    // max events to return (optional)
//
// If `since` is missing/invalid we default to "5 minutes ago" so a fresh bot (or a
// bad cursor) does not dump the entire backlog into the channel on first poll.
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { guard, serviceClient, json, dbError } from '../_shared/rook.ts'

serve(async (req: Request) => {
  const blocked = guard(req); if (blocked) return blocked

  const body = await req.json().catch(() => ({}))

  // Parse the cursor; fall back to 5 minutes ago so a missing/bad cursor never
  // floods the channel with the whole history.
  let since = new Date(Date.now() - 5 * 60 * 1000)
  if (body && typeof body.since === 'string') {
    const t = new Date(body.since)
    if (!Number.isNaN(t.getTime())) since = t
  }
  const limit = Number.isFinite(Number(body?.limit)) ? Math.trunc(Number(body.limit)) : 200

  const supabase = serviceClient()
  const { data, error } = await supabase.rpc('rook_hype_events', {
    p_since: since.toISOString(),
    p_limit: limit,
  })
  if (error) return dbError('rook-hype', error)
  return json({ events: data ?? [] })
})
