// Supabase Edge Function: sq-report-client-error (c265)
//
// Receives a compact client-error record from a SideQuest game and forwards it
// to the PRIVATE #error-log Discord channel via an incoming webhook, posting
// under Rook's name. The webhook URL is held here (server-side) and never ships
// in the client bundle — a Discord webhook URL in public JS is an abuse magnet.
//
// This is best-effort logging plumbing. It always answers 200 to the client
// (except an auth/shape reject) so a reporting hiccup never becomes a second
// failure the game has to handle. The real breakage it reports still stands on
// its own; this only makes it VISIBLE.
//
// This function is only ever called from the browser (never a DB webhook), so
// it is deployed WITH JWT verification ON (default): Supabase's gateway rejects
// any caller that doesn't present a valid project key before the request reaches
// this code, which sheds header-less scanners for free. The channel is private
// to Rae and messages carry allowed_mentions:{parse:[]}, so nothing can ping.

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'

const WEBHOOK = Deno.env.get('SQ_DISCORD_ERRORLOG_WEBHOOK') ?? ''

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

// Trim + hard-cap a field so a hostile/huge payload can't flood the channel.
function clamp(v: unknown, max: number): string {
  return String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
}

// Defensive server-side dedup within a warm instance. The client dedups per
// session already; this catches a caller that doesn't (and repeated tabs).
const seen = new Map<string, number>()
const DEDUP_MS = 5 * 60 * 1000

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)

  let payload: any
  try { payload = await req.json() } catch { return json({ error: 'bad json' }, 400) }

  const game = clamp(payload.game, 32)
  const type = clamp(payload.type, 64)
  if (!game || !type) return json({ error: 'game and type required' }, 400)
  const detail = clamp(payload.detail, 500)
  const status = Number.isFinite(payload.status) ? Number(payload.status) : null

  if (!WEBHOOK) {
    console.error('sq-report-client-error: SQ_DISCORD_ERRORLOG_WEBHOOK not set')
    return json({ skipped: 'no webhook configured' })
  }

  // Server-side dedup (best-effort; instances are ephemeral).
  const sig = `${game}:${type}:${status ?? 'net'}`
  const now = Date.now()
  const last = seen.get(sig)
  if (last && now - last < DEDUP_MS) return json({ skipped: 'deduped' })
  seen.set(sig, now)

  const nice: Record<string, string> = { wordy: 'Wordy', yahdle: 'Yahdle', rungles: 'Rungles', snibble: 'Snibble', oublex: 'Oublex' }
  const gameLabel = nice[game] ?? game
  const statusLine = status === null ? 'network / timeout error' : `HTTP ${status}`
  const lines = [
    `**${gameLabel}** — client push failed`,
    `\`${type}\` · ${statusLine}`,
  ]
  if (detail) lines.push(`detail: ${detail}`)

  try {
    const res = await fetch(`${WEBHOOK}?wait=true`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'Rook',
        content: lines.join('\n'),
        allowed_mentions: { parse: [] }, // never ping anyone, even if detail contains a mention
      }),
    })
    if (!res.ok) {
      console.error('sq-report-client-error: webhook returned', res.status)
      return json({ reported: false, reason: `webhook http ${res.status}` })
    }
    return json({ reported: true })
  } catch (err: any) {
    console.error('sq-report-client-error: webhook post failed', err?.message)
    return json({ reported: false, reason: 'webhook error' })
  }
})
