// Rook account-link redeem (card c203, feature 4). Shared-secret auth.
// Body: { code, discord_id, discord_username }. Verifies the one-time code and
// writes the Discord<->SQ mapping. Service-role stays server-side.
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { guard, serviceClient, json, dbError } from '../_shared/rook.ts'

serve(async (req: Request) => {
  const blocked = guard(req); if (blocked) return blocked

  const body = await req.json().catch(() => ({}))
  const code = typeof body.code === 'string' ? body.code.trim() : ''
  const discordId = typeof body.discord_id === 'string' ? body.discord_id : ''
  if (!code || !discordId) return json({ ok: false, error: 'missing_fields' }, 400)

  const supabase = serviceClient()
  const { data, error } = await supabase.rpc('rook_redeem_link_code', {
    p_code: code,
    p_discord_id: discordId,
    p_discord_username: body.discord_username ?? null,
  })
  if (error) return dbError('rook-link-redeem', error, { ok: false })
  return json(data)
})
