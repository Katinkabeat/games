// Hype feed for the Rook Discord bot (card c222; outbox rework review r2).
// Auth is a shared secret in the `x-rook-secret` header (deploy with
// --no-verify-jwt). The service-role key stays server-side.
//
// Three modes:
//   { "fetch": true, "limit": 50 }   -> rook_hype_fetch: detect + return the
//                                       undelivered backlog (id-ordered)
//   { "ack": [1, 2, 3] }             -> rook_hype_ack: mark events delivered
//   { "since": "<ISO>", "limit": n } -> LEGACY replay via rook_hype_events;
//                                       read-only, kept for the test harness
//                                       and diag scripts. The live loop uses
//                                       fetch/ack.
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { guard, serviceClient, json, dbError } from '../_shared/rook.ts'

serve(async (req: Request) => {
  const blocked = guard(req); if (blocked) return blocked

  const body = await req.json().catch(() => ({}))
  const supabase = serviceClient()

  // Ack mode: confirmed-delivery cursor advance.
  if (Array.isArray(body?.ack)) {
    const ids = body.ack.map((v: unknown) => Number(v)).filter((n: number) => Number.isInteger(n) && n > 0)
    const { data, error } = await supabase.rpc('rook_hype_ack', { p_ids: ids })
    if (error) return dbError('rook-hype ack', error)
    return json({ acked: data ?? 0 })
  }

  // Fetch mode: detect new events, return the undelivered backlog.
  if (body?.fetch) {
    const limit = Number.isFinite(Number(body?.limit)) ? Math.trunc(Number(body.limit)) : 50
    const { data, error } = await supabase.rpc('rook_hype_fetch', { p_limit: limit })
    if (error) return dbError('rook-hype fetch', error)
    return json({ events: data ?? [] })
  }

  // Legacy replay: events since a timestamp, no delivery accounting.
  let since = new Date(Date.now() - 5 * 60 * 1000)
  if (body && typeof body.since === 'string') {
    const t = new Date(body.since)
    if (!Number.isNaN(t.getTime())) since = t
  }
  const limit = Number.isFinite(Number(body?.limit)) ? Math.trunc(Number(body.limit)) : 200

  const { data, error } = await supabase.rpc('rook_hype_events', {
    p_since: since.toISOString(),
    p_limit: limit,
  })
  if (error) return dbError('rook-hype', error)
  return json({ events: data ?? [] })
})
